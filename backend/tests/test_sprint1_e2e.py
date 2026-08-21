# -*- coding: utf-8 -*-
"""RAGDom — Sprint 1 : test de bout en bout du pipeline sci-engine (D.O.D. §5.1).

PDF réel de 3 pages généré par PyMuPDF (cours + exercice n°7 + corrigé n°7 +
formules $…$) → enqueue → run_queue → assertions sur TOUTES les tables :
page_scans (Base Autonome), chunks qualifiés (pedagogical_index), artefacts
LaTeX, benchmarks, SolutionLinker (exercice↔corrigé), INVALID_SOURCE,
Linter < 5ms, base copiée seule = 100% servie.
"""
import os
import shutil
import sqlite3
import sys
import time
import uuid

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402
from db import connection as db  # noqa: E402
from core.orchestrator import PipelineOrchestrator  # noqa: E402
from core import engine_registry  # noqa: E402

TEST_DB = "Test_E2E.sqlite"
PDF_NAME = "manuel_test.pdf"


def _make_pdf(path: str) -> None:
    import fitz
    doc = fitz.open()
    pages = [
        "Cours : Théorème de Pythagore\n\nDéfinition : dans un triangle rectangle, "
        "l'hypoténuse vérifie $a^2 + b^2 = c^2$.\n\nPropriété : la somme des angles vaut $180$ degrés.",
        "Exercice n° 7\n\nCalculer l'hypoténuse d'un triangle rectangle de côtés $3$ et $4$.\n\n"
        "Exercice n° 8\n\nDémontrer que $$x^2 - 1 = (x-1)(x+1)$$ pour tout réel.",
        "Correction de l'exercice n° 7\n\nOn applique $c = \\sqrt{3^2 + 4^2} = 5$. "
        "L'hypoténuse mesure donc 5 cm.",
    ]
    for text in pages:
        page = doc.new_page()
        page.insert_textbox(fitz.Rect(50, 50, 545, 780), text, fontsize=12)
    doc.set_toc([[1, "Chapitre 1 : Pythagore", 1], [2, "Exercices", 2]])
    doc.save(path)
    doc.close()


@pytest.fixture(scope="module")
def pipeline_run():
    """Exécute le pipeline complet une fois, partagé par tous les tests du module."""
    db_path = os.path.join(config.DATABASES_DIR, TEST_DB)
    pdf_path = os.path.join(config.SOURCES_DIR, PDF_NAME)
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(db_path + suffix):
            os.remove(db_path + suffix)
    _make_pdf(pdf_path)
    conn = db.create_database(TEST_DB)
    doc_id = str(uuid.uuid4())
    conn.execute("INSERT INTO documents (id,title,filename,source_path,total_pages,doc_source,domain_tags_json)"
                 " VALUES (?,?,?,?,3,'Maths/Test','[\"Maths\",\"Test\"]')",
                 (doc_id, "Manuel Test", PDF_NAME, pdf_path))
    conn.commit()
    conn.close()
    engine_registry.scan_engines()
    orch = PipelineOrchestrator()
    batch = orch.enqueue_batch(TEST_DB, doc_id, pdf_path, "document", 1, 3)
    result = orch.run_queue(TEST_DB)
    yield {"doc_id": doc_id, "batch": batch, "result": result, "db_path": db_path}
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(db_path + suffix):
            os.remove(db_path + suffix)
    os.remove(pdf_path)


def _q(pipeline_run, sql, args=()):
    conn = sqlite3.connect(pipeline_run["db_path"])
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


# ── Pipeline complet : 3 pages READY, batch COMPLETED ─────────
def test_all_pages_ready(pipeline_run):
    assert pipeline_run["result"]["processed"] == 3
    assert pipeline_run["result"]["quarantined"] == 0
    statuses = [r[0] for r in _q(pipeline_run, "SELECT status FROM pipeline_jobs")]
    assert statuses == ["READY"] * 3
    batch = _q(pipeline_run, "SELECT status, pages_done FROM ingestion_batches")[0]
    assert batch == ("COMPLETED", 3)


# ── V3.5 Base Autonome : page_scans complets ──────────────────
def test_page_scans_persisted(pipeline_run):
    rows = _q(pipeline_run, "SELECT page_number, width_px, height_px, LENGTH(image_webp),"
                            " LENGTH(thumb_webp) FROM page_scans ORDER BY page_number")
    assert len(rows) == 3
    for page, width, height, img_len, thumb_len in rows:
        assert width > 2000 and height > 3000  # 300 DPI A4
        assert img_len > 1000 and thumb_len > 200


# ── Qualification : types + pedagogical_index (V3.5) ──────────
def test_chunks_qualified(pipeline_run):
    rows = _q(pipeline_run, "SELECT pedagogical_type, pedagogical_index FROM document_chunks"
                            " ORDER BY page_number, chunk_index")
    types = [r[0] for r in rows]
    assert "course_theory" in types
    assert any(t in ("exercise_unsolved", "exercise_solved") for t in types)
    assert "solution_only" in types
    assert (("exercise_solved", 7) in rows) or (("exercise_unsolved", 7) in rows)


# ── Artefacts LaTeX (Tier 1) + FTS peuplé ─────────────────────
def test_latex_artifacts_and_fts(pipeline_run):
    n_latex = _q(pipeline_run, "SELECT COUNT(*) FROM scientific_artifacts WHERE artifact_type='latex_formula'")[0][0]
    assert n_latex >= 3  # a²+b²=c², 180, x²-1, √…
    hits = _q(pipeline_run, "SELECT COUNT(*) FROM search_index WHERE search_content MATCH 'Pythagore'")[0][0]
    assert hits >= 1


# ── SolutionLinker : exercice 7 ↔ corrigé 7 ───────────────────
def test_solution_linker(pipeline_run):
    rows = _q(pipeline_run, "SELECT pedagogical_index, has_solution, linked_solution_chunk_id"
                            " FROM document_chunks WHERE pedagogical_type='exercise_solved'")
    assert any(idx == 7 and has == 1 and link for idx, has, link in rows), rows


# ── Benchmarks Couche 6 ───────────────────────────────────────
def test_benchmarks(pipeline_run):
    rows = _q(pipeline_run, "SELECT engine_used, execution_time_ms, ram_peak_mb, confidence_score"
                            " FROM processing_benchmarks")
    assert len(rows) == 3
    for engine, latency, ram, confidence in rows:
        assert engine in ("PyMuPDF4LLM", "PyMuPDF", "RapidOCR")
        assert latency > 0 and ram and ram > 0 and 0 <= confidence <= 1


# ── D.O.D : Base Autonome — le .sqlite copié seul sert 100% ───
def test_base_autonome(pipeline_run, tmp_path):
    solo = tmp_path / "solo.sqlite"
    shutil.copy(pipeline_run["db_path"], solo)
    conn = sqlite3.connect(str(solo))
    scans = conn.execute("SELECT LENGTH(image_webp) FROM page_scans").fetchall()
    chunks = conn.execute("SELECT COUNT(*) FROM document_chunks").fetchone()[0]
    conn.close()
    assert len(scans) == 3 and all(s[0] > 1000 for s in scans) and chunks >= 3


# ── D.O.D : INVALID_SOURCE sans arrêt du backend ──────────────
def test_invalid_source(pipeline_run):
    bad_pdf = os.path.join(config.SOURCES_DIR, "corrompu.pdf")
    with open(bad_pdf, "wb") as fh:
        fh.write(b"%PDF-1.4 CECI N'EST PAS UN PDF VALIDE \x00\x01\x02")
    conn = db.get_connection(TEST_DB)
    doc_id = str(uuid.uuid4())
    conn.execute("INSERT INTO documents (id,title,filename,source_path,total_pages)"
                 " VALUES (?,?,?,?,1)", (doc_id, "Corrompu", "corrompu.pdf", bad_pdf))
    conn.commit()
    conn.close()
    orch = PipelineOrchestrator()
    orch.enqueue_batch(TEST_DB, doc_id, bad_pdf, "document", 1, 1)
    result = orch.run_queue(TEST_DB)  # ne doit PAS lever
    status = _q(pipeline_run, "SELECT status FROM pipeline_jobs WHERE document_id=?", (doc_id,))[0][0]
    assert status == "INVALID_SOURCE" and result["quarantined"] == 1
    os.remove(bad_pdf)


# ── D.O.D : Linter < 5ms ──────────────────────────────────────
def test_linter_performance():
    layer4 = engine_registry.load_layer("sci-engine", "layer_4_lint")
    ctx = {"chunks": [{"chunk_index": 0, "content_markdown": "| a | b |\n| 1 | 2 |\ntexte $x^2$"}],
           "artifacts": [{"block_id_ref": "b_01", "artifact_type": "latex_formula",
                          "raw_data": "$\\frac{1}{2} + \\begin{matrix}a\\end{matrix}$"}],
           "latencies": {}}
    started = time.perf_counter()
    layer4.run(ctx)
    elapsed_ms = (time.perf_counter() - started) * 1000
    assert elapsed_ms < 5.0, "Linter : %.2f ms (limite 5 ms)" % elapsed_ms
    assert ctx["lint"]["is_valid"] is True
