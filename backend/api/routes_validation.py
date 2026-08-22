# -*- coding: utf-8 -*-
"""Studio de validation live : runs isolés, snapshots, diff et diagnostics."""
import base64
import hashlib
import json
import os
import threading
import time
import uuid
from typing import Any, Dict, List, Literal, Optional

import config

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from core.embedding_profile import (CURRENT_PROFILE, active_vector_profiles,
                                    compatibility_reasons, profile_from_row)
from core.validation_scope import ScopeResolutionError, resolve_scope
from db import connection as db

router = APIRouter()

_EXECUTION_MONITORS: Dict[str, threading.Thread] = {}
_EXECUTION_MONITORS_LOCK = threading.Lock()
_ACTIVE_JOB_STATES = ("QUEUED", "PROCESSING_CV", "SEGMENTING", "EXTRACTING", "LINTING",
                      "VLM_RECOVERY", "INDEXED")
_TERMINAL_JOB_STATES = ("READY", "QUARANTINE", "INVALID_SOURCE")


def _working_db_filename(run_id: str) -> str:
    return "%s%s.sqlite" % (db.VALIDATION_WORKING_DB_PREFIX, run_id.replace("-", ""))


def _working_db_path(filename: str) -> str:
    if not db.is_validation_working_db(filename):
        raise HTTPException(409, "Copie de validation invalide ou non isolée")
    return db.sanitize_db_name(filename)


def _remove_working_db(filename: Optional[str]) -> None:
    if not filename:
        return
    path = _working_db_path(filename)
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(path + suffix)
        except FileNotFoundError:
            pass


def _public_run_status(stored_status: str, execution_status: str) -> str:
    if stored_status in ("ACCEPTED", "REJECTED", "CANCELLED"):
        return stored_status
    return execution_status or stored_status


def _batch_ids(run: dict) -> List[str]:
    try:
        values = json.loads(run.get("batch_ids_json") or "[]")
    except (TypeError, ValueError):
        values = []
    return [str(value) for value in values if value]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", protected_namespaces=())


class ScopeDTO(StrictModel):
    scope_type: Literal["base", "document", "toc", "chapter", "course", "title", "page",
                        "page_range", "page_selection"]
    document_id: Optional[str] = None
    toc_id: Optional[str] = None
    page: Optional[int] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    pages: Optional[List[int]] = Field(default=None, max_length=1000)


class RunCreateDTO(StrictModel):
    db: str
    scope: ScopeDTO
    label: Optional[str] = Field(default=None, max_length=200)
    embedding_profile_id: Optional[str] = None


class WorkingCopyDTO(StrictModel):
    working: Dict[str, Any]


class SnapshotDTO(StrictModel):
    # A physical snapshot used to capture page_scans but the restore endpoint only
    # restored working_json.  Advertising it as restorable was unsafe, so the API
    # now exposes the sole mode it can restore without touching official tables.
    snapshot_type: Literal["logical"] = "logical"


class BenchmarkAttachDTO(StrictModel):
    benchmark_ids: List[str] = Field(min_length=1, max_length=500)


class EmbeddingProfileDTO(StrictModel):
    model_name: str = Field(min_length=1, max_length=300)
    model_version: str = Field(min_length=1, max_length=100)
    pooling: Literal["cls", "mean", "max", "last_token", "none"]
    dimensions: int = Field(gt=0, le=65536)
    normalized: bool
    metadata: Dict[str, Any] = Field(default_factory=dict)


class EmbeddingAssignDTO(StrictModel):
    db: str
    document_id: str
    profile_id: str
    confirm_reindex: bool = False


def _conn(db_name: str):
    return db.get_connection_or_http(db_name)


def _scope(conn, dto: ScopeDTO):
    try:
        return resolve_scope(conn, dto.scope_type, dto.document_id, dto.toc_id, dto.page,
                             dto.page_start, dto.page_end, dto.pages)
    except ScopeResolutionError as exc:
        raise HTTPException(exc.status_code, str(exc))


def _json_safe(value):
    if isinstance(value, bytes):
        return {"$binary": base64.b64encode(value).decode("ascii")}
    return value


def _decode(value):
    if isinstance(value, dict) and set(value) == {"$binary"}:
        return base64.b64decode(value["$binary"].encode("ascii"))
    return value


def _rows(conn, sql: str, args=()):
    cur = conn.execute(sql, args)
    names = [item[0] for item in cur.description]
    return [{name: _json_safe(value) for name, value in zip(names, row)} for row in cur.fetchall()]


def _official_page(conn, document_id: str, page_number: int) -> dict:
    chunks = _rows(conn, "SELECT id, document_id, toc_id, page_number, chunk_index, section_title,"
                   " content_markdown, pedagogical_type, has_solution, linked_solution_chunk_id,"
                   " is_human_edited, pedagogical_index, updated_at, embedding_vector, token_count, created_at"
                   " FROM document_chunks WHERE document_id=? AND page_number=? ORDER BY chunk_index, id",
                   (document_id, page_number))
    artifacts = _rows(conn, "SELECT id, document_id, chunk_id, page_number, domain, artifact_type,"
                      " raw_data, raw_binary, render_config_json, caption, searchable_text,"
                      " bounding_box_json, is_human_edited, validation_run_id, updated_at, created_at"
                      " FROM scientific_artifacts WHERE document_id=? AND page_number=? ORDER BY id",
                      (document_id, page_number))
    return {"document_id": document_id, "page_number": page_number,
            "chunks": chunks, "artifacts": artifacts}


def _event(conn, run_id: str, event_type: str, payload=None, page_number=None,
           document_id=None) -> None:
    if document_id is None and page_number is not None:
        rows = conn.execute("SELECT DISTINCT document_id FROM validation_run_pages"
                            " WHERE run_id=? AND page_number=?", (run_id, page_number)).fetchall()
        document_id = rows[0][0] if len(rows) == 1 else None
    conn.execute("INSERT INTO validation_events"
                 " (id, run_id, document_id, page_number, event_type, payload_json)"
                 " VALUES (?,?,?,?,?,?)", (str(uuid.uuid4()), run_id, document_id, page_number,
                                            event_type, json.dumps(payload or {}, ensure_ascii=False,
                                                                   sort_keys=True)))


def _payload_sha256(payload: dict) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _run(conn, run_id: str):
    row = conn.execute("SELECT id, document_id, scope_type, scope_json, status, label,"
                       " embedding_profile_id, working_db_filename, operation, batch_id, batch_ids_json,"
                       " execution_status, progress_current, progress_total, error_log, started_at, completed_at,"
                       " created_at, updated_at, accepted_at, rejected_at"
                       " FROM validation_runs WHERE id=?", (run_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Run de validation introuvable")
    keys = ("id", "document_id", "scope_type", "scope_json", "stored_status", "label",
            "embedding_profile_id", "working_db_filename", "operation", "batch_id", "batch_ids_json",
            "execution_status", "progress_current", "progress_total", "error_log", "started_at", "completed_at",
            "created_at", "updated_at", "accepted_at", "rejected_at")
    result = dict(zip(keys, row))
    result["scope"] = json.loads(result.pop("scope_json"))
    result["status"] = _public_run_status(result["stored_status"], result["execution_status"])
    result["working_db"] = {"filename": result["working_db_filename"],
                            "exists": bool(result["working_db_filename"] and
                                           os.path.exists(_working_db_path(result["working_db_filename"])))}
    result["batch_ids"] = _batch_ids(result)
    total = int(result["progress_total"] or 0)
    result["progress"] = {"current": int(result["progress_current"] or 0), "total": total,
                          "percent": round((int(result["progress_current"] or 0) / total) * 100, 2) if total else 0}
    return result


def _page_row(conn, run_id: str, page_number: int, document_id: Optional[str] = None):
    sql = ("SELECT id, document_id, page_number, status, baseline_json, working_json, error_log, updated_at"
           " FROM validation_run_pages WHERE run_id=? AND page_number=?")
    args = [run_id, page_number]
    if document_id:
        sql += " AND document_id=?"
        args.append(document_id)
    rows = conn.execute(sql, args).fetchall()
    if not rows:
        raise HTTPException(404, "Page absente du run")
    if len(rows) > 1:
        raise HTTPException(409, "document_id requis pour désambiguïser cette page")
    return rows[0]


@router.post("/resolve-scope")
def resolve_scope_route(body: RunCreateDTO):
    conn = _conn(body.db)
    try:
        targets = _scope(conn, body.scope)
        return {"scope_type": body.scope.scope_type,
                "targets": [{"document_id": t.document_id, "toc_id": t.toc_id,
                             "pages": list(t.pages), "page_start": t.page_start,
                             "page_end": t.page_end, "total_pages": t.total_pages} for t in targets],
                "page_count": sum(len(t.pages) for t in targets)}
    finally:
        conn.close()


@router.post("/runs", status_code=201)
def create_run(body: RunCreateDTO):
    if db.is_validation_working_db(body.db):
        raise HTTPException(400, "Une copie de validation ne peut pas devenir une base officielle")
    conn = _conn(body.db)
    working_filename = None
    snapshot_conn = None
    try:
        targets = _scope(conn, body.scope)
        if body.embedding_profile_id and not conn.execute(
                "SELECT 1 FROM embedding_profiles WHERE id=?", (body.embedding_profile_id,)).fetchone():
            raise HTTPException(404, "Profil d'embedding introuvable")
        run_id = str(uuid.uuid4())
        working_filename = _working_db_filename(run_id)
        working_path = _working_db_path(working_filename)
        if os.path.exists(working_path):
            raise HTTPException(409, "Collision de copie de validation")
        # Connection.backup creates a transactionally consistent physical image.
        # We then lock the official DB and verify each baseline still matches that
        # image before publishing run metadata (a concurrent change yields 409).
        db.backup_connection(conn, working_path)
        snapshot_conn = db.get_connection(working_filename)
        conn.execute("BEGIN IMMEDIATE")
        single_doc = targets[0].document_id if len(targets) == 1 else None
        scope_json = json.dumps(body.scope.model_dump(), ensure_ascii=False, sort_keys=True)
        count = sum(len(target.pages) for target in targets)
        conn.execute("INSERT INTO validation_runs (id, document_id, scope_type, scope_json, status, label,"
                     " embedding_profile_id, working_db_filename, operation, execution_status, progress_total)"
                     " VALUES (?,?,?,?, 'DRAFT', ?,?,?, 'REPROCESS', 'CREATED', ?)",
                     (run_id, single_doc, body.scope.scope_type, scope_json, body.label,
                      body.embedding_profile_id, working_filename, count))
        for target in targets:
            for page_number in target.pages:
                payload = _official_page(snapshot_conn, target.document_id, page_number)
                if _payload_sha256(_official_page(conn, target.document_id, page_number)) != _payload_sha256(payload):
                    raise HTTPException(409, "Base officielle modifiée pendant la création du run; réessayez")
                encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
                conn.execute("INSERT INTO validation_run_pages (id, run_id, document_id, page_number,"
                             " status, baseline_json, working_json, baseline_hash)"
                             " VALUES (?,?,?,?, 'PENDING', ?,?,?)",
                             (str(uuid.uuid4()), run_id, target.document_id, page_number, encoded, encoded,
                              _payload_sha256(payload)))
        # Mirror only the run identity into the sandbox so provenance foreign keys
        # (artifacts/benchmarks) remain valid there. Official lifecycle state stays
        # authoritative in the official database.
        snapshot_conn.execute("INSERT INTO validation_runs"
                              " (id,document_id,scope_type,scope_json,status,label,embedding_profile_id,"
                              " working_db_filename,operation,execution_status,progress_total)"
                              " VALUES (?,?,?,?, 'DRAFT', ?,?,?, 'REPROCESS','CREATED',?)",
                              (run_id, single_doc, body.scope.scope_type, scope_json, body.label,
                               body.embedding_profile_id, working_filename, count))
        snapshot_conn.commit()
        _event(conn, run_id, "run.created", {"pages": count, "working_db": working_filename,
                                             "operation": "REPROCESS"})
        conn.commit()
        return {"id": run_id, "status": "CREATED", "page_count": count,
                "scope_type": body.scope.scope_type, "working_db_filename": working_filename,
                "operation": "REPROCESS", "official_mutated": False}
    except Exception:
        conn.rollback()
        if snapshot_conn is not None:
            snapshot_conn.close()
            snapshot_conn = None
        if working_filename:
            _remove_working_db(working_filename)
        raise
    finally:
        if snapshot_conn is not None:
            snapshot_conn.close()
        conn.close()


def _targets_from_run_pages(conn, run_id: str):
    grouped: Dict[str, List[int]] = {}
    for document_id, page_number in conn.execute(
            "SELECT document_id, page_number FROM validation_run_pages WHERE run_id=?"
            " ORDER BY document_id, page_number", (run_id,)).fetchall():
        grouped.setdefault(document_id, []).append(int(page_number))
    return [type("ValidationTarget", (), {"document_id": document_id, "pages": tuple(pages),
                                           "page_start": pages[0], "page_end": pages[-1]})
            for document_id, pages in grouped.items()]


def _sync_working_pages(official_conn, run: dict, execution_status: str,
                        error_log: Optional[str] = None) -> None:
    filename = run.get("working_db_filename")
    if not filename or not os.path.exists(_working_db_path(filename)):
        raise RuntimeError("Copie SQLite de validation absente")
    working = db.get_connection(filename)
    try:
        rows = official_conn.execute(
            "SELECT id, document_id, page_number FROM validation_run_pages WHERE run_id=?",
            (run["id"],)).fetchall()
        for page_id, document_id, page_number in rows:
            payload = _official_page(working, document_id, page_number)
            for artifact in payload["artifacts"]:
                artifact["validation_run_id"] = run["id"]
            encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
            job = working.execute(
                "SELECT status, error_log FROM pipeline_jobs WHERE document_id=? AND page_number=?"
                " AND batch_id IN (%s) ORDER BY updated_at DESC, rowid DESC LIMIT 1" %
                ",".join("?" for _ in (_batch_ids(run) or [""])),
                [document_id, page_number] + (_batch_ids(run) or [""])).fetchone()
            page_status = "READY" if job and job[0] == "READY" else "FAILED"
            page_error = job[1] if job and job[1] else (error_log if page_status == "FAILED" else None)
            official_conn.execute(
                "UPDATE validation_run_pages SET working_json=?, status=?, error_log=?,"
                " updated_at=CURRENT_TIMESTAMP WHERE id=?",
                (encoded, page_status, page_error, page_id))
        official_conn.execute(
            "UPDATE validation_runs SET status=?, execution_status=?, error_log=?,"
            " progress_current=progress_total, completed_at=CURRENT_TIMESTAMP,"
            " updated_at=CURRENT_TIMESTAMP WHERE id=?",
            ("READY" if execution_status == "COMPLETED" else "FAILED", execution_status,
             error_log, run["id"]))
        _event(official_conn, run["id"], "run.%s" % execution_status.lower(),
               {"working_db": filename, "batch_ids": _batch_ids(run), "error": error_log})
    finally:
        working.close()


def refresh_run_working_json(db_name: str, run_id: str, event_type: str = "run.working_refreshed") -> None:
    """Refresh logical staging from the physical sandbox after a scoped mutation."""
    official = _conn(db_name)
    try:
        run = _run(official, run_id)
        filename = run.get("working_db_filename")
        if not filename or not os.path.exists(_working_db_path(filename)):
            raise HTTPException(409, "Copie SQLite de validation absente")
        working = db.get_connection(filename)
        try:
            for page_id, document_id, page_number in official.execute(
                    "SELECT id,document_id,page_number FROM validation_run_pages WHERE run_id=?",
                    (run_id,)).fetchall():
                payload = _official_page(working, document_id, page_number)
                for artifact in payload["artifacts"]:
                    artifact["validation_run_id"] = run_id
                official.execute("UPDATE validation_run_pages SET working_json=?, updated_at=CURRENT_TIMESTAMP"
                                 " WHERE id=?",
                                 (json.dumps(payload, ensure_ascii=False, sort_keys=True), page_id))
            _event(official, run_id, event_type, {"working_db": filename})
            official.commit()
        finally:
            working.close()
    finally:
        official.close()


def _refresh_execution_state(db_name: str, run_id: str) -> None:
    official = _conn(db_name)
    try:
        run = _run(official, run_id)
        if run["execution_status"] not in ("QUEUED", "RUNNING"):
            return
        filename = run.get("working_db_filename")
        if not filename or not os.path.exists(_working_db_path(filename)):
            official.execute("UPDATE validation_runs SET status='FAILED', execution_status='FAILED',"
                             " error_log='Copie SQLite de validation absente', updated_at=CURRENT_TIMESTAMP"
                             " WHERE id=?", (run_id,))
            official.commit()
            return
        working = db.get_connection(filename)
        try:
            batch_ids = _batch_ids(run)
            if not batch_ids:
                return
            marks = ",".join("?" for _ in batch_ids)
            stats = working.execute(
                "SELECT COUNT(*), SUM(status IN ('READY','QUARANTINE','INVALID_SOURCE')) ,"
                " SUM(status='READY'), SUM(status IN ('QUARANTINE','INVALID_SOURCE')) ,"
                " SUM(status IN ('PROCESSING_CV','SEGMENTING','EXTRACTING','LINTING','VLM_RECOVERY','INDEXED'))"
                " FROM pipeline_jobs WHERE batch_id IN (%s)" % marks, batch_ids).fetchone()
            total, terminal, ready, failed, active = [int(value or 0) for value in stats]
            current = terminal
            status = "RUNNING" if active or terminal < total else run["execution_status"]
            official.execute("UPDATE validation_runs SET execution_status=?, progress_current=?,"
                             " updated_at=CURRENT_TIMESTAMP WHERE id=?",
                             (status, current, run_id))
            official.execute("UPDATE validation_run_pages SET status='PROCESSING',"
                             " updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='PENDING'", (run_id,))
            if total and terminal == total:
                errors = [row[0] for row in working.execute(
                    "SELECT error_log FROM pipeline_jobs WHERE batch_id IN (%s)"
                    " AND status IN ('QUARANTINE','INVALID_SOURCE') AND error_log IS NOT NULL" % marks,
                    batch_ids).fetchall()]
                outcome = "FAILED" if failed or ready != total else "COMPLETED"
                _sync_working_pages(official, run, outcome, "; ".join(errors) or None)
            official.commit()
        finally:
            working.close()
    except Exception as exc:
        official.rollback()
        try:
            official.execute("UPDATE validation_runs SET status='FAILED', execution_status='FAILED',"
                             " error_log=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                             ("%s: %s" % (type(exc).__name__, exc), run_id))
            _event(official, run_id, "run.failed", {"error": str(exc)})
            official.commit()
        except Exception:
            official.rollback()
    finally:
        official.close()


def _monitor_execution(db_name: str, run_id: str) -> None:
    try:
        for _ in range(36000):
            try:
                _refresh_execution_state(db_name, run_id)
                conn = _conn(db_name)
            except HTTPException:
                return  # official test/runtime database removed while monitor exits
            try:
                try:
                    run = _run(conn, run_id)
                except HTTPException:
                    return
                if run["execution_status"] not in ("QUEUED", "RUNNING"):
                    return
            finally:
                conn.close()
            time.sleep(0.1)
    finally:
        with _EXECUTION_MONITORS_LOCK:
            _EXECUTION_MONITORS.pop(run_id, None)


def _start_monitor(db_name: str, run_id: str) -> None:
    with _EXECUTION_MONITORS_LOCK:
        current = _EXECUTION_MONITORS.get(run_id)
        if current and current.is_alive():
            return
        monitor = threading.Thread(target=_monitor_execution, args=(db_name, run_id), daemon=True,
                                   name="validation-%s" % run_id[:8])
        _EXECUTION_MONITORS[run_id] = monitor
        monitor.start()


@router.post("/runs/{run_id}/execute", status_code=202)
def execute_run(run_id: str, db_name: str = Query(alias="db")):
    from api import routes_pipeline

    official = _conn(db_name)
    try:
        official.execute("BEGIN IMMEDIATE")
        run = _run(official, run_id)
        if run["execution_status"] not in ("CREATED", "BLOCKED", "FAILED"):
            raise HTTPException(409, "Ce run est déjà exécuté ou en cours")
        filename = run.get("working_db_filename")
        if not filename or not os.path.exists(_working_db_path(filename)):
            raise HTTPException(409, "Copie SQLite de validation absente")
        targets = _targets_from_run_pages(official, run_id)
        sources = {}
        missing = []
        for target in targets:
            row = official.execute("SELECT source_path FROM documents WHERE id=?",
                                   (target.document_id,)).fetchone()
            source = row[0] if row else None
            if not source or not os.path.isfile(source):
                missing.append({"document_id": target.document_id, "source_path": source})
            else:
                sources[target.document_id] = source
        if missing:
            message = "PDF source officiel absent — exécution impossible"
            official.execute("UPDATE validation_runs SET status='FAILED', execution_status='BLOCKED',"
                             " error_log=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (message, run_id))
            official.execute("UPDATE validation_run_pages SET status='FAILED', error_log=?,"
                             " updated_at=CURRENT_TIMESTAMP WHERE run_id=?", (message, run_id))
            _event(official, run_id, "run.blocked", {"reason": "SOURCE_MISSING", "sources": missing})
            official.commit()
            return {"id": run_id, "status": "BLOCKED", "error": message,
                    "missing_sources": missing, "official_mutated": False}
        official.commit()

        working = db.get_connection(filename)
        try:
            working.execute("BEGIN IMMEDIATE")
            # A backup may contain official queues.  They are historical data in this
            # sandbox and must never be drained by the validation worker.
            working.execute("DELETE FROM pipeline_jobs WHERE status IN"
                            " ('QUEUED','PROCESSING_CV','SEGMENTING','EXTRACTING','LINTING',"
                            " 'VLM_RECOVERY','INDEXED')")
            working.execute("UPDATE ingestion_batches SET status='STOPPED', updated_at=CURRENT_TIMESTAMP"
                            " WHERE status IN ('QUEUED','RUNNING')")
            purge_scope = "document" if run["scope_type"] == "base" else run["scope_type"]
            body = routes_pipeline.ReprocessBody(db=filename, scope=purge_scope,
                                                 preserve_human_edits=True)
            routes_pipeline._purge_for_reprocess(working, body, targets)
            batches = []
            for target in targets:
                groups: List[List[int]] = []
                for selected in target.pages:
                    if not groups or selected != groups[-1][-1] + 1:
                        groups.append([selected])
                    else:
                        groups[-1].append(selected)
                for group in groups:
                    batches.append(routes_pipeline.orchestrator.enqueue_batch(
                        filename, target.document_id, sources[target.document_id], "page_range",
                        group[0], group[-1], conn=working, commit=False, emit=False))
            working.commit()
        except Exception:
            working.rollback()
            raise
        finally:
            working.close()

        batch_ids = [batch["batch_id"] for batch in batches]
        official.execute("UPDATE validation_runs SET status='RUNNING', execution_status='QUEUED',"
                         " batch_id=?, batch_ids_json=?, progress_current=0, error_log=NULL,"
                         " started_at=CURRENT_TIMESTAMP, completed_at=NULL, updated_at=CURRENT_TIMESTAMP"
                         " WHERE id=?", (batch_ids[0] if batch_ids else None,
                                         json.dumps(batch_ids), run_id))
        official.execute("UPDATE validation_run_pages SET status='PROCESSING', error_log=NULL,"
                         " updated_at=CURRENT_TIMESTAMP WHERE run_id=?", (run_id,))
        _event(official, run_id, "run.queued", {"working_db": filename, "batch_ids": batch_ids})
        official.commit()
        for batch in batches:
            routes_pipeline.orchestrator._emit(
                "queue_update", {"queue_length": batch["pages_total"] - batch["skipped_ready"] -
                                 batch["skipped_active"], "batch_id": batch["batch_id"]})
        routes_pipeline._launch(filename)
        _start_monitor(db_name, run_id)
        return {"id": run_id, "status": "QUEUED", "working_db_filename": filename,
                "batch_id": batch_ids[0] if batch_ids else None, "batch_ids": batch_ids,
                "operation": run["operation"], "official_mutated": False}
    except HTTPException:
        official.rollback()
        raise
    except Exception as exc:
        official.rollback()
        try:
            official.execute("UPDATE validation_runs SET status='FAILED', execution_status='FAILED',"
                             " error_log=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                             ("%s: %s" % (type(exc).__name__, exc), run_id))
            _event(official, run_id, "run.failed", {"error": str(exc)})
            official.commit()
        except Exception:
            official.rollback()
        raise
    finally:
        try:
            official.close()
        except Exception:
            pass


@router.get("/runs")
def list_runs(db_name: str = Query(alias="db"), document_id: Optional[str] = None):
    conn = _conn(db_name)
    try:
        sql = ("SELECT r.id, r.document_id, r.scope_type, r.status, r.execution_status, r.label,"
               " r.working_db_filename, r.operation, r.batch_id, r.batch_ids_json,"
               " r.progress_current, r.progress_total, r.error_log, r.created_at, r.updated_at,"
               " COUNT(p.id) FROM validation_runs r LEFT JOIN validation_run_pages p ON p.run_id=r.id")
        args = []
        if document_id:
            sql += " WHERE EXISTS (SELECT 1 FROM validation_run_pages vp WHERE vp.run_id=r.id AND vp.document_id=?)"
            args.append(document_id)
        sql += " GROUP BY r.id ORDER BY r.created_at DESC"
        runs = []
        for row in conn.execute(sql, args).fetchall():
            try:
                batch_ids = json.loads(row[9] or "[]")
            except (TypeError, ValueError):
                batch_ids = []
            total = int(row[11] or 0)
            runs.append({"id": row[0], "document_id": row[1], "scope_type": row[2],
                         "status": _public_run_status(row[3], row[4]), "execution_status": row[4],
                         "label": row[5], "working_db_filename": row[6],
                         "working_db_exists": bool(row[6] and os.path.exists(_working_db_path(row[6]))),
                         "operation": row[7], "batch_id": row[8], "batch_ids": batch_ids,
                         "progress_current": int(row[10] or 0), "progress_total": total,
                         "progress_percent": round((int(row[10] or 0) / total) * 100, 2) if total else 0,
                         "error_log": row[12], "created_at": row[13], "updated_at": row[14],
                         "page_count": row[15]})
        return {"runs": runs}
    finally:
        conn.close()


@router.get("/runs/{run_id}")
def get_run(run_id: str, db_name: str = Query(alias="db")):
    _refresh_execution_state(db_name, run_id)
    conn = _conn(db_name)
    try:
        result = _run(conn, run_id)
        result["pages"] = [{"document_id": r[0], "page_number": r[1], "status": r[2],
                           "updated_at": r[3]} for r in conn.execute(
            "SELECT document_id, page_number, status, updated_at FROM validation_run_pages"
            " WHERE run_id=? ORDER BY document_id, page_number", (run_id,)).fetchall()]
        return result
    finally:
        conn.close()


@router.get("/runs/{run_id}/pages/{page_number}")
def get_working_page(run_id: str, page_number: int, db_name: str = Query(alias="db"),
                     document_id: Optional[str] = None):
    conn = _conn(db_name)
    try:
        row = _page_row(conn, run_id, page_number, document_id)
        return {"id": row[0], "document_id": row[1], "page_number": row[2], "status": row[3],
                "baseline": json.loads(row[4]), "working": json.loads(row[5]),
                "error_log": row[6], "updated_at": row[7]}
    finally:
        conn.close()


@router.put("/runs/{run_id}/pages/{page_number}")
def update_working_page(run_id: str, page_number: int, body: WorkingCopyDTO,
                        db_name: str = Query(alias="db"), document_id: Optional[str] = None):
    conn = _conn(db_name)
    try:
        run = _run(conn, run_id)
        if run["status"] != "COMPLETED":
            raise HTTPException(409, "La copie n'est modifiable qu'après exécution COMPLETED")
        row = _page_row(conn, run_id, page_number, document_id)
        working = dict(body.working)
        if working.get("document_id") != row[1] or working.get("page_number") != row[2]:
            raise HTTPException(400, "La copie de travail doit conserver document_id et page_number")
        if not isinstance(working.get("chunks", []), list) or not isinstance(working.get("artifacts", []), list):
            raise HTTPException(400, "chunks et artifacts doivent être des listes")
        encoded = json.dumps(working, ensure_ascii=False, sort_keys=True)
        filename = run.get("working_db_filename")
        if not filename or not os.path.exists(_working_db_path(filename)):
            raise HTTPException(409, "Copie SQLite de validation absente")
        working_conn = db.get_connection(filename)
        try:
            working_conn.execute("BEGIN IMMEDIATE")
            _validate_accept_references(working_conn, [working])
            deferred = _replace_official_page(working_conn, working)
            for linked_id, chunk_id in deferred:
                working_conn.execute("UPDATE document_chunks SET linked_solution_chunk_id=? WHERE id=?",
                                     (linked_id, chunk_id))
            working_conn.commit()
        except Exception:
            working_conn.rollback()
            raise
        finally:
            working_conn.close()
        conn.execute("UPDATE validation_run_pages SET working_json=?, status='READY',"
                     " updated_at=CURRENT_TIMESTAMP WHERE id=?", (encoded, row[0]))
        conn.execute("UPDATE validation_runs SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (run_id,))
        _event(conn, run_id, "page.updated", {"document_id": row[1]}, page_number)
        conn.commit()
        return {"updated": True, "run_id": run_id, "document_id": row[1],
                "page_number": page_number, "official_mutated": False}
    finally:
        conn.close()


def _snapshot_payload(conn, run_id: str, snapshot_type: str) -> dict:
    pages = []
    for doc_id, page_number, working in conn.execute(
            "SELECT document_id, page_number, working_json FROM validation_run_pages"
            " WHERE run_id=? ORDER BY document_id, page_number", (run_id,)).fetchall():
        item = {"document_id": doc_id, "page_number": page_number, "working": json.loads(working)}
        if snapshot_type == "physical":
            scan = conn.execute("SELECT width_px, height_px, dpi, image_webp, thumb_webp FROM page_scans"
                                " WHERE document_id=? AND page_number=?", (doc_id, page_number)).fetchone()
            if scan:
                item["page_scan"] = {"width_px": scan[0], "height_px": scan[1], "dpi": scan[2],
                                     "image_webp": _json_safe(scan[3]), "thumb_webp": _json_safe(scan[4])}
        pages.append(item)
    return {"snapshot_type": snapshot_type, "pages": pages}


@router.post("/runs/{run_id}/snapshots", status_code=201)
def create_snapshot(run_id: str, body: SnapshotDTO, db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    try:
        _run(conn, run_id)
        snapshot_id = str(uuid.uuid4())
        payload = _snapshot_payload(conn, run_id, body.snapshot_type)
        conn.execute("INSERT INTO validation_snapshots (id, run_id, snapshot_type, payload_json)"
                     " VALUES (?,?,?,?)", (snapshot_id, run_id, body.snapshot_type,
                                           json.dumps(payload, ensure_ascii=False, sort_keys=True)))
        _event(conn, run_id, "snapshot.created", {"snapshot_id": snapshot_id,
                                                   "snapshot_type": body.snapshot_type})
        conn.commit()
        return {"id": snapshot_id, "run_id": run_id, "snapshot_type": body.snapshot_type,
                "page_count": len(payload["pages"]), "official_mutated": False}
    finally:
        conn.close()


@router.post("/runs/{run_id}/snapshots/{snapshot_id}/restore")
def restore_snapshot(run_id: str, snapshot_id: str, db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    try:
        run = _run(conn, run_id)
        if run["status"] != "COMPLETED":
            raise HTTPException(409, "Le run n'est restaurable qu'après exécution COMPLETED")
        row = conn.execute("SELECT payload_json FROM validation_snapshots WHERE id=? AND run_id=?",
                           (snapshot_id, run_id)).fetchone()
        if row is None:
            raise HTTPException(404, "Snapshot introuvable")
        payload = json.loads(row[0])
        filename = run.get("working_db_filename")
        if not filename or not os.path.exists(_working_db_path(filename)):
            raise HTTPException(409, "Copie SQLite de validation absente")
        conn.execute("BEGIN")
        working_conn = db.get_connection(filename)
        restored = 0
        try:
            working_conn.execute("BEGIN IMMEDIATE")
            deferred = []
            for page in payload.get("pages", []):
                cur = conn.execute("UPDATE validation_run_pages SET working_json=?, status='READY',"
                                   " updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND document_id=? AND page_number=?",
                                   (json.dumps(page["working"], ensure_ascii=False, sort_keys=True), run_id,
                                    page["document_id"], page["page_number"]))
                if cur.rowcount:
                    deferred.extend(_replace_official_page(working_conn, page["working"]))
                restored += cur.rowcount
            for linked_id, chunk_id in deferred:
                working_conn.execute("UPDATE document_chunks SET linked_solution_chunk_id=? WHERE id=?",
                                     (linked_id, chunk_id))
            working_conn.commit()
        except Exception:
            working_conn.rollback()
            raise
        finally:
            working_conn.close()
        _event(conn, run_id, "snapshot.restored", {"snapshot_id": snapshot_id, "pages": restored})
        conn.commit()
        return {"restored": True, "pages": restored, "official_mutated": False}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _assert_human_edits_preserved(baseline: dict, working: dict) -> None:
    """A validation run may not silently delete/replace pre-existing human edits."""
    for collection in ("chunks", "artifacts"):
        working_by_id = {item.get("id"): item for item in working.get(collection, [])}
        for item in baseline.get(collection, []):
            if item.get("is_human_edited") and working_by_id.get(item.get("id")) != item:
                raise HTTPException(409, "Édition humaine protégée : %s" % item.get("id"))


def _validate_accept_references(conn, payloads: List[dict]) -> None:
    """Valide l'image finale complète avant la première mutation officielle."""
    page_keys = set()
    chunks = {}
    artifacts = {}
    for payload in payloads:
        try:
            key = (payload["document_id"], int(payload["page_number"]))
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, "Copie de travail sans document_id/page_number valide")
        if key in page_keys:
            raise HTTPException(400, "Page dupliquée dans le run")
        page_keys.add(key)
        for collection, index in ((payload.get("chunks", []), chunks),
                                  (payload.get("artifacts", []), artifacts)):
            if not isinstance(collection, list):
                raise HTTPException(400, "chunks et artifacts doivent être des listes")
            for item in collection:
                if not isinstance(item, dict) or not item.get("id"):
                    raise HTTPException(400, "Référence sans id")
                try:
                    item_key = (item.get("document_id"), int(item.get("page_number", -1)))
                except (TypeError, ValueError):
                    raise HTTPException(400, "Référence avec page_number invalide")
                if item_key != key:
                    raise HTTPException(400, "Copie de travail hors périmètre")
                if item["id"] in index:
                    raise HTTPException(400, "Identifiant dupliqué : %s" % item["id"])
                index[item["id"]] = item

    official_chunks = {r[0]: (r[1], int(r[2])) for r in conn.execute(
        "SELECT id, document_id, page_number FROM document_chunks").fetchall()}
    official_artifacts = {r[0]: (r[1], int(r[2])) for r in conn.execute(
        "SELECT id, document_id, page_number FROM scientific_artifacts").fetchall()}
    for item_id, item in chunks.items():
        old = official_chunks.get(item_id)
        wanted = (item["document_id"], int(item["page_number"]))
        if old is not None and old != wanted:
            raise HTTPException(409, "Chunk déjà détenu par un autre document/page : %s" % item_id)
    for item_id, item in artifacts.items():
        old = official_artifacts.get(item_id)
        wanted = (item["document_id"], int(item["page_number"]))
        if old is not None and old != wanted:
            raise HTTPException(409, "Artefact déjà détenu par un autre document/page : %s" % item_id)

    def final_chunk_owner(chunk_id):
        candidate = chunks.get(chunk_id)
        if candidate:
            return candidate["document_id"]
        old = official_chunks.get(chunk_id)
        if old is None or old in page_keys:
            return None
        return old[0]

    def require_owner(kind, ref_id, expected_document, owner):
        if owner is None:
            raise HTTPException(400, "Référence %s introuvable : %s" % (kind, ref_id))
        if owner != expected_document:
            raise HTTPException(409, "Référence %s cross-document : %s" % (kind, ref_id))

    toc_owners = {r[0]: r[1] for r in conn.execute("SELECT id, document_id FROM document_toc")}
    for item in chunks.values():
        doc_id = item["document_id"]
        if item.get("toc_id"):
            require_owner("chunk.toc_id", item["toc_id"], doc_id, toc_owners.get(item["toc_id"]))
        if item.get("linked_solution_chunk_id"):
            ref = item["linked_solution_chunk_id"]
            require_owner("linked_solution_chunk_id", ref, doc_id, final_chunk_owner(ref))
    for item in artifacts.values():
        if item.get("chunk_id"):
            require_owner("artifact.chunk_id", item["chunk_id"], item["document_id"],
                          final_chunk_owner(item["chunk_id"]))

    documents = {r[0] for r in conn.execute("SELECT id FROM documents")}
    term_owners = {r[0]: r[1] for r in conn.execute("SELECT id, document_id FROM curriculum_terms")}
    program_owners = {r[0]: r[1] for r in conn.execute("SELECT id, document_id FROM curriculum_programs")}
    assessment_owners = {r[0]: r[1] for r in conn.execute("SELECT id, document_id FROM assessments")}
    scan_owners = {r[0]: r[1] for r in conn.execute("SELECT id, document_id FROM page_scans")}

    def require_curriculum_document(table, item_id, document_id):
        if document_id is None:
            raise HTTPException(400, "%s.document_id manquant : %s" % (table, item_id))
        if document_id not in documents:
            raise HTTPException(400, "%s.document_id introuvable : %s" % (table, item_id))

    for term_id, document_id in term_owners.items():
        require_curriculum_document("curriculum_terms", term_id, document_id)
    for program_id, document_id, term_id in conn.execute(
            "SELECT id, document_id, term_id FROM curriculum_programs"):
        require_curriculum_document("curriculum_programs", program_id, document_id)
        if term_id:
            require_owner("curriculum_programs.term_id", term_id, document_id, term_owners.get(term_id))
    for assessment_id, document_id, term_id, subject_id, correction_id in conn.execute(
            "SELECT id, document_id, term_id, subject_chunk_id, correction_chunk_id FROM assessments"):
        require_curriculum_document("assessments", assessment_id, document_id)
        if term_id:
            require_owner("assessments.term_id", term_id, document_id, term_owners.get(term_id))
        for field, ref in (("subject_chunk_id", subject_id), ("correction_chunk_id", correction_id)):
            if ref:
                require_owner("assessments.%s" % field, ref, document_id, final_chunk_owner(ref))

    endpoint_tables = {
        "program_term": (program_owners, term_owners),
        "course_program": (lambda ref: final_chunk_owner(ref), program_owners),
        "course_exercise": (lambda ref: final_chunk_owner(ref), lambda ref: final_chunk_owner(ref)),
        "course_scan": (lambda ref: final_chunk_owner(ref), scan_owners),
        "exercise_scan": (lambda ref: final_chunk_owner(ref), scan_owners),
        "assessment_scan": (assessment_owners, scan_owners),
    }

    def endpoint_owner(source, ref):
        return source(ref) if callable(source) else source.get(ref)

    for link_id, document_id, link_type, from_id, to_id in conn.execute(
            "SELECT id, document_id, link_type, from_id, to_id FROM content_links"):
        require_curriculum_document("content_links", link_id, document_id)
        pair = endpoint_tables.get(link_type)
        if pair is None:
            raise HTTPException(400, "content_links.link_type invalide : %s" % link_type)
        require_owner("content_links.from_id", from_id, document_id, endpoint_owner(pair[0], from_id))
        require_owner("content_links.to_id", to_id, document_id, endpoint_owner(pair[1], to_id))


def _replace_official_page(conn, payload: dict) -> List[tuple]:
    doc_id, page_number = payload["document_id"], int(payload["page_number"])
    chunks, artifacts = payload.get("chunks", []), payload.get("artifacts", [])
    conn.execute("DELETE FROM scientific_artifacts WHERE document_id=? AND page_number=?", (doc_id, page_number))
    candidate_ids = [item["id"] for item in chunks]
    if candidate_ids:
        conn.execute("DELETE FROM document_chunks WHERE document_id=? AND page_number=?"
                     " AND id NOT IN (%s)" % ",".join("?" for _ in candidate_ids),
                     [doc_id, page_number] + candidate_ids)
        conn.execute("UPDATE document_chunks SET linked_solution_chunk_id=NULL"
                     " WHERE document_id=? AND page_number=?", (doc_id, page_number))
    else:
        conn.execute("DELETE FROM document_chunks WHERE document_id=? AND page_number=?", (doc_id, page_number))
    chunk_cols = ("id", "document_id", "toc_id", "page_number", "chunk_index", "section_title",
                  "content_markdown", "pedagogical_type", "has_solution", "is_human_edited",
                  "pedagogical_index", "updated_at", "embedding_vector", "token_count", "created_at")
    update_cols = chunk_cols[1:]
    links = []
    for item in chunks:
        values = [_decode(item.get(col)) for col in chunk_cols]
        conn.execute("INSERT INTO document_chunks (%s) VALUES (%s)"
                     " ON CONFLICT(id) DO UPDATE SET %s" %
                     (", ".join(chunk_cols), ", ".join("?" for _ in chunk_cols),
                      ", ".join("%s=excluded.%s" % (col, col) for col in update_cols)), values)
        if item.get("linked_solution_chunk_id"):
            links.append((item["linked_solution_chunk_id"], item["id"]))
    artifact_cols = ("id", "document_id", "chunk_id", "page_number", "domain", "artifact_type",
                     "raw_data", "raw_binary", "render_config_json", "caption", "searchable_text",
                     "bounding_box_json", "is_human_edited", "validation_run_id", "updated_at", "created_at")
    for item in artifacts:
        values = [_decode(item.get(col)) for col in artifact_cols]
        conn.execute("INSERT INTO scientific_artifacts (%s) VALUES (%s)" %
                     (", ".join(artifact_cols), ", ".join("?" for _ in artifact_cols)), values)
    return links


@router.post("/runs/{run_id}/accept")
def accept_run(run_id: str, db_name: str = Query(alias="db")):
    _refresh_execution_state(db_name, run_id)
    conn = _conn(db_name)
    working = None
    filename = None
    try:
        conn.execute("BEGIN IMMEDIATE")
        run = _run(conn, run_id)
        if run["execution_status"] != "COMPLETED" or run["stored_status"] != "READY":
            raise HTTPException(409, "Seul un run COMPLETED peut être accepté")
        filename = run.get("working_db_filename")
        if not filename or not os.path.exists(_working_db_path(filename)):
            raise HTTPException(409, "Copie SQLite de validation absente")
        working = db.get_connection(filename)
        rows = conn.execute("SELECT id, document_id, page_number, baseline_json, working_json, baseline_hash"
                            " FROM validation_run_pages WHERE run_id=? ORDER BY document_id, page_number",
                            (run_id,)).fetchall()
        prepared = []
        for page_id, document_id, page_number, baseline, staged, baseline_hash in rows:
            try:
                baseline_payload = json.loads(baseline)
            except (TypeError, ValueError):
                raise HTTPException(400, "Baseline JSON invalide")
            working_payload = _official_page(working, document_id, page_number)
            for artifact in working_payload["artifacts"]:
                artifact["validation_run_id"] = run_id
            if json.loads(staged) != working_payload:
                conn.execute("UPDATE validation_run_pages SET working_json=?, updated_at=CURRENT_TIMESTAMP"
                             " WHERE id=?", (json.dumps(working_payload, ensure_ascii=False, sort_keys=True), page_id))
            current_hash = _payload_sha256(_official_page(conn, document_id, page_number))
            expected_hash = baseline_hash or _payload_sha256(baseline_payload)
            if current_hash != expected_hash:
                raise HTTPException(409, "Données officielles modifiées depuis la création du run")
            _assert_human_edits_preserved(baseline_payload, working_payload)
            prepared.append((page_id, working_payload))
        _validate_accept_references(conn, [payload for _, payload in prepared])
        deferred_links = []
        for page_id, working_payload in prepared:
            document_id = working_payload["document_id"]
            page_number = int(working_payload["page_number"])
            deferred_links.extend(_replace_official_page(conn, working_payload))
            scan = working.execute(
                "SELECT id, width_px, height_px, dpi, image_webp, thumb_webp, created_at"
                " FROM page_scans WHERE document_id=? AND page_number=?",
                (document_id, page_number)).fetchone()
            conn.execute("DELETE FROM page_scans WHERE document_id=? AND page_number=?",
                         (document_id, page_number))
            if scan:
                conn.execute("INSERT INTO page_scans"
                             " (id,document_id,page_number,width_px,height_px,dpi,image_webp,thumb_webp,created_at)"
                             " VALUES (?,?,?,?,?,?,?,?,?)",
                             (scan[0], document_id, page_number, *scan[1:]))
            conn.execute("DELETE FROM processing_benchmarks WHERE document_id=? AND page_number=?"
                         " AND validation_run_id IS NULL", (document_id, page_number))
            bench_cols = ("id", "document_id", "page_number", "engine_used", "vlm_provider_used",
                          "fallback_triggered", "linter_errors_json", "execution_time_ms", "ram_peak_mb",
                          "confidence_score", "blur_score", "deskew_angle", "created_at")
            for bench in working.execute(
                    "SELECT %s FROM processing_benchmarks WHERE document_id=? AND page_number=?" %
                    ",".join(bench_cols), (document_id, page_number)).fetchall():
                conn.execute("INSERT OR REPLACE INTO processing_benchmarks (%s, validation_run_id)"
                             " VALUES (%s,?)" % (",".join(bench_cols),
                                                 ",".join("?" for _ in bench_cols)),
                             tuple(bench) + (run_id,))
            conn.execute("UPDATE validation_run_pages SET status='ACCEPTED',"
                         " updated_at=CURRENT_TIMESTAMP WHERE id=?", (page_id,))
        for linked_id, chunk_id in deferred_links:
            conn.execute("UPDATE document_chunks SET linked_solution_chunk_id=? WHERE id=?",
                         (linked_id, chunk_id))
        conn.execute("UPDATE validation_runs SET status='ACCEPTED', accepted_at=CURRENT_TIMESTAMP,"
                     " updated_at=CURRENT_TIMESTAMP WHERE id=?", (run_id,))
        _event(conn, run_id, "run.accepted", {"pages": len(rows), "working_db_deleted": True})
        conn.commit()
        working.close()
        working = None
        _remove_working_db(filename)
        return {"accepted": True, "run_id": run_id, "pages": len(rows), "official_mutated": True,
                "working_db_deleted": True}
    except Exception:
        conn.rollback()
        raise
    finally:
        if working is not None:
            working.close()
        conn.close()


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str, db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    working = None
    try:
        run = _run(conn, run_id)
        if run["status"] in ("ACCEPTED", "REJECTED", "CANCELLED"):
            raise HTTPException(409, "Run déjà terminal")
        filename = run.get("working_db_filename")
        batch_ids = _batch_ids(run)
        removed_jobs = 0
        if filename and os.path.exists(_working_db_path(filename)) and batch_ids:
            working = db.get_connection(filename)
            marks = ",".join("?" for _ in batch_ids)
            removed_jobs = working.execute(
                "DELETE FROM pipeline_jobs WHERE batch_id IN (%s) AND status='QUEUED'" % marks,
                batch_ids).rowcount
            working.execute("UPDATE ingestion_batches SET status='STOPPED', updated_at=CURRENT_TIMESTAMP"
                            " WHERE id IN (%s) AND status IN ('QUEUED','RUNNING')" % marks, batch_ids)
            working.commit()
        conn.execute("UPDATE validation_run_pages SET status='CANCELLED', updated_at=CURRENT_TIMESTAMP"
                     " WHERE run_id=? AND status NOT IN ('ACCEPTED','REJECTED')", (run_id,))
        conn.execute("UPDATE validation_runs SET status='CANCELLED', execution_status='CANCELLED',"
                     " updated_at=CURRENT_TIMESTAMP WHERE id=?", (run_id,))
        _event(conn, run_id, "run.cancelled", {"batch_ids": batch_ids,
                                                "removed_queued_jobs": removed_jobs})
        conn.commit()
        return {"cancelled": True, "run_id": run_id, "batch_ids": batch_ids,
                "removed_queued_jobs": removed_jobs, "official_mutated": False}
    finally:
        if working is not None:
            working.close()
        conn.close()


@router.post("/runs/{run_id}/reject")
def reject_run(run_id: str, db_name: str = Query(alias="db")):
    _refresh_execution_state(db_name, run_id)
    conn = _conn(db_name)
    filename = None
    try:
        run = _run(conn, run_id)
        if run["execution_status"] not in ("COMPLETED", "BLOCKED", "FAILED"):
            raise HTTPException(409, "Seul un run terminé peut être rejeté")
        filename = run.get("working_db_filename")
        conn.execute("UPDATE validation_run_pages SET status='REJECTED', updated_at=CURRENT_TIMESTAMP"
                     " WHERE run_id=?", (run_id,))
        conn.execute("UPDATE validation_runs SET status='REJECTED', rejected_at=CURRENT_TIMESTAMP,"
                     " updated_at=CURRENT_TIMESTAMP WHERE id=?", (run_id,))
        _event(conn, run_id, "run.rejected", {"working_db_deleted": True})
        conn.commit()
        _remove_working_db(filename)
        return {"rejected": True, "run_id": run_id, "official_mutated": False,
                "working_db_deleted": True}
    finally:
        conn.close()


def _diff(baseline, working):
    if baseline == working:
        return {"changed": False, "baseline_sha256": hashlib.sha256(
            json.dumps(baseline, sort_keys=True).encode()).hexdigest(), "working_sha256": hashlib.sha256(
            json.dumps(working, sort_keys=True).encode()).hexdigest(), "changes": []}
    changes = []
    for key in sorted(set(baseline) | set(working)):
        if baseline.get(key) != working.get(key):
            changes.append({"field": key, "before": baseline.get(key), "after": working.get(key)})
    return {"changed": True, "baseline_sha256": hashlib.sha256(
        json.dumps(baseline, sort_keys=True).encode()).hexdigest(), "working_sha256": hashlib.sha256(
        json.dumps(working, sort_keys=True).encode()).hexdigest(), "changes": changes}


@router.get("/runs/{run_id}/pages/{page_number}/diff")
def page_diff(run_id: str, page_number: int, db_name: str = Query(alias="db"),
              document_id: Optional[str] = None):
    conn = _conn(db_name)
    try:
        row = _page_row(conn, run_id, page_number, document_id)
        return {"run_id": run_id, "document_id": row[1], "page_number": row[2],
                "diff": _diff(json.loads(row[4]), json.loads(row[5]))}
    finally:
        conn.close()


@router.get("/runs/{run_id}/diff")
def run_diff(run_id: str, db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    try:
        _run(conn, run_id)
        pages = []
        for doc_id, page_number, baseline, working in conn.execute(
                "SELECT document_id, page_number, baseline_json, working_json FROM validation_run_pages"
                " WHERE run_id=? ORDER BY document_id, page_number", (run_id,)).fetchall():
            item = _diff(json.loads(baseline), json.loads(working))
            pages.append({"document_id": doc_id, "page_number": page_number, "diff": item})
        return {"run_id": run_id, "changed_pages": sum(1 for p in pages if p["diff"]["changed"]),
                "pages": pages}
    finally:
        conn.close()


@router.get("/runs/{run_id}/report")
def report(run_id: str, db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    try:
        run = _run(conn, run_id)
        diff = run_diff(run_id, db_name)
        events = [{"id": r[0], "document_id": r[1], "page_number": r[2], "event_type": r[3],
                   "payload": json.loads(r[4]), "created_at": r[5]} for r in conn.execute(
            "SELECT id, document_id, page_number, event_type, payload_json, created_at"
            " FROM validation_events WHERE run_id=? ORDER BY created_at, rowid", (run_id,)).fetchall()]
        benchmarks = [r[0] for r in conn.execute(
            "SELECT id FROM processing_benchmarks WHERE validation_run_id=?"
            " ORDER BY document_id, page_number, id", (run_id,))]
        filename = run.get("working_db_filename")
        if filename and os.path.exists(_working_db_path(filename)):
            working = db.get_connection(filename)
            try:
                for document_id, page_number in conn.execute(
                        "SELECT document_id,page_number FROM validation_run_pages WHERE run_id=?",
                        (run_id,)).fetchall():
                    benchmarks.extend(r[0] for r in working.execute(
                        "SELECT id FROM processing_benchmarks WHERE document_id=? AND page_number=?"
                        " ORDER BY id", (document_id, page_number)).fetchall())
            finally:
                working.close()
        return {"schema": "ragdom.validation-report.v1", "run": run, "diff": diff,
                "events": events, "benchmark_ids": sorted(set(benchmarks))}
    finally:
        conn.close()


@router.post("/runs/{run_id}/benchmarks")
def attach_benchmarks(run_id: str, body: BenchmarkAttachDTO, db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    try:
        conn.execute("BEGIN IMMEDIATE")
        run = _run(conn, run_id)
        if run["status"] in ("ACCEPTED", "REJECTED", "CANCELLED", "FAILED"):
            raise HTTPException(409, "Provenance benchmark immutable après terminalisation du run")
        allowed = {(r[0], r[1]) for r in conn.execute(
            "SELECT document_id, page_number FROM validation_run_pages WHERE run_id=?", (run_id,))}
        filename = run.get("working_db_filename")
        if not filename or not os.path.exists(_working_db_path(filename)):
            raise HTTPException(409, "Copie SQLite de validation absente")
        working = db.get_connection(filename)
        attached = []
        try:
            for benchmark_id in body.benchmark_ids:
                row = working.execute("SELECT document_id, page_number FROM processing_benchmarks WHERE id=?",
                                      (benchmark_id,)).fetchone()
                if row is None:
                    raise HTTPException(404, "Benchmark introuvable : %s" % benchmark_id)
                if (row[0], row[1]) not in allowed:
                    raise HTTPException(409, "Benchmark hors périmètre : %s" % benchmark_id)
                owner = working.execute("SELECT validation_run_id FROM processing_benchmarks WHERE id=?",
                                        (benchmark_id,)).fetchone()[0]
                if owner not in (None, run_id):
                    raise HTTPException(409, "Benchmark déjà rattaché à un autre run : %s" % benchmark_id)
                working.execute("UPDATE processing_benchmarks SET validation_run_id=?"
                                " WHERE id=? AND validation_run_id IS NULL", (run_id, benchmark_id))
                attached.append(benchmark_id)
            working.commit()
        finally:
            working.close()
        _event(conn, run_id, "benchmarks.attached", {"ids": attached})
        conn.commit()
        return {"run_id": run_id, "attached": attached, "working_db": filename}
    finally:
        conn.close()


@router.post("/embeddings/profiles", status_code=201)
def create_embedding_profile(body: EmbeddingProfileDTO, db_name: str = Query(alias="db")):
    if body.dimensions != 384:
        raise HTTPException(422, "Seuls les profils 384 dimensions sont supportés actuellement")
    conn = _conn(db_name)
    try:
        conn.execute("BEGIN IMMEDIATE")
        natural = (body.model_name.strip(), body.model_version.strip(), body.pooling,
                   body.dimensions, int(body.normalized))
        existing = conn.execute("SELECT id, metadata_json FROM embedding_profiles WHERE model_name=?"
                                " AND model_version=? AND pooling=? AND dimensions=? AND normalized=?",
                                natural).fetchone()
        metadata = dict(body.metadata)
        if not isinstance(metadata.get("profile_contract"), dict):
            metadata["profile_contract"] = {"model_name": natural[0], "model_version": natural[1],
                                             "pooling": natural[2], "dimensions": natural[3],
                                             "normalized": bool(natural[4])}
        if existing:
            stored = json.loads(existing[1] or "{}")
            if stored != metadata:
                raise HTTPException(409, "Profil naturel existant avec des métadonnées différentes")
            conn.commit()
            return {"id": existing[0], **body.model_dump(), "metadata": stored, "existing": True}
        profile_id = str(uuid.uuid4())
        conn.execute("INSERT INTO embedding_profiles (id, model_name, model_version, pooling, dimensions,"
                     " normalized, metadata_json) VALUES (?,?,?,?,?,?,?)",
                     (profile_id, *natural, json.dumps(metadata, ensure_ascii=False, sort_keys=True)))
        conn.commit()
        return {"id": profile_id, **body.model_dump(), "metadata": metadata, "existing": False}
    except HTTPException:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post("/embeddings/assign")
def assign_embedding_profile(body: EmbeddingAssignDTO):
    conn = _conn(body.db)
    try:
        doc = conn.execute("SELECT 1 FROM documents WHERE id=?", (body.document_id,)).fetchone()
        profile = conn.execute("SELECT dimensions FROM embedding_profiles WHERE id=?",
                               (body.profile_id,)).fetchone()
        if not doc or not profile:
            raise HTTPException(404, "Document ou profil introuvable")
        current = conn.execute("SELECT profile_id FROM document_embedding_profiles WHERE document_id=?",
                               (body.document_id,)).fetchone()
        vectors = conn.execute("SELECT COUNT(*) FROM document_chunks WHERE document_id=?"
                               " AND embedding_vector IS NOT NULL", (body.document_id,)).fetchone()[0]
        active_profiles, _, _ = active_vector_profiles(conn)
        if any(item["id"] != body.profile_id for item in active_profiles):
            raise HTTPException(409, "Plusieurs profils actifs avec vecteurs interdits : réindexation explicite requise")
        if current and current[0] != body.profile_id and vectors:
            raise HTTPException(409, "Profil incompatible avec des vecteurs existants : réindexation explicite requise")
        if vectors:
            bad = conn.execute("SELECT COUNT(*) FROM document_chunks WHERE document_id=?"
                               " AND embedding_vector IS NOT NULL AND length(embedding_vector) != ?",
                               (body.document_id, int(profile[0]) * 4)).fetchone()[0]
            if bad:
                raise HTTPException(409, "Dimensions du profil incompatibles avec les vecteurs existants")
        conn.execute("INSERT INTO document_embedding_profiles (document_id, profile_id) VALUES (?,?)"
                     " ON CONFLICT(document_id) DO UPDATE SET profile_id=excluded.profile_id,"
                     " indexed_at=CURRENT_TIMESTAMP", (body.document_id, body.profile_id))
        conn.commit()
        return {"assigned": True, "document_id": body.document_id, "profile_id": body.profile_id,
                "reindexed": False, "confirm_reindex_ignored": body.confirm_reindex}
    finally:
        conn.close()


@router.get("/embeddings/diagnostic")
def embedding_diagnostic(db_name: str = Query(alias="db"), document_id: Optional[str] = None):
    conn = _conn(db_name)
    try:
        sql = "SELECT id, title FROM documents"
        args = []
        if document_id:
            sql += " WHERE id=?"
            args.append(document_id)
        documents = []
        for doc_id, title in conn.execute(sql, args).fetchall():
            profile_row = conn.execute(
                "SELECT p.id, p.model_name, p.model_version, p.pooling, p.dimensions,"
                " p.normalized, p.metadata_json FROM document_embedding_profiles d"
                " JOIN embedding_profiles p ON p.id=d.profile_id WHERE d.document_id=?",
                (doc_id,),
            ).fetchone()
            profile = profile_from_row(profile_row) if profile_row else None
            lengths = conn.execute("SELECT length(embedding_vector), COUNT(*) FROM document_chunks"
                                   " WHERE document_id=? AND embedding_vector IS NOT NULL"
                                   " GROUP BY length(embedding_vector) ORDER BY 1", (doc_id,)).fetchall()
            inferred = sorted({int(length / 4) for length, _ in lengths if length and length % 4 == 0})
            expected = profile["dimensions"] if profile else None
            shape_compatible = (not lengths) or (expected is not None and inferred == [expected])
            reasons = []
            if lengths and profile is None:
                reasons.append("embedding_profile_missing")
            if not shape_compatible:
                reasons.append("vector_dimensions_mismatch")
            query_reasons = compatibility_reasons(profile, CURRENT_PROFILE) if lengths else []
            reasons.extend(reason for reason in query_reasons if reason not in reasons)
            documents.append({"document_id": doc_id, "title": title,
                              "profile": profile,
                              "vector_count": sum(r[1] for r in lengths),
                              "inferred_dimensions": inferred, "compatible": shape_compatible,
                              "query_compatible": not query_reasons,
                              "reasons": reasons,
                              "action": None if not reasons else "register_or_reindex_explicitly"})
        active_profiles, vector_count, unassigned = active_vector_profiles(conn)
        database_reasons = []
        if len(active_profiles) > 1:
            database_reasons.append("multiple_active_embedding_profiles")
        if unassigned:
            database_reasons.append("vectors_without_embedding_profile")
        return {"engine": db.vector_state(), "query_profile": CURRENT_PROFILE.contract(),
                "active_profiles": active_profiles, "vector_count": vector_count,
                "database_compatible": not database_reasons, "reasons": database_reasons,
                "documents": documents, "silent_reindex_performed": False}
    finally:
        conn.close()
