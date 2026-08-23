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
    low_memory = os.environ.get("RAGDOM_LOW_MEMORY", "false").lower() == "true"
    assert len(chunks) >= (2 if low_memory else 3)
    if low_memory:
        assert any(c["pedagogical_type"] == "solution_only" for c in chunks)
    else:
        assert any(c["pedagogical_type"] == "exercise_solved" and c["pedagogical_index"] == 3
                   for c in chunks)  # SolutionLinker passé
    globals()["_DOC_ID"] = doc_id
    globals()["_CHUNK_ID"] = chunks[0]["id"]


def test_page_scan_binary_headers():
    response = client.get("/api/library/page-scan",
                          params={"db": TEST_DB, "document_id": _DOC_ID, "page": 1})
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    minimum_width = 1000 if os.environ.get("RAGDOM_LOW_MEMORY", "false").lower() == "true" else 2000
    assert int(response.headers["x-scan-width"]) > minimum_width
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
                           json={"query": "Que dit le cours sur les fractions ?",
                                 "databases": [TEST_DB], "top_k": 3}).json()
    assert response["no_context"] is False and response["sources"]
    # Environnement-indépendant : sans provider configuré → repli tracé ;
    # avec de vraies clés dans ragdom_config.sqlite → réponse LLM réelle sourcée.
    if response["fallback_triggered"]:
        assert response["answer"]  # message de repli + extraits
    else:
        assert response.get("provider_used") and response["answer"]  # vraie réponse LLM
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


# ── Sprint pixel-perfect Lot 1 : manifeste + agrégats + filtres ──
def test_page_scans_manifest():
    payload = client.get("/api/library/page-scans", params={"db": TEST_DB}).json()
    data = payload["data"]
    # La page 2 a été purgée par test_purge_dry_run_then_page → il reste les pages 1 et 3.
    assert {d["page_number"] for d in data} == {1, 3}
    first = data[0]
    minimum_width = 1000 if os.environ.get("RAGDOM_LOW_MEMORY", "false").lower() == "true" else 2000
    assert first["width"] > minimum_width and first["has_thumb"] is True
    assert first["exercises_count"] >= 0 and "chapter_title" in first
    scoped = client.get("/api/library/page-scans",
                        params={"db": TEST_DB, "document_id": _DOC_ID}).json()["data"]
    assert len(scoped) == len(data)


def test_curriculum_aggregates():
    payload = client.get("/api/library/curriculum", params={"db": TEST_DB}).json()
    agg = payload["aggregates"]
    assert agg["global"]["page_scans"] == 2  # cohérent avec le manifeste post-purge
    assert agg["global"]["solutions"] >= 1   # correction n°3 (page 3) — l'exercice (page 2) a été purgé
    assert isinstance(agg["per_term"], list)  # vide en Mode Repli (aucun terme)
    created = client.post("/api/curriculum/terms?db=" + TEST_DB,
                          json={"term_index": 1, "label": "الفصل الأول"}).json()
    per_term = client.get("/api/library/curriculum",
                          params={"db": TEST_DB}).json()["aggregates"]["per_term"]
    assert per_term and per_term[0]["term_index"] == 1 and per_term[0]["programs"] == 0
    client.delete("/api/curriculum/terms/%s?db=%s" % (created["id"], TEST_DB))


def test_chunks_filters_pedagogical_and_range():
    sols = client.get("/api/library/chunks",
                      params={"db": TEST_DB, "document_id": _DOC_ID,
                              "pedagogical_type": "solution_only"}).json()["chunks"]
    assert sols and all(c["pedagogical_type"] == "solution_only" for c in sols)
    exos = client.get("/api/library/chunks",
                      params={"db": TEST_DB, "document_id": _DOC_ID,
                              "pedagogical_type": "exercise"}).json()["chunks"]
    assert all(c["pedagogical_type"].startswith("exercise") for c in exos)  # vide post-purge : OK
    ranged = client.get("/api/library/chunks",
                        params={"db": TEST_DB, "document_id": _DOC_ID,
                                "page_start": 3, "page_end": 3}).json()["chunks"]
    assert ranged and all(c["page_number"] == 3 for c in ranged)


def test_reprocess_scoped_page():
    """Ré-exécution scopée (Lot contrôle pipeline) : purge + ré-ingestion de la page 1."""
    before = client.get("/api/library/chunks",
                        params={"db": TEST_DB, "document_id": _DOC_ID, "page_number": 1}).json()["chunks"]
    assert before, "la page 1 doit exister avant reprocess"
    response = client.post("/api/pipeline/reprocess",
                           json={"db": TEST_DB, "scope": "page_range", "document_id": _DOC_ID,
                                 "page_start": 1, "page_end": 1})
    assert response.status_code == 202, response.text
    payload = response.json()
    assert payload["page_start"] == 1 and payload["page_end"] == 1
    _wait_batch(payload["batch_id"])
    after = client.get("/api/library/chunks",
                       params={"db": TEST_DB, "document_id": _DOC_ID, "page_number": 1}).json()["chunks"]
    assert after, "la page 1 doit être ré-ingérée"
    scan = client.get("/api/library/page-scan",
                      params={"db": TEST_DB, "document_id": _DOC_ID, "page": 1})
    assert scan.status_code == 200  # scan régénéré


def test_key_model_per_key():
    """Modèle PAR CLÉ : la même clé peut exister avec des modèles différents."""
    k1 = client.post("/api/llm/keys", json={"provider": "gemini", "api_key": "AIzaMEMECLE0001"}).json()["key_id"]
    k2 = client.post("/api/llm/keys", json={"provider": "gemini", "api_key": "AIzaMEMECLE0001"}).json()["key_id"]
    assert k1 != k2  # même secret, deux enregistrements
    assert client.put("/api/llm/keys/%s" % k1, json={"active_model": "modele-alpha"}).json()["updated"]
    assert client.put("/api/llm/keys/%s" % k2, json={"active_model": "modele-beta"}).json()["updated"]
    keys = {k["id"]: k for k in client.get("/api/llm/keys").json()["keys"]}
    assert keys[k1]["active_model"] == "modele-alpha" and keys[k2]["active_model"] == "modele-beta"
    client.delete("/api/llm/keys/%s" % k1); client.delete("/api/llm/keys/%s" % k2)


# ── Mise en conformité : ?db= invalide → 404 (jamais 500) sur curriculum ET pipeline ──
def test_invalid_db_returns_404_not_500():
    """Une base inexistante doit remonter 404 (garde-fou _conn factorisé),
    jamais une 500 (ValueError/FileNotFoundError crues). Point d'audit n°1."""
    assert client.get("/api/curriculum/terms", params={"db": "nope.sqlite"}).status_code == 404
    assert client.get("/api/pipeline/queue", params={"db": "nope.sqlite"}).status_code == 404
    # nom malformé (regex stricte) → 400
    assert client.get("/api/pipeline/queue", params={"db": "../etc/passwd"}).status_code == 400
    # purge sur base inexistante → 404 (et non 500)
    purge_nope = client.post("/api/pipeline/purge",
                             json={"db": "nope.sqlite", "scope": "curriculum_only", "dry_run": True})
    assert purge_nope.status_code == 404


# ── Mise en conformité : agrégat « cours » = unités de lecture réelles (TOC level=1) ──
def test_curriculum_aggregate_courses_reflects_toc():
    """`courses` = COUNT(document_toc level=1), repli COUNT(documents) si 0 ;
    `assessments` = max(assessments, chunks evaluation_exam). Points d'audit 2 & 3."""
    agg_db = "Agg_TestAPI.sqlite"
    for suffix in ("", "-wal", "-shm"):
        path = os.path.join(config.DATABASES_DIR, agg_db + suffix)
        if os.path.exists(path):
            os.remove(path)
    conn = db.create_database(agg_db)
    try:
        conn.execute("INSERT INTO documents (id, title, filename, source_path, total_pages)"
                     " VALUES ('d1','Doc','doc.pdf','/tmp/inexistant_doc.pdf', 30)")
        # 3 chapitres (level=1) + 1 sous-section (level=2, ne compte pas comme cours)
        for i, (lvl, ps) in enumerate([(1, 1), (1, 11), (1, 21), (2, 12)]):
            conn.execute("INSERT INTO document_toc (id, document_id, level, title, page_start)"
                         " VALUES (?, 'd1', ?, ?, ?)", ("t%d" % i, lvl, "Chap %d" % i, ps))
        # 2 chunks evaluation_exam (0 assessment curriculum → repli sur les chunks)
        for i in range(2):
            conn.execute("INSERT INTO document_chunks (id, document_id, page_number, chunk_index,"
                         " content_markdown, pedagogical_type) VALUES (?, 'd1', ?, ?, 'Examen', 'evaluation_exam')",
                         ("c%d" % i, i + 1, i))
        conn.commit()
    finally:
        conn.close()
    try:
        agg = client.get("/api/library/curriculum", params={"db": agg_db}).json()["aggregates"]["global"]
        assert agg["courses"] == 3          # 3 chapitres TOC level=1 (pas les chunks course_theory)
        assert agg["assessments"] == 2      # max(0 assessments, 2 chunks evaluation_exam)
        assert agg["chapters"] == 3
        # Repli documents : sans aucune entrée TOC, courses tombe sur COUNT(documents).
        conn2 = db.get_connection(agg_db)
        try:
            conn2.execute("DELETE FROM document_toc")
            conn2.commit()
        finally:
            conn2.close()
        agg2 = client.get("/api/library/curriculum", params={"db": agg_db}).json()["aggregates"]["global"]
        assert agg2["courses"] == 1         # repli : COUNT(documents) = 1
    finally:
        for suffix in ("", "-wal", "-shm"):
            path = os.path.join(config.DATABASES_DIR, agg_db + suffix)
            if os.path.exists(path):
                os.remove(path)


# ── Requalification VLM du corpus (§12) : forme du dry_run (route admin) ──
def test_requalify_artifacts_dry_run_shape():
    """dry_run = comptes seuls, aucune donnée modifiée, forme de réponse stable.

    Le mini-manuel natif n'a pas de crops dense_illustration → candidates=0, mais
    la FORME de la réponse (clés du contrat) doit être respectée et le dry_run ne
    doit JAMAIS toucher la base ni exiger un provider VLM."""
    response = client.post("/api/pipeline/requalify-artifacts",
                           json={"db": TEST_DB, "dry_run": True, "limit": 85})
    assert response.status_code == 200, response.text
    payload = response.json()
    for key in ("dry_run", "candidates", "requalified", "anchored",
                "by_type", "by_semantic", "skipped_failures"):
        assert key in payload, "clé manquante : %s" % key
    assert payload["dry_run"] is True
    assert payload["requalified"] == 0 and payload["anchored"] == 0
    assert isinstance(payload["candidates"], int)
    assert isinstance(payload["by_type"], dict) and isinstance(payload["by_semantic"], dict)


def test_requalify_artifacts_is_admin_guarded():
    """La route de requalification est ADMIN : masquée en mode consultation (404)."""
    import config as _cfg
    original = _cfg.RAGDOM_READONLY
    _cfg.RAGDOM_READONLY = True
    try:
        r = client.post("/api/pipeline/requalify-artifacts",
                        json={"db": TEST_DB, "dry_run": True})
        assert r.status_code == 404
    finally:
        _cfg.RAGDOM_READONLY = original
