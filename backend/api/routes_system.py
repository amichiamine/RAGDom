# -*- coding: utf-8 -*-
"""RAGDom — Routes /api/system/* (Blueprint §7.1 + §7.6 partiel : engines).

Phase 1 : découverte des bases (Zéro Mock), santé + moteur vectoriel, registre
des moteurs. Les routes d'administration sources/databases/settings arrivent
en Phase 2 (elles vivent aussi dans ce module).
"""
import os
import sqlite3
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import config
from core import engine_registry, orchestrator as orch
from db import connection as db

router = APIRouter()


def _metrics(db_path: str) -> dict:
    conn = sqlite3.connect(db_path)
    try:
        def count(sql: str) -> int:
            try:
                return conn.execute(sql).fetchone()[0]
            except sqlite3.Error:
                return 0
        return {
            "document_count": count("SELECT COUNT(*) FROM documents"),
            "chunk_count": count("SELECT COUNT(*) FROM document_chunks"),
            "artifact_count": count("SELECT COUNT(*) FROM scientific_artifacts"),
            "page_count": count("SELECT COALESCE(SUM(total_pages),0) FROM documents"),
            "indexed_page_count": count("SELECT COUNT(*) FROM pipeline_jobs WHERE status='READY'"),
        }
    finally:
        conn.close()


@router.get("/databases")
def list_databases() -> dict:
    """Scanne physiquement /databases/ — le Frontend n'a AUCUNE donnée hardcodée."""
    items = []
    for name in sorted(os.listdir(config.DATABASES_DIR)):
        if not db.DB_NAME_RE.fullmatch(name):
            continue
        path = os.path.join(config.DATABASES_DIR, name)
        stat = os.stat(path)
        items.append({
            "filename": name,
            "size_bytes": stat.st_size,
            "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
            "metrics": _metrics(path),
        })
    return {"databases": items}


@router.get("/health")
def health() -> dict:
    state = db.vector_state()
    if state["engine"] == "unknown":  # première interrogation : sonde à chaud
        ok, _ = db.test_vector_engine()
        state = db.vector_state()
    queue_len = 0
    current = orch.orchestrator.current_job
    return {
        "status": "ok",
        "version": "3.5",
        "queue_length": queue_len if current is None else queue_len + 1,
        "vector_engine": state["engine"],
        "vector_engine_status": state["status"],
        "vector_engine_message": state["message"],
        "force_sqlite_vec": state["force"],
        "readonly": config.RAGDOM_READONLY,  # Phase 7 : le frontend masque la Vue 3
    }


class ToggleStrictBody(BaseModel):
    force_sqlite_vec: bool


@router.post("/vector-engine/toggle-strict")
def toggle_strict(body: ToggleStrictBody) -> dict:
    db.set_force_strict(body.force_sqlite_vec)
    return {"success": True, "force_sqlite_vec": body.force_sqlite_vec,
            "message": "Mode strict sqlite-vec configuré."}


@router.post("/vector-engine/test")
def test_vector_engine() -> dict:
    ok, message = db.test_vector_engine()
    return {"success": ok, "engine": db.vector_state()["engine"], "message": message}


@router.get("/engines")
def list_engines() -> dict:
    """Registre des moteurs (V3.4) — alimente le badge moteur et --engine-accent."""
    engines = engine_registry.scan_engines()
    active = engine_registry.active_engine()
    return {"engines": engines, "active_engine": active["id"] if active else None}


# ═══════════════════ Administration §7.6 (V3.2) ═══════════════════
import shutil
from fastapi import File, UploadFile, Form
from fastapi.responses import FileResponse

_REL_RE = __import__("re").compile(r"^[\w\- /\.]{0,200}$")


def _safe_rel(rel_path: str) -> str:
    rel = (rel_path or "").strip().strip("/")
    if not _REL_RE.fullmatch(rel) or ".." in rel:
        raise HTTPException(400, "Chemin relatif invalide")
    target = os.path.realpath(os.path.join(config.SOURCES_DIR, rel))
    if not target.startswith(os.path.realpath(config.SOURCES_DIR)):
        raise HTTPException(400, "Chemin hors /sources/ interdit")
    return target


def _sources_tree(base: str, rel: str = "") -> dict:
    node = {"rel_path": rel or ".", "folders": [], "files": []}
    ingested = _ingested_paths()
    for name in sorted(os.listdir(base)):
        full = os.path.join(base, name)
        if os.path.isdir(full):
            node["folders"].append(_sources_tree(full, (rel + "/" + name).strip("/")))
        elif name.lower().endswith(".pdf"):
            from api.routes_pipeline import extract_document_metadata
            meta = extract_document_metadata(full, config.SOURCES_DIR)
            node["files"].append({"name": name, "size_bytes": os.path.getsize(full),
                                  "ingested": os.path.realpath(full) in ingested,
                                  "target_db": meta["db_name"]})
    return node


def _ingested_paths() -> set:
    paths = set()
    for db_file in os.listdir(config.DATABASES_DIR):
        if not db.DB_NAME_RE.fullmatch(db_file):
            continue
        try:
            conn = db.get_connection(db_file)
            paths.update(r[0] for r in conn.execute("SELECT source_path FROM documents"))
            conn.close()
        except Exception:  # noqa: BLE001
            continue
    return paths


@router.get("/sources")
def sources_tree():
    return {"tree": [_sources_tree(config.SOURCES_DIR)]}


@router.post("/sources/upload")
async def sources_upload(file: UploadFile = File(...), rel_path: str = Form("")):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "PDF uniquement")
    target_dir = _safe_rel(rel_path)
    os.makedirs(target_dir, exist_ok=True)
    dest = os.path.join(target_dir, os.path.basename(file.filename))
    size = 0
    with open(dest, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > 1024 * 1024 * 1024:
                out.close(); os.remove(dest)
                raise HTTPException(413, "PDF > 1 Go")
            out.write(chunk)
    return {"uploaded": True, "rel_path": rel_path, "filename": os.path.basename(dest), "size_bytes": size}


class FolderBody(BaseModel):
    rel_path: str


@router.post("/sources/folder")
def sources_folder(body: FolderBody):
    os.makedirs(_safe_rel(body.rel_path), exist_ok=True)
    return {"created": True, "rel_path": body.rel_path}


@router.delete("/sources")
def sources_delete(rel_path: str = Query(...)):
    target = _safe_rel(rel_path)
    if not os.path.isfile(target):
        raise HTTPException(404, "Fichier introuvable (les dossiers ne sont jamais supprimés récursivement)")
    if os.path.realpath(target) in _ingested_paths():
        raise HTTPException(409, "PDF référencé par un document déjà ingéré")
    os.remove(target)
    return {"deleted": True}


@router.get("/databases/{filename}/export")
def database_export(filename: str):
    """Téléchargement du .sqlite autonome (wal_checkpoint TRUNCATE préalable — §7.6)."""
    path = db.sanitize_db_name(filename)
    if not os.path.exists(path):
        raise HTTPException(404, "Base introuvable")
    conn = db.get_connection(filename)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    return FileResponse(path, media_type="application/vnd.sqlite3", filename=filename)


class DuplicateBody(BaseModel):
    new_name: str


@router.post("/databases/{filename}/duplicate")
def database_duplicate(filename: str, body: DuplicateBody):
    src = db.sanitize_db_name(filename)
    dst = db.sanitize_db_name(body.new_name)
    if not os.path.exists(src):
        raise HTTPException(404, "Base source introuvable")
    if os.path.exists(dst):
        raise HTTPException(409, "La base cible existe déjà")
    conn = db.get_connection(filename)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    shutil.copy2(src, dst)
    return {"duplicated": True, "new_name": body.new_name}


class DeleteDbBody(BaseModel):
    confirm: str


@router.delete("/databases/{filename}")
def database_delete(filename: str, body: DeleteDbBody):
    if body.confirm != filename:
        raise HTTPException(400, "confirm doit être le nom exact de la base (double garde-fou)")
    current = orch.orchestrator.current_job
    if current is not None:
        raise HTTPException(409, "Un batch est en cours — suppression refusée")
    path = db.sanitize_db_name(filename)
    if not os.path.exists(path):
        raise HTTPException(404, "Base introuvable")
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(path + suffix):
            os.remove(path + suffix)
    return {"deleted": True}


# ═══════════════════ Documentation Make.com (LECTURE seule, ADMIN) ═══════════════════
# Racine du projet = parent de backend/ (ce module vit dans backend/api/).
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_MAKE_DOCS_DIR = os.path.join(_PROJECT_ROOT, "docs", "make")
_MAKE_CONTRACT_PATH = os.path.join(_MAKE_DOCS_DIR, "CONTRAT_SCENARIO_MAKE.md")
_MAKE_PROMPTS_PATH = os.path.join(_MAKE_DOCS_DIR, "PROMPTS_SCENARIOS_MAKE.md")


@router.get("/docs/make")
def make_docs() -> dict:
    """Renvoie les deux markdown Make.com (contrat + prompts) — LECTURE seule.

    Route d'ADMINISTRATION (non listée dans access_policy._PUBLIC_RULES) : elle
    passe donc par la garde Bearer/session dès qu'un contrôle d'accès est actif.
    404 propre si l'un des fichiers est absent (aucune écriture, jamais).
    """
    if not (os.path.isfile(_MAKE_CONTRACT_PATH) and os.path.isfile(_MAKE_PROMPTS_PATH)):
        raise HTTPException(404, "Documentation Make.com introuvable (docs/make/)")
    with open(_MAKE_CONTRACT_PATH, encoding="utf-8") as fh:
        contract = fh.read()
    with open(_MAKE_PROMPTS_PATH, encoding="utf-8") as fh:
        prompts = fh.read()
    return {"contract": contract, "prompts": prompts}


_SETTINGS_WHITELIST = ("vec_distance_threshold", "bm25_score_threshold", "force_sqlite_vec")


@router.get("/settings")
def get_app_settings():
    return {"settings": {
        "vec_distance_threshold": float(db.get_app_setting("vec_distance_threshold", "0.45")),
        "bm25_score_threshold": float(db.get_app_setting("bm25_score_threshold", "-0.3")),
        "force_sqlite_vec": db.get_app_setting("force_sqlite_vec", "false") == "true",
    }}


class SettingBody(BaseModel):
    key: str
    value: str


@router.put("/settings")
def put_app_setting(body: SettingBody):
    if body.key not in _SETTINGS_WHITELIST:
        raise HTTPException(400, "Clé hors whitelist : %s" % body.key)
    if body.key == "force_sqlite_vec":
        db.set_force_strict(body.value.lower() == "true")
    else:
        try:
            float(body.value)
        except ValueError:
            raise HTTPException(400, "Valeur numérique attendue")
        db._set_app_setting(body.key, body.value)  # noqa: SLF001 — API interne du module db
    return {"success": True, "key": body.key, "value": body.value}
