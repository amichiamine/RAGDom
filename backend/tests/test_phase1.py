# -*- coding: utf-8 -*-
"""RAGDom — Tests Phase 1 (D.O.D. tech_specs §5.1, sous-ensemble socle).

Couvre : SQLite Integrity (FK + triggers FTS sync/delete/update + page_scans),
sanitisation ?db=, fallback vectoriel (drop triggers vec sans crash),
registre des moteurs, recovery de l'orchestrateur, skip des pages READY.
"""
import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402
from db import connection as db  # noqa: E402
from core import engine_registry  # noqa: E402
from core.orchestrator import PipelineOrchestrator  # noqa: E402

TEST_DB = "Test_Phase1.sqlite"


@pytest.fixture()
def fresh_db():
    path = os.path.join(config.DATABASES_DIR, TEST_DB)
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(path + suffix):
            os.remove(path + suffix)
    conn = db.create_database(TEST_DB)
    yield conn
    conn.close()
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(path + suffix):
            os.remove(path + suffix)


def _seed_document(conn, doc_id="d1"):
    conn.execute("INSERT INTO documents (id,title,filename,source_path,total_pages)"
                 " VALUES (?,?,?,?,?)", (doc_id, "Doc Test", "t.pdf", "/x/t.pdf", 3))
    conn.commit()


# ── D.O.D : SQLite Integrity ──────────────────────────────────
def test_schema_tables_and_triggers(fresh_db):
    tables = {r[0] for r in fresh_db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'search_index%'")}
    expected = {"pipeline_jobs", "ingestion_batches", "documents", "document_toc",
                "document_chunks", "scientific_artifacts", "page_scans",
                "processing_benchmarks", "schema_version", "curriculum_terms",
                "curriculum_programs", "assessments", "content_links"}
    assert expected <= tables, tables
    triggers = {r[0] for r in fresh_db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
    assert {"trg_chunks_fts_sync", "trg_artifacts_fts_sync", "trg_chunks_fts_delete",
            "trg_artifacts_fts_delete", "trg_chunks_fts_update"} <= triggers


def test_fts_sync_update_delete_and_cascade(fresh_db):
    _seed_document(fresh_db)
    fresh_db.execute("INSERT INTO page_scans (id,document_id,page_number,width_px,height_px,image_webp)"
                     " VALUES ('s1','d1',1,2480,3508,x'0102')")
    fresh_db.execute("INSERT INTO document_chunks (id,document_id,page_number,chunk_index,content_markdown,"
                     "pedagogical_type,pedagogical_index) VALUES ('c1','d1',1,0,'contenu alpha','exercise_unsolved',14)")
    fresh_db.execute("INSERT INTO scientific_artifacts (id,document_id,chunk_id,page_number,domain,artifact_type,"
                     "raw_data,searchable_text) VALUES ('a1','d1','c1',1,'math','latex_formula','$x$','x formule')")
    fresh_db.commit()
    assert fresh_db.execute("SELECT COUNT(*) FROM search_index").fetchone()[0] == 2
    # UPDATE → resync (trigger V3.1)
    fresh_db.execute("UPDATE document_chunks SET content_markdown='contenu beta', is_human_edited=1,"
                     " updated_at=CURRENT_TIMESTAMP WHERE id='c1'")
    fresh_db.commit()
    hits = fresh_db.execute("SELECT COUNT(*) FROM search_index WHERE search_content MATCH 'beta'").fetchone()[0]
    assert hits == 1
    # CASCADE document → zéro fantôme partout (Base Autonome + Reset Propre)
    fresh_db.execute("DELETE FROM documents WHERE id='d1'")
    fresh_db.commit()
    for table in ("document_chunks", "scientific_artifacts", "page_scans", "search_index"):
        assert fresh_db.execute("SELECT COUNT(*) FROM %s" % table).fetchone()[0] == 0, table


# ── Sanitisation ?db= (anti path-traversal) ───────────────────
@pytest.mark.parametrize("bad", ["../../etc/passwd.sqlite", "a/b.sqlite", "x.db", "", "café.sqlite"])
def test_db_name_sanitization(bad):
    with pytest.raises(ValueError):
        db.sanitize_db_name(bad)


def test_db_name_valid():
    assert db.sanitize_db_name("Maths_1AM.sqlite").endswith("Maths_1AM.sqlite")


# ── Fallback vectoriel : base hybride rouverte, triggers vec droppés sans crash ──
def test_vector_fallback_drops_triggers(fresh_db):
    state = db.vector_state()
    if state["engine"] == "sqlite-vec":
        # Simule la réouverture SANS extension : drop manuel puis insert doit passer.
        fresh_db.execute("DROP TRIGGER IF EXISTS trg_chunks_vec_sync")
        fresh_db.execute("DROP TRIGGER IF EXISTS trg_chunks_vec_delete")
    _seed_document(fresh_db, "d2")
    fresh_db.execute("INSERT INTO document_chunks (id,document_id,page_number,chunk_index,content_markdown,"
                     "embedding_vector) VALUES ('c2','d2',1,0,'txt',x'00000000')")
    fresh_db.commit()  # ne doit PAS lever même sans vec_chunks


# ── Registre des moteurs (V3.4) ───────────────────────────────
def test_engine_registry_finds_sci_engine():
    engines = engine_registry.scan_engines()
    ids = [e["id"] for e in engines]
    assert "sci-engine" in ids
    active = engine_registry.active_engine()
    assert active is not None and active["accent"] == "#2563eb"


def test_engine_registry_ignores_invalid(tmp_path, monkeypatch):
    bad = tmp_path / "bad-engine"
    (bad / "pipeline").mkdir(parents=True)
    (bad / "engine.json").write_text('{"id": "bad-engine"}', encoding="utf-8")  # champs manquants
    monkeypatch.setattr(config, "ENGINES_DIR", str(tmp_path))
    assert engine_registry.scan_engines() == []  # ignoré avec WARN, zéro crash
    monkeypatch.undo()
    engine_registry.scan_engines()  # restaure le registre réel


# ── Orchestrateur : recovery + skip READY (Skills §5.2) ───────
def test_orchestrator_recovery_and_ready_skip(fresh_db):
    _seed_document(fresh_db, "d3")
    fresh_db.execute("INSERT INTO pipeline_jobs (id,document_id,page_number,status)"
                     " VALUES (?, 'd3', 1, 'EXTRACTING')", (str(uuid.uuid4()),))
    fresh_db.execute("INSERT INTO pipeline_jobs (id,document_id,page_number,status)"
                     " VALUES (?, 'd3', 2, 'READY')", (str(uuid.uuid4()),))
    fresh_db.commit()
    orch = PipelineOrchestrator()
    assert orch.recover(TEST_DB) == 1  # seule la page transitoire repasse en QUEUED
    result = orch.enqueue_batch(TEST_DB, "d3", "/x/t.pdf", "page_range", 1, 3)
    assert result["skipped_ready"] == 1  # la page 2 (READY) n'est jamais ré-indexée
    conn = db.get_connection(TEST_DB)
    queued = conn.execute("SELECT COUNT(*) FROM pipeline_jobs WHERE status='QUEUED'").fetchone()[0]
    conn.close()
    assert queued == 2  # page 1 recovery réutilisée + page 3; aucun doublon actif
