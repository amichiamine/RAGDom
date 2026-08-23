# -*- coding: utf-8 -*-
"""RAGDom — Routes /api/pipeline/* : batchs, SSE, stop, purge scopée, quarantaine
(Blueprint §7.4 + §7.6). Enregistrement auto des documents avec métadonnées
auto-générées depuis /sources/ (tech_specs §13). Python 3.9+."""
import asyncio
import json
import os
import queue as queue_module
import re
import threading
import time
import uuid
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

import config
from core.orchestrator import orchestrator
from core.validation_scope import ScopeResolutionError, resolve_scope
from db import connection as db

router = APIRouter()

_LEVEL_RE = re.compile(r"^(\d?A[MPS]|Term|BEM|BAC|L\d|M\d|\dAM|\dAP|\dAS)$", re.I)
_sse_queues: List[queue_module.Queue] = []
_worker: dict = {"thread": None, "pending": [], "lock": threading.Lock()}


_recent_logs: List[dict] = []
_recent_logs_lock = threading.Lock()
_MAX_RECENT_LOGS = 200


def _broadcast(event: str, data: dict) -> None:
    # Buffer tournant des derniers événements (pour hydrater un nouvel abonné SSE
    # ou une reconnexion, évitant la console "vide" après rechargement de page).
    with _recent_logs_lock:
        _recent_logs.append({"event": event, "data": data, "t": time.time()})
        if len(_recent_logs) > _MAX_RECENT_LOGS:
            _recent_logs.pop(0)
    for q in list(_sse_queues):
        try:
            q.put_nowait((event, data))
        except queue_module.Full:
            pass


orchestrator.subscribe(_broadcast)


def _resolve_source(source_path: str) -> str:
    """Chemin absolu OU relatif à /sources/ (contrat UI : rel_path de l'arbre)."""
    if not os.path.isabs(source_path):
        source_path = os.path.join(config.SOURCES_DIR, source_path)
    return os.path.realpath(source_path)


def extract_document_metadata(source_path: str, sources_dir: str) -> dict:
    """Implémentation IMPOSÉE tech_specs §13 (doc_source, tags, niveau, nom de base)."""
    rel_path = os.path.relpath(os.path.dirname(source_path), sources_dir)
    parts = rel_path.replace("\\", "/").split("/") if rel_path != "." else []
    return {
        "doc_source": "/".join(parts),
        "domain_tags_json": json.dumps(parts, ensure_ascii=False),
        "academic_level": parts[-1] if parts and _LEVEL_RE.match(parts[-1]) else None,
        "db_name": ("_".join(parts) + ".sqlite") if parts else "root.sqlite",
    }


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StartBody(StrictBody):
    source_path: str
    target_db: Optional[str] = None
    mode: Literal["document", "chapter", "page_range", "folder"] = "document"
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    toc_id: Optional[str] = None


def _register_document(db_name: str, source_path: str) -> dict:
    """Crée la base si besoin + enregistre le document (métadonnées §13). Idempotent."""
    db.require_official_mutation_target(db_name)
    real = _resolve_source(source_path)
    if not real.startswith(os.path.realpath(config.SOURCES_DIR) + os.sep):
        raise HTTPException(400, "source_path hors de /sources/")
    if not os.path.exists(real):
        raise HTTPException(404, "PDF introuvable : %s" % source_path)
    conn = db.create_database(db_name)  # applique le DDL si base neuve
    try:
        row = conn.execute("SELECT id, total_pages FROM documents WHERE source_path=?", (real,)).fetchone()
        if row is None:
            # Anti-doublon robuste : le source_path absolu est instable d'un
            # environnement à l'autre (dev /app→/agent, Render /app, Windows C:\…).
            # Identité stable = (doc_source relatif) + filename. Si un document
            # porte déjà ce couple, on le réutilise et on recale son source_path.
            meta = extract_document_metadata(real, config.SOURCES_DIR)
            row = conn.execute(
                "SELECT id, total_pages FROM documents WHERE doc_source=? AND filename=?",
                (meta["doc_source"], os.path.basename(real))).fetchone()
            if row is not None:
                conn.execute("UPDATE documents SET source_path=? WHERE id=?", (real, row[0]))
                conn.commit()
        if row:
            return {"id": row[0], "total_pages": row[1], "exists": True}
        import fitz
        pdf = fitz.open(real)
        total_pages = pdf.page_count
        pdf.close()
        meta = extract_document_metadata(real, config.SOURCES_DIR)
        doc_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO documents (id, title, filename, source_path, total_pages, file_size_bytes,"
            " doc_source, academic_level, domain_tags_json) VALUES (?,?,?,?,?,?,?,?,?)",
            (doc_id, os.path.splitext(os.path.basename(real))[0], os.path.basename(real), real,
             total_pages, os.path.getsize(real), meta["doc_source"], meta["academic_level"],
             meta["domain_tags_json"]))
        conn.commit()
        return {"id": doc_id, "total_pages": total_pages, "exists": False}
    finally:
        conn.close()


def _resolve_pages(body: StartBody, db_name: str, doc: dict):
    if body.mode == "page_range":
        if body.page_start is None or body.page_end is None:
            raise HTTPException(400, "page_start/page_end requis pour page_range")
        if body.page_start < 1 or body.page_end > doc["total_pages"] or body.page_start > body.page_end:
            raise HTTPException(400, "page_range hors bornes ou inversée")
        return body.page_start, body.page_end
    if body.mode == "chapter":
        if not body.toc_id:
            raise HTTPException(400, "toc_id requis pour chapter")
        conn = db.get_connection(db_name)
        try:
            row = conn.execute("SELECT page_start, page_end FROM document_toc"
                               " WHERE id=? AND document_id=?", (body.toc_id, doc["id"])).fetchone()
            if row is None:
                foreign = conn.execute("SELECT 1 FROM document_toc WHERE id=?", (body.toc_id,)).fetchone()
                raise HTTPException(409 if foreign else 404,
                                    "Entrée TOC hors document" if foreign else "Entrée TOC introuvable")
        finally:
            conn.close()
        start, end = int(row[0]), int(row[1] or doc["total_pages"])
        if start < 1 or end > doc["total_pages"] or start > end:
            raise HTTPException(409, "Plage TOC historique invalide")
        return start, end
    return 1, doc["total_pages"]  # document


def _run_worker(db_name: str) -> None:
    try:
        orchestrator.run_queue(db_name)
    except Exception as exc:  # noqa: BLE001
        _broadcast("error", {"error": type(exc).__name__, "details": str(exc)})
    finally:
        # Relance en chaîne : un lot enfilé sur une AUTRE base pendant ce run
        # attend dans _worker["pending"] — le worker suivant prend le relais.
        with _worker["lock"]:
            next_db = _worker["pending"].pop(0) if _worker["pending"] else None
            if next_db:
                worker = threading.Thread(target=_run_worker, args=(next_db,), daemon=True)
                _worker["thread"] = worker
                worker.start()


def resume_pending_queues() -> list:
    """Reprise au DÉMARRAGE (crash/redéploiement) : toute base ayant des jobs
    QUEUED/RUNNING voit ses RUNNING re-mis en file (recover) puis son worker
    relancé — aucun lot orphelin après un restart. Retourne les bases reprises."""
    resumed = []
    try:
        db_files = [f for f in os.listdir(config.DATABASES_DIR) if f.endswith(".sqlite")]
    except OSError:
        return resumed
    for filename in db_files:
        try:
            conn = db.get_connection(filename)
            try:
                row = conn.execute("SELECT COUNT(*) FROM pipeline_jobs"
                                   " WHERE status IN ('QUEUED','PROCESSING_CV','SEGMENTING','EXTRACTING',"
                                   " 'LINTING','VLM_RECOVERY','INDEXED')").fetchone()
            finally:
                conn.close()
            if row and row[0] > 0:
                orchestrator.recover(filename)
                _launch(filename)
                resumed.append({"db": filename, "jobs": row[0]})
        except Exception:  # noqa: BLE001 — base illisible : on n'empêche pas le boot
            continue
    return resumed


@router.post("/start", status_code=202)
def start(body: StartBody):
    real = _resolve_source(body.source_path)
    source_root = os.path.realpath(config.SOURCES_DIR) + os.sep
    if not (real + os.sep).startswith(source_root):
        raise HTTPException(400, "source_path hors de /sources/")
    if body.mode == "folder":
        if not os.path.isdir(real):
            raise HTTPException(404, "Dossier source introuvable")
        folder_db = body.target_db or extract_document_metadata(
            os.path.join(real, "x.pdf"), config.SOURCES_DIR)["db_name"]
        db.require_official_mutation_target(folder_db)
        batches, total = [], 0
        reused_any = False
        for name in sorted(os.listdir(real)):
            if not name.lower().endswith(".pdf"):
                continue
            pdf_path = os.path.join(real, name)
            doc = _register_document(folder_db, pdf_path)
            if doc.get("exists"):
                # Anti-double-ingestion : document déjà présent → reprocess scopé
                # (réutilise l'ID existant, purge UNIQUEMENT ce document, ré-ingère).
                result = _reprocess_existing_document(folder_db, doc["id"], pdf_path)
                batches.extend(result["batch_ids"])
                total += result["pages_total"]
                reused_any = True
                continue
            batch = orchestrator.enqueue_batch(folder_db, doc["id"], pdf_path, "document",
                                               1, doc["total_pages"])
            batches.append(batch["batch_id"])
            total += batch["pages_total"]
        if not batches:
            raise HTTPException(404, "Aucun PDF dans le dossier")
        _launch(folder_db)
        return {"batch_id": batches[0], "batch_ids": batches, "status": "QUEUED",
                "pages_total": total, "target_db": folder_db,
                "reused_existing_document": reused_any}
    db_name = body.target_db or extract_document_metadata(real, config.SOURCES_DIR)["db_name"]
    db.require_official_mutation_target(db_name)
    doc = _register_document(db_name, real)
    if doc.get("exists"):
        # Anti-double-ingestion (mode document) : source_path déjà ingéré → reprocess
        # scopé du document existant plutôt qu'un doublon. Réutilise l'ID existant.
        result = _reprocess_existing_document(db_name, doc["id"], real)
        _launch(db_name)
        return {"batch_id": result["batch_id"], "batch_ids": result["batch_ids"],
                "status": "QUEUED", "pages_total": result["pages_total"],
                "target_db": db_name, "reused_existing_document": True,
                "reused_document_id": doc["id"], "purged": result["purged"]}
    page_start, page_end = _resolve_pages(body, db_name, doc)
    batch = orchestrator.enqueue_batch(db_name, doc["id"], real, body.mode, page_start, page_end)
    _launch(db_name)
    return {"batch_id": batch["batch_id"], "status": "QUEUED",
            "pages_total": batch["pages_total"], "target_db": db_name,
            "reused_existing_document": False}


def _launch(db_name: str) -> None:
    with _worker["lock"]:
        thread = _worker.get("thread")
        if thread is not None and thread.is_alive():
            # Séquentiel strict D2-B : UNE base à la fois. Le worker en cours ne
            # draine que SA base → toute autre base est mise en attente et sera
            # relancée en chaîne à la fin du run (jamais de lot orphelin).
            if db_name not in _worker["pending"]:
                _worker["pending"].append(db_name)
            return
        worker = threading.Thread(target=_run_worker, args=(db_name,), daemon=True)
        _worker["thread"] = worker
        worker.start()


@router.get("/status")
def status(batch_id: str = Query(...), db_name: str = Query(alias="db")):
    conn = db.get_connection_or_http(db_name)
    try:
        batch = conn.execute(
            "SELECT status, pages_total, pages_done, updated_at FROM ingestion_batches WHERE id=?",
            (batch_id,)).fetchone()
        if batch is None:
            raise HTTPException(404, "Batch introuvable")
        done = conn.execute(
            "SELECT COUNT(*) FROM pipeline_jobs WHERE batch_id=? AND status='READY'", (batch_id,)).fetchone()[0]
        current = orchestrator.current_job
        return {"batch_id": batch_id, "status": batch[0], "pages_total": batch[1],
                "pages_done": done,
                "current_page": ({"page_number": current["page_number"], "status": current["status"],
                                  "retry_count": current.get("retry_count", 0), "error_log": None}
                                 if current and current.get("batch_id") == batch_id else None),
                "updated_at": batch[3]}
    finally:
        conn.close()


@router.get("/queue")
def queue_state(db_name: str = Query(alias="db")):
    conn = db.get_connection_or_http(db_name)
    try:
        queued = conn.execute("SELECT COUNT(*) FROM pipeline_jobs WHERE status='QUEUED'").fetchone()[0]
        completed_today = conn.execute(
            "SELECT COUNT(*) FROM pipeline_jobs WHERE status='READY' AND date(updated_at)=date('now')"
        ).fetchone()[0]
        current = orchestrator.current_job
        return {"current_job": ({"batch_id": current.get("batch_id"), "job_id": current["id"],
                                 "status": current["status"], "page_number": current["page_number"]}
                                if current else None),
                "queued_jobs": queued, "completed_today": completed_today}
    finally:
        conn.close()


@router.post("/stop")
def stop():
    """Arrêt d'urgence (§7.6) : termine la page courante, remet le reste à QUEUED."""
    orchestrator.request_stop()
    current = orchestrator.current_job or {}
    return {"stopped": True, "batch_id": current.get("batch_id"),
            "last_completed_page": (current.get("page_number", 0) or 1) - 1}


@router.delete("/batch/{batch_id}")
def cancel_batch(batch_id: str, db_name: str = Query(alias="db")):
    conn = db.get_mutable_connection_or_http(db_name)
    try:
        batch = conn.execute("SELECT status FROM ingestion_batches WHERE id=?", (batch_id,)).fetchone()
        if batch is None:
            raise HTTPException(404, "Batch introuvable")
        cur = conn.execute("DELETE FROM pipeline_jobs WHERE batch_id=? AND status='QUEUED'", (batch_id,))
        changed = conn.execute("UPDATE ingestion_batches SET status='STOPPED', updated_at=CURRENT_TIMESTAMP"
                               " WHERE id=? AND status IN ('QUEUED','RUNNING')", (batch_id,)).rowcount
        conn.commit()
        return {"cancelled": bool(changed or cur.rowcount), "batch_id": batch_id,
                "removed_jobs": cur.rowcount, "current_page_finishes_safely": True}
    finally:
        conn.close()


class ReprocessBody(StrictBody):
    """Ré-exécution SCOPÉE : purge du périmètre puis ré-ingestion du même périmètre.

    Scopes : document | page_range | chapter. La purge préserve les éditions
    humaines par défaut ; la ré-ingestion repasse TOUTES les couches du moteur
    sur le périmètre (l'unité d'exécution du pipeline est la page — D4-A).
    """
    db: str
    scope: Literal["base", "document", "toc", "chapter", "course", "title", "page",
                   "page_range", "page_selection"]
    document_id: Optional[str] = None
    page: Optional[int] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    pages: Optional[List[int]] = Field(default=None, max_length=1000)
    toc_id: Optional[str] = None
    preserve_human_edits: bool = True


def _purge_for_reprocess(conn, body: ReprocessBody, targets) -> dict:
    """Purge le périmètre déjà résolu dans la transaction du reprocess.

    Les lignes ``documents`` sont conservées, y compris pour ``base`` : elles sont
    nécessaires aux nouveaux jobs et empêchent les cascades hors périmètre. Cette
    fonction ne commit jamais.
    """
    whole_base = body.scope == "base"
    human = " AND is_human_edited=0" if body.preserve_human_edits and not whole_base else ""
    deleted = {"chunks": 0, "artifacts": 0, "toc_entries": 0, "jobs": 0,
               "curriculum_links": 0, "page_scans": 0}
    impacted_batches = set()
    for target in targets:
        where, args = _target_where(target)
        deleted["chunks"] += conn.execute(
            "SELECT COUNT(*) FROM document_chunks WHERE %s%s" % (where, human), args).fetchone()[0]
        deleted["artifacts"] += conn.execute(
            "SELECT COUNT(*) FROM scientific_artifacts WHERE %s%s" % (where, human), args).fetchone()[0]
        deleted["jobs"] += conn.execute(
            "SELECT COUNT(*) FROM pipeline_jobs WHERE %s" % where, args).fetchone()[0]
        deleted["page_scans"] += conn.execute(
            "SELECT COUNT(*) FROM page_scans WHERE %s" % where, args).fetchone()[0]
        impacted_batches.update(r[0] for r in conn.execute(
            "SELECT DISTINCT batch_id FROM pipeline_jobs WHERE %s AND batch_id IS NOT NULL" % where,
            args).fetchall())
        conn.execute("DELETE FROM scientific_artifacts WHERE %s%s" % (where, human), args)
        conn.execute("DELETE FROM document_chunks WHERE %s%s" % (where, human), args)
        conn.execute("DELETE FROM page_scans WHERE %s" % where, args)
        conn.execute("DELETE FROM processing_benchmarks WHERE %s" % where, args)
        conn.execute("DELETE FROM pipeline_jobs WHERE %s" % where, args)
        if whole_base or body.scope == "document":
            doc_id = target.document_id
            deleted["toc_entries"] += conn.execute(
                "SELECT COUNT(*) FROM document_toc WHERE document_id=?", (doc_id,)).fetchone()[0]
            deleted["curriculum_links"] += conn.execute(
                "SELECT COUNT(*) FROM content_links WHERE document_id=?", (doc_id,)).fetchone()[0]
            conn.execute("DELETE FROM document_toc WHERE document_id=?", (doc_id,))
            for table in ("content_links", "assessments", "curriculum_programs", "curriculum_terms"):
                conn.execute("DELETE FROM %s WHERE document_id=?" % table, (doc_id,))
    if impacted_batches:
        conn.execute("UPDATE ingestion_batches SET status='STOPPED', updated_at=CURRENT_TIMESTAMP"
                     " WHERE id IN (%s)" % ",".join("?" for _ in impacted_batches),
                     sorted(impacted_batches))
    return {"deleted": deleted, "stopped_batch_ids": sorted(impacted_batches)}


def _reprocess_existing_document(db_name: str, document_id: str, source_path: str) -> dict:
    """Reprocess scopé d'un document DÉJÀ ingéré (anti-double-ingestion §start).

    Réutilise l'ID existant, purge UNIQUEMENT le périmètre de ce document (scope
    ``document``) dans une seule ``BEGIN IMMEDIATE``, puis ré-enfile le document
    complet. Aucun doublon de ligne ``documents`` : l'ID est conservé et la purge
    scopée ne touche jamais les autres documents (ni les pages hors périmètre).
    """
    if not os.path.exists(source_path):
        raise HTTPException(409, "PDF source absent de /sources/ — ré-exécution impossible")
    body = ReprocessBody(db=db_name, scope="document", document_id=document_id)
    conn = db.get_mutable_connection_or_http(db_name)
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            targets = resolve_scope(conn, body.scope, body.document_id, body.toc_id,
                                    body.page, body.page_start, body.page_end, body.pages)
        except ScopeResolutionError as exc:
            raise HTTPException(exc.status_code, str(exc))
        purge_result = _purge_for_reprocess(conn, body, targets)
        batches = []
        for target in targets:
            groups = []
            for selected in target.pages:
                if not groups or selected != groups[-1][-1] + 1:
                    groups.append([selected])
                else:
                    groups[-1].append(selected)
            for group in groups:
                batch = orchestrator.enqueue_batch(
                    db_name, target.document_id, source_path, body.scope,
                    group[0], group[-1], conn=conn, commit=False, emit=False)
                batches.append(batch)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    for batch in batches:
        orchestrator._emit("queue_update", {"queue_length": batch["pages_total"] -
                                             batch["skipped_ready"] - batch["skipped_active"],
                                             "batch_id": batch["batch_id"]})
    return {"purged": purge_result.get("deleted"), "batch_id": batches[0]["batch_id"] if batches else None,
            "batch_ids": [b["batch_id"] for b in batches],
            "pages_total": sum(b["pages_total"] for b in batches)}


@router.post("/reprocess", status_code=202)
def reprocess(body: ReprocessBody):
    """Valide, purge et enfile sous un verrou SQLite d'écriture unique."""
    conn = db.get_mutable_connection_or_http(body.db)
    try:
        # BEGIN IMMEDIATE est acquis avant la résolution. Toute écriture concurrente
        # finit avant notre image ou attend notre commit; un échec fait un rollback
        # local, jamais un restore whole-db susceptible d'écraser d'autres commits.
        conn.execute("BEGIN IMMEDIATE")
        try:
            targets = resolve_scope(conn, body.scope, body.document_id, body.toc_id,
                                    body.page, body.page_start, body.page_end, body.pages)
        except ScopeResolutionError as exc:
            raise HTTPException(exc.status_code, str(exc))
        sources = {}
        for target in targets:
            row = conn.execute("SELECT source_path FROM documents WHERE id=?",
                               (target.document_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "Document introuvable")
            if not os.path.exists(row[0]):
                raise HTTPException(409, "PDF source absent de /sources/ — ré-exécution impossible")
            sources[target.document_id] = row[0]

        purge_result = _purge_for_reprocess(conn, body, targets)
        batches = []
        for target in targets:
            groups = []
            for selected in target.pages:
                if not groups or selected != groups[-1][-1] + 1:
                    groups.append([selected])
                else:
                    groups[-1].append(selected)
            for group in groups:
                batch = orchestrator.enqueue_batch(
                    body.db, target.document_id, sources[target.document_id], body.scope,
                    group[0], group[-1], conn=conn, commit=False, emit=False)
                batches.append(batch)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    for batch in batches:
        orchestrator._emit("queue_update", {"queue_length": batch["pages_total"] -
                                             batch["skipped_ready"] - batch["skipped_active"],
                                             "batch_id": batch["batch_id"]})
    _launch(body.db)
    return {"reprocessed_scope": body.scope, "purged": purge_result.get("deleted"),
            "batch_id": batches[0]["batch_id"] if batches else None,
            "batch_ids": [b["batch_id"] for b in batches],
            "pages_total": sum(b["pages_total"] for b in batches),
            "page_start": targets[0].page_start if len(targets) == 1 else None,
            "page_end": targets[0].page_end if len(targets) == 1 else None,
            "targets": [{"document_id": t.document_id, "pages": list(t.pages)} for t in targets],
            "status": "QUEUED"}


class PurgeBody(StrictBody):
    db: str
    scope: str
    document_id: Optional[str] = None
    toc_id: Optional[str] = None
    page: Optional[int] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    pages: Optional[List[int]] = Field(default=None, max_length=1000)
    dry_run: bool = True
    preserve_human_edits: bool = True
    confirm: Optional[str] = None


def _target_where(target):
    pages = list(target.pages)
    if pages == list(range(pages[0], pages[-1] + 1)):
        return "document_id=? AND page_number BETWEEN ? AND ?", [target.document_id, pages[0], pages[-1]]
    return "document_id=? AND page_number IN (%s)" % ",".join("?" for _ in pages), [target.document_id] + pages


@router.post("/purge")
def purge(body: PurgeBody):
    """Purge atomique : tous les scopes sont résolus avant la première écriture."""
    whole_base = body.scope in ("database", "base")
    if whole_base and body.confirm != body.db:
        raise HTTPException(400, "La purge complète exige confirm = nom exact de la base")
    conn = db.get_mutable_connection_or_http(body.db)
    try:
        special = body.scope in ("database", "curriculum_only", "artifacts_only")
        targets = []
        if not special or (body.scope == "artifacts_only" and body.document_id):
            scope = "document" if body.scope == "artifacts_only" else body.scope
            try:
                targets = resolve_scope(conn, scope, body.document_id, body.toc_id, body.page,
                                        body.page_start, body.page_end, body.pages)
            except ScopeResolutionError as exc:
                raise HTTPException(exc.status_code, str(exc))
        elif body.scope == "database":
            rows = conn.execute("SELECT id, total_pages FROM documents ORDER BY id").fetchall()
            targets = [type("Target", (), {"document_id": r[0], "pages": tuple(range(1, r[1] + 1))})
                       for r in rows if r[1]]

        human = " AND is_human_edited=0" if body.preserve_human_edits and not whole_base else ""

        def scoped_count(table, human_clause=""):
            if body.scope == "curriculum_only":
                return 0
            if body.scope == "artifacts_only" and not body.document_id:
                return conn.execute("SELECT COUNT(*) FROM scientific_artifacts" + human_clause).fetchone()[0]
            total = 0
            for target in targets:
                where, args = _target_where(target)
                total += conn.execute("SELECT COUNT(*) FROM %s WHERE %s%s" %
                                      (table, where, human_clause), args).fetchone()[0]
            return total

        toc_entries = 0
        if whole_base:
            toc_entries = conn.execute("SELECT COUNT(*) FROM document_toc").fetchone()[0]
        elif body.scope == "document" and targets:
            toc_entries = conn.execute("SELECT COUNT(*) FROM document_toc WHERE document_id=?",
                                       (targets[0].document_id,)).fetchone()[0]
        deleted = {
            "chunks": 0 if body.scope in ("curriculum_only", "artifacts_only") else scoped_count("document_chunks", human),
            "artifacts": 0 if body.scope == "curriculum_only" else scoped_count("scientific_artifacts", human),
            "toc_entries": toc_entries,
            "jobs": 0 if body.scope in ("curriculum_only", "artifacts_only") else scoped_count("pipeline_jobs"),
            "curriculum_links": (conn.execute("SELECT COUNT(*) FROM content_links").fetchone()[0]
                                 if body.scope in ("database", "base", "curriculum_only") else 0),
            "page_scans": 0 if body.scope in ("curriculum_only", "artifacts_only") else scoped_count("page_scans"),
        }
        preserved = 0
        if human:
            preserved = scoped_count("document_chunks", " AND is_human_edited=1")
            preserved += scoped_count("scientific_artifacts", " AND is_human_edited=1")
        if body.dry_run:
            return {"dry_run": True, "deleted": deleted, "preserved_human_edited": preserved,
                    "message": "Prévisualisation — aucune donnée modifiée."}

        impacted_batches = set()
        for target in targets:
            where, args = _target_where(target)
            impacted_batches.update(r[0] for r in conn.execute(
                "SELECT DISTINCT batch_id FROM pipeline_jobs WHERE %s AND batch_id IS NOT NULL" % where,
                args).fetchall())

        conn.execute("BEGIN")
        if body.scope == "curriculum_only":
            for table in ("content_links", "assessments", "curriculum_programs", "curriculum_terms"):
                conn.execute("DELETE FROM %s" % table)
        elif whole_base:
            for table in ("content_links", "assessments", "curriculum_programs", "curriculum_terms",
                          "scientific_artifacts", "document_chunks", "page_scans", "document_toc",
                          "processing_benchmarks", "pipeline_jobs", "ingestion_batches", "documents"):
                conn.execute("DELETE FROM %s" % table)
        elif body.scope == "artifacts_only" and not body.document_id:
            conn.execute("DELETE FROM scientific_artifacts WHERE 1=1%s" % human)
        else:
            for target in targets:
                where, args = _target_where(target)
                conn.execute("DELETE FROM scientific_artifacts WHERE %s%s" % (where, human), args)
                if body.scope != "artifacts_only":
                    conn.execute("DELETE FROM document_chunks WHERE %s%s" % (where, human), args)
                    conn.execute("DELETE FROM page_scans WHERE %s" % where, args)
                    conn.execute("DELETE FROM processing_benchmarks WHERE %s" % where, args)
                    conn.execute("DELETE FROM pipeline_jobs WHERE %s" % where, args)
                    if body.scope == "document":
                        conn.execute("DELETE FROM document_toc WHERE document_id=?", (target.document_id,))
                        for table in ("content_links", "assessments", "curriculum_programs", "curriculum_terms"):
                            conn.execute("DELETE FROM %s WHERE document_id=?" % table, (target.document_id,))
        if impacted_batches:
            conn.execute("UPDATE ingestion_batches SET status='STOPPED', updated_at=CURRENT_TIMESTAMP"
                         " WHERE id IN (%s)" % ",".join("?" for _ in impacted_batches),
                         list(impacted_batches))
        conn.commit()
        return {"dry_run": False, "deleted": deleted, "preserved_human_edited": preserved,
                "stopped_batch_ids": sorted(impacted_batches),
                "message": "Purge exécutée (scope=%s)." % body.scope}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post("/reset")
def reset(db_name: str = Query(alias="db"), document_id: Optional[str] = None):
    """DÉPRÉCIÉ (V3.2) — alias rétro-compatible de purge (voir Blueprint §7.4)."""
    body = PurgeBody(db=db_name, scope="document" if document_id else "database",
                     document_id=document_id, dry_run=False, preserve_human_edits=True,
                     confirm=db_name if not document_id else None)
    result = purge(body)
    return {"success": True, "deleted_chunks": result["deleted"]["chunks"],
            "deleted_artifacts": result["deleted"]["artifacts"], "message": "Base réinitialisée."}


class RequalifyBody(StrictBody):
    explode: bool = False  # True = exploser les cadres pleine page en sous-artefacts
    # Stratégie d'explosion : "cv" (défaut) = segmentation LOCALE CPU sans LLM
    # (frame_segmenter) puis qualification aval par PETITS crops (mécanisme
    # éprouvé) ; "vlm" = comportement historique (un gros appel VLM par cadre).
    strategy: str = "cv"
    retry_failed: bool = False
    pace_s: float = 4.0  # cadence anti-RPM entre appels VLM (stratégie vlm uniquement)
    """Requalification VLM du corpus EXISTANT (contrat consolidé §12) : reprend les
    dense_illustration à raw_binary NON NULL et ≤70 % de page, les RE-TYPE +
    STRUCTURE + SÉMANTIQUE, et (option) les ANCRE dans le chunk à leur vraie
    position. raw_binary JAMAIS supprimé. Route admin."""
    db: str
    document_id: Optional[str] = None
    run_id: Optional[str] = None
    limit: int = Field(default=200, ge=1, le=500)
    max_payload_bytes: int = Field(default=4 * 1024 * 1024, ge=1024, le=8 * 1024 * 1024)
    max_crops: int = Field(default=200, ge=1, le=500)
    allow_full_page: bool = False
    dry_run: bool = False
    anchor: bool = True


def _qualifier_and_generate():
    """(qualify_visual_artifact, generate) chargés depuis le moteur actif + noyau.

    Renvoie (None, None) si RAGDOM_VLM_ARTIFACTS=false ou si l'un des deux est
    indisponible (le corpus n'est alors pas modifié)."""
    if os.environ.get("RAGDOM_VLM_ARTIFACTS", "auto").lower() == "false":
        return None, None
    try:
        from core import engine_registry
        manifest = engine_registry.active_engine()
        if manifest is None:
            return None, None
        module = engine_registry.load_layer(manifest["id"], "artifact_qualifier")
        qualify_fn = module.qualify_visual_artifact
    except Exception:  # noqa: BLE001
        return None, None
    try:
        from llm.key_manager import generate
    except Exception:  # noqa: BLE001
        return None, None
    return qualify_fn, generate


def _requalify_area_ratio(bbox_json, width_px, height_px):
    """area_ratio depuis bounding_box_json (DICT) + dimensions page_scans. None si
    non calculable (traité comme candidat exclu > seuil)."""
    if not bbox_json or not width_px or not height_px:
        return None
    try:
        box = json.loads(bbox_json)
        w = float(box["x1"]) - float(box["x0"])
        h = float(box["y1"]) - float(box["y0"])
        page = float(width_px) * float(height_px)
        if w <= 0 or h <= 0 or page <= 0:
            return None
        return (w * h) / page
    except (ValueError, TypeError, KeyError):
        return None


_PARA_RE = re.compile(r"\n\n+")
# Détection des délimiteurs mathématiques pour la garde d'ancrage : on compte les
# blocs $$ (display) d'abord, puis les $ simples restants (inline). Un point
# d'insertion « à l'intérieur » d'un bloc a une parité IMPAIRE de délimiteurs
# ouverts avant lui — y insérer une image casserait le LaTeX (rouge en flux).
_DISPLAY_MATH_RE = re.compile(r"\$\$")
_INLINE_MATH_RE = re.compile(r"(?<!\$)\$(?!\$)")


def _inside_math_block(md: str, offset: int) -> bool:
    """True si `offset` tombe à l'intérieur d'un bloc mathématique ouvert.

    Parité IMPAIRE de `$$` avant l'offset → bloc display ouvert. Sinon, parité
    IMPAIRE de `$` simples (hors `$$`) → bloc inline ouvert. Les `$$` sont retirés
    avant le comptage des `$` simples pour ne pas les compter deux fois."""
    head = md[:offset]
    if len(_DISPLAY_MATH_RE.findall(head)) % 2 == 1:
        return True  # au milieu d'un $$…$$
    head_no_display = _DISPLAY_MATH_RE.sub("", head)
    return len(_INLINE_MATH_RE.findall(head_no_display)) % 2 == 1


def _safe_anchor_offset(md: str, seps: list, preferred: int):
    """Choisit un point d'insertion d'ancre qui NE COUPE PAS un bloc mathématique.

    Part du séparateur `preferred` (le plus proche du ratio vertical) ; s'il tombe
    dans un bloc `$$…$$` (ou `$…$`), essaie les autres séparateurs par distance
    croissante jusqu'à en trouver un hors bloc. Renvoie l'offset sûr, ou None si
    aucun séparateur n'est sûr (l'appelant ajoutera alors l'ancre en FIN de
    chunk, position toujours hors bloc)."""
    if not _inside_math_block(md, preferred):
        return preferred
    for off in sorted(seps, key=lambda s: abs(s - preferred)):
        if not _inside_math_block(md, off):
            return off
    return None


def _anchor_in_chunk(conn, artifact_id: str, caption: Optional[str], document_id: str,
                     page_number: int, y0: Optional[float], page_height: Optional[int]) -> bool:
    """Ancre idempotente `![caption](asset://artifacts/{id})` dans le chunk (même
    doc+page) au \\n\\n le plus proche du ratio y0/page_height. Ne réinsère pas si
    l'ancre existe déjà (idempotent). GARDE : l'ancre n'est jamais insérée AU
    MILIEU d'un bloc mathématique `$$…$$` / `$…$` (sinon LaTeX cassé) — on décale
    au séparateur sûr le plus proche, ou en fin de chunk. Déclenche le trigger
    FTS via UPDATE. True si modifié."""
    marker = "asset://artifacts/%s" % artifact_id
    row = conn.execute(
        "SELECT id, content_markdown FROM document_chunks"
        " WHERE document_id=? AND page_number=? ORDER BY chunk_index LIMIT 1",
        (document_id, page_number)).fetchone()
    if row is None:
        return False
    chunk_id, md = row[0], row[1] or ""
    if marker in md:
        return False  # déjà ancré (idempotent)
    image_md = "![%s](%s)" % (caption or "", marker)
    seps = [m.start() for m in _PARA_RE.finditer(md)]
    offset = None
    if seps and page_height and y0 is not None:
        ratio = max(0.0, min(1.0, float(y0) / float(page_height)))
        target = ratio * max(1, len(md))
        preferred = min(seps, key=lambda s: abs(s - target))
        offset = _safe_anchor_offset(md, seps, preferred)
    if offset is not None:
        new_md = md[:offset] + "\n\n" + image_md + md[offset:]
    else:
        # Aucun séparateur (ou tous dans un bloc math) → ajout en fin de chunk.
        new_md = (md + "\n\n" + image_md) if md else image_md
    conn.execute("UPDATE document_chunks SET content_markdown=? WHERE id=?", (new_md, chunk_id))
    return True




# Seuil « cadre quasi-pleine-page » (>70 % de page) — cohérent avec layer_2/route.
_EXPLODE_AREA_RATIO_MIN = 0.70
# Nombre max de cadres traités par appel d'explosion (garde-fou charge/quota).
_EXPLODE_MAX_FRAMES = 50
# Nombre max de sous-régions renvoyées par cadre (stratégie CV, borne mémoire).
_CV_MAX_REGIONS = 20
# render_config des sous-artefacts CV : openseadragon (dense_illustration) +
# provenance additive (origin/parent). Ces clés NE contiennent AUCUN marqueur
# vlm_* → les sous-artefacts restent candidats de la requalification standard.
_RC_DENSE_CV = {"renderer": "openseadragon", "tileSources": None, "showNavigator": True}


def _select_explode_frames(conn, body, rows):
    """Sélectionne les cadres pleine page (>70 %) à exploser, avec la garde
    d'idempotence vlm_exploded_at (jamais re-soumis, même sous retry_failed).
    Partagé par les stratégies CV et VLM."""
    frames = []
    for r in rows:
        ratio = _requalify_area_ratio(r[3], r[5], r[6])
        if ratio is None or ratio <= _EXPLODE_AREA_RATIO_MIN:
            continue
        # Garde défensive (idempotence) : un cadre déjà explosé n'est JAMAIS
        # re-soumis (sinon doublons de sous-artefacts / quota brûlé).
        done = conn.execute("SELECT render_config_json FROM scientific_artifacts"
                            " WHERE id=?", (r[0],)).fetchone()
        if done and done[0] and "vlm_exploded_at" in done[0]:
            continue
        frames.append(r)
        if len(frames) >= max(1, min(body.limit, _EXPLODE_MAX_FRAMES)):
            break
    return frames


def _mark_frame_exploded(conn, art_id, marker):
    """Fusionne un marqueur (vlm_exploded_at / vlm_failed_at [+ explode_strategy])
    dans le render_config_json du cadre parent (idempotence)."""
    prev = conn.execute("SELECT render_config_json FROM scientific_artifacts WHERE id=?",
                        (art_id,)).fetchone()
    try:
        cfg = json.loads(prev[0]) if prev and prev[0] else {}
    except ValueError:
        cfg = {}
    cfg.update(marker)
    conn.execute("UPDATE scientific_artifacts SET render_config_json=? WHERE id=?",
                 (json.dumps(cfg, ensure_ascii=False), art_id))


def _explode_frames_cv(conn, body, frames):
    """Stratégie « CV-first » (défaut) : segmentation LOCALE CPU (frame_segmenter,
    ZÉRO LLM, zéro réseau) de chaque cadre pleine page. Chaque sous-région devient
    un dense_illustration (crop WebP + bbox ABSOLUE) qui redevient AUTOMATIQUEMENT
    candidat de la requalification standard par PETITS crops — le mécanisme
    éprouvé (98/98 le même jour). Aucun appel LLM, aucune cadence nécessaire.
    Le cadre parent est marqué vlm_exploded_at + explode_strategy=cv."""
    import uuid as _uuid
    import datetime as _dt
    try:
        from core import engine_registry
        active = engine_registry.active_engine()
        seg = engine_registry.load_layer(active["id"], "frame_segmenter")
    except Exception as exc:  # noqa: BLE001 — moteur/segmenteur indisponible
        # Cause réelle exposée + inventaire des dépendances vision de l'image
        # (diagnostic ops : une image web sans cv2 casse aussi toute ingestion web).
        import importlib as _il
        import sys as _sys
        probe = {}
        for mod in ("cv2", "numpy", "PIL", "fitz"):
            try:
                _il.import_module(mod)
                probe[mod] = "ok"
            except Exception as mexc:  # noqa: BLE001
                probe[mod] = "%s: %s" % (type(mexc).__name__, str(mexc)[:80])
        raise HTTPException(503, "Segmentation CV indisponible : %s: %s | python=%s | %s"
                            % (type(exc).__name__, str(exc)[:150], _sys.executable,
                               json.dumps(probe)))
    if body.dry_run:
        return {"dry_run": True, "mode": "explode", "strategy": "cv",
                "frames": len(frames), "created": 0, "skipped_text_regions": 0}
    created = anchored = failed = skipped_text = 0
    by_type: dict = {}
    for art_id, doc_id, page_number, bbox_json, _c, _w, page_h in frames:
        row = conn.execute("SELECT raw_binary, chunk_id, domain FROM scientific_artifacts"
                           " WHERE id=?", (art_id,)).fetchone()
        if not row or not row[0]:
            failed += 1
            continue
        try:
            regions = seg.segment_frame(row[0], max_regions=min(_CV_MAX_REGIONS, body.max_crops))
        except Exception:  # noqa: BLE001 — le segmenteur ne lève jamais, ceinture+bretelles
            regions = []
        # Décalage bbox : le cadre a son propre bbox (absolu) dans la page.
        try:
            fb = json.loads(bbox_json)
            off_x, off_y = int(fb["x0"]), int(fb["y0"])
        except (ValueError, TypeError, KeyError):
            off_x = off_y = 0
        # Marqueur d'idempotence sur le cadre parent (toujours, même si 0 région :
        # une page 100 % texte n'a rien à exploser mais ne doit pas être re-soumise).
        _mark_frame_exploded(conn, art_id, {
            "vlm_exploded_at": _dt.datetime.utcnow().isoformat(),
            "explode_strategy": "cv"})
        for reg in (regions or []):
            if created >= body.max_crops:
                break
            # Les régions jugées « texte pur » sont comptées mais PAS créées :
            # inutile de les faire passer par la qualification aval (bruit). On
            # préfère toutefois garder celles au doute (is_text=False).
            if reg.get("is_text"):
                skipped_text += 1
                continue
            new_id = str(_uuid.uuid4())
            x0, y0, x1, y1 = reg["bbox_rel"]
            bbox_abs = json.dumps({"x0": off_x + x0, "y0": off_y + y0,
                                   "x1": off_x + x1, "y1": off_y + y1})
            rc = dict(_RC_DENSE_CV)
            rc["origin"] = "cv_explode"
            rc["parent_artifact_id"] = art_id
            conn.execute(
                "INSERT INTO scientific_artifacts (id, chunk_id, document_id, page_number,"
                " domain, artifact_type, raw_data, raw_binary, render_config_json, caption,"
                " searchable_text, bounding_box_json, validation_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (new_id, row[1], doc_id, page_number, row[2] or "general",
                 "dense_illustration", None, reg["raw_binary"],
                 json.dumps(rc, ensure_ascii=False), None,
                 "illustration page %d" % page_number, bbox_abs, body.run_id))
            created += 1
            by_type["dense_illustration"] = by_type.get("dense_illustration", 0) + 1
            # Ancrage in-situ (caption vide à ce stade — la qualification aval la
            # renseignera). Garde anti-bloc-mathématique intégrée à _anchor_in_chunk.
            if body.anchor and _anchor_in_chunk(conn, new_id, None, doc_id,
                                                page_number, float(off_y + y0), page_h):
                anchored += 1
    conn.commit()
    return {"dry_run": False, "mode": "explode", "strategy": "cv",
            "frames": len(frames), "created": created, "anchored": anchored,
            "by_type": by_type, "skipped_text_regions": skipped_text,
            "failed_frames": failed}


def _explode_frames_vlm(conn, body, frames):
    """Stratégie « vlm » (historique, conservée) : UN gros appel VLM par cadre qui
    liste tous les éléments (type + forme structurée + bbox %). Fragile sur les
    grosses pages (429 sur la clé forte) — d'où le défaut CV. raw_binary conservé."""
    import time as _time
    import uuid as _uuid
    import datetime as _dt
    try:
        from core import engine_registry
        active = engine_registry.active_engine()
        qual = engine_registry.load_layer(active["id"], "artifact_qualifier")
        from llm.key_manager import generate as generate_fn
    except Exception:  # noqa: BLE001
        raise HTTPException(503, "Explosion VLM indisponible")
    if body.dry_run:
        return {"dry_run": True, "mode": "explode", "strategy": "vlm",
                "frames": len(frames), "created": 0}
    created = anchored = failed = 0
    by_type: dict = {}
    for art_id, doc_id, page_number, bbox_json, _c, _w, page_h in frames:
        row = conn.execute("SELECT raw_binary, chunk_id, domain FROM scientific_artifacts"
                           " WHERE id=?", (art_id,)).fetchone()
        if not row or not row[0]:
            failed += 1
            continue
        try:
            elements = qual.explode_full_page(row[0], generate_fn,
                                              timeout_s=int(config.VLM_TIMEOUT_SECONDS) * 3)
        except Exception:  # noqa: BLE001
            elements = None
        if body.pace_s > 0:
            _time.sleep(min(body.pace_s, 15.0))
        # Décalage bbox : le cadre a son propre bbox dans la page.
        try:
            fb = json.loads(bbox_json)
            off_x, off_y = int(fb["x0"]), int(fb["y0"])
        except (ValueError, TypeError, KeyError):
            off_x = off_y = 0
        marker = {"vlm_exploded_at": _dt.datetime.utcnow().isoformat(),
                  "explode_strategy": "vlm"}
        if elements is None:
            marker = {"vlm_failed_at": marker["vlm_exploded_at"], "explode_strategy": "vlm"}
            failed += 1
        _mark_frame_exploded(conn, art_id, marker)
        for el in (elements or []):
            new_id = str(_uuid.uuid4())
            x0, y0, x1, y1 = el["bbox_rel"]
            bbox_abs = json.dumps({"x0": off_x + x0, "y0": off_y + y0,
                                   "x1": off_x + x1, "y1": off_y + y1})
            conn.execute(
                "INSERT INTO scientific_artifacts (id, chunk_id, document_id, page_number,"
                " domain, artifact_type, raw_data, raw_binary, render_config_json, caption,"
                " searchable_text, bounding_box_json, validation_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (new_id, row[1], doc_id, page_number, row[2] or "general",
                 el["artifact_type"], el.get("raw_data"), el.get("raw_binary"),
                 el["render_config_json"], el.get("caption"), el.get("searchable_text"),
                 bbox_abs, body.run_id))
            created += 1
            by_type[el["artifact_type"]] = by_type.get(el["artifact_type"], 0) + 1
            if body.anchor and _anchor_in_chunk(conn, new_id, el.get("caption"), doc_id,
                                                page_number, float(off_y + y0), page_h):
                anchored += 1
    conn.commit()
    return {"dry_run": False, "mode": "explode", "strategy": "vlm",
            "frames": len(frames), "created": created,
            "anchored": anchored, "by_type": by_type, "failed_frames": failed}


def _explode_fullpage_frames(conn, body, rows):
    """Explosion des cadres quasi-pleine-page (>70 %) en SOUS-ARTEFACTS individuels.

    Deux stratégies (body.strategy) :
      - "cv" (DÉFAUT) : segmentation LOCALE CPU sans LLM → sous-crops
        dense_illustration requalifiés ensuite par PETITS appels (éprouvé) ;
      - "vlm" (historique) : un gros appel VLM par cadre (fragile, 429).
    Le cadre d'origine est conservé et marqué vlm_exploded_at (idempotence)."""
    frames = _select_explode_frames(conn, body, rows)
    strategy = (body.strategy or "cv").strip().lower()
    if strategy == "vlm":
        return _explode_frames_vlm(conn, body, frames)
    return _explode_frames_cv(conn, body, frames)


@router.post("/requalify-artifacts")
def requalify_artifacts(body: RequalifyBody):
    """Requalification VLM du corpus existant (§12). dry_run = comptes ; réel =
    UPDATE type/raw_data/render_config_json/caption/searchable_text (+ ancre)."""
    official_db = body.db
    allowed_run_pages = None
    conn = db.get_mutable_connection_or_http(body.db)
    try:
        if body.run_id:
            run = conn.execute("SELECT status, execution_status, working_db_filename FROM validation_runs"
                               " WHERE id=?", (body.run_id,)).fetchone()
            if run is None:
                raise HTTPException(404, "Run de validation introuvable")
            if run[0] in ("ACCEPTED", "REJECTED", "CANCELLED"):
                raise HTTPException(409, "Run de validation terminal")
            if not body.dry_run and run[1] != "COMPLETED":
                raise HTTPException(409, "Requalification mutante réservée à un run COMPLETED")
            if not run[2] or not db.is_validation_working_db(run[2]):
                raise HTTPException(409, "Copie SQLite de validation absente ou non isolée")
            allowed_run_pages = {(row[0], int(row[1])) for row in conn.execute(
                "SELECT document_id,page_number FROM validation_run_pages WHERE run_id=?",
                (body.run_id,)).fetchall()}
            conn.close()
            body = body.model_copy(update={"db": run[2]})
            conn = db.get_connection_or_http(body.db)
        where, args = ["a.artifact_type='dense_illustration'", "a.raw_binary IS NOT NULL",
                       "length(a.raw_binary)<=?"], [body.max_payload_bytes]
        if body.document_id:
            where.append("a.document_id=?"); args.append(body.document_id)
        # `vlm_exploded_at` = marqueur de SUCCÈS de l'explosion : TOUJOURS exclu, même
        # sous retry_failed (qui vise les ÉCHECS à retenter, pas les succès à refaire).
        # Sans cette exclusion, les cadres déjà explosés restent éligibles à chaque
        # passe (ORDER BY page_number + limit → toujours le MÊME lot) : la boucle ne
        # converge jamais vers frames=0 et re-crée des sous-artefacts en doublon.
        where.append("(a.render_config_json IS NULL OR a.render_config_json"
                     " NOT LIKE '%vlm_exploded_at%')")
        if not body.retry_failed:  # ne pas retenter en boucle les échecs marqués
            where.append("(a.render_config_json IS NULL OR (a.render_config_json"
                         " NOT LIKE '%vlm_failed_at%' AND a.render_config_json"
                         " NOT LIKE '%vlm_qualified_at%'))")
        rows = conn.execute(
            "SELECT a.id, a.document_id, a.page_number, a.bounding_box_json, a.caption,"
            " ps.width_px, ps.height_px"
            " FROM scientific_artifacts a"
            " LEFT JOIN page_scans ps ON ps.document_id=a.document_id AND ps.page_number=a.page_number"
            " WHERE %s ORDER BY a.page_number" % " AND ".join(where),
            args).fetchall()
        if allowed_run_pages is not None:
            rows = [row for row in rows if (row[1], int(row[2])) in allowed_run_pages]

        # Candidats = dense_illustration, raw_binary NON NULL, ≤70 % (bbox DICT).
        # `limit` borne le NOMBRE DE CANDIDATS traités (pas la fenêtre SQL) : un
        # petit limit qui ne tomberait que sur des cadres pleine-page traiterait
        # sinon 0 sous-figure.
        cap = max(1, min(body.limit, body.max_crops, 500))
        candidates = []
        for r in rows:
            ratio = _requalify_area_ratio(r[3], r[5], r[6])
            if ratio is not None and ratio <= 0.70:
                candidates.append(r)
                if len(candidates) >= cap:
                    break

        # Explosion (CV ou VLM) : branchée AVANT le dry_run générique pour que le
        # dry_run d'explosion renvoie le décompte de CADRES pleine page (et non le
        # décompte de candidats ≤70 %). _explode_fullpage_frames gère son dry_run.
        if body.explode:
            if (body.strategy or "cv").lower() == "vlm" and not body.allow_full_page:
                raise HTTPException(400, "allow_full_page=true requis pour envoyer une page entière au VLM")
            result = _explode_fullpage_frames(conn, body, rows)
            if body.run_id and not body.dry_run:
                from api.routes_validation import refresh_run_working_json
                refresh_run_working_json(official_db, body.run_id, "run.requalified")
            return result

        if body.dry_run:
            return {"dry_run": True, "candidates": len(candidates), "requalified": 0,
                    "anchored": 0, "by_type": {}, "by_semantic": {}, "skipped_failures": 0}

        qualify_fn, generate_fn = _qualifier_and_generate()
        if qualify_fn is None or generate_fn is None:
            raise HTTPException(503, "Qualification VLM indisponible (RAGDOM_VLM_ARTIFACTS=false,"
                                     " moteur inactif ou noyau LLM injoignable)")

        timeout_s = int(config.VLM_TIMEOUT_SECONDS)
        requalified = anchored = skipped_failures = 0
        by_type: dict = {}
        by_semantic: dict = {}
        conn.execute("BEGIN")
        for art_id, doc_id, page_number, bbox_json, _caption, _w, page_h in candidates:
            if body.run_id:
                # The connection now points exclusively at the run's physical copy.
                conn.execute("UPDATE scientific_artifacts SET validation_run_id=? WHERE id=?",
                             (body.run_id, art_id))
            blob = conn.execute("SELECT raw_binary FROM scientific_artifacts WHERE id=?",
                                (art_id,)).fetchone()
            if blob is None or blob[0] is None:
                skipped_failures += 1
                continue
            try:
                result = qualify_fn(blob[0], generate_fn, timeout_s=timeout_s)
            except Exception:  # noqa: BLE001 — jamais d'arrêt
                result = None
            if body.pace_s > 0:
                time.sleep(min(body.pace_s, 15.0))  # respect du RPM des providers
            if not result or not result.get("artifact_type"):
                # photo/other/échec : caption + sémantique éventuelles mises à jour.
                if result and (result.get("caption") or result.get("render_config_json")):
                    # Photo/other CLASSÉ : marquer vlm_qualified_at pour ne plus le re-soumettre.
                    import datetime as _dt
                    try:
                        cfg = json.loads(result.get("render_config_json") or "{}")
                    except ValueError:
                        cfg = {}
                    cfg["vlm_qualified_at"] = _dt.datetime.utcnow().isoformat()
                    conn.execute(
                        "UPDATE scientific_artifacts SET caption=COALESCE(?,caption),"
                        " render_config_json=? WHERE id=?",
                        (result.get("caption"), json.dumps(cfg, ensure_ascii=False), art_id))
                    if result.get("semantic"):
                        by_semantic[result["semantic"]] = by_semantic.get(result["semantic"], 0) + 1
                else:
                    skipped_failures += 1
                    # Marqueur persistant : exclu des prochaines vagues (retry_failed pour retenter)
                    import datetime as _dt
                    prev = conn.execute("SELECT render_config_json FROM scientific_artifacts"
                                        " WHERE id=?", (art_id,)).fetchone()
                    try:
                        cfg = json.loads(prev[0]) if prev and prev[0] else {}
                    except ValueError:
                        cfg = {}
                    cfg["vlm_failed_at"] = _dt.datetime.utcnow().isoformat()
                    conn.execute("UPDATE scientific_artifacts SET render_config_json=? WHERE id=?",
                                 (json.dumps(cfg, ensure_ascii=False), art_id))
                continue
            conn.execute(
                "UPDATE scientific_artifacts SET artifact_type=?, raw_data=?,"
                " render_config_json=?, caption=COALESCE(?,caption), searchable_text=? WHERE id=?",
                (result["artifact_type"], result["raw_data"], result["render_config_json"],
                 result.get("caption"), result.get("searchable_text") or result["artifact_type"],
                 art_id))
            requalified += 1
            by_type[result["artifact_type"]] = by_type.get(result["artifact_type"], 0) + 1
            if result.get("semantic"):
                by_semantic[result["semantic"]] = by_semantic.get(result["semantic"], 0) + 1
            if body.anchor:
                y0 = None
                try:
                    y0 = float(json.loads(bbox_json)["y0"]) if bbox_json else None
                except (ValueError, TypeError, KeyError):
                    y0 = None
                if _anchor_in_chunk(conn, art_id, result.get("caption"), doc_id,
                                    page_number, y0, page_h):
                    anchored += 1
        conn.commit()
        result = {"dry_run": False, "candidates": len(candidates), "requalified": requalified,
                  "anchored": anchored, "by_type": by_type, "by_semantic": by_semantic,
                  "skipped_failures": skipped_failures}
        if body.run_id:
            from api.routes_validation import refresh_run_working_json
            refresh_run_working_json(official_db, body.run_id, "run.requalified")
        return result
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.get("/quarantine")
def quarantine(db_name: str = Query(alias="db")):
    conn = db.get_connection_or_http(db_name)
    try:
        rows = conn.execute(
            "SELECT id, document_id, page_number, status, retry_count, error_log, updated_at"
            " FROM pipeline_jobs WHERE status IN ('QUARANTINE','INVALID_SOURCE')"
            " ORDER BY updated_at DESC LIMIT 500").fetchall()
        return {"jobs": [{"id": r[0], "document_id": r[1], "page_number": r[2], "status": r[3],
                          "retry_count": r[4], "error_log": r[5], "updated_at": r[6]} for r in rows]}
    finally:
        conn.close()


class RetryBody(StrictBody):
    db: str
    job_ids: List[str]


@router.post("/retry")
def retry(body: RetryBody):
    conn = db.get_mutable_connection_or_http(body.db)
    try:
        retried, refused = 0, []
        for job_id in body.job_ids:
            row = conn.execute("SELECT status FROM pipeline_jobs WHERE id=?", (job_id,)).fetchone()
            if row is None:
                refused.append(job_id)
                continue
            if row[0] == "INVALID_SOURCE":
                refused.append(job_id)  # HTTP 409 sémantique : fichier inchangé
                continue
            conn.execute("UPDATE pipeline_jobs SET status='QUEUED', retry_count=0, error_log=NULL,"
                         " updated_at=CURRENT_TIMESTAMP WHERE id=?", (job_id,))
            retried += 1
        conn.commit()
        if retried:
            _launch(body.db)
        return {"retried": retried, "refused": refused}
    finally:
        conn.close()


@router.get("/stream")
async def stream():
    """SSE (Blueprint §7.4) : page_update / queue_update / job_complete / error."""
    q: queue_module.Queue = queue_module.Queue(maxsize=1000)
    # Rejoue les derniers événements pour le nouvel abonné : la console ne s'ouvre
    # plus vide après un rechargement de page ou un basculement tardif d'onglet.
    with _recent_logs_lock:
        for item in _recent_logs[-50:]:
            try:
                q.put_nowait((item["event"], item["data"]))
            except queue_module.Full:
                break
    _sse_queues.append(q)

    async def generator():
        try:
            while True:
                try:
                    event, data = q.get_nowait()
                except queue_module.Empty:
                    await asyncio.sleep(0.25)
                    continue
                yield "event: %s\ndata: %s\n\n" % (event, json.dumps(data, ensure_ascii=False))
        finally:
            _sse_queues.remove(q)

    return StreamingResponse(generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
