# -*- coding: utf-8 -*-
"""RAGDom — Phase 5 : benchmark RAM 3 paliers + baseline de débit (D.o.D tech_specs).

Génère un PDF de 100 pages (contenu pédagogique varié FR/AR + formules), l'ingère
via l'orchestrateur réel, et mesure :
  - Palier 1 (plancher)  : RSS après démarrage, avant tout moteur
  - Palier 2 (pic)       : RSS max échantillonné pendant l'ingestion (thread 200ms)
  - Palier 3 (non-fuite) : RSS après COMPLETED + gc, comparé au plancher
Baseline de débit : pages/minute sur les 100 pages.
Sortie : JSON sur stdout + docs/ragdom/04_state/bench_ram_100p.json
"""
import gc
import json
import os
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402
from db import connection as db  # noqa: E402


def rss_mb() -> float:
    with open("/proc/self/status") as f:
        for line in f:
            if line.startswith("VmRSS"):
                return round(int(line.split()[1]) / 1024.0, 1)
    return -1.0


TEST_DB = "Maths_Bench100.sqlite"


def main():
    # Nettoyage idempotent
    for suffix in ("", "-wal", "-shm"):
        path = os.path.join(config.DATABASES_DIR, TEST_DB + suffix)
        if os.path.exists(path):
            os.remove(path)

    # ── PDF 100 pages : mélange cours / exercices / corrections ──
    import fitz
    src_dir = os.path.join(config.SOURCES_DIR, "Maths", "Bench100")
    os.makedirs(src_dir, exist_ok=True)
    pdf_path = os.path.join(src_dir, "manuel_100p.pdf")
    doc = fitz.open()
    for i in range(1, 101):
        kind = i % 3
        if kind == 1:
            text = ("Cours %d : les fractions et proportions.\n"
                    "Définition : $\\frac{a}{b}$ avec $b \\neq 0$. "
                    "Propriété : $\\frac{a}{b} = \\frac{ka}{kb}$.\n" % i) * 4
        elif kind == 2:
            text = ("Exercice n° %d\n\nSimplifier $\\frac{%d}{%d}$ puis calculer "
                    "$x^2 + %d x - 1 = 0$.\n" % (i, i * 2, i * 4, i)) * 4
        else:
            text = ("Correction de l'exercice n° %d\n\nOn obtient $\\frac{1}{2}$ "
                    "après simplification par %d.\n" % (i - 1, i)) * 4
        page = doc.new_page()
        page.insert_textbox(fitz.Rect(50, 50, 545, 780), text, fontsize=11)
    doc.save(pdf_path)
    doc.close()

    gc.collect()
    floor = rss_mb()  # Palier 1 : plancher process (avant moteurs)

    from core import orchestrator as orch  # import tardif : le plancher exclut les moteurs
    from api.routes_pipeline import _register_document

    doc_info = _register_document(TEST_DB, pdf_path)
    orch.orchestrator.enqueue_batch(TEST_DB, doc_info["id"], pdf_path, "document",
                                    1, doc_info["total_pages"])

    peak = {"value": rss_mb()}
    stop_flag = {"stop": False}

    def sampler():
        while not stop_flag["stop"]:
            peak["value"] = max(peak["value"], rss_mb())
            time.sleep(0.2)

    t = threading.Thread(target=sampler, daemon=True)
    t.start()

    started = time.time()
    orch.orchestrator.run_queue(TEST_DB)  # exécution SYNCHRONE dans ce process
    elapsed = time.time() - started
    stop_flag["stop"] = True
    t.join(timeout=2)

    # Vérification READY
    conn = db.get_connection(TEST_DB)
    ready = conn.execute("SELECT COUNT(*) FROM pipeline_jobs WHERE status='READY'").fetchone()[0]
    scans = conn.execute("SELECT COUNT(*) FROM page_scans").fetchone()[0]
    chunks = conn.execute("SELECT COUNT(*) FROM document_chunks").fetchone()[0]
    conn.close()

    gc.collect()
    time.sleep(1)
    gc.collect()
    residual = rss_mb()  # Palier 3

    result = {
        "date": time.strftime("%Y-%m-%d %H:%M"),
        "environment": "sandbox Linux (Python 3.9, RAGDOM_OFFLINE — moteurs natifs fitz, "
                       "sans modèles rapid-*/fastembed : à rejouer machine cible pour valeurs finales)",
        "pages": 100, "pages_ready": ready, "page_scans": scans, "chunks": chunks,
        "palier_1_plancher_mb": floor,
        "palier_2_pic_mb": peak["value"],
        "palier_3_residuel_mb": residual,
        "non_fuite_delta_mb": round(residual - floor, 1),
        "duree_s": round(elapsed, 1),
        "debit_pages_par_minute": round(100 / (elapsed / 60.0), 1),
        "max_ram_mb_limite": 2048,
        "verdict_ram": "OK" if peak["value"] <= 2048 else "DEPASSEMENT",
    }
    out = os.path.join(os.path.dirname(__file__), "..", "..",
                       "docs", "ragdom", "04_state", "bench_ram_100p.json")
    with open(os.path.abspath(out), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # Nettoyage de la base de bench (le JSON de résultat est l'artefact conservé)
    for suffix in ("", "-wal", "-shm"):
        path = os.path.join(config.DATABASES_DIR, TEST_DB + suffix)
        if os.path.exists(path):
            os.remove(path)


if __name__ == "__main__":
    main()
