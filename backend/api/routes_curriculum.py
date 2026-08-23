# -*- coding: utf-8 -*-
"""RAGDom — Routes /api/curriculum/* : CRUD + import structuré (Blueprint §7.6, D1-B).

Alimente les tables curriculum OPTIONNELLES — la clé de sortie du Mode Repli
Générique de la Vue 2. Python 3.9+."""
import uuid
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from db import connection as db

router = APIRouter()

_TABLES = {
    "terms": ("curriculum_terms", ("document_id", "term_index", "label", "metadata_json")),
    "programs": ("curriculum_programs", ("document_id", "term_id", "seq_index", "title", "source", "competencies_json")),
    "assessments": ("assessments", ("document_id", "term_id", "kind", "title",
                                    "subject_chunk_id", "correction_chunk_id", "scale_json")),
    "links": ("content_links", ("document_id", "link_type", "from_id", "to_id", "page_number", "metadata_json")),
}


def _table(kind: str):
    if kind not in _TABLES:
        raise HTTPException(404, "Type curriculum inconnu : %s" % kind)
    return _TABLES[kind]


def _validate_document_refs(conn, kind: str, item: dict) -> None:
    document_id = item.get("document_id")
    if not document_id:
        documents = [row[0] for row in conn.execute("SELECT id FROM documents ORDER BY id").fetchall()]
        if len(documents) != 1:
            raise HTTPException(400, "document_id requis; curriculum legacy ambigu interdit en écriture")
        document_id = documents[0]
        item["document_id"] = document_id
    if not conn.execute("SELECT 1 FROM documents WHERE id=?", (document_id,)).fetchone():
        raise HTTPException(404, "Document curriculum introuvable")
    if item.get("term_id"):
        owner = conn.execute("SELECT document_id FROM curriculum_terms WHERE id=?",
                             (item["term_id"],)).fetchone()
        if owner and owner[0] != document_id:
            raise HTTPException(409, "Référence term_id cross-document")
    for field in ("subject_chunk_id", "correction_chunk_id"):
        if item.get(field):
            owner = conn.execute("SELECT document_id FROM document_chunks WHERE id=?",
                                 (item[field],)).fetchone()
            if owner and owner[0] != document_id:
                raise HTTPException(409, "Référence %s cross-document" % field)


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BuildBody(StrictBody):
    """Génération AUTOMATIQUE du curriculum sur un corpus EXISTANT (V5).

    document_id optionnel : None = toute la base. Idempotent et non-destructif
    (ne reconstruit que les lignes d'origine auto ; préserve les lignes saisies
    à la main via CurriculumStudio)."""
    db: str
    document_id: Optional[str] = None


# ⚠ Déclarée AVANT les routes /{kind} : sinon POST /build serait capturé par
# create_item (@router.post("/{kind}")) avec kind="build" (résolution par ordre).
@router.post("/build")
def build(body: BuildBody):
    """Peuple DÉTERMINISTIQUEMENT (zéro LLM) les tables curriculum depuis le TOC
    et les chunks typés déjà en base, puis renvoie les comptes obtenus.

    Charge le builder depuis le moteur actif (même mécanisme que le finalize de
    l'orchestrateur). 400 si aucun moteur actif / couche absente ; 400/404 si la
    base est invalide/introuvable (wrapper commun get_connection_or_http)."""
    from core import engine_registry  # import local : db/ reste utilisable hors HTTP

    manifest = engine_registry.active_engine()
    if manifest is None:
        raise HTTPException(400, "Aucun moteur actif — génération curriculum impossible")
    try:
        builder = engine_registry.load_layer(manifest["id"], "curriculum_builder")
    except FileNotFoundError:
        raise HTTPException(400, "curriculum_builder absent du moteur %s" % manifest["id"])
    conn = db.get_mutable_connection_or_http(body.db)
    try:
        counts = builder.build_curriculum(conn, body.document_id)
        return {"built": True, "document_id": body.document_id, "counts": counts}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — erreur de build → 400 explicite (jamais 500)
        raise HTTPException(400, "Génération curriculum en échec : %s" % exc)
    finally:
        conn.close()


class ImportBody(StrictBody):
    mode: Literal["merge", "replace"] = "merge"
    document_id: Optional[str] = None
    replace_all: bool = False
    terms: Optional[List[Dict[str, Any]]] = None
    programs: Optional[List[Dict[str, Any]]] = None
    assessments: Optional[List[Dict[str, Any]]] = None
    links: Optional[List[Dict[str, Any]]] = None


@router.post("/import")
def import_curriculum(body: ImportBody, db_name: str = Query(alias="db")):
    """Import structuré, remplacé par document sauf opt-in explicite global."""
    if body.mode == "replace" and not body.document_id and not body.replace_all:
        raise HTTPException(400, "document_id ou replace_all=true requis pour replace")
    conn = db.get_mutable_connection_or_http(db_name)
    try:
        if body.document_id and not conn.execute("SELECT 1 FROM documents WHERE id=?",
                                                 (body.document_id,)).fetchone():
            raise HTTPException(404, "Document introuvable")
        conn.execute("BEGIN")
        if body.mode == "replace":
            for table in ("content_links", "assessments", "curriculum_programs", "curriculum_terms"):
                if body.replace_all:
                    conn.execute("DELETE FROM %s" % table)
                else:
                    conn.execute("DELETE FROM %s WHERE document_id=?" % table, (body.document_id,))
        counts = {}
        for kind in ("terms", "programs", "assessments", "links"):
            items = getattr(body, kind) or []
            table, columns = _TABLES[kind]
            allowed = set(columns) | {"id"}
            for item in items:
                unknown = set(item) - allowed
                if unknown:
                    raise HTTPException(422, "Champs inconnus pour %s : %s" %
                                        (kind, ", ".join(sorted(unknown))))
                item = dict(item)
                if body.document_id:
                    if item.get("document_id") not in (None, body.document_id):
                        raise HTTPException(409, "Élément curriculum hors document")
                    item["document_id"] = body.document_id
                _validate_document_refs(conn, kind, item)
                conn.execute("INSERT OR REPLACE INTO %s (id, %s) VALUES (%s)"
                             % (table, ", ".join(columns), ", ".join("?" * (len(columns) + 1))),
                             [item.get("id") or str(uuid.uuid4())] + [item.get(c) for c in columns])
            counts[kind] = len(items)
        conn.commit()
        return {"imported": counts, "mode": body.mode, "document_id": body.document_id,
                "replace_all": body.replace_all}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        raise HTTPException(400, "Import invalide : %s" % exc)
    finally:
        conn.close()


@router.get("/{kind}")
def list_items(kind: str, db_name: str = Query(alias="db"), document_id: Optional[str] = None):
    table, columns = _table(kind)
    conn = db.get_connection_or_http(db_name)
    try:
        sql = "SELECT id, %s FROM %s" % (", ".join(columns), table)
        args = []
        if document_id:
            sql += " WHERE document_id=?"
            args.append(document_id)
        rows = conn.execute(sql, args).fetchall()
        return {"items": [dict(zip(("id",) + columns, row)) for row in rows]}
    finally:
        conn.close()


@router.post("/{kind}", status_code=201)
def create_item(kind: str, payload: dict, db_name: str = Query(alias="db")):
    table, columns = _table(kind)
    unknown = set(payload) - (set(columns) | {"id"})
    if unknown:
        raise HTTPException(422, "Champs inconnus : %s" % ", ".join(sorted(unknown)))
    item_id = payload.get("id") or str(uuid.uuid4())
    conn = db.get_mutable_connection_or_http(db_name)
    try:
        _validate_document_refs(conn, kind, payload)
        values = [payload.get(col) for col in columns]
        conn.execute("INSERT INTO %s (id, %s) VALUES (%s)" % (table, ", ".join(columns),
                     ", ".join("?" * (len(columns) + 1))), [item_id] + values)
        conn.commit()
        return {"id": item_id, "created": True}
    finally:
        conn.close()


@router.put("/{kind}/{item_id}")
def update_item(kind: str, item_id: str, payload: dict, db_name: str = Query(alias="db")):
    table, columns = _table(kind)
    unknown = set(payload) - set(columns)
    if unknown:
        raise HTTPException(422, "Champs inconnus : %s" % ", ".join(sorted(unknown)))
    sets, args = [], []
    for col in columns:
        if col in payload:
            sets.append(col + "=?")
            args.append(payload[col])
    if not sets:
        raise HTTPException(400, "Aucun champ à mettre à jour")
    conn = db.get_mutable_connection_or_http(db_name)
    try:
        row = conn.execute("SELECT %s FROM %s WHERE id=?" % (", ".join(columns), table),
                           (item_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Élément introuvable")
        merged = dict(zip(columns, row))
        merged.update(payload)
        _validate_document_refs(conn, kind, merged)
        cur = conn.execute("UPDATE %s SET %s WHERE id=?" % (table, ", ".join(sets)), args + [item_id])
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Élément introuvable")
        return {"updated": True}
    finally:
        conn.close()


@router.delete("/{kind}/{item_id}")
def delete_item(kind: str, item_id: str, db_name: str = Query(alias="db")):
    table, _ = _table(kind)
    conn = db.get_mutable_connection_or_http(db_name)
    try:
        cur = conn.execute("DELETE FROM %s WHERE id=?" % table, (item_id,))
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Élément introuvable")
        return {"deleted": True}
    finally:
        conn.close()
