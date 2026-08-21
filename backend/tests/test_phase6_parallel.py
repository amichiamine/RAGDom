# -*- coding: utf-8 -*-
"""RAGDom — Phase 6 (post-v1, D4-B) : test du parallélisme intra-page borné.

Vérifie : (1) le flag à 1 → couche séquentielle (aucun changement v1) ;
(2) flag à 2 → l'orchestrateur charge layer_2_extract_v2, l'ingestion aboutit
READY avec le même nombre de chunks/scans que la référence séquentielle, et
engine_used trace la variante (+p2).
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402
from db import connection as db  # noqa: E402
from core import orchestrator as orch  # noqa: E402
from api.routes_pipeline import _register_document  # noqa: E402

SEQ_DB = "Maths_P6seq.sqlite"
PAR_DB = "Maths_P6par.sqlite"


def _cleanup(name):
    for suffix in ("", "-wal", "-shm"):
        path = os.path.join(config.DATABASES_DIR, name + suffix)
        if os.path.exists(path):
            os.remove(path)


@pytest.fixture(scope="module", autouse=True)
def pdf_source():
    import fitz
    src_dir = os.path.join(config.SOURCES_DIR, "Maths", "P6")
    os.makedirs(src_dir, exist_ok=True)
    pdf_path = os.path.join(src_dir, "mini_p6.pdf")
    doc = fitz.open()
    for i in (1, 2, 3):
        page = doc.new_page()
        page.insert_textbox(fitz.Rect(50, 50, 545, 780),
                            "Cours %d : $\\frac{%d}{%d}$ et $x^2 + %d = 0$.\n" % (i, i, i + 1, i) * 5,
                            fontsize=11)
    doc.save(pdf_path)
    doc.close()
    yield pdf_path
    for name in (SEQ_DB, PAR_DB):
        _cleanup(name)


def _ingest(db_name, pdf_path):
    _cleanup(db_name)
    doc_info = _register_document(db_name, pdf_path)
    orch.orchestrator.enqueue_batch(db_name, doc_info["id"], pdf_path, "document",
                                    1, doc_info["total_pages"])
    orch.orchestrator.run_queue(db_name)
    conn = db.get_connection(db_name)
    try:
        ready = conn.execute("SELECT COUNT(*) FROM pipeline_jobs WHERE status='READY'").fetchone()[0]
        chunks = conn.execute("SELECT COUNT(*) FROM document_chunks").fetchone()[0]
        scans = conn.execute("SELECT COUNT(*) FROM page_scans").fetchone()[0]
        engines = [r[0] for r in conn.execute(
            "SELECT DISTINCT engine_used FROM processing_benchmarks WHERE engine_used IS NOT NULL")]
        return {"ready": ready, "chunks": chunks, "scans": scans, "engines": engines}
    finally:
        conn.close()


def test_variant_loader_fallback(monkeypatch):
    monkeypatch.setattr(config, "RAGDOM_INTRA_PAGE_WORKERS", 2)
    module = orch.PipelineOrchestrator._load_layer_variant("sci-engine", "layer_2_extract")
    assert module.__name__.endswith("layer_2_extract_v2") or "_v2" in getattr(module, "__file__", "")
    # Couche sans variante : repli silencieux sur la séquentielle.
    module0 = orch.PipelineOrchestrator._load_layer_variant("sci-engine", "layer_0_cv")
    assert "layer_0_cv" in getattr(module0, "__file__", "")


def test_sequential_reference(monkeypatch, pdf_source):
    monkeypatch.setattr(config, "RAGDOM_INTRA_PAGE_WORKERS", 1)
    result = _ingest(SEQ_DB, pdf_source)
    assert result["ready"] == 3 and result["scans"] == 3
    assert not any("+p" in e for e in result["engines"])
    globals()["_SEQ"] = result


def test_parallel_equivalence(monkeypatch, pdf_source):
    monkeypatch.setattr(config, "RAGDOM_INTRA_PAGE_WORKERS", 2)
    result = _ingest(PAR_DB, pdf_source)
    assert result["ready"] == 3 and result["scans"] == 3
    assert any("+p2" in e for e in result["engines"])  # la variante a bien servi
    seq = globals()["_SEQ"]
    assert result["chunks"] == seq["chunks"]  # équivalence stricte des sorties
