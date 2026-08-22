# -*- coding: utf-8 -*-
"""Studio de validation live : runs isolés, snapshots, diff et diagnostics."""
import base64
import hashlib
import json
import uuid
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from core.validation_scope import ScopeResolutionError, resolve_scope
from db import connection as db

router = APIRouter()


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
    snapshot_type: Literal["logical", "physical"] = "logical"


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


def _event(conn, run_id: str, event_type: str, payload=None, page_number=None) -> None:
    conn.execute("INSERT INTO validation_events (id, run_id, page_number, event_type, payload_json)"
                 " VALUES (?,?,?,?,?)", (str(uuid.uuid4()), run_id, page_number, event_type,
                                         json.dumps(payload or {}, ensure_ascii=False, sort_keys=True)))


def _run(conn, run_id: str):
    row = conn.execute("SELECT id, document_id, scope_type, scope_json, status, label,"
                       " embedding_profile_id, created_at, updated_at, accepted_at, rejected_at"
                       " FROM validation_runs WHERE id=?", (run_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Run de validation introuvable")
    keys = ("id", "document_id", "scope_type", "scope_json", "status", "label",
            "embedding_profile_id", "created_at", "updated_at", "accepted_at", "rejected_at")
    result = dict(zip(keys, row))
    result["scope"] = json.loads(result.pop("scope_json"))
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
    conn = _conn(body.db)
    try:
        targets = _scope(conn, body.scope)
        if body.embedding_profile_id and not conn.execute(
                "SELECT 1 FROM embedding_profiles WHERE id=?", (body.embedding_profile_id,)).fetchone():
            raise HTTPException(404, "Profil d'embedding introuvable")
        run_id = str(uuid.uuid4())
        single_doc = targets[0].document_id if len(targets) == 1 else None
        scope_json = json.dumps(body.scope.model_dump(), ensure_ascii=False, sort_keys=True)
        conn.execute("BEGIN")
        conn.execute("INSERT INTO validation_runs (id, document_id, scope_type, scope_json, status, label,"
                     " embedding_profile_id) VALUES (?,?,?,?, 'READY', ?,?)",
                     (run_id, single_doc, body.scope.scope_type, scope_json, body.label,
                      body.embedding_profile_id))
        count = 0
        for target in targets:
            for page_number in target.pages:
                payload = _official_page(conn, target.document_id, page_number)
                encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
                conn.execute("INSERT INTO validation_run_pages (id, run_id, document_id, page_number,"
                             " status, baseline_json, working_json) VALUES (?,?,?,?, 'READY', ?,?)",
                             (str(uuid.uuid4()), run_id, target.document_id, page_number, encoded, encoded))
                count += 1
        _event(conn, run_id, "run.created", {"pages": count})
        conn.commit()
        return {"id": run_id, "status": "READY", "page_count": count,
                "scope_type": body.scope.scope_type, "official_mutated": False}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.get("/runs")
def list_runs(db_name: str = Query(alias="db"), document_id: Optional[str] = None):
    conn = _conn(db_name)
    try:
        sql = ("SELECT r.id, r.document_id, r.scope_type, r.status, r.label, r.created_at, r.updated_at,"
               " COUNT(p.id) FROM validation_runs r LEFT JOIN validation_run_pages p ON p.run_id=r.id")
        args = []
        if document_id:
            sql += " WHERE EXISTS (SELECT 1 FROM validation_run_pages vp WHERE vp.run_id=r.id AND vp.document_id=?)"
            args.append(document_id)
        sql += " GROUP BY r.id ORDER BY r.created_at DESC"
        return {"runs": [{"id": r[0], "document_id": r[1], "scope_type": r[2], "status": r[3],
                          "label": r[4], "created_at": r[5], "updated_at": r[6], "page_count": r[7]}
                         for r in conn.execute(sql, args).fetchall()]}
    finally:
        conn.close()


@router.get("/runs/{run_id}")
def get_run(run_id: str, db_name: str = Query(alias="db")):
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
        if run["status"] in ("ACCEPTED", "REJECTED", "CANCELLED"):
            raise HTTPException(409, "Run terminal non modifiable")
        row = _page_row(conn, run_id, page_number, document_id)
        working = dict(body.working)
        if working.get("document_id") != row[1] or working.get("page_number") != row[2]:
            raise HTTPException(400, "La copie de travail doit conserver document_id et page_number")
        if not isinstance(working.get("chunks", []), list) or not isinstance(working.get("artifacts", []), list):
            raise HTTPException(400, "chunks et artifacts doivent être des listes")
        encoded = json.dumps(working, ensure_ascii=False, sort_keys=True)
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
        if run["status"] in ("ACCEPTED", "REJECTED", "CANCELLED"):
            raise HTTPException(409, "Run terminal non restaurable")
        row = conn.execute("SELECT payload_json FROM validation_snapshots WHERE id=? AND run_id=?",
                           (snapshot_id, run_id)).fetchone()
        if row is None:
            raise HTTPException(404, "Snapshot introuvable")
        payload = json.loads(row[0])
        conn.execute("BEGIN")
        restored = 0
        for page in payload.get("pages", []):
            cur = conn.execute("UPDATE validation_run_pages SET working_json=?, status='READY',"
                               " updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND document_id=? AND page_number=?",
                               (json.dumps(page["working"], ensure_ascii=False, sort_keys=True), run_id,
                                page["document_id"], page["page_number"]))
            restored += cur.rowcount
        _event(conn, run_id, "snapshot.restored", {"snapshot_id": snapshot_id, "pages": restored})
        conn.commit()
        return {"restored": True, "pages": restored, "official_mutated": False}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _replace_official_page(conn, payload: dict) -> None:
    doc_id, page_number = payload["document_id"], int(payload["page_number"])
    chunks, artifacts = payload.get("chunks", []), payload.get("artifacts", [])
    for item in chunks + artifacts:
        if item.get("document_id") != doc_id or int(item.get("page_number", -1)) != page_number:
            raise HTTPException(400, "Copie de travail hors périmètre")
    conn.execute("DELETE FROM scientific_artifacts WHERE document_id=? AND page_number=?", (doc_id, page_number))
    conn.execute("UPDATE document_chunks SET linked_solution_chunk_id=NULL"
                 " WHERE document_id=? AND page_number=?", (doc_id, page_number))
    conn.execute("DELETE FROM document_chunks WHERE document_id=? AND page_number=?", (doc_id, page_number))
    chunk_cols = ("id", "document_id", "toc_id", "page_number", "chunk_index", "section_title",
                  "content_markdown", "pedagogical_type", "has_solution", "is_human_edited",
                  "pedagogical_index", "updated_at", "embedding_vector", "token_count", "created_at")
    links = []
    for item in chunks:
        values = [_decode(item.get(col)) for col in chunk_cols]
        conn.execute("INSERT INTO document_chunks (%s) VALUES (%s)" %
                     (", ".join(chunk_cols), ", ".join("?" for _ in chunk_cols)), values)
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
    conn = _conn(db_name)
    try:
        run = _run(conn, run_id)
        if run["status"] != "READY":
            raise HTTPException(409, "Seul un run READY peut être accepté")
        rows = conn.execute("SELECT id, working_json FROM validation_run_pages WHERE run_id=?"
                            " ORDER BY document_id, page_number", (run_id,)).fetchall()
        conn.execute("BEGIN")
        deferred_links = []
        for page_id, working in rows:
            deferred_links.extend(_replace_official_page(conn, json.loads(working)))
            conn.execute("UPDATE validation_run_pages SET status='ACCEPTED',"
                         " updated_at=CURRENT_TIMESTAMP WHERE id=?", (page_id,))
        for linked_id, chunk_id in deferred_links:
            conn.execute("UPDATE document_chunks SET linked_solution_chunk_id=? WHERE id=?",
                         (linked_id, chunk_id))
        conn.execute("UPDATE validation_runs SET status='ACCEPTED', accepted_at=CURRENT_TIMESTAMP,"
                     " updated_at=CURRENT_TIMESTAMP WHERE id=?", (run_id,))
        _event(conn, run_id, "run.accepted", {"pages": len(rows)})
        conn.commit()
        return {"accepted": True, "run_id": run_id, "pages": len(rows), "official_mutated": True}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str, db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    try:
        run = _run(conn, run_id)
        if run["status"] in ("ACCEPTED", "REJECTED", "CANCELLED"):
            raise HTTPException(409, "Run déjà terminal")
        conn.execute("UPDATE validation_run_pages SET status='CANCELLED', updated_at=CURRENT_TIMESTAMP"
                     " WHERE run_id=? AND status NOT IN ('ACCEPTED','REJECTED')", (run_id,))
        conn.execute("UPDATE validation_runs SET status='CANCELLED', updated_at=CURRENT_TIMESTAMP"
                     " WHERE id=?", (run_id,))
        _event(conn, run_id, "run.cancelled")
        conn.commit()
        return {"cancelled": True, "run_id": run_id, "official_mutated": False}
    finally:
        conn.close()


@router.post("/runs/{run_id}/reject")
def reject_run(run_id: str, db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    try:
        run = _run(conn, run_id)
        if run["status"] != "READY":
            raise HTTPException(409, "Seul un run READY peut être rejeté")
        conn.execute("UPDATE validation_run_pages SET status='REJECTED', updated_at=CURRENT_TIMESTAMP"
                     " WHERE run_id=?", (run_id,))
        conn.execute("UPDATE validation_runs SET status='REJECTED', rejected_at=CURRENT_TIMESTAMP,"
                     " updated_at=CURRENT_TIMESTAMP WHERE id=?", (run_id,))
        _event(conn, run_id, "run.rejected")
        conn.commit()
        return {"rejected": True, "run_id": run_id, "official_mutated": False}
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
        events = [{"id": r[0], "page_number": r[1], "event_type": r[2],
                   "payload": json.loads(r[3]), "created_at": r[4]} for r in conn.execute(
            "SELECT id, page_number, event_type, payload_json, created_at FROM validation_events"
            " WHERE run_id=? ORDER BY created_at, rowid", (run_id,)).fetchall()]
        benchmarks = [r[0] for r in conn.execute(
            "SELECT id FROM processing_benchmarks WHERE validation_run_id=? ORDER BY page_number", (run_id,))]
        return {"schema": "ragdom.validation-report.v1", "run": run, "diff": diff,
                "events": events, "benchmark_ids": benchmarks}
    finally:
        conn.close()


@router.post("/runs/{run_id}/benchmarks")
def attach_benchmarks(run_id: str, body: BenchmarkAttachDTO, db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    try:
        _run(conn, run_id)
        allowed = {(r[0], r[1]) for r in conn.execute(
            "SELECT document_id, page_number FROM validation_run_pages WHERE run_id=?", (run_id,))}
        attached = []
        for benchmark_id in body.benchmark_ids:
            row = conn.execute("SELECT document_id, page_number FROM processing_benchmarks WHERE id=?",
                               (benchmark_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "Benchmark introuvable : %s" % benchmark_id)
            if (row[0], row[1]) not in allowed:
                raise HTTPException(409, "Benchmark hors périmètre : %s" % benchmark_id)
            conn.execute("UPDATE processing_benchmarks SET validation_run_id=? WHERE id=?",
                         (run_id, benchmark_id))
            attached.append(benchmark_id)
        _event(conn, run_id, "benchmarks.attached", {"ids": attached})
        conn.commit()
        return {"run_id": run_id, "attached": attached}
    finally:
        conn.close()


@router.post("/embeddings/profiles", status_code=201)
def create_embedding_profile(body: EmbeddingProfileDTO, db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    try:
        profile_id = str(uuid.uuid4())
        conn.execute("INSERT INTO embedding_profiles (id, model_name, model_version, pooling, dimensions,"
                     " normalized, metadata_json) VALUES (?,?,?,?,?,?,?)",
                     (profile_id, body.model_name, body.model_version, body.pooling, body.dimensions,
                      int(body.normalized), json.dumps(body.metadata, ensure_ascii=False, sort_keys=True)))
        conn.commit()
        return {"id": profile_id, **body.model_dump()}
    except Exception as exc:
        conn.rollback()
        if "UNIQUE constraint failed" in str(exc):
            raise HTTPException(409, "Profil d'embedding déjà enregistré")
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
            profile = conn.execute("SELECT p.id, p.model_name, p.model_version, p.pooling, p.dimensions,"
                                   " p.normalized FROM document_embedding_profiles d"
                                   " JOIN embedding_profiles p ON p.id=d.profile_id WHERE d.document_id=?",
                                   (doc_id,)).fetchone()
            lengths = conn.execute("SELECT length(embedding_vector), COUNT(*) FROM document_chunks"
                                   " WHERE document_id=? AND embedding_vector IS NOT NULL"
                                   " GROUP BY length(embedding_vector) ORDER BY 1", (doc_id,)).fetchall()
            inferred = sorted({int(length / 4) for length, _ in lengths if length and length % 4 == 0})
            expected = profile[4] if profile else None
            compatible = (not lengths) or (expected is not None and inferred == [expected])
            documents.append({"document_id": doc_id, "title": title,
                              "profile": ({"id": profile[0], "model_name": profile[1],
                                           "model_version": profile[2], "pooling": profile[3],
                                           "dimensions": profile[4], "normalized": bool(profile[5])}
                                          if profile else None),
                              "vector_count": sum(r[1] for r in lengths),
                              "inferred_dimensions": inferred, "compatible": compatible,
                              "action": None if compatible else "register_or_reindex_explicitly"})
        return {"engine": db.vector_state(), "documents": documents,
                "silent_reindex_performed": False}
    finally:
        conn.close()
