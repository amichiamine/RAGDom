# -*- coding: utf-8 -*-
"""RAGDom — Phase 2 : tests d'API sur serveur réel (TestClient FastAPI).

Couvre le contrat Blueprint §7 + §7.6 : ingestion via /pipeline/start (PDF réel),
library (documents/chunks/page-scan binaire + en-têtes), recherche hybride
(seuils réels), ask (fallback sans provider), purge scopée dry-run/exécution,
quarantaine, corrections humaines, curriculum CRUD + Mode Repli, settings,
sources, cycle de vie des bases, clés LLM masquées.
"""
import io
import os
import sys
import time

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402
from main import app  # noqa: E402
from db import connection as db  # noqa: E402

client = TestClient(app)
TEST_DB = "Maths_TestAPI.sqlite"


def _cleanup_db():
    for suffix in ("", "-wal", "-shm"):
        path = os.path.join(config.DATABASES_DIR, TEST_DB + suffix)
        if os.path.exists(path):
            os.remove(path)


@pytest.fixture(scope="module", autouse=True)
def setup_module_env():
    _cleanup_db()  # idempotence : purge tout résidu d'exécution précédente
    src_dir = os.path.join(config.SOURCES_DIR, "Maths", "TestAPI")
    os.makedirs(src_dir, exist_ok=True)
    pdf_path = os.path.join(src_dir, "mini_manuel.pdf")
    import fitz
    doc = fitz.open()
    for text in ["Cours : les fractions. Définition : $\\frac{a}{b}$ avec $b \\neq 0$.",
                 "Exercice n° 3\n\nSimplifier $\\frac{6}{8}$.",
                 "Correction de l'exercice n° 3\n\nOn obtient $\\frac{3}{4}$."]:
        page = doc.new_page()
        page.insert_textbox(fitz.Rect(50, 50, 545, 780), text, fontsize=12)
    doc.save(pdf_path)
    doc.close()
    yield {"pdf": pdf_path}
    for suffix in ("", "-wal", "-shm"):
        path = os.path.join(config.DATABASES_DIR, TEST_DB + suffix)
        if os.path.exists(path):
            os.remove(path)


def _wait_batch(batch_id: str, timeout_s: int = 60):
    for _ in range(timeout_s * 4):
        response = client.get("/api/pipeline/status", params={"batch_id": batch_id, "db": TEST_DB})
        if response.status_code == 200 and response.json()["status"] == "COMPLETED":
            return response.json()
        time.sleep(0.25)
    raise AssertionError("Batch jamais COMPLETED")


# ── Ingestion par l'API : nommage §13 + worker en arrière-plan ──
def test_pipeline_start_and_complete(setup_module_env):
    response = client.post("/api/pipeline/start",
                           json={"source_path": setup_module_env["pdf"], "mode": "document"})
    assert response.status_code == 202, response.text
    payload = response.json()
    assert payload["target_db"] == TEST_DB  # /sources/Maths/TestAPI/ → Maths_TestAPI.sqlite (§13)
    status = _wait_batch(payload["batch_id"])
    assert status["pages_done"] == 3


def test_databases_listing_zero_mock():
    names = [d["filename"] for d in client.get("/api/system/databases").json()["databases"]]
    assert TEST_DB in names


def test_library_documents_chunks():
    docs = client.get("/api/library/documents", params={"db": TEST_DB}).json()["documents"]
    assert len(docs) == 1 and docs[0]["academic_level"] is None
    doc_id = docs[0]["id"]
    chunks = client.get("/api/library/chunks",
                        params={"db": TEST_DB, "document_id": doc_id}).json()["chunks"]
    assert len(chunks) >= 3
    assert any(c["pedagogical_type"] == "exercise_solved" and c["pedagogical_index"] == 3
               for c in chunks)  # SolutionLinker passé
    globals()["_DOC_ID"] = doc_id
    globals()["_CHUNK_ID"] = chunks[0]["id"]


def test_page_scan_binary_headers():
    response = client.get("/api/library/page-scan",
                          params={"db": TEST_DB, "document_id": _DOC_ID, "page": 1})
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    assert int(response.headers["x-scan-width"]) > 2000
    assert len(response.content) > 1000
    thumb = client.get("/api/library/page-scan",
                       params={"db": TEST_DB, "document_id": _DOC_ID, "page": 1, "thumb": True})
    assert 0 < len(thumb.content) < len(response.content)


def test_search_hybrid_and_thresholds():
    response = client.post("/api/search/hybrid?db=" + TEST_DB,
                           json={"query": "fractions simplifier", "top_k": 5})
    results = response.json()["results"]
    assert results and results[0]["document_id"] == _DOC_ID
    assert results[0]["bm25_rank"] == 1
    empty = client.post("/api/search/hybrid?db=" + TEST_DB,
                        json={"query": "zztermeinexistantqq", "top_k": 5}).json()["results"]
    assert empty == []  # seuils réels : aucun chunk éligible


def test_ask_no_provider_fallback():
    response = client.post("/api/search/ask",
                           json={"query": "Comment simplifier une fraction ?",
                                 "databases": [TEST_DB], "top_k": 3}).json()
    assert response["no_context"] is False and response["sources"]
    assert response["fallback_triggered"] is True  # aucun provider configuré
    nothing = client.post("/api/search/ask",
                          json={"query": "zzabsentduquorpus", "databases": [TEST_DB]}).json()
    assert nothing["no_context"] is True and nothing["sources"] == []


def test_human_correction_preserved():
    response = client.put("/api/library/chunks/" + _CHUNK_ID + "?db=" + TEST_DB,
                          json={"content_markdown": "Contenu corrigé par ArchiSys3.0 $x^2$"})
    payload = response.json()
    assert payload["updated"] and payload["is_human_edited"] == 1 and payload["lint"]["is_valid"]
    hit = client.post("/api/search/hybrid?db=" + TEST_DB,
                      json={"query": "corrigé ArchiSys3.0", "top_k": 3}).json()["results"]
    assert any(r["chunk_id"] == _CHUNK_ID for r in hit)  # FTS resynchronisé par trigger


def test_purge_dry_run_then_page():
    dry = client.post("/api/pipeline/purge",
                      json={"db": TEST_DB, "scope": "page", "document_id": _DOC_ID,
                            "page_start": 2, "dry_run": True}).json()
    assert dry["dry_run"] and dry["deleted"]["page_scans"] == 1
    real = client.post("/api/pipeline/purge",
                       json={"db": TEST_DB, "scope": "page", "document_id": _DOC_ID,
                             "page_start": 2, "dry_run": False}).json()
    assert real["deleted"]["page_scans"] == 1
    gone = client.get("/api/library/page-scan",
                      params={"db": TEST_DB, "document_id": _DOC_ID, "page": 2})
    assert gone.status_code == 404
    guard = client.post("/api/pipeline/purge",
                        json={"db": TEST_DB, "scope": "database", "dry_run": False})
    assert guard.status_code == 400  # double garde-fou confirm


def test_curriculum_crud_and_fallback_mode():
    empty = client.get("/api/library/curriculum", params={"db": TEST_DB}).json()
    assert empty["curriculum_available"] is False  # Mode Repli Générique (D1-B)
    created = client.post("/api/curriculum/terms?db=" + TEST_DB,
                          json={"term_index": 1, "label": "الفصل الأول"}).json()
    assert created["created"]
    active = client.get("/api/library/curriculum", params={"db": TEST_DB}).json()
    assert active["curriculum_available"] is True and active["terms"][0]["label"] == "الفصل الأول"
    assert client.delete("/api/curriculum/terms/%s?db=%s" % (created["id"], TEST_DB)).json()["deleted"]


def test_settings_whitelist():
    settings = client.get("/api/system/settings").json()["settings"]
    assert settings["vec_distance_threshold"] == 0.45
    assert client.put("/api/system/settings",
                      json={"key": "vec_distance_threshold", "value": "0.5"}).json()["success"]
    assert client.get("/api/system/settings").json()["settings"]["vec_distance_threshold"] == 0.5
    client.put("/api/system/settings", json={"key": "vec_distance_threshold", "value": "0.45"})
    assert client.put("/api/system/settings",
                      json={"key": "hack", "value": "1"}).status_code == 400


def test_sources_tree_and_upload():
    tree = client.get("/api/system/sources").json()["tree"][0]
    flat = str(tree)
    assert "mini_manuel.pdf" in flat and "'ingested': True" in flat
    upload = client.post("/api/system/sources/upload",
                         files={"file": ("note.pdf", io.BytesIO(b"%PDF-1.4 test"), "application/pdf")},
                         data={"rel_path": "Maths/TestAPI"})
    assert upload.json()["uploaded"]
    protected = client.request("DELETE", "/api/system/sources",
                               params={"rel_path": "Maths/TestAPI/mini_manuel.pdf"})
    assert protected.status_code == 409  # PDF ingéré : suppression refusée
    assert client.request("DELETE", "/api/system/sources",
                          params={"rel_path": "Maths/TestAPI/note.pdf"}).json()["deleted"]


def test_database_lifecycle():
    dup = client.post("/api/system/databases/%s/duplicate" % TEST_DB,
                      json={"new_name": "Copie_TestAPI.sqlite"})
    assert dup.json()["duplicated"]
    export = client.get("/api/system/databases/Copie_TestAPI.sqlite/export")
    assert export.status_code == 200 and len(export.content) > 10000
    refused = client.request("DELETE", "/api/system/databases/Copie_TestAPI.sqlite",
                             json={"confirm": "mauvais_nom"})
    assert refused.status_code == 400
    assert client.request("DELETE", "/api/system/databases/Copie_TestAPI.sqlite",
                          json={"confirm": "Copie_TestAPI.sqlite"}).json()["deleted"]


def test_llm_keys_masked_and_reveal():
    created = client.post("/api/llm/keys", json={"provider": "gemini", "api_key": "AIzaSyFAKE1234567890"})
    key_id = created.json()["key_id"]
    listed = client.get("/api/llm/keys").json()["keys"]
    me = next(k for k in listed if k["id"] == key_id)
    assert "FAKE" not in me["masked_key"] or me["masked_key"].count(".") == 3  # masquée
    assert "api_key" not in me
    revealed = client.post("/api/llm/keys/%s/reveal" % key_id).json()
    assert revealed["api_key"].endswith("7890")
    assert client.delete("/api/llm/keys/%s" % key_id).json()["deleted"]


def test_quarantine_empty_then_listable():
    jobs = client.get("/api/pipeline/quarantine", params={"db": TEST_DB}).json()["jobs"]
    assert isinstance(jobs, list)
