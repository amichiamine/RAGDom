# -*- coding: utf-8 -*-
"""Lot L7 — validation déterministe d'un corpus multi-livres généré à la volée."""
import hashlib
import importlib.util
import json
import os
import sqlite3
import struct
import sys
import time
from pathlib import Path

import fitz
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402
from api import routes_search  # noqa: E402
from core.embedding_profile import CURRENT_PROFILE  # noqa: E402
from db import connection as db  # noqa: E402
from main import app  # noqa: E402

TEST_DB = "Validation_Multibook_L7.sqlite"
ASSET_DB = "Validation_L7_Asset.sqlite"
RELEASE_DB = "Validation_L7_Release.sqlite"
client = TestClient(app)
ROOT = Path(__file__).resolve().parents[2]
FONT = Path("/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf")
VECTOR = struct.pack("<384f", 1.0, *([0.0] * 383))

DOCUMENTS = (
    {
        "id": "math-ar-mixed", "title": "دليل الرياضيات — الكسور", "pages": 3,
        "doc_type": "manuel", "toc": ("toc-math", "الفصل: الكسور", 1, 3),
        "content": (
            "نص OCR حتمي: الكسور والأعداد النسبية",
            "Cours de fractions: addition et simplification des fractions.",
            "تمرين الكسور — Exercice de fractions avec solution.",
        ),
        "types": ("course_theory", "course_theory", "exercise_solved"),
        "scanned_pages": {1},
    },
    {
        "id": "science-fr-native", "title": "Biologie cellulaire expérimentale", "pages": 2,
        "doc_type": "scientifique", "toc": ("toc-science", "Photosynthèse", 1, 2),
        "content": (
            "La chlorophylle capte les photons pendant la photosynthèse.",
            "Protocole scientifique français: mesurer le dioxygène produit.",
        ),
        "types": ("course_theory", "practical_work"), "scanned_pages": set(),
    },
    {
        "id": "bilingual-ar-fr", "title": "علوم الحياة — Sciences de la vie", "pages": 2,
        "doc_type": "manuel", "toc": ("toc-bilingual", "التكاثر — Reproduction", 1, 2),
        "content": (
            "التكاثر الخلوي — Reproduction cellulaire et mitose.",
            "الوراثة — Hérédité et transmission génétique.",
        ),
        "types": ("course_theory", "course_theory"), "scanned_pages": set(),
    },
    {
        "id": "without-toc", "title": "Notes sans sommaire", "pages": 2,
        "doc_type": "notes", "toc": None,
        "content": ("Observation libre page une.", "Annexe sans structure page deux."),
        "types": ("general_content", "general_content"), "scanned_pages": set(),
    },
    {
        "id": "non-pedagogical", "title": "Bordereau administratif", "pages": 1,
        "doc_type": "administratif", "toc": None,
        "content": ("Référence de facture, adresse et total à payer.",),
        "types": ("general_content",), "scanned_pages": set(),
    },
)


def _db_path(name):
    return Path(config.DATABASES_DIR) / name


def _remove_database(name):
    path = _db_path(name)
    for suffix in ("", "-wal", "-shm"):
        try:
            Path(str(path) + suffix).unlink()
        except FileNotFoundError:
            pass


def _insert_text(page, text):
    fontname = "helv"
    if FONT.exists() and any("\u0600" <= char <= "\u06ff" for char in text):
        page.insert_font(fontname="fixture", fontfile=str(FONT))
        fontname = "fixture"
    page.insert_textbox(fitz.Rect(40, 50, 555, 790), text, fontsize=12,
                        fontname=fontname, lineheight=1.4)


def _generate_pdf(path, spec):
    document = fitz.open()
    for number, content in enumerate(spec["content"], start=1):
        page = document.new_page(width=595, height=842)
        if number in spec["scanned_pages"]:
            pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 24, 24), False)
            pixmap.clear_with(230)
            page.insert_image(fitz.Rect(40, 60, 555, 782), pixmap=pixmap)
        else:
            _insert_text(page, content)
    if spec["toc"]:
        document.set_toc([[1, spec["toc"][1], spec["toc"][2]]])
    document.set_metadata({"title": spec["title"], "subject": "fixture L7 générée"})
    document.save(path, garbage=4, deflate=True)
    document.close()


def _seed_multibook_database(pdf_dir):
    conn = db.create_database(TEST_DB)
    try:
        for spec in DOCUMENTS:
            pdf_path = pdf_dir / (spec["id"] + ".pdf")
            _generate_pdf(pdf_path, spec)
            conn.execute(
                "INSERT INTO documents (id,title,filename,source_path,total_pages,file_size_bytes,doc_type)"
                " VALUES (?,?,?,?,?,?,?)",
                (spec["id"], spec["title"], pdf_path.name, str(pdf_path), spec["pages"],
                 pdf_path.stat().st_size, spec["doc_type"]),
            )
            if spec["toc"]:
                toc_id, title, start, end = spec["toc"]
                conn.execute(
                    "INSERT INTO document_toc (id,document_id,level,title,page_start,page_end)"
                    " VALUES (?,?,1,?,?,?)", (toc_id, spec["id"], title, start, end),
                )
            source = fitz.open(pdf_path)
            try:
                for page_number, (content, pedagogical_type) in enumerate(
                        zip(spec["content"], spec["types"]), start=1):
                    chunk_id = "%s-c%d" % (spec["id"], page_number)
                    toc_id = spec["toc"][0] if spec["toc"] else None
                    conn.execute(
                        "INSERT INTO document_chunks"
                        " (id,document_id,toc_id,page_number,chunk_index,section_title,content_markdown,"
                        " pedagogical_type,embedding_vector) VALUES (?,?,?,?,0,?,?,?,?)",
                        (chunk_id, spec["id"], toc_id, page_number,
                         spec["toc"][1] if spec["toc"] else None, content,
                         pedagogical_type, VECTOR),
                    )
                    preview = source[page_number - 1].get_pixmap(
                        matrix=fitz.Matrix(0.08, 0.08), colorspace=fitz.csGRAY, alpha=False)
                    image = preview.tobytes("png")
                    conn.execute(
                        "INSERT INTO page_scans"
                        " (id,document_id,page_number,width_px,height_px,dpi,image_webp,thumb_webp)"
                        " VALUES (?,?,?,?,?,72,?,?)",
                        ("%s-s%d" % (spec["id"], page_number), spec["id"], page_number,
                         preview.width, preview.height, image, image),
                    )
            finally:
                source.close()
        conn.execute(
            "INSERT INTO scientific_artifacts"
            " (id,document_id,chunk_id,page_number,domain,artifact_type,raw_data,searchable_text)"
            " VALUES ('fraction-formula','math-ar-mixed','math-ar-mixed-c2',2,'math',"
            " 'latex_formula','\\frac{1}{2}+\\frac{1}{3}','addition de fractions')"
        )
        conn.commit()
    finally:
        conn.close()


def _load_curriculum_builder():
    path = ROOT / "engines" / "sci-engine" / "pipeline" / "curriculum_builder.py"
    spec = importlib.util.spec_from_file_location("l7_curriculum_builder", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_run(database, scope):
    """Create a completed staging run for decision/reference unit scenarios."""
    response = client.post("/api/validation/runs", json={"db": database, "scope": scope})
    assert response.status_code == 201, response.text
    run_id = response.json()["id"]
    conn = db.get_connection(database)
    conn.execute("UPDATE validation_runs SET status='READY', execution_status='COMPLETED',"
                 " progress_current=progress_total WHERE id=?", (run_id,))
    conn.execute("UPDATE validation_run_pages SET status='READY' WHERE run_id=?", (run_id,))
    conn.commit(); conn.close()
    return run_id


def _create_and_execute(scope):
    response = client.post("/api/validation/runs", json={"db": TEST_DB, "scope": scope})
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["status"] == "CREATED"
    assert created["working_db_filename"].startswith("validation_test_")
    executed = client.post("/api/validation/runs/%s/execute" % created["id"], params={"db": TEST_DB})
    assert executed.status_code == 202, executed.text
    return created, executed.json()


def _poll_run(run_id, terminal=("COMPLETED", "BLOCKED", "FAILED", "CANCELLED"), timeout=30):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        response = client.get("/api/validation/runs/%s" % run_id, params={"db": TEST_DB})
        assert response.status_code == 200, response.text
        last = response.json()
        if last["status"] in terminal:
            return last
        time.sleep(0.05)
    pytest.fail("run %s non terminal après %ss: %r" % (run_id, timeout, last))


def _official_hash(database):
    conn = db.get_connection(database)
    try:
        payload = []
        for table in ("documents", "document_toc", "document_chunks", "scientific_artifacts",
                      "page_scans", "curriculum_terms", "curriculum_programs", "assessments",
                      "content_links"):
            payload.extend((table,) + tuple(row) for row in conn.execute(
                "SELECT * FROM %s ORDER BY rowid" % table).fetchall())
        return hashlib.sha256(repr(payload).encode("utf-8")).hexdigest()
    finally:
        conn.close()


@pytest.fixture()
def multibook_corpus(tmp_path):
    _remove_database(TEST_DB)
    pdf_dir = tmp_path / "pdfs"
    pdf_dir.mkdir()
    _seed_multibook_database(pdf_dir)
    yield pdf_dir
    _remove_database(TEST_DB)
    for path in Path(config.DATABASES_DIR).glob("validation_test_*.sqlite*"):
        path.unlink(missing_ok=True)


def test_validation_execute_real_pipeline_isolated_diff_reject(multibook_corpus, monkeypatch):
    monkeypatch.setenv("RAGDOM_VLM_PAGE_OCR", "false")
    monkeypatch.setenv("RAGDOM_VLM_ARTIFACTS", "false")
    before = _official_hash(TEST_DB)
    created, execution = _create_and_execute(
        {"scope_type": "page", "document_id": "science-fr-native", "page": 1})
    assert execution["official_mutated"] is False
    run = _poll_run(created["id"])
    assert run["status"] == "COMPLETED"
    assert run["progress"] == {"current": 1, "total": 1, "percent": 100.0}
    assert run["batch_id"] and run["operation"] == "REPROCESS"
    assert run["working_db"]["exists"] is True
    assert _official_hash(TEST_DB) == before

    working = db.get_connection(created["working_db_filename"])
    try:
        assert working.execute("SELECT COUNT(*) FROM pipeline_jobs WHERE batch_id=? AND status='READY'",
                               (run["batch_id"],)).fetchone()[0] == 1
        assert working.execute("SELECT COUNT(*) FROM document_chunks"
                               " WHERE document_id='science-fr-native' AND page_number=1").fetchone()[0] > 0
    finally:
        working.close()
    diff = client.get("/api/validation/runs/%s/diff" % created["id"], params={"db": TEST_DB}).json()
    assert diff["changed_pages"] == 1
    rejected = client.post("/api/validation/runs/%s/reject" % created["id"], params={"db": TEST_DB})
    assert rejected.status_code == 200 and rejected.json()["working_db_deleted"] is True
    assert not _db_path(created["working_db_filename"]).exists()
    assert _official_hash(TEST_DB) == before


def test_validation_accept_promotes_only_scope_and_removes_copy(multibook_corpus, monkeypatch):
    monkeypatch.setenv("RAGDOM_VLM_PAGE_OCR", "false")
    monkeypatch.setenv("RAGDOM_VLM_ARTIFACTS", "false")
    conn = db.get_connection(TEST_DB)
    untouched_before = conn.execute("SELECT * FROM document_chunks"
                                    " WHERE document_id='science-fr-native' AND page_number=2").fetchall()
    target_before = conn.execute("SELECT * FROM document_chunks"
                                 " WHERE document_id='science-fr-native' AND page_number=1").fetchall()
    conn.close()
    created, _ = _create_and_execute(
        {"scope_type": "page", "document_id": "science-fr-native", "page": 1})
    assert _poll_run(created["id"])["status"] == "COMPLETED"
    accepted = client.post("/api/validation/runs/%s/accept" % created["id"], params={"db": TEST_DB})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["official_mutated"] is True
    assert not _db_path(created["working_db_filename"]).exists()
    conn = db.get_connection(TEST_DB)
    try:
        untouched_after = conn.execute("SELECT * FROM document_chunks"
                                       " WHERE document_id='science-fr-native' AND page_number=2").fetchall()
        target_after = conn.execute("SELECT * FROM document_chunks"
                                    " WHERE document_id='science-fr-native' AND page_number=1").fetchall()
        assert untouched_after == untouched_before
        assert target_after != target_before
    finally:
        conn.close()


def test_validation_missing_source_blocks_without_official_mutation(multibook_corpus):
    conn = db.get_connection(TEST_DB)
    conn.execute("UPDATE documents SET source_path=? WHERE id='without-toc'",
                 (str(multibook_corpus / "missing.pdf"),))
    conn.commit(); conn.close()
    before = _official_hash(TEST_DB)
    response = client.post("/api/validation/runs", json={"db": TEST_DB, "scope": {
        "scope_type": "page", "document_id": "without-toc", "page": 1}})
    assert response.status_code == 201
    run_id = response.json()["id"]
    blocked = client.post("/api/validation/runs/%s/execute" % run_id, params={"db": TEST_DB})
    assert blocked.status_code == 202
    assert blocked.json()["status"] == "BLOCKED"
    detail = _poll_run(run_id)
    assert detail["status"] == "BLOCKED"
    assert "source" in detail["error_log"].lower()
    assert _official_hash(TEST_DB) == before
    rejected = client.post("/api/validation/runs/%s/reject" % run_id, params={"db": TEST_DB})
    assert rejected.status_code == 200 and rejected.json()["working_db_deleted"] is True


def test_validation_get_poll_recovers_completed_batch_state(multibook_corpus, monkeypatch):
    """GET is the restart-safe reconciler even when the in-process monitor is absent."""
    from api import routes_validation
    monkeypatch.setenv("RAGDOM_VLM_PAGE_OCR", "false")
    monkeypatch.setenv("RAGDOM_VLM_ARTIFACTS", "false")
    monkeypatch.setattr(routes_validation, "_start_monitor", lambda _db, _run: None)
    created, _ = _create_and_execute(
        {"scope_type": "page", "document_id": "science-fr-native", "page": 2})
    run = _poll_run(created["id"])
    assert run["status"] == "COMPLETED" and run["progress"]["percent"] == 100.0
    assert client.post("/api/validation/runs/%s/reject" % created["id"],
                       params={"db": TEST_DB}).status_code == 200


def test_validation_cancel_targets_only_working_batches(multibook_corpus, monkeypatch):
    from api import routes_pipeline, routes_validation
    response = client.post("/api/validation/runs", json={"db": TEST_DB, "scope": {
        "scope_type": "page_range", "document_id": "science-fr-native",
        "page_start": 1, "page_end": 2}})
    created = response.json()
    original_launch = routes_pipeline._launch
    monkeypatch.setattr(routes_pipeline, "_launch", lambda _db_name: None)
    executed = client.post("/api/validation/runs/%s/execute" % created["id"], params={"db": TEST_DB})
    monkeypatch.setattr(routes_pipeline, "_launch", original_launch)
    assert executed.status_code == 202
    batch_ids = executed.json()["batch_ids"]
    cancelled = client.post("/api/validation/runs/%s/cancel" % created["id"], params={"db": TEST_DB})
    assert cancelled.status_code == 200
    working = db.get_connection(created["working_db_filename"])
    try:
        marks = ",".join("?" for _ in batch_ids)
        assert working.execute("SELECT COUNT(*) FROM pipeline_jobs WHERE batch_id IN (%s)" % marks,
                               batch_ids).fetchone()[0] == 0
        assert working.execute("SELECT COUNT(*) FROM ingestion_batches WHERE id IN (%s)"
                               " AND status='STOPPED'" % marks, batch_ids).fetchone()[0] == len(batch_ids)
    finally:
        working.close()
    assert _poll_run(created["id"])["status"] == "CANCELLED"
    with routes_validation._EXECUTION_MONITORS_LOCK:
        routes_validation._EXECUTION_MONITORS.pop(created["id"], None)


@pytest.fixture()
def release_asset():
    _remove_database(ASSET_DB)
    _remove_database(RELEASE_DB)
    path = _db_path(ASSET_DB)
    conn = sqlite3.connect(path)
    conn.executescript("""
        PRAGMA foreign_keys=ON;
        CREATE TABLE schema_version(version INTEGER PRIMARY KEY, applied_at DATETIME, description TEXT);
        INSERT INTO schema_version(version,description) VALUES(4,'legacy release asset');
        CREATE TABLE documents(id TEXT PRIMARY KEY,title TEXT,filename TEXT,source_path TEXT,
                               total_pages INTEGER,doc_type TEXT);
        CREATE TABLE document_toc(id TEXT PRIMARY KEY);
        CREATE TABLE document_chunks(id TEXT PRIMARY KEY,document_id TEXT,page_number INTEGER,
                                     chunk_index INTEGER,content_markdown TEXT,pedagogical_type TEXT);
        CREATE TABLE scientific_artifacts(id TEXT PRIMARY KEY);
        CREATE TABLE page_scans(id TEXT PRIMARY KEY);
        CREATE TABLE processing_benchmarks(id TEXT PRIMARY KEY);
        CREATE TABLE curriculum_terms(id TEXT PRIMARY KEY);
        CREATE TABLE curriculum_programs(id TEXT PRIMARY KEY);
        CREATE TABLE assessments(id TEXT PRIMARY KEY);
        CREATE TABLE content_links(id TEXT PRIMARY KEY);
        CREATE TABLE pipeline_jobs(id TEXT PRIMARY KEY,document_id TEXT,page_number INTEGER,status TEXT);
        CREATE TABLE ingestion_batches(id TEXT PRIMARY KEY);
        INSERT INTO documents VALUES('release-doc','Asset local','asset.pdf','/tmp/asset.pdf',1,'manuel');
        INSERT INTO document_chunks(id,document_id,page_number,chunk_index,content_markdown,pedagogical_type)
        VALUES('release-chunk','release-doc',1,0,'contenu officiel asset','course_theory');
    """)
    conn.commit()
    conn.close()
    yield
    _remove_database(ASSET_DB)
    _remove_database(RELEASE_DB)


def test_generated_pdf_fixture_matrix_is_minimal_and_represents_every_document_kind(multibook_corpus):
    sizes = []
    for spec in DOCUMENTS:
        path = multibook_corpus / (spec["id"] + ".pdf")
        sizes.append(path.stat().st_size)
        document = fitz.open(path)
        try:
            assert document.page_count == spec["pages"]
            assert document.metadata["title"] == spec["title"]
            assert bool(document.get_toc()) is bool(spec["toc"])
            if spec["id"] == "math-ar-mixed":
                assert document[0].get_text().strip() == ""
                assert document[0].get_images()
                assert "fractions" in document[1].get_text().lower()
            if spec["id"] == "science-fr-native":
                assert "chlorophylle" in document[0].get_text().lower()
            if spec["id"] == "bilingual-ar-fr":
                text = document[0].get_text()
                assert "Reproduction" in text and any("\u0600" <= char <= "\u06ff" for char in text)
            if spec["id"] == "without-toc":
                assert document.get_toc() == []
        finally:
            document.close()
    assert max(sizes) < 500_000
    assert sum(sizes) < 1_000_000


def test_all_validation_scopes_and_document_toc_isolation_on_multibook_base(multibook_corpus):
    scopes = (
        ({"scope_type": "title", "document_id": "math-ar-mixed", "toc_id": "toc-math"}, 3),
        ({"scope_type": "course", "document_id": "math-ar-mixed", "toc_id": "toc-math"}, 3),
        ({"scope_type": "chapter", "document_id": "math-ar-mixed", "toc_id": "toc-math"}, 3),
        ({"scope_type": "page", "document_id": "science-fr-native", "page": 2}, 1),
        ({"scope_type": "page_selection", "document_id": "bilingual-ar-fr", "pages": [2, 1, 2]}, 2),
        ({"scope_type": "base"}, 10),
    )
    for scope, expected in scopes:
        response = client.post("/api/validation/resolve-scope", json={"db": TEST_DB, "scope": scope})
        assert response.status_code == 200, response.text
        assert response.json()["page_count"] == expected
    missing = client.post("/api/validation/resolve-scope", json={"db": TEST_DB, "scope": {
        "scope_type": "chapter", "document_id": "without-toc", "toc_id": "toc-absent"}})
    crossed = client.post("/api/validation/resolve-scope", json={"db": TEST_DB, "scope": {
        "scope_type": "chapter", "document_id": "science-fr-native", "toc_id": "toc-math"}})
    assert missing.status_code == 404
    assert crossed.status_code == 409


def test_base_run_disambiguates_equal_page_numbers_and_reject_keeps_official_hash(multibook_corpus):
    before = _official_hash(TEST_DB)
    run_id = _create_run(TEST_DB, {"scope_type": "base"})
    run = client.get("/api/validation/runs/%s" % run_id, params={"db": TEST_DB})
    assert run.status_code == 200 and len(run.json()["pages"]) == 10
    ambiguous = client.get("/api/validation/runs/%s/pages/1" % run_id, params={"db": TEST_DB})
    selected = client.get("/api/validation/runs/%s/pages/1" % run_id,
                          params={"db": TEST_DB, "document_id": "non-pedagogical"})
    assert ambiguous.status_code == 409
    assert selected.status_code == 200 and selected.json()["document_id"] == "non-pedagogical"
    rejected = client.post("/api/validation/runs/%s/reject" % run_id, params={"db": TEST_DB})
    assert rejected.status_code == 200 and rejected.json()["official_mutated"] is False
    assert _official_hash(TEST_DB) == before


def test_snapshot_restore_diff_accept_conflict_and_official_hash(multibook_corpus):
    run_id = _create_run(TEST_DB, {
        "scope_type": "page", "document_id": "math-ar-mixed", "page": 2})
    before = _official_hash(TEST_DB)
    snapshot = client.post("/api/validation/runs/%s/snapshots" % run_id,
                           params={"db": TEST_DB}, json={"snapshot_type": "logical"})
    assert snapshot.status_code == 201
    page = client.get("/api/validation/runs/%s/pages/2" % run_id,
                      params={"db": TEST_DB}).json()
    page["working"]["chunks"][0]["content_markdown"] = "Copie L7 provisoire"
    updated = client.put("/api/validation/runs/%s/pages/2" % run_id,
                         params={"db": TEST_DB}, json={"working": page["working"]})
    assert updated.status_code == 200 and _official_hash(TEST_DB) == before
    assert client.get("/api/validation/runs/%s/diff" % run_id,
                      params={"db": TEST_DB}).json()["changed_pages"] == 1
    restored = client.post("/api/validation/runs/%s/snapshots/%s/restore" %
                           (run_id, snapshot.json()["id"]), params={"db": TEST_DB})
    assert restored.status_code == 200
    assert client.get("/api/validation/runs/%s/diff" % run_id,
                      params={"db": TEST_DB}).json()["changed_pages"] == 0

    conflict_run = _create_run(TEST_DB, {
        "scope_type": "page", "document_id": "math-ar-mixed", "page": 2})
    conn = db.get_connection(TEST_DB)
    conn.execute("UPDATE document_chunks SET content_markdown='édition concurrente'"
                 " WHERE id='math-ar-mixed-c2'")
    conn.commit()
    conn.close()
    conflict = client.post("/api/validation/runs/%s/accept" % conflict_run,
                           params={"db": TEST_DB})
    assert conflict.status_code == 409
    conn = db.get_connection(TEST_DB)
    try:
        assert conn.execute("SELECT content_markdown FROM document_chunks"
                            " WHERE id='math-ar-mixed-c2'").fetchone()[0] == "édition concurrente"
    finally:
        conn.close()


def test_curriculum_build_all_documents_is_scoped_and_ignores_non_pedagogical(multibook_corpus):
    builder = _load_curriculum_builder()
    conn = db.get_connection(TEST_DB)
    try:
        counts = builder.build_curriculum(conn)
        owners = {row[0] for row in conn.execute(
            "SELECT DISTINCT document_id FROM curriculum_terms").fetchall()}
        assert counts["lessons"] == 3
        assert owners == {"math-ar-mixed", "science-fr-native", "bilingual-ar-fr"}
        for table in ("curriculum_terms", "curriculum_programs", "content_links"):
            assert conn.execute("SELECT COUNT(*) FROM %s WHERE document_id IS NULL" % table).fetchone()[0] == 0
            assert conn.execute("SELECT COUNT(*) FROM %s WHERE document_id='non-pedagogical'" %
                                table).fetchone()[0] == 0
        assert builder.build_curriculum(conn, "without-toc") == {
            "lessons": 0, "exercises": 0, "solutions": 0, "assessments": 0}
    finally:
        conn.close()


def test_bm25_multilingual_search_and_embedding_profile_without_external_model(multibook_corpus, monkeypatch):
    payload = CURRENT_PROFILE.storage_payload()
    profile = client.post("/api/validation/embeddings/profiles", params={"db": TEST_DB}, json={
        "model_name": payload["model_name"], "model_version": payload["model_version"],
        "pooling": payload["pooling"], "dimensions": payload["dimensions"],
        "normalized": payload["normalized"], "metadata": payload["metadata"],
    })
    assert profile.status_code == 201, profile.text
    for spec in DOCUMENTS:
        assigned = client.post("/api/validation/embeddings/assign", json={
            "db": TEST_DB, "document_id": spec["id"], "profile_id": profile.json()["id"]})
        assert assigned.status_code == 200, assigned.text
    diagnostic = client.get("/api/validation/embeddings/diagnostic", params={"db": TEST_DB}).json()
    assert diagnostic["vector_count"] == 10
    assert diagnostic["database_compatible"] is True
    assert all(item["query_compatible"] for item in diagnostic["documents"])

    calls = []
    monkeypatch.setattr(routes_search.db, "vector_state", lambda: {
        "engine": "sqlite-vec", "status": "ready", "message": "fixture déterministe"})
    monkeypatch.setattr(routes_search, "_thresholds", lambda: (0.45, 0.0))
    monkeypatch.setattr(routes_search, "_query_embedding_result",
                        lambda text: (calls.append(text) or (None, CURRENT_PROFILE)))
    french, french_diag = routes_search._hybrid_search_detailed(
        TEST_DB, routes_search.SearchBody(query="chlorophylle photons", top_k=3))
    arabic, arabic_diag = routes_search._hybrid_search_detailed(
        TEST_DB, routes_search.SearchBody(query="الكسور", top_k=3))
    assert french and french[0]["document_id"] == "science-fr-native"
    assert arabic and arabic[0]["document_id"] == "math-ar-mixed"
    assert french[0]["bm25_rank"] == arabic[0]["bm25_rank"] == 1
    assert french_diag["mode"] == arabic_diag["mode"] == "bm25"
    assert "query_embedder_unavailable" in french_diag["reasons"]
    assert calls == ["chlorophylle photons", "الكسور"]


def test_partial_legacy_migration_repairs_every_required_validation_table(release_asset):
    migrated = db.get_connection(ASSET_DB)
    try:
        versions = {row[0] for row in migrated.execute("SELECT version FROM schema_version")}
        assert {4, 5, 6} <= versions
        required = {
            "validation_runs": {"document_id", "scope_type", "scope_json", "status"},
            "validation_run_pages": {"document_id", "baseline_json", "working_json", "baseline_hash"},
            "validation_events": {"document_id", "event_type", "payload_json"},
            "validation_snapshots": {"run_id", "snapshot_type", "payload_json"},
            "embedding_profiles": {"model_name", "pooling", "dimensions"},
            "document_embedding_profiles": {"document_id", "profile_id"},
        }
        for table, columns in required.items():
            actual = {row[1] for row in migrated.execute("PRAGMA table_info(%s)" % table)}
            assert columns <= actual
        assert migrated.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert db.apply_migrations(migrated) == 0
    finally:
        migrated.close()


def test_local_release_path_asset_clone_migrate_reject_hash_then_accept_on_copy(release_asset):
    source_before = hashlib.sha256(_db_path(ASSET_DB).read_bytes()).hexdigest()
    cloned = client.post("/api/system/databases/%s/duplicate" % ASSET_DB,
                         json={"new_name": RELEASE_DB})
    assert cloned.status_code == 200, cloned.text

    migrated = db.get_connection(RELEASE_DB)
    try:
        assert {5, 6} <= {row[0] for row in migrated.execute("SELECT version FROM schema_version")}
    finally:
        migrated.close()
    copy_before = _official_hash(RELEASE_DB)

    rejected_run = _create_run(RELEASE_DB, {
        "scope_type": "page", "document_id": "release-doc", "page": 1})
    page = client.get("/api/validation/runs/%s/pages/1" % rejected_run,
                      params={"db": RELEASE_DB}).json()
    page["working"]["chunks"][0]["content_markdown"] = "candidate rejeté"
    assert client.put("/api/validation/runs/%s/pages/1" % rejected_run,
                      params={"db": RELEASE_DB}, json={"working": page["working"]}).status_code == 200
    assert client.post("/api/validation/runs/%s/reject" % rejected_run,
                       params={"db": RELEASE_DB}).status_code == 200
    assert _official_hash(RELEASE_DB) == copy_before

    accepted_run = _create_run(RELEASE_DB, {
        "scope_type": "page", "document_id": "release-doc", "page": 1})
    page = client.get("/api/validation/runs/%s/pages/1" % accepted_run,
                      params={"db": RELEASE_DB}).json()
    page["working"]["chunks"][0]["content_markdown"] = "candidate accepté sur copie"
    assert client.put("/api/validation/runs/%s/pages/1" % accepted_run,
                      params={"db": RELEASE_DB}, json={"working": page["working"]}).status_code == 200
    accepted = client.post("/api/validation/runs/%s/accept" % accepted_run,
                           params={"db": RELEASE_DB})
    assert accepted.status_code == 200 and accepted.json()["official_mutated"] is True
    copy = db.get_connection(RELEASE_DB)
    try:
        assert copy.execute("SELECT content_markdown FROM document_chunks"
                            " WHERE id='release-chunk'").fetchone()[0] == "candidate accepté sur copie"
    finally:
        copy.close()
    assert hashlib.sha256(_db_path(ASSET_DB).read_bytes()).hexdigest() == source_before
    source = sqlite3.connect(_db_path(ASSET_DB))
    try:
        assert source.execute("SELECT COUNT(*) FROM schema_version WHERE version>4").fetchone()[0] == 0
        columns = {row[1] for row in source.execute("PRAGMA table_info(document_chunks)")}
        assert "toc_id" not in columns
    finally:
        source.close()
