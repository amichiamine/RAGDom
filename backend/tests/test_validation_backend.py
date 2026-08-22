# -*- coding: utf-8 -*-
"""Studio de validation live : scopes, runs, snapshots, isolation et embeddings."""
import importlib.util
import os
import sqlite3
import struct
import sys

import pytest
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
                 " (id,document_id,chunk_id,page_number,domain,artifact_type,searchable_text,raw_data)"
                 " VALUES ('a1','d1','d1-c2',2,'math','latex_formula','x','x')")
    conn.execute("INSERT INTO processing_benchmarks"
                 " (id,document_id,page_number,engine_used,execution_time_ms)"
                 " VALUES ('b1','d1',2,'test',10)")
    conn.commit()
    conn.close()
    yield
    _remove_db()


def _create_run(scope):
    response = client.post("/api/validation/runs", json={"db": TEST_DB, "scope": scope})
    assert response.status_code == 201, response.text
    return response.json()["id"]


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


def test_working_copy_snapshots_diff_reject_never_mutate_official():
    run_id = _create_run({"scope_type": "page", "document_id": "d1", "page": 2})
    snap = client.post("/api/validation/runs/%s/snapshots?db=%s" % (run_id, TEST_DB),
                       json={"snapshot_type": "physical"})
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
        assert "document_id" in [r[1] for r in migrated.execute("PRAGMA table_info(content_links)")]
        assert db.apply_migrations(migrated) == 0
        migrated.close()
    finally:
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(path + suffix)
            except FileNotFoundError:
                pass
