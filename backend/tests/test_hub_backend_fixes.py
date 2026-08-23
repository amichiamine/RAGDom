"""RAGDom — Correctifs backend « Hub » : suppression documentaire, anti-double-ingestion,
purge scopée intelligente au reprocess.

Couvre :
  (1) DELETE /api/library/documents/{document_id}?db= — suppression transactionnelle
      d'UN document (ligne + descendance via ON DELETE CASCADE), garde-fou base
      officielle, refus 409 si un batch est en cours ;
  (2) anti-double-ingestion dans POST /pipeline/start — un second lancement du même
      source_path route vers un reprocess scopé du document EXISTANT (réutilise l'ID,
      renvoie reused_existing_document=true + batch) au lieu de créer un doublon ;
  (3) la purge au (re)lancement reste scopée : elle ne purge QUE les pages du périmètre
      retraité, jamais le reste du document ni les autres documents.
Python 3.9+.
"""
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
TEST_DB = "Maths_HubFixes.sqlite"


def _cleanup_db(name=TEST_DB):
    for suffix in ("", "-wal", "-shm"):
        path = os.path.join(config.DATABASES_DIR, name + suffix)
        if os.path.exists(path):
            os.remove(path)


def _make_pdf(rel_subdir, filename, pages):
    import fitz
    src_dir = os.path.join(config.SOURCES_DIR, "Maths", rel_subdir)
    os.makedirs(src_dir, exist_ok=True)
    pdf_path = os.path.join(src_dir, filename)
    doc = fitz.open()
    for text in pages:
        page = doc.new_page()
        page.insert_textbox(fitz.Rect(50, 50, 545, 780), text, fontsize=12)
    doc.save(pdf_path)
    doc.close()
    return pdf_path


@pytest.fixture(scope="module", autouse=True)
def setup_module_env():
    _cleanup_db()
    yield
    _cleanup_db()


def _wait_batch(batch_id, timeout_s=90):
    for _ in range(timeout_s * 4):
        r = client.get("/api/pipeline/status", params={"batch_id": batch_id, "db": TEST_DB})
        if r.status_code == 200 and r.json()["status"] == "COMPLETED":
            return r.json()
        time.sleep(0.25)
    raise AssertionError("Batch jamais COMPLETED")


def _document_count():
    conn = db.get_connection(TEST_DB)
    try:
        return conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
    finally:
        conn.close()


def _chunk_count(document_id):
    conn = db.get_connection(TEST_DB)
    try:
        return conn.execute("SELECT COUNT(*) FROM document_chunks WHERE document_id=?",
                            (document_id,)).fetchone()[0]
    finally:
        conn.close()


# ── (1) Suppression documentaire ──────────────────────────────────────────────
def test_delete_document_cascades_and_official_guard():
    pdf = _make_pdf("HubFixes", "manuel_suppr.pdf",
                    ["Cours A : les fractions, définition avec $\\frac{a}{b}$ où $b \\neq 0$.",
                     "Exercice B : simplifier $\\frac{6}{8}$ puis $\\frac{4}{10}$.",
                     "Correction C : on obtient $\\frac{3}{4}$ et $\\frac{2}{5}$."])
    start = client.post("/api/pipeline/start", json={"source_path": pdf, "mode": "document"})
    assert start.status_code == 202, start.text
    _wait_batch(start.json()["batch_id"])

    docs = client.get("/api/library/documents", params={"db": TEST_DB}).json()["documents"]
    assert len(docs) == 1
    doc_id = docs[0]["id"]

    # Cascade : des descendants existent avant suppression.
    conn = db.get_connection(TEST_DB)
    try:
        n_chunks = conn.execute("SELECT COUNT(*) FROM document_chunks WHERE document_id=?",
                                (doc_id,)).fetchone()[0]
        n_scans = conn.execute("SELECT COUNT(*) FROM page_scans WHERE document_id=?",
                               (doc_id,)).fetchone()[0]
        n_benches = conn.execute("SELECT COUNT(*) FROM processing_benchmarks WHERE document_id=?",
                                 (doc_id,)).fetchone()[0]
        n_jobs = conn.execute("SELECT COUNT(*) FROM pipeline_jobs WHERE document_id=?",
                              (doc_id,)).fetchone()[0]
        n_batches = conn.execute(
            "SELECT COUNT(*) FROM ingestion_batches WHERE id IN"
            " (SELECT DISTINCT batch_id FROM pipeline_jobs WHERE document_id=?)", (doc_id,)).fetchone()[0]
    finally:
        conn.close()
    assert n_chunks > 0, "le document doit avoir des chunks pour valider la cascade"

    # Garde-fou base officielle : copie validation_test_ refusée (403).
    guarded = client.request("DELETE", "/api/library/documents/" + doc_id,
                             params={"db": "validation_test_hubfixes.sqlite"})
    assert guarded.status_code == 403

    deleted = client.request("DELETE", "/api/library/documents/" + doc_id, params={"db": TEST_DB})
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] is True

    # Cascade totale vérifiée.
    conn = db.get_connection(TEST_DB)
    try:
        assert conn.execute("SELECT COUNT(*) FROM documents WHERE id=?", (doc_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM document_chunks WHERE document_id=?",
                            (doc_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM page_scans WHERE document_id=?",
                            (doc_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM processing_benchmarks WHERE document_id=?",
                            (doc_id,)).fetchone()[0] == 0
        assert n_scans > 0  # sanity : il y avait bien des descendants
    finally:
        conn.close()

    # 404 sur suppression d'un document déjà absent, 400 nom de base malformé.
    assert client.request("DELETE", "/api/library/documents/" + doc_id,
                          params={"db": TEST_DB}).status_code == 404
    assert client.request("DELETE", "/api/library/documents/" + doc_id,
                          params={"db": "../etc/passwd"}).status_code == 400


def test_delete_document_refused_during_active_batch():
    """Refus 409 si un batch est en cours sur le document (jobs QUEUED/transitoires)."""
    pdf = _make_pdf("HubFixes", "manuel_busy.pdf",
                    ["Cours X : introduction aux nombres relatifs et aux opérations.",
                     "Exercice Y : calculer $3 + (-5)$ puis $(-2) \\times 7$.",
                     "Correction Z : le résultat est $-2$ puis $-14$.",
                     "Chapitre W : bilan des règles de signe et priorités."])
    # Enregistrer manuellement le document + enfilements de jobs QUEUED (batch fictif
    # en cours), sans lancer le worker : état « ingestion en cours » reproduit.
    import uuid
    from api.routes_pipeline import _resolve_source
    real = _resolve_source(pdf)
    conn = db.create_database(TEST_DB)
    try:
        doc_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO documents (id, title, filename, source_path, total_pages)"
            " VALUES (?,?,?,?,?)", (doc_id, "Busy", os.path.basename(pdf), real, 4))
        batch_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO ingestion_batches (id, source_path, target_db, mode, page_start, page_end,"
            " status, pages_total) VALUES (?,?,?,?,?,?, 'RUNNING', 4)",
            (batch_id, real, TEST_DB, "document", 1, 4))
        conn.execute("INSERT INTO pipeline_jobs (id, document_id, page_number, status, batch_id)"
                     " VALUES (?,?,?, 'QUEUED', ?)", (str(uuid.uuid4()), doc_id, 1, batch_id))
        conn.commit()
    finally:
        conn.close()

    refused = client.request("DELETE", "/api/library/documents/" + doc_id, params={"db": TEST_DB})
    assert refused.status_code == 409

    # Une fois les jobs retirés (flux réel : batch terminé/annulé), la suppression passe.
    conn = db.get_connection(TEST_DB)
    try:
        conn.execute("DELETE FROM pipeline_jobs WHERE document_id=?", (doc_id,))
        conn.execute("UPDATE ingestion_batches SET status='COMPLETED' WHERE id=?", (batch_id,))
        conn.commit()
    finally:
        conn.close()
    ok = client.request("DELETE", "/api/library/documents/" + doc_id, params={"db": TEST_DB})
    assert ok.status_code == 200


# ── (2) Anti-double-ingestion ───────────────────────────────────────────────
def test_start_reuses_existing_document_instead_of_duplicate():
    _cleanup_db()
    pdf = _make_pdf("HubFixes", "manuel_unique.pdf",
                    ["Cours 1 : relation fondamentale $a+b=c$ et calcul littéral.",
                     "Exercice 1 : résoudre $x + 3 = 7$ puis vérifier la solution.",
                     "Correction 1 : on trouve $x = 4$ et la vérification est juste."])
    first = client.post("/api/pipeline/start", json={"source_path": pdf, "mode": "document"})
    assert first.status_code == 202, first.text
    assert first.json().get("reused_existing_document") is False
    _wait_batch(first.json()["batch_id"])
    assert _document_count() == 1

    # Second lancement du MÊME PDF → reprocess scopé du document existant, pas de doublon.
    second = client.post("/api/pipeline/start", json={"source_path": pdf, "mode": "document"})
    assert second.status_code == 202, second.text
    payload = second.json()
    assert payload.get("reused_existing_document") is True
    assert payload.get("reused_document_id")
    assert payload.get("batch_id")
    _wait_batch(payload["batch_id"])
    assert _document_count() == 1  # toujours UN document (anti-doublon)

    # Les deux lancements pointent le même document existant (ID réutilisé).
    docs = client.get("/api/library/documents", params={"db": TEST_DB}).json()["documents"]
    assert len(docs) == 1 and docs[0]["id"] == payload["reused_document_id"]


def test_multiple_scoped_reprocess_same_doc_remain_possible():
    """Les exécutions scopées multiples sur le même doc RESTENT possibles (pas bloquées)."""
    _cleanup_db()
    pdf = _make_pdf("HubFixes", "manuel_multi.pdf",
                    ["Cours 1 : développer l'expression $x+y$ puis factoriser.",
                     "Cours 2 : soustraire $x-y$ et réduire les termes semblables.",
                     "Cours 3 : multiplier $xy$ par le facteur commun proposé.",
                     "Cours 4 : diviser $x/y$ en précisant la condition $y \\neq 0$.",
                     "Cours 5 : élever au carré $x^2$ et développer $(x+1)^2$."])
    start = client.post("/api/pipeline/start", json={"source_path": pdf, "mode": "document"})
    assert start.status_code == 202, start.text
    _wait_batch(start.json()["batch_id"])
    doc_id = start.json().get("reused_document_id") or \
        client.get("/api/library/documents", params={"db": TEST_DB}).json()["documents"][0]["id"]

    # Deux reprocess scopés page_range successifs sur le même document.
    for ps, pe in ((1, 1), (3, 3)):
        r = client.post("/api/pipeline/reprocess",
                        json={"db": TEST_DB, "scope": "page_range", "document_id": doc_id,
                              "page_start": ps, "page_end": pe})
        assert r.status_code == 202, r.text
        _wait_batch(r.json()["batch_id"])
    assert _document_count() == 1


# ── (3) Purge scopée intelligente ───────────────────────────────────────────
def test_scoped_reprocess_purges_only_target_range():
    _cleanup_db()
    pdf = _make_pdf("HubFixes", "manuel_scope.pdf",
                    ["Chapitre 1 introduction aux suites arithmétiques et géométriques.",
                     "## Section A\nContenu A : raison $r$ et terme général $u_n = a_1 + (n-1)r$.",
                     "## Section B\nContenu B : somme des termes $S_n = n \\frac{u_1+u_n}{2}$.",
                     "## Section C\nContenu C : suite géométrique de raison $q$ et $v_n = b_1 q^{n-1}$.",
                     "## Section D\nContenu D : convergence et limite des suites $c_n$."])
    start = client.post("/api/pipeline/start", json={"source_path": pdf, "mode": "document"})
    assert start.status_code == 202, start.text
    _wait_batch(start.json()["batch_id"])
    doc_id = client.get("/api/library/documents", params={"db": TEST_DB}).json()["documents"][0]["id"]

    # Snapshot des scans par page avant reprocess scopé.
    def scans_by_page():
        conn = db.get_connection(TEST_DB)
        try:
            return {r[0]: r[1] for r in conn.execute(
                "SELECT page_number, id FROM page_scans WHERE document_id=?", (doc_id,)).fetchall()}
        finally:
            conn.close()

    before = scans_by_page()
    assert set(before.keys()) == {1, 2, 3, 4, 5}

    # Reprocess scopé de la page 2 SEULE.
    r = client.post("/api/pipeline/reprocess",
                    json={"db": TEST_DB, "scope": "page_range", "document_id": doc_id,
                          "page_start": 2, "page_end": 2})
    assert r.status_code == 202, r.text
    payload = r.json()
    # La purge annoncée ne couvre QUE la page 2.
    assert payload["purged"]["page_scans"] == 1
    _wait_batch(payload["batch_id"])

    # Les scans des pages 1,3,4,5 sont intacts (jamais purgés), page 2 régénérée.
    after = scans_by_page()
    assert 1 in after and 3 in after and 4 in after and 5 in after
    assert before[1] == after[1]  # page 1 : aucun scan ne touche — ID strictement conservé
    assert before[3] == after[3]
    assert before[4] == after[4]
    assert before[5] == after[5]
    assert 2 in after  # re-scannée

    # Le document et ses chunks hors périmètre restent présents.
    assert _document_count() == 1
    conn = db.get_connection(TEST_DB)
    try:
        outside = conn.execute(
            "SELECT COUNT(*) FROM document_chunks WHERE document_id=? AND page_number IN (1,3,4,5)",
            (doc_id,)).fetchone()[0]
    finally:
        conn.close()
    assert outside > 0
