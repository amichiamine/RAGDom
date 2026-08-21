# -*- coding: utf-8 -*-
"""RAGDom — Phase 5 : test Recovery SIGTERM sur PROCESSUS RÉEL (D.o.D).

Scénario :
  1. Démarre un serveur uvicorn réel (subprocess, PID connu).
  2. Lance l'ingestion d'un PDF de 30 pages via l'API.
  3. Attend qu'au moins 5 pages soient READY puis envoie SIGTERM au serveur.
  4. Vérifie qu'il reste des jobs transitoires (QUEUED/PROCESSING) en base.
  5. Redémarre un serveur, appelle POST /api/pipeline/start (même document —
     idempotent : skip READY + recovery des transitoires), attend COMPLETED.
  6. Vérifie : 30/30 READY, zéro QUARANTINE, zéro doublon de page_scans/chunks.

Exécution : ../.venv/bin/python tests/test_recovery_sigterm.py
(script autonome — kill UNIQUEMENT par PID exact, jamais par motif.)
"""
import json
import os
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import config  # noqa: E402

BASE = "http://127.0.0.1:8901"
TEST_DB = "Maths_Recovery.sqlite"
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PYTHON = os.path.abspath(os.path.join(BACKEND_DIR, "..", ".venv", "bin", "python"))


def api(path, payload=None, timeout=10):
    req = urllib.request.Request(BASE + path)
    if payload is not None:
        req.data = json.dumps(payload).encode()
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def wait_server(proc, timeout=30):
    for _ in range(timeout * 4):
        if proc.poll() is not None:
            raise RuntimeError("Le serveur s'est arrêté prématurément")
        try:
            api("/api/system/health", timeout=2)
            return
        except Exception:  # noqa: BLE001
            time.sleep(0.25)
    raise RuntimeError("Serveur injoignable")


def start_server():
    proc = subprocess.Popen(
        [PYTHON, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8901"],
        cwd=BACKEND_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wait_server(proc)
    return proc


def db_path():
    return os.path.join(config.DATABASES_DIR, TEST_DB)


def query(sql):
    conn = sqlite3.connect(db_path())
    try:
        return conn.execute(sql).fetchall()
    finally:
        conn.close()


def main():
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(db_path() + suffix):
            os.remove(db_path() + suffix)

    import fitz
    src_dir = os.path.join(config.SOURCES_DIR, "Maths", "Recovery")
    os.makedirs(src_dir, exist_ok=True)
    pdf_path = os.path.join(src_dir, "manuel_30p.pdf")
    doc = fitz.open()
    for i in range(1, 31):
        page = doc.new_page()
        page.insert_textbox(fitz.Rect(50, 50, 545, 780),
                            "Cours %d : fractions $\\frac{%d}{%d}$.\n" % (i, i, i + 1) * 6,
                            fontsize=11)
    doc.save(pdf_path)
    doc.close()

    print("[1] Démarrage serveur réel…")
    proc = start_server()
    try:
        print("[2] Lancement ingestion 30 pages…")
        started = api("/api/pipeline/start", {"source_path": pdf_path, "mode": "document"})
        assert started["target_db"] == TEST_DB, started

        print("[3] Attente d'une progression partielle (>=5 pages READY)…")
        for _ in range(240):
            rows = query("SELECT COUNT(*) FROM pipeline_jobs WHERE status='READY'")
            if rows and rows[0][0] >= 5:
                break
            time.sleep(0.25)
        ready_before = query("SELECT COUNT(*) FROM pipeline_jobs WHERE status='READY'")[0][0]
        assert 5 <= ready_before < 30, "Progression partielle attendue, obtenu %d" % ready_before

        print("[4] SIGTERM au PID %d (kill ciblé, pages READY=%d)…" % (proc.pid, ready_before))
        os.kill(proc.pid, signal.SIGTERM)
        proc.wait(timeout=15)
    finally:
        if proc.poll() is None:
            proc.kill()

    transient = query("SELECT COUNT(*) FROM pipeline_jobs WHERE status IN"
                      " ('QUEUED','PROCESSING','EXTRACTING','QUALIFYING','LINTING','PERSISTING')")[0][0]
    ready_mid = query("SELECT COUNT(*) FROM pipeline_jobs WHERE status='READY'")[0][0]
    print("[5] Post-kill : READY=%d, transitoires=%d" % (ready_mid, transient))
    assert transient > 0, "Le kill devait laisser des jobs transitoires"

    print("[6] Redémarrage + reprise idempotente…")
    proc = start_server()
    try:
        api("/api/pipeline/start", {"source_path": pdf_path, "mode": "document"})
        for _ in range(480):
            ready = query("SELECT COUNT(*) FROM pipeline_jobs WHERE status='READY'")[0][0]
            if ready == 30:
                break
            time.sleep(0.25)

        ready = query("SELECT COUNT(*) FROM pipeline_jobs WHERE status='READY'")[0][0]
        quarantined = query("SELECT COUNT(*) FROM pipeline_jobs WHERE status='QUARANTINE'")[0][0]
        dup_scans = query("SELECT COUNT(*) FROM (SELECT document_id, page_number, COUNT(*) c"
                          " FROM page_scans GROUP BY 1,2 HAVING c>1)")[0][0]
        scans = query("SELECT COUNT(*) FROM page_scans")[0][0]

        verdict = (ready == 30 and quarantined == 0 and dup_scans == 0 and scans == 30)
        result = {"ready": ready, "quarantined": quarantined, "duplicate_scans": dup_scans,
                  "page_scans": scans, "ready_before_kill": ready_before,
                  "transient_after_kill": transient, "verdict": "PASS" if verdict else "FAIL"}
        print(json.dumps(result, indent=2))
        out = os.path.join(BACKEND_DIR, "..", "docs", "ragdom", "04_state",
                           "recovery_sigterm.json")
        with open(os.path.abspath(out), "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        assert verdict, "Recovery incomplet : %s" % result
        print("RECOVERY SIGTERM : PASS")
    finally:
        if proc.poll() is None:
            os.kill(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(db_path() + suffix):
                os.remove(db_path() + suffix)


if __name__ == "__main__":
    main()
