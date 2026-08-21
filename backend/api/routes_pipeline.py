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
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import config
from core.orchestrator import orchestrator
from db import connection as db

router = APIRouter()

_LEVEL_RE = re.compile(r"^(\d?A[MPS]|Term|BEM|BAC|L\d|M\d|\dAM|\dAP|\dAS)$", re.I)
_sse_queues: List[queue_module.Queue] = []
_worker: dict = {"thread": None, "pending": [], "lock": threading.Lock()}


def _broadcast(event: str, data: dict) -> None:
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


class StartBody(BaseModel):
    source_path: str
    target_db: Optional[str] = None
    mode: str = "document"  # document | chapter | page_range | folder
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    toc_id: Optional[str] = None


def _register_document(db_name: str, source_path: str) -> dict:
    """Crée la base si besoin + enregistre le document (métadonnées §13). Idempotent."""
    real = _resolve_source(source_path)
    if not real.startswith(os.path.realpath(config.SOURCES_DIR) + os.sep):
        raise HTTPException(400, "source_path hors de /sources/")
    if not os.path.exists(real):
        raise HTTPException(404, "PDF introuvable : %s" % source_path)
    conn = db.create_database(db_name)  # applique le DDL si base neuve
    try:
        row = conn.execute("SELECT id, total_pages FROM documents WHERE source_path=?", (real,)).fetchone()
        if row:
            return {"id": row[0], "total_pages": row[1]}
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
        return {"id": doc_id, "total_pages": total_pages}
    finally:
        conn.close()


def _resolve_pages(body: StartBody, db_name: str, doc: dict):
    if body.mode == "page_range":
        if not body.page_start or not body.page_end:
            raise HTTPException(400, "page_start/page_end requis pour page_range")
        return max(1, body.page_start), min(doc["total_pages"], body.page_end)
    if body.mode == "chapter":
        if not body.toc_id:
            raise HTTPException(400, "toc_id requis pour chapter")
        conn = db.get_connection(db_name)
        row = conn.execute("SELECT page_start, page_end FROM document_toc WHERE id=?", (body.toc_id,)).fetchone()
        conn.close()
        if row is None:
            raise HTTPException(404, "Entrée TOC introuvable")
        return row[0], row[1] or doc["total_pages"]
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
                                   " WHERE status IN ('QUEUED','RUNNING')").fetchone()
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
    if body.mode == "folder":
        folder_db = body.target_db or extract_document_metadata(
            os.path.join(real, "x.pdf"), config.SOURCES_DIR)["db_name"]
        batches, total = [], 0
        for name in sorted(os.listdir(real)):
            if not name.lower().endswith(".pdf"):
                continue
            pdf_path = os.path.join(real, name)
            doc = _register_document(folder_db, pdf_path)
            batch = orchestrator.enqueue_batch(folder_db, doc["id"], pdf_path, "document",
                                               1, doc["total_pages"])
            batches.append(batch["batch_id"])
            total += batch["pages_total"]
        if not batches:
            raise HTTPException(404, "Aucun PDF dans le dossier")
        _launch(folder_db)
        return {"batch_id": batches[0], "batch_ids": batches, "status": "QUEUED",
                "pages_total": total, "target_db": folder_db}
    db_name = body.target_db or extract_document_metadata(real, config.SOURCES_DIR)["db_name"]
    doc = _register_document(db_name, real)
    page_start, page_end = _resolve_pages(body, db_name, doc)
    batch = orchestrator.enqueue_batch(db_name, doc["id"], real, body.mode, page_start, page_end)
    _launch(db_name)
    return {"batch_id": batch["batch_id"], "status": "QUEUED",
            "pages_total": batch["pages_total"], "target_db": db_name}


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
    conn = db.get_connection(db_name)
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
    conn = db.get_connection(db_name)
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
    conn = db.get_connection(db_name)
    try:
        cur = conn.execute("DELETE FROM pipeline_jobs WHERE batch_id=? AND status='QUEUED'", (batch_id,))
        conn.execute("UPDATE ingestion_batches SET status='STOPPED', updated_at=CURRENT_TIMESTAMP"
                     " WHERE id=? AND status IN ('QUEUED','RUNNING')", (batch_id,))
        conn.commit()
        return {"cancelled": True, "removed_jobs": cur.rowcount}
    finally:
        conn.close()


class ReprocessBody(BaseModel):
    """Ré-exécution SCOPÉE : purge du périmètre puis ré-ingestion du même périmètre.

    Scopes : document | page_range | chapter. La purge préserve les éditions
    humaines par défaut ; la ré-ingestion repasse TOUTES les couches du moteur
    sur le périmètre (l'unité d'exécution du pipeline est la page — D4-A).
    """
    db: str
    scope: str  # document | page_range | chapter
    document_id: str
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    toc_id: Optional[str] = None
    preserve_human_edits: bool = True


@router.post("/reprocess", status_code=202)
def reprocess(body: ReprocessBody):
    if body.scope not in ("document", "page_range", "chapter"):
        raise HTTPException(400, "scope invalide (document | page_range | chapter)")
    conn = db.get_connection(body.db)
    try:
        row = conn.execute("SELECT source_path, total_pages FROM documents WHERE id=?",
                           (body.document_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Document introuvable")
        source_path, total_pages = row
        toc_row = None
        if body.scope == "chapter":
            if not body.toc_id:
                raise HTTPException(400, "toc_id requis pour le scope chapter")
            toc_row = conn.execute("SELECT page_start, page_end FROM document_toc WHERE id=?",
                                   (body.toc_id,)).fetchone()
            if toc_row is None:
                raise HTTPException(404, "Chapitre introuvable")
    finally:
        conn.close()
    if not os.path.exists(source_path):
        raise HTTPException(409, "PDF source absent de /sources/ — ré-exécution impossible")

    # 1) Purge du périmètre (réutilise la purge scopée réelle — jamais de duplication)
    purge_scope = {"document": "document", "page_range": "page_range", "chapter": "chapter"}[body.scope]
    purge_result = purge(PurgeBody(db=body.db, scope=purge_scope, document_id=body.document_id,
                                   page_start=body.page_start, page_end=body.page_end,
                                   toc_id=body.toc_id, dry_run=False,
                                   preserve_human_edits=body.preserve_human_edits,
                                   confirm=None))
    # 2) Ré-ingestion du même périmètre
    if body.scope == "document":
        page_start, page_end = 1, total_pages
    elif body.scope == "chapter":
        page_start, page_end = toc_row[0], toc_row[1] or total_pages
    else:
        if not body.page_start:
            raise HTTPException(400, "page_start requis pour le scope page_range")
        page_start = body.page_start
        page_end = min(body.page_end or body.page_start, total_pages)
    batch = orchestrator.enqueue_batch(body.db, body.document_id, source_path,
                                       body.scope, page_start, page_end)
    _launch(body.db)
    return {"reprocessed_scope": body.scope, "purged": purge_result.get("deleted"),
            "batch_id": batch["batch_id"], "pages_total": batch["pages_total"],
            "page_start": page_start, "page_end": page_end, "status": "QUEUED"}


class PurgeBody(BaseModel):
    db: str
    scope: str  # page | page_range | chapter | document | database | artifacts_only | curriculum_only
    document_id: Optional[str] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    toc_id: Optional[str] = None
    dry_run: bool = True
    preserve_human_edits: bool = True
    confirm: Optional[str] = None


@router.post("/purge")
def purge(body: PurgeBody):
    """Purge Scopée 7 niveaux (§7.6/tech_specs §4.5) — dry_run = prévisualisation exacte."""
    if body.scope == "database" and body.confirm != body.db:
        raise HTTPException(400, "scope=database exige confirm = nom exact de la base (garde-fou)")
    if body.scope in ("page", "page_range", "chapter", "document", "artifacts_only") and not body.document_id \
            and body.scope != "artifacts_only":
        raise HTTPException(400, "document_id requis pour ce scope")
    conn = db.get_connection(body.db)
    try:
        # Périmètre de pages
        page_clause, args = "", []
        if body.scope == "page":
            page_clause, args = " AND page_number=?", [body.page_start or 0]
        elif body.scope == "page_range":
            page_clause, args = " AND page_number BETWEEN ? AND ?", [body.page_start, body.page_end]
        elif body.scope == "chapter":
            row = conn.execute("SELECT page_start, page_end FROM document_toc WHERE id=?",
                               (body.toc_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "Entrée TOC introuvable")
            page_clause, args = " AND page_number BETWEEN ? AND ?", [row[0], row[1] or 10 ** 6]
        doc_clause = "" if body.scope in ("database", "curriculum_only") else " AND document_id=?"
        doc_args = [] if not doc_clause else [body.document_id]
        human = " AND is_human_edited=0" if (body.preserve_human_edits and body.scope != "database") else ""

        def count(table, extra=""):
            if body.scope == "curriculum_only":
                return 0
            if body.scope == "database":
                return conn.execute("SELECT COUNT(*) FROM %s" % table).fetchone()[0]
            return conn.execute("SELECT COUNT(*) FROM %s WHERE 1=1%s%s%s" % (table, doc_clause, page_clause, extra),
                                doc_args + args).fetchone()[0]

        deleted = {
            "chunks": count("document_chunks", human),
            "artifacts": count("scientific_artifacts", human) if body.scope != "artifacts_only"
                         else count("scientific_artifacts", human),
            "toc_entries": (conn.execute("SELECT COUNT(*) FROM document_toc WHERE document_id=?",
                                         [body.document_id]).fetchone()[0]
                            if body.scope == "document" else
                            conn.execute("SELECT COUNT(*) FROM document_toc").fetchone()[0]
                            if body.scope == "database" else 0),
            "jobs": count("pipeline_jobs") if body.scope != "artifacts_only" else 0,
            "curriculum_links": (conn.execute("SELECT COUNT(*) FROM content_links").fetchone()[0]
                                 if body.scope in ("database", "curriculum_only") else 0),
            "page_scans": count("page_scans") if body.scope not in ("artifacts_only", "curriculum_only") else 0,
        }
        preserved = 0
        if human:
            preserved = (conn.execute(
                "SELECT (SELECT COUNT(*) FROM document_chunks WHERE 1=1%s%s AND is_human_edited=1)"
                " + (SELECT COUNT(*) FROM scientific_artifacts WHERE 1=1%s%s AND is_human_edited=1)"
                % (doc_clause, page_clause, doc_clause, page_clause), (doc_args + args) * 2).fetchone()[0])
        if body.scope == "artifacts_only":
            deleted["chunks"] = deleted["jobs"] = deleted["page_scans"] = 0

        if body.dry_run:
            return {"dry_run": True, "deleted": deleted, "preserved_human_edited": preserved,
                    "message": "Prévisualisation — aucune donnée modifiée."}

        conn.execute("BEGIN")
        if body.scope == "curriculum_only":
            for table in ("content_links", "assessments", "curriculum_programs", "curriculum_terms"):
                conn.execute("DELETE FROM %s" % table)
        elif body.scope == "database":
            for table in ("content_links", "assessments", "curriculum_programs", "curriculum_terms",
                          "scientific_artifacts", "document_chunks", "page_scans", "document_toc",
                          "processing_benchmarks", "pipeline_jobs", "ingestion_batches", "documents"):
                conn.execute("DELETE FROM %s" % table)
        elif body.scope == "artifacts_only":
            conn.execute("DELETE FROM scientific_artifacts WHERE 1=1%s%s%s" % (doc_clause, page_clause, human),
                         doc_args + args)
        else:
            conn.execute("DELETE FROM scientific_artifacts WHERE 1=1%s%s%s" % (doc_clause, page_clause, human),
                         doc_args + args)
            conn.execute("DELETE FROM document_chunks WHERE 1=1%s%s%s" % (doc_clause, page_clause, human),
                         doc_args + args)
            conn.execute("DELETE FROM page_scans WHERE 1=1%s%s" % (doc_clause, page_clause), doc_args + args)
            conn.execute("DELETE FROM pipeline_jobs WHERE 1=1%s%s" % (doc_clause, page_clause), doc_args + args)
            if body.scope == "document":
                conn.execute("DELETE FROM document_toc WHERE document_id=?", (body.document_id,))
                conn.execute("DELETE FROM processing_benchmarks WHERE document_id=?", (body.document_id,))
        conn.execute("UPDATE ingestion_batches SET status='STOPPED', updated_at=CURRENT_TIMESTAMP"
                     " WHERE status IN ('QUEUED','RUNNING')")
        conn.commit()
        return {"dry_run": False, "deleted": deleted, "preserved_human_edited": preserved,
                "message": "Purge exécutée (scope=%s)." % body.scope}
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


@router.get("/quarantine")
def quarantine(db_name: str = Query(alias="db")):
    conn = db.get_connection(db_name)
    try:
        rows = conn.execute(
            "SELECT id, document_id, page_number, status, retry_count, error_log, updated_at"
            " FROM pipeline_jobs WHERE status IN ('QUARANTINE','INVALID_SOURCE')"
            " ORDER BY updated_at DESC LIMIT 500").fetchall()
        return {"jobs": [{"id": r[0], "document_id": r[1], "page_number": r[2], "status": r[3],
                          "retry_count": r[4], "error_log": r[5], "updated_at": r[6]} for r in rows]}
    finally:
        conn.close()


class RetryBody(BaseModel):
    db: str
    job_ids: List[str]


@router.post("/retry")
def retry(body: RetryBody):
    conn = db.get_connection(body.db)
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
