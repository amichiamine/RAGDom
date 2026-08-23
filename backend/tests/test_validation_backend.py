# -*- coding: utf-8 -*-
"""Studio de validation live : scopes, runs, snapshots, isolation et embeddings."""
import hashlib
import importlib.util
import json
import os
import sqlite3
import struct
import sys
import threading
import time
import types

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402
from core.orchestrator import PipelineOrchestrator  # noqa: E402
from db import connection as db  # noqa: E402
from main import app  # noqa: E402

TEST_DB = "Validation_Backend.sqlite"
client = TestClient(app)


def _remove_db():
    path = os.path.join(config.DATABASES_DIR, TEST_DB)
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(path + suffix)
        except FileNotFoundError:
            pass


@pytest.fixture(autouse=True)
def validation_db():
    _remove_db()
    conn = db.create_database(TEST_DB)
    conn.executemany(
        "INSERT INTO documents (id,title,filename,source_path,total_pages) VALUES (?,?,?,?,?)",
        [("d1", "Document 1", "d1.pdf", "/tmp/d1.pdf", 5),
         ("d2", "Document 2", "d2.pdf", "/tmp/d2.pdf", 3)])
    conn.executemany(
        "INSERT INTO document_toc (id,document_id,level,title,page_start,page_end) VALUES (?,?,?,?,?,?)",
        [("t1", "d1", 1, "Chapitre 1", 2, 4), ("t2", "d2", 1, "Chapitre 2", 1, 2)])
    for doc_id, total in (("d1", 5), ("d2", 3)):
        for page in range(1, total + 1):
            chunk_id = "%s-c%s" % (doc_id, page)
            conn.execute("INSERT INTO document_chunks"
                         " (id,document_id,page_number,chunk_index,content_markdown,pedagogical_type,embedding_vector)"
                         " VALUES (?,?,?,?,?,'course_theory',?)",
                         (chunk_id, doc_id, page, 0, "Cours %s page %s" % (doc_id, page),
                          struct.pack("<384f", *([0.1] * 384))))
            conn.execute("INSERT INTO page_scans"
                         " (id,document_id,page_number,width_px,height_px,dpi,image_webp,thumb_webp)"
                         " VALUES (?,?,?,?,?,300,?,?)",
                         ("%s-s%s" % (doc_id, page), doc_id, page, 100, 200, b"webp", b"thumb"))
    conn.execute("INSERT INTO scientific_artifacts"
                 " (id,document_id,chunk_id,page_number,domain,artifact_type,searchable_text,raw_data,raw_binary)"
                 " VALUES ('a1','d1','d1-c2',2,'math','latex_formula','x','x',?)", (b"artifact-baseline",))
    conn.execute("INSERT INTO processing_benchmarks"
                 " (id,document_id,page_number,engine_used,execution_time_ms)"
                 " VALUES ('b1','d1',2,'test',10)")
    conn.commit()
    conn.close()
    yield
    _remove_db()
    for name in os.listdir(config.DATABASES_DIR):
        if name.startswith(db.VALIDATION_WORKING_DB_PREFIX):
            try:
                os.remove(os.path.join(config.DATABASES_DIR, name))
            except FileNotFoundError:
                pass


def _create_run(scope):
    """Create a logically completed run for legacy decision-focused unit tests.

    Physical execution is covered by dedicated end-to-end tests below; these older
    tests deliberately exercise edit/reference/decision guards in isolation.
    """
    response = client.post("/api/validation/runs", json={"db": TEST_DB, "scope": scope})
    assert response.status_code == 201, response.text
    run_id = response.json()["id"]
    conn = db.get_connection(TEST_DB)
    conn.execute("UPDATE validation_runs SET status='READY', execution_status='COMPLETED',"
                 " progress_current=progress_total WHERE id=?", (run_id,))
    conn.execute("UPDATE validation_run_pages SET status='READY' WHERE run_id=?", (run_id,))
    conn.commit(); conn.close()
    return run_id


def test_universal_scope_resolver_and_strict_guards():
    cases = [
        ({"scope_type": "base"}, 8),
        ({"scope_type": "document", "document_id": "d1"}, 5),
        ({"scope_type": "toc", "document_id": "d1", "toc_id": "t1"}, 3),
        ({"scope_type": "chapter", "document_id": "d1", "toc_id": "t1"}, 3),
        ({"scope_type": "course", "document_id": "d1", "toc_id": "t1"}, 3),
        ({"scope_type": "title", "document_id": "d1", "toc_id": "t1"}, 3),
        ({"scope_type": "page", "document_id": "d1", "page": 2}, 1),
        ({"scope_type": "page_range", "document_id": "d1", "page_start": 2, "page_end": 4}, 3),
        ({"scope_type": "page_selection", "document_id": "d1", "pages": [5, 1, 5]}, 2),
    ]
    for scope, expected in cases:
        response = client.post("/api/validation/resolve-scope", json={"db": TEST_DB, "scope": scope})
        assert response.status_code == 200, response.text
        assert response.json()["page_count"] == expected
    mismatch = client.post("/api/validation/resolve-scope", json={"db": TEST_DB, "scope": {
        "scope_type": "chapter", "document_id": "d1", "toc_id": "t2"}})
    assert mismatch.status_code == 409
    out_of_bounds = client.post("/api/validation/resolve-scope", json={"db": TEST_DB, "scope": {
        "scope_type": "page_range", "document_id": "d1", "page_start": 0, "page_end": 4}})
    assert out_of_bounds.status_code == 400
    extra = client.post("/api/validation/resolve-scope", json={"db": TEST_DB,
        "scope": {"scope_type": "document", "document_id": "d1"}, "unknown": True})
    assert extra.status_code == 422


def test_validation_run_pagination_and_isolated_binary_routes():
    run_ids = [
        _create_run({"scope_type": "page", "document_id": "d1", "page": page})
        for page in (1, 2, 3)
    ]
    first = client.get("/api/validation/runs", params={"db": TEST_DB, "page": 1, "limit": 2})
    second = client.get("/api/validation/runs", params={"db": TEST_DB, "page": 2, "limit": 2})
    assert first.status_code == 200 and len(first.json()["runs"]) == 2
    assert first.json()["pagination"] == {"page": 1, "limit": 2, "total": 3, "total_pages": 2}
    assert second.status_code == 200 and len(second.json()["runs"]) == 1

    run_id = run_ids[1]
    detail = client.get("/api/validation/runs/%s" % run_id, params={"db": TEST_DB}).json()
    working_db = detail["working_db_filename"]
    isolated = db.get_connection(working_db)
    isolated.execute("UPDATE page_scans SET image_webp=? WHERE document_id='d1' AND page_number=2",
                     (b"working-webp",))
    isolated.execute("UPDATE scientific_artifacts SET raw_binary=? WHERE id='a1'",
                     (b"artifact-working",))
    isolated.execute("INSERT INTO document_toc"
                     " (id,document_id,parent_id,level,title,page_start,page_end)"
                     " VALUES ('working-toc','d1','t1',2,'Working only',2,2)")
    isolated.execute("INSERT INTO curriculum_terms"
                     " (id,document_id,term_index,label) VALUES ('working-term','d1',1,'Working term')")
    isolated.execute("INSERT INTO processing_benchmarks"
                     " (id,document_id,page_number,engine_used,execution_time_ms)"
                     " VALUES ('working-bench','d1',2,'working-engine',20)")
    isolated.commit(); isolated.close()

    route = "/api/validation/runs/%s/pages/2" % run_id
    page_payload = client.get(route, params={"db": TEST_DB}).json()
    assert page_payload["baseline"]["page_scan"]["has_image"] is True
    assert "image_webp" not in page_payload["baseline"]["page_scan"]
    assert client.get(route + "/scan", params={"db": TEST_DB, "version": "baseline"}).content == b"webp"
    assert client.get(route + "/scan", params={"db": TEST_DB, "version": "working"}).content == b"working-webp"
    binary_route = route + "/artifacts/a1/binary"
    assert client.get(binary_route, params={"db": TEST_DB, "version": "baseline"}).content == b"artifact-baseline"
    assert client.get(binary_route, params={"db": TEST_DB, "version": "working"}).content == b"artifact-working"
    assert client.get(route + "/artifacts/unknown/binary",
                      params={"db": TEST_DB, "version": "working"}).status_code == 404
    inspection = client.get(route, params={"db": TEST_DB}).json()["working_inspection"]
    assert any(node["id"] == "working-toc" for node in inspection["toc"][0]["children"])
    assert [term["id"] for term in inspection["curriculum"]["terms"]] == ["working-term"]
    assert {row["id"] for row in inspection["benchmarks"]} == {"b1", "working-bench"}

    official = db.get_connection(TEST_DB)
    assert official.execute("SELECT image_webp FROM page_scans WHERE document_id='d1' AND page_number=2").fetchone()[0] == b"webp"
    assert official.execute("SELECT raw_binary FROM scientific_artifacts WHERE id='a1'").fetchone()[0] == b"artifact-baseline"
    official.close()


def test_working_copy_snapshots_diff_reject_never_mutate_official():
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    unsupported = client.post("/api/validation/runs/%s/snapshots?db=%s" % (run_id, TEST_DB),
                              json={"snapshot_type": "physical"})
    assert unsupported.status_code == 422
    snap = client.post("/api/validation/runs/%s/snapshots?db=%s" % (run_id, TEST_DB),
                       json={"snapshot_type": "logical"})
    assert snap.status_code == 201 and snap.json()["page_count"] == 1
    page = client.get("/api/validation/runs/%s/pages/2?db=%s" % (run_id, TEST_DB)).json()
    working = page["working"]
    working["chunks"][0]["content_markdown"] = "Copie de travail modifiée"
    updated = client.put("/api/validation/runs/%s/pages/2?db=%s" % (run_id, TEST_DB),
                         json={"working": working})
    assert updated.json()["official_mutated"] is False
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT content_markdown FROM document_chunks WHERE id='d1-c2'").fetchone()[0] != \
        "Copie de travail modifiée"
    conn.close()
    diff = client.get("/api/validation/runs/%s/diff?db=%s" % (run_id, TEST_DB)).json()
    assert diff["changed_pages"] == 1
    restored = client.post("/api/validation/runs/%s/snapshots/%s/restore?db=%s" %
                           (run_id, snap.json()["id"], TEST_DB)).json()
    assert restored["official_mutated"] is False
    assert client.get("/api/validation/runs/%s/diff?db=%s" % (run_id, TEST_DB)).json()["changed_pages"] == 0
    rejected = client.post("/api/validation/runs/%s/reject?db=%s" % (run_id, TEST_DB)).json()
    assert rejected["rejected"] and rejected["official_mutated"] is False


def test_targeted_run_cancellation_is_non_mutating():
    run_id = _create_run({"scope_type": "page", "document_id": "d2", "page": 1})
    cancelled = client.post("/api/validation/runs/%s/cancel?db=%s" % (run_id, TEST_DB)).json()
    assert cancelled["cancelled"] and cancelled["official_mutated"] is False
    assert client.get("/api/validation/runs/%s?db=%s" % (run_id, TEST_DB)).json()["status"] == "CANCELLED"


def test_accept_is_only_operation_that_updates_official_and_report_is_stable():
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    page = client.get("/api/validation/runs/%s/pages/2?db=%s" % (run_id, TEST_DB)).json()
    working = page["working"]
    working["chunks"][0]["content_markdown"] = "Version acceptée"
    client.put("/api/validation/runs/%s/pages/2?db=%s" % (run_id, TEST_DB), json={"working": working})
    attached = client.post("/api/validation/runs/%s/benchmarks?db=%s" % (run_id, TEST_DB),
                           json={"benchmark_ids": ["b1"]})
    assert attached.status_code == 200
    accepted = client.post("/api/validation/runs/%s/accept?db=%s" % (run_id, TEST_DB)).json()
    assert accepted["official_mutated"] is True
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT content_markdown FROM document_chunks WHERE id='d1-c2'").fetchone()[0] == \
        "Version acceptée"
    assert conn.execute("SELECT validation_run_id FROM processing_benchmarks WHERE id='b1'").fetchone()[0] == run_id
    conn.close()
    archived_route = "/api/validation/runs/%s/pages/2" % run_id
    assert client.get(archived_route + "/scan",
                      params={"db": TEST_DB, "version": "working"}).content == b"webp"
    assert client.get(archived_route + "/artifacts/a1/binary",
                      params={"db": TEST_DB, "version": "working"}).content == b"artifact-baseline"
    report = client.get("/api/validation/runs/%s/report?db=%s" % (run_id, TEST_DB)).json()
    assert report["schema"] == "ragdom.validation-report.v1"
    assert report["run"]["status"] == "ACCEPTED" and report["benchmark_ids"] == ["b1"]


def test_purge_batch_and_document_isolation_and_no_mutation_on_bad_toc():
    conn = db.get_connection(TEST_DB)
    conn.executemany("INSERT INTO ingestion_batches"
                     " (id,source_path,target_db,mode,status,pages_total) VALUES (?,?,?,'document','QUEUED',1)",
                     [("batch-1", "/tmp/d1.pdf", TEST_DB), ("batch-2", "/tmp/d2.pdf", TEST_DB)])
    conn.executemany("INSERT INTO pipeline_jobs"
                     " (id,document_id,page_number,status,batch_id) VALUES (?,?,1,'QUEUED',?)",
                     [("j1", "d1", "batch-1"), ("j2", "d2", "batch-2")])
    conn.commit(); conn.close()
    bad = client.post("/api/pipeline/purge", json={"db": TEST_DB, "scope": "chapter",
        "document_id": "d1", "toc_id": "t2", "dry_run": False})
    assert bad.status_code == 409
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT COUNT(*) FROM document_chunks").fetchone()[0] == 8
    conn.close()
    done = client.post("/api/pipeline/purge", json={"db": TEST_DB, "scope": "page",
        "document_id": "d1", "page": 1, "dry_run": False})
    assert done.status_code == 200, done.text
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT status FROM ingestion_batches WHERE id='batch-1'").fetchone()[0] == "STOPPED"
    assert conn.execute("SELECT status FROM ingestion_batches WHERE id='batch-2'").fetchone()[0] == "QUEUED"
    assert conn.execute("SELECT COUNT(*) FROM document_chunks WHERE document_id='d2'").fetchone()[0] == 3
    conn.close()


def test_recovery_resets_every_transient_state_and_running_batch():
    conn = db.get_connection(TEST_DB)
    conn.execute("INSERT INTO ingestion_batches"
                 " (id,source_path,target_db,mode,status,pages_total)"
                 " VALUES ('recover','/tmp/d1.pdf',?,'document','RUNNING',2)", (TEST_DB,))
    conn.executemany("INSERT INTO pipeline_jobs"
                     " (id,document_id,page_number,status,batch_id) VALUES (?,?,?,?, 'recover')",
                     [("r1", "d1", 1, "PROCESSING_CV"), ("r2", "d1", 2, "INDEXED")])
    conn.commit(); conn.close()
    assert PipelineOrchestrator().recover(TEST_DB) == 2
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT COUNT(*) FROM pipeline_jobs WHERE batch_id='recover' AND status='QUEUED'").fetchone()[0] == 2
    assert conn.execute("SELECT status FROM ingestion_batches WHERE id='recover'").fetchone()[0] == "QUEUED"
    conn.close()


def test_vlm_full_page_requires_explicit_opt_in_and_payload_is_bounded():
    conn = db.get_connection(TEST_DB)
    conn.execute("INSERT INTO scientific_artifacts"
                 " (id,document_id,chunk_id,page_number,domain,artifact_type,searchable_text,"
                 " raw_binary,bounding_box_json) VALUES"
                 " ('full','d1','d1-c1',1,'general','dense_illustration','page',?,?)",
                 (b"small", '{"x0":0,"y0":0,"x1":100,"y1":200}'))
    conn.commit(); conn.close()
    refused = client.post("/api/pipeline/requalify-artifacts", json={
        "db": TEST_DB, "document_id": "d1", "explode": True, "strategy": "vlm",
        "limit": 1, "dry_run": True})
    assert refused.status_code == 400
    bounded = client.post("/api/pipeline/requalify-artifacts", json={
        "db": TEST_DB, "document_id": "d1", "limit": 1, "max_payload_bytes": 1024,
        "dry_run": True})
    assert bounded.status_code == 200 and bounded.json()["candidates"] == 0


def test_embedding_profiles_diagnostic_and_no_silent_reindex():
    profile = client.post("/api/validation/embeddings/profiles?db=" + TEST_DB, json={
        "model_name": "test/model", "model_version": "1", "pooling": "mean",
        "dimensions": 384, "normalized": True, "metadata": {"runtime": "test"}})
    assert profile.status_code == 201, profile.text
    assigned = client.post("/api/validation/embeddings/assign", json={
        "db": TEST_DB, "document_id": "d1", "profile_id": profile.json()["id"]})
    assert assigned.status_code == 200 and assigned.json()["reindexed"] is False
    diagnostic = client.get("/api/validation/embeddings/diagnostic",
                            params={"db": TEST_DB, "document_id": "d1"}).json()
    assert diagnostic["documents"][0]["compatible"] is True
    assert diagnostic["silent_reindex_performed"] is False
    other = client.post("/api/validation/embeddings/profiles?db=" + TEST_DB, json={
        "model_name": "test/other", "model_version": "2", "pooling": "cls",
        "dimensions": 384, "normalized": False}).json()["id"]
    refused = client.post("/api/validation/embeddings/assign", json={
        "db": TEST_DB, "document_id": "d1", "profile_id": other})
    assert refused.status_code == 409


def test_curriculum_build_is_non_destructive_across_documents():
    path = os.path.join(os.path.dirname(__file__), "..", "..", "engines", "sci-engine",
                        "pipeline", "curriculum_builder.py")
    spec = importlib.util.spec_from_file_location("validation_curriculum_builder", path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    conn = db.get_connection(TEST_DB)
    module.build_curriculum(conn, "d1")
    d1_before = conn.execute("SELECT COUNT(*) FROM curriculum_programs WHERE document_id='d1'").fetchone()[0]
    module.build_curriculum(conn, "d2")
    assert conn.execute("SELECT COUNT(*) FROM curriculum_programs WHERE document_id='d1'").fetchone()[0] == d1_before
    assert conn.execute("SELECT COUNT(*) FROM curriculum_programs WHERE document_id='d2'").fetchone()[0] > 0
    assert conn.execute("SELECT COUNT(*) FROM content_links WHERE document_id IS NULL").fetchone()[0] == 0
    d2_before = conn.execute("SELECT COUNT(*) FROM curriculum_programs WHERE document_id='d2'").fetchone()[0]
    conn.close()
    imported = client.post("/api/curriculum/import", params={"db": TEST_DB}, json={
        "mode": "replace", "document_id": "d1",
        "terms": [{"id": "manual-d1", "term_index": 2, "label": "Terme manuel"}]})
    assert imported.status_code == 200, imported.text
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT COUNT(*) FROM curriculum_programs WHERE document_id='d2'").fetchone()[0] == d2_before
    assert conn.execute("SELECT document_id FROM curriculum_terms WHERE id='manual-d1'").fetchone()[0] == "d1"
    conn.close()


def test_migration_application_is_additive_and_idempotent_from_v4():
    legacy = "Validation_Legacy.sqlite"
    path = os.path.join(config.DATABASES_DIR, legacy)
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(path + suffix)
        except FileNotFoundError:
            pass
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE schema_version(version INTEGER PRIMARY KEY, applied_at DATETIME, description TEXT);
        INSERT INTO schema_version(version) VALUES(4);
        CREATE TABLE documents(id TEXT PRIMARY KEY);
        CREATE TABLE processing_benchmarks(id TEXT);
        CREATE TABLE curriculum_terms(id TEXT);
        CREATE TABLE curriculum_programs(id TEXT);
        CREATE TABLE content_links(id TEXT);
        CREATE TABLE scientific_artifacts(id TEXT);
    """)
    conn.close()
    try:
        migrated = db.get_connection(legacy)
        assert migrated.execute("SELECT COUNT(*) FROM schema_version WHERE version=5").fetchone()[0] == 1
        assert migrated.execute("SELECT COUNT(*) FROM schema_version WHERE version=7").fetchone()[0] == 1
        assert "document_id" in [r[1] for r in migrated.execute("PRAGMA table_info(content_links)")]
        assert "document_id" in [r[1] for r in migrated.execute("PRAGMA table_info(assessments)")]
        assert "document_id" in [r[1] for r in migrated.execute("PRAGMA table_info(validation_events)")]
        assert "baseline_hash" in [r[1] for r in migrated.execute("PRAGMA table_info(validation_run_pages)")]
        run_columns = [r[1] for r in migrated.execute("PRAGMA table_info(validation_runs)")]
        assert {"working_db_filename", "operation", "batch_id", "execution_status", "error_log"}.issubset(run_columns)
        assert migrated.execute("SELECT 1 FROM sqlite_master WHERE name='uq_jobs_active_page'").fetchone()
        assert db.apply_migrations(migrated) == 0
        migrated.close()
    finally:
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(path + suffix)
            except FileNotFoundError:
                pass


def _official_digest():
    conn = db.get_connection(TEST_DB)
    try:
        rows = []
        for table in ("document_chunks", "scientific_artifacts", "page_scans"):
            rows.extend((table,) + tuple(row) for row in conn.execute(
                "SELECT * FROM %s ORDER BY rowid" % table).fetchall())
        return hashlib.sha256(repr(rows).encode()).hexdigest()
    finally:
        conn.close()


def test_run_requalify_is_fail_closed_and_terminal_actions_preserve_official(monkeypatch):
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 1})
    before = _official_digest()
    response = client.post("/api/pipeline/requalify-artifacts", json={
        "db": TEST_DB, "document_id": "d1", "run_id": run_id, "limit": 1, "dry_run": True})
    assert response.status_code == 200
    assert _official_digest() == before
    assert client.post("/api/validation/runs/%s/cancel?db=%s" % (run_id, TEST_DB)).status_code == 200
    assert _official_digest() == before

    rejected_run = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    before = _official_digest()
    assert client.post("/api/validation/runs/%s/reject?db=%s" %
                       (rejected_run, TEST_DB)).status_code == 200
    assert _official_digest() == before


def test_accept_preserves_unchanged_human_artifact_ignoring_run_provenance():
    conn = db.get_connection(TEST_DB)
    conn.execute("UPDATE scientific_artifacts SET is_human_edited=1, caption='édition humaine'"
                 " WHERE id='a1'")
    conn.commit(); conn.close()
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})

    accepted = client.post("/api/validation/runs/%s/accept?db=%s" % (run_id, TEST_DB))
    assert accepted.status_code == 200, accepted.text
    conn = db.get_connection(TEST_DB)
    try:
        row = conn.execute("SELECT caption,is_human_edited,validation_run_id"
                           " FROM scientific_artifacts WHERE id='a1'").fetchone()
        assert row == ("édition humaine", 1, run_id)
    finally:
        conn.close()


@pytest.mark.parametrize("mutation,expected", [
    ("UPDATE page_scans SET width_px=321 WHERE id='d1-s2'", 321),
    ("UPDATE processing_benchmarks SET execution_time_ms=321 WHERE id='b1'", 321),
])
def test_accept_detects_concurrent_promoted_scan_or_benchmark_change(mutation, expected):
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    conn = db.get_connection(TEST_DB)
    conn.execute(mutation)
    conn.commit(); conn.close()

    conflict = client.post("/api/validation/runs/%s/accept?db=%s" % (run_id, TEST_DB))
    assert conflict.status_code == 409
    conn = db.get_connection(TEST_DB)
    try:
        if "page_scans" in mutation:
            assert conn.execute("SELECT width_px FROM page_scans WHERE id='d1-s2'").fetchone()[0] == expected
        else:
            assert conn.execute("SELECT execution_time_ms FROM processing_benchmarks"
                                " WHERE id='b1'").fetchone()[0] == expected
    finally:
        conn.close()


def test_accept_legacy_baseline_hash_falls_back_to_logical_page_comparison():
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 1})
    conn = db.get_connection(TEST_DB)
    conn.execute("UPDATE validation_run_pages SET baseline_hash=NULL WHERE run_id=?", (run_id,))
    conn.commit(); conn.close()
    accepted = client.post("/api/validation/runs/%s/accept?db=%s" % (run_id, TEST_DB))
    assert accepted.status_code == 200, accepted.text


def test_accept_optimistic_concurrency_and_human_edit_protection():
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    conn = db.get_connection(TEST_DB)
    conn.execute("UPDATE document_chunks SET content_markdown='human concurrent', is_human_edited=1"
                 " WHERE id='d1-c2'")
    conn.commit(); conn.close()
    conflicted = client.post("/api/validation/runs/%s/accept?db=%s" % (run_id, TEST_DB))
    assert conflicted.status_code == 409
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT content_markdown FROM document_chunks WHERE id='d1-c2'").fetchone()[0] == \
        "human concurrent"
    conn.execute("UPDATE document_chunks SET content_markdown='protected baseline', is_human_edited=1"
                 " WHERE id='d1-c3'")
    conn.commit(); conn.close()

    protected = _create_run({"scope_type": "page", "document_id": "d1", "page": 3})
    page = client.get("/api/validation/runs/%s/pages/3?db=%s" % (protected, TEST_DB)).json()
    page["working"]["chunks"][0]["content_markdown"] = "overwrite attempted"
    assert client.put("/api/validation/runs/%s/pages/3?db=%s" % (protected, TEST_DB),
                      json={"working": page["working"]}).status_code == 200
    assert client.post("/api/validation/runs/%s/accept?db=%s" %
                       (protected, TEST_DB)).status_code == 409
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT content_markdown FROM document_chunks WHERE id='d1-c3'").fetchone()[0] == \
        "protected baseline"
    conn.close()


def test_active_job_uniqueness_and_atomic_claim():
    orch = PipelineOrchestrator()
    first = orch.enqueue_batch(TEST_DB, "d1", "/tmp/d1.pdf", "page_range", 1, 1)
    second = orch.enqueue_batch(TEST_DB, "d1", "/tmp/d1.pdf", "page_range", 1, 1)
    assert first["skipped_active"] == 0 and second["skipped_active"] == 1
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT COUNT(*) FROM pipeline_jobs WHERE document_id='d1' AND page_number=1"
                        " AND status='QUEUED'").fetchone()[0] == 1
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO pipeline_jobs (id,document_id,page_number,status)"
                     " VALUES ('duplicate','d1',1,'QUEUED')")
    conn.rollback(); conn.close()
    claimed = orch._next_job(TEST_DB)
    assert claimed and claimed["document_id"] == "d1"
    assert PipelineOrchestrator()._next_job(TEST_DB) is None


def test_reprocess_restores_snapshot_if_enqueue_fails(monkeypatch):
    from api import routes_pipeline
    for path in ("/tmp/d1.pdf",):
        with open(path, "wb") as stream:
            stream.write(b"source")
    before = _official_digest()
    monkeypatch.setattr(routes_pipeline.orchestrator, "enqueue_batch",
                        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("enqueue failed")))
    with pytest.raises(RuntimeError, match="enqueue failed"):
        client.post("/api/pipeline/reprocess", json={
            "db": TEST_DB, "scope": "page", "document_id": "d1", "page": 1})
    assert _official_digest() == before
    os.remove("/tmp/d1.pdf")


def test_validation_events_are_document_scoped_and_benchmark_owner_is_immutable():
    run1 = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    page = client.get("/api/validation/runs/%s/pages/2?db=%s" % (run1, TEST_DB)).json()
    assert client.put("/api/validation/runs/%s/pages/2?db=%s" % (run1, TEST_DB),
                      json={"working": page["working"]}).status_code == 200
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT document_id FROM validation_events WHERE run_id=?"
                        " AND page_number=2 ORDER BY rowid DESC", (run1,)).fetchone()[0] == "d1"
    conn.close()
    assert client.post("/api/validation/runs/%s/benchmarks?db=%s" % (run1, TEST_DB),
                       json={"benchmark_ids": ["b1"]}).status_code == 200
    run2 = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    # Each physical copy owns its own benchmark provenance; no official benchmark
    # row is reserved before acceptance.
    assert client.post("/api/validation/runs/%s/benchmarks?db=%s" % (run2, TEST_DB),
                       json={"benchmark_ids": ["b1"]}).status_code == 200


def test_embedding_profile_natural_key_384_contract_and_vector_recovery():
    payload = {"model_name": " deterministic/model ", "model_version": "v1", "pooling": "mean",
               "dimensions": 384, "normalized": True, "metadata": {"runtime": "cpu"}}
    first = client.post("/api/validation/embeddings/profiles?db=" + TEST_DB, json=payload)
    second = client.post("/api/validation/embeddings/profiles?db=" + TEST_DB, json=payload)
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] == second.json()["id"] and second.json()["existing"] is True
    bad = dict(payload, dimensions=768)
    assert client.post("/api/validation/embeddings/profiles?db=" + TEST_DB, json=bad).status_code == 422

    conn = db.get_connection(TEST_DB)
    if db.vector_state()["engine"] == "sqlite-vec":
        conn.execute("DROP TRIGGER IF EXISTS trg_chunks_vec_sync")
        conn.execute("DROP TRIGGER IF EXISTS trg_chunks_vec_delete")
        conn.execute("DROP TRIGGER IF EXISTS trg_chunks_vec_update")
        conn.execute("DROP TABLE IF EXISTS vec_chunks")
        db.init_vector_support(conn)
        expected = conn.execute("SELECT COUNT(*) FROM document_chunks WHERE embedding_vector IS NOT NULL").fetchone()[0]
        assert conn.execute("SELECT COUNT(*) FROM vec_chunks").fetchone()[0] == expected
        # Reopening an already complete vec0 index must not reinsert duplicate PKs.
        db.init_vector_support(conn)
        assert db.vector_state()["status"] == "ready"
        assert conn.execute("SELECT COUNT(*) FROM vec_chunks").fetchone()[0] == expected
        conn.execute("UPDATE document_chunks SET embedding_vector=NULL WHERE id='d1-c1'")
        assert conn.execute("SELECT COUNT(*) FROM vec_chunks WHERE chunk_id='d1-c1'").fetchone()[0] == 0
    conn.close()


def test_curriculum_legacy_ambiguity_and_cross_document_guards():
    conn = db.get_connection(TEST_DB)
    conn.execute("INSERT INTO curriculum_terms (id,document_id,term_index,label)"
                 " VALUES ('legacy-null',NULL,1,'legacy')")
    conn.execute("INSERT INTO curriculum_terms (id,document_id,term_index,label)"
                 " VALUES ('d2-term','d2',1,'d2')")
    conn.execute("INSERT INTO curriculum_programs"
                 " (id,term_id,seq_index,title,source,competencies_json,document_id)"
                 " VALUES ('legacy-program','legacy-null',1,'legacy','auto',?,NULL)",
                 (json.dumps({"source": "auto", "toc_id": "t1"}),))
    conn.execute("INSERT INTO content_links"
                 " (id,link_type,from_id,to_id,page_number,metadata_json,document_id)"
                 " VALUES ('legacy-link','program_term','legacy-program','legacy-null',2,'{}',NULL)")
    conn.commit(); conn.close()
    ambiguous = client.post("/api/curriculum/programs?db=" + TEST_DB,
                            json={"term_id": "d2-term", "seq_index": 1, "title": "x"})
    assert ambiguous.status_code == 400
    crossed = client.post("/api/curriculum/programs?db=" + TEST_DB,
                          json={"document_id": "d1", "term_id": "d2-term",
                                "seq_index": 1, "title": "x"})
    assert crossed.status_code == 409
    health = client.get("/api/system/health").json()
    assert health["status"] == "ok"
    assert health["validation"]["curriculum_ambiguous_rows"] == 0
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT document_id FROM curriculum_programs"
                        " WHERE id='legacy-program'").fetchone()[0] == "d1"
    assert conn.execute("SELECT document_id FROM content_links"
                        " WHERE id='legacy-link'").fetchone()[0] == "d1"
    # Shared/empty terms may stay global without degrading an otherwise valid base.
    assert conn.execute("SELECT document_id FROM curriculum_terms"
                        " WHERE id='legacy-null'").fetchone()[0] == "d1"
    conn.close()


def test_sql_migration_parser_keeps_trigger_body_together():
    script = """CREATE TABLE x(id INTEGER, value TEXT);\nCREATE TABLE log(v TEXT);\nCREATE TRIGGER tx AFTER INSERT ON x BEGIN\n INSERT INTO log(v) VALUES('a;b');\n UPDATE x SET value='done' WHERE id=new.id;\nEND;\n"""
    statements = list(db._sql_statements(script))
    assert len(statements) == 3
    conn = sqlite3.connect(":memory:")
    for statement in statements:
        conn.execute(statement)
    conn.execute("INSERT INTO x(id) VALUES(1)")
    assert conn.execute("SELECT value FROM x").fetchone()[0] == "done"
    conn.close()


def test_sqlite_duplicate_uses_atomic_backup():
    duplicate = "Validation_Backend_Copy.sqlite"
    path = os.path.join(config.DATABASES_DIR, duplicate)
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(path + suffix)
        except FileNotFoundError:
            pass
    response = client.post("/api/system/databases/%s/duplicate" % TEST_DB,
                           json={"new_name": duplicate})
    assert response.status_code == 200
    copied = db.get_connection(duplicate)
    assert copied.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert copied.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 2
    copied.close()
    os.remove(path)


def test_validation_namespace_blocks_generic_mutations_but_validation_route_can_stage():
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    run = client.get("/api/validation/runs/%s?db=%s" % (run_id, TEST_DB)).json()
    working_db = run["working_db_filename"]

    assert client.get("/api/library/chunks", params={
        "db": working_db, "document_id": "d1"}).status_code == 200
    blocked = [
        client.put("/api/library/chunks/d1-c2", params={"db": working_db},
                   json={"content_markdown": "mutation générique"}),
        client.put("/api/library/artifacts/a1", params={"db": working_db},
                   json={"caption": "mutation générique"}),
        client.post("/api/curriculum/terms", params={"db": working_db},
                    json={"id": "forbidden", "document_id": "d1", "term_index": 1,
                          "label": "interdit"}),
        client.post("/api/pipeline/purge", json={
            "db": working_db, "scope": "page", "document_id": "d1", "page": 2}),
        client.post("/api/pipeline/retry", json={"db": working_db, "job_ids": ["missing"]}),
        client.post("/api/system/databases/%s/duplicate" % working_db,
                    json={"new_name": "Forbidden_Copy.sqlite"}),
    ]
    assert all(response.status_code == 403 for response in blocked), [
        (response.status_code, response.text) for response in blocked]

    page = client.get("/api/validation/runs/%s/pages/2?db=%s" % (run_id, TEST_DB)).json()
    page["working"]["chunks"][0]["content_markdown"] = "mutation Validation autorisée"
    staged = client.put("/api/validation/runs/%s/pages/2?db=%s" % (run_id, TEST_DB),
                        json={"working": page["working"]})
    assert staged.status_code == 200, staged.text
    working = db.get_connection(working_db)
    try:
        assert working.execute("SELECT content_markdown FROM document_chunks"
                               " WHERE id='d1-c2'").fetchone()[0] == "mutation Validation autorisée"
    finally:
        working.close()


def test_historical_chapter_and_folder_confinement_guards():
    from api.routes_pipeline import StartBody, _resolve_pages
    with pytest.raises(HTTPException) as mismatch:
        _resolve_pages(StartBody(source_path="x", mode="chapter", toc_id="t2"), TEST_DB,
                       {"id": "d1", "total_pages": 5})
    assert mismatch.value.status_code == 409
    outside = client.post("/api/pipeline/start", json={"source_path": "/tmp", "mode": "folder",
                                                       "target_db": TEST_DB})
    assert outside.status_code == 400


def test_reprocess_transaction_blocks_concurrent_writer_and_rollback_preserves_it(monkeypatch):
    """Reproduit la perte historique : backup, écriture tierce, purge, restore whole-db."""
    from api import routes_pipeline
    with open("/tmp/d1.pdf", "wb") as stream:
        stream.write(b"source")
    entered = threading.Event()
    release = threading.Event()
    writer_done = threading.Event()
    original = routes_pipeline.orchestrator.enqueue_batch

    def failing_enqueue(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        raise RuntimeError("enqueue failed under transaction")

    def concurrent_writer():
        assert entered.wait(5)
        conn = db.get_connection(TEST_DB)
        try:
            conn.execute("INSERT INTO documents (id,title,filename,source_path,total_pages)"
                         " VALUES ('concurrent','Concurrent','c.pdf','/tmp/c.pdf',1)")
            conn.commit()
        finally:
            conn.close()
        writer_done.set()

    monkeypatch.setattr(routes_pipeline.orchestrator, "enqueue_batch", failing_enqueue)
    writer = threading.Thread(target=concurrent_writer)
    writer.start()
    response = {}

    def invoke_reprocess():
        try:
            routes_pipeline.reprocess(routes_pipeline.ReprocessBody(
                db=TEST_DB, scope="page", document_id="d1", page=1))
        except Exception as exc:  # attendu : provoque le rollback de purge + enqueue
            response["error"] = exc

    request = threading.Thread(target=invoke_reprocess)
    request.start()
    assert entered.wait(5)
    time.sleep(0.1)
    assert not writer_done.is_set(), "BEGIN IMMEDIATE doit exclure l'écriture concurrente"
    release.set()
    request.join(5); writer.join(5)
    monkeypatch.setattr(routes_pipeline.orchestrator, "enqueue_batch", original)
    assert isinstance(response.get("error"), RuntimeError)
    assert writer_done.is_set()
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT COUNT(*) FROM document_chunks WHERE id='d1-c1'").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM documents WHERE id='concurrent'").fetchone()[0] == 1
    conn.close()
    os.remove("/tmp/d1.pdf")


@pytest.mark.parametrize("field,value", [
    ("toc_id", "t2"),
    ("linked_solution_chunk_id", "d2-c1"),
])
def test_accept_rejects_cross_document_chunk_references_before_mutation(field, value):
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    page = client.get("/api/validation/runs/%s/pages/2?db=%s" % (run_id, TEST_DB)).json()
    page["working"]["chunks"][0][field] = value
    before = _official_digest()
    staged = client.put("/api/validation/runs/%s/pages/2?db=%s" % (run_id, TEST_DB),
                        json={"working": page["working"]})
    assert staged.status_code == 409
    assert _official_digest() == before


def test_accept_rejects_cross_document_artifact_and_curriculum_links_before_mutation():
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    page = client.get("/api/validation/runs/%s/pages/2?db=%s" % (run_id, TEST_DB)).json()
    page["working"]["artifacts"][0]["chunk_id"] = "d2-c1"
    before = _official_digest()
    staged = client.put("/api/validation/runs/%s/pages/2?db=%s" % (run_id, TEST_DB),
                        json={"working": page["working"]})
    assert staged.status_code == 409
    assert _official_digest() == before

    clean_run = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    conn = db.get_connection(TEST_DB)
    conn.execute("INSERT INTO content_links (id,document_id,link_type,from_id,to_id)"
                 " VALUES ('cross-link','d1','course_exercise','d1-c1','d2-c1')")
    conn.commit(); conn.close()
    before = _official_digest()
    rejected = client.post("/api/validation/runs/%s/accept?db=%s" % (clean_run, TEST_DB))
    assert rejected.status_code == 409
    assert _official_digest() == before


def test_accept_rejects_dangling_reference_with_400_before_mutation():
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    page = client.get("/api/validation/runs/%s/pages/2?db=%s" % (run_id, TEST_DB)).json()
    page["working"]["chunks"][0]["toc_id"] = "missing-toc"
    before = _official_digest()
    staged = client.put("/api/validation/runs/%s/pages/2?db=%s" % (run_id, TEST_DB),
                        json={"working": page["working"]})
    assert staged.status_code == 400
    assert _official_digest() == before


def test_sources_mutations_reject_symlink_escape(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    outside_pdf = outside / "outside.pdf"
    outside_pdf.write_bytes(b"outside")
    link_dir = os.path.join(config.SOURCES_DIR, "validation-escape-dir")
    link_file = os.path.join(config.SOURCES_DIR, "validation-escape.pdf")
    try:
        os.symlink(str(outside), link_dir)
        os.symlink(str(outside_pdf), link_file)
        mkdir = client.post("/api/system/sources/folder", json={
            "rel_path": "validation-escape-dir/new-folder"})
        upload = client.post("/api/system/sources/upload", data={"rel_path": "validation-escape-dir"},
                             files={"file": ("attack.pdf", b"payload", "application/pdf")})
        delete = client.delete("/api/system/sources", params={"rel_path": "validation-escape.pdf"})
        assert mkdir.status_code == upload.status_code == delete.status_code == 400
        assert outside_pdf.read_bytes() == b"outside"
        assert not (outside / "new-folder").exists()
        assert not (outside / "attack.pdf").exists()
    finally:
        for path in (link_file, link_dir):
            try:
                os.remove(path)
            except FileNotFoundError:
                pass


def test_validation_relocates_legacy_source_path_to_runtime_root(tmp_path, monkeypatch):
    from api import routes_validation

    runtime_root = tmp_path / "sources"
    target = runtime_root / "1AM" / "math" / "book.pdf"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"%PDF-1.4")
    monkeypatch.setattr(routes_validation.config, "SOURCES_DIR", str(runtime_root))

    old_linux = "/agent/workspace/RAGDom/sources/1AM/math/book.pdf"
    old_windows = r"C:\\xampp\\htdocs\\RAGDom\\sources\\1AM\\math\\book.pdf"
    assert routes_validation._resolve_runtime_source_path(old_linux) == str(target)
    assert routes_validation._resolve_runtime_source_path(old_windows) == str(target)


def test_terminal_run_rejects_late_benchmark_attachment():
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    assert client.post("/api/validation/runs/%s/accept?db=%s" %
                       (run_id, TEST_DB)).status_code == 200
    late = client.post("/api/validation/runs/%s/benchmarks?db=%s" % (run_id, TEST_DB),
                       json={"benchmark_ids": ["b1"]})
    assert late.status_code == 409
    conn = db.get_connection(TEST_DB)
    assert conn.execute("SELECT validation_run_id FROM processing_benchmarks WHERE id='b1'").fetchone()[0] == run_id
    conn.close()


def test_vector_state_is_not_ready_when_backfill_fails(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE document_chunks(id TEXT PRIMARY KEY, embedding_vector BLOB)")
    conn.execute("INSERT INTO document_chunks VALUES ('c1', ?)", (b"vector",))
    monkeypatch.setitem(sys.modules, "sqlite_vec", types.SimpleNamespace(load=lambda connection: None))
    monkeypatch.setattr(db, "SCHEMA_VEC", "CREATE TABLE vec_chunks(chunk_id TEXT PRIMARY KEY);")
    assert db.init_vector_support(conn, force_strict=False) == "sqlite-vec"
    state = db.vector_state()
    assert state["status"] == "loaded_not_ready"
    assert "backfill" in state["message"]
    conn.close()


def test_migration_repairs_partial_schema_even_when_versions_are_declared():
    partial = "Validation_Partial_Declared.sqlite"
    path = os.path.join(config.DATABASES_DIR, partial)
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(path + suffix)
        except FileNotFoundError:
            pass
    conn = db.create_database(partial)
    assert conn.execute("SELECT COUNT(*) FROM schema_version WHERE version IN (5,6)").fetchone()[0] == 2
    conn.execute("DROP TABLE validation_snapshots")
    conn.commit(); conn.close()
    try:
        repaired = db.get_connection(partial)
        assert "document_id" in [r[1] for r in repaired.execute("PRAGMA table_info(validation_events)")]
        assert repaired.execute("SELECT 1 FROM sqlite_master WHERE type='table'"
                                " AND name='validation_snapshots'").fetchone()
        assert repaired.execute("SELECT COUNT(*) FROM schema_version WHERE version IN (5,6)").fetchone()[0] == 2
        repaired.close()
    finally:
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(path + suffix)
            except FileNotFoundError:
                pass
