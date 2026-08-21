# -*- coding: utf-8 -*-
"""sci-engine — Couche 7 : Persistance SQLite transactionnelle ACID (tech_specs §2/§4.5).

Transaction unique par page : page_scans (image_webp + thumb_webp + dimensions —
V3.5 Base Autonome), ré-ingestion propre (suppression des anciennes lignes NON
corrigées : is_human_edited=1 JAMAIS écrasé), chunks (+FTS/vec par triggers),
artefacts, TOC (page 1), benchmark. Purge mémoire agressive (Skills §2.1) et
checkpoint /pipeline-set/ supprimé. Python 3.9+.
"""
import glob
import os
import sys
import time
import uuid

import cv2

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend"))


def _webp(image_rgb, quality: int) -> bytes:
    ok, buf = cv2.imencode(".webp", cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR),
                           [cv2.IMWRITE_WEBP_QUALITY, quality])
    return buf.tobytes() if ok else b""


def run(ctx: dict) -> dict:
    started = time.perf_counter()
    from db import connection as db  # import tardif : le noyau fournit la connexion

    job, document = ctx["job"], ctx["document"]
    page_number = job["page_number"]
    doc_id = document["id"]
    conn = db.get_connection(ctx["db_name"])
    try:
        conn.execute("BEGIN")

        # ── Ré-ingestion propre : purge des lignes NON corrigées de cette page ──
        conn.execute("DELETE FROM scientific_artifacts WHERE document_id=? AND page_number=? AND is_human_edited=0",
                     (doc_id, page_number))
        conn.execute("DELETE FROM document_chunks WHERE document_id=? AND page_number=? AND is_human_edited=0",
                     (doc_id, page_number))
        protected = {row[0] for row in conn.execute(
            "SELECT chunk_index FROM document_chunks WHERE document_id=? AND page_number=?",
            (doc_id, page_number))}

        # ── page_scans (V3.5 — le .sqlite sert 100% de l'UI, scans inclus) ──
        image_webp = _webp(ctx["restored_rgb"], 80)
        height, width = ctx["restored_rgb"].shape[:2]
        thumb_w = 256
        thumb = cv2.resize(ctx["restored_rgb"], (thumb_w, max(1, int(height * thumb_w / width))),
                           interpolation=cv2.INTER_AREA)
        conn.execute(
            "INSERT INTO page_scans (id, document_id, page_number, width_px, height_px, dpi, image_webp, thumb_webp)"
            " VALUES (?,?,?,?,?,300,?,?) ON CONFLICT(document_id, page_number) DO UPDATE SET"
            " width_px=excluded.width_px, height_px=excluded.height_px,"
            " image_webp=excluded.image_webp, thumb_webp=excluded.thumb_webp",
            (str(uuid.uuid4()), doc_id, page_number, ctx["width_px"], ctx["height_px"],
             image_webp, _webp(thumb, 70)),
        )

        # ── TOC (page 1 : outlines natifs) ──
        for entry in ctx.get("toc_entries", []):
            conn.execute(
                "INSERT INTO document_toc (id, document_id, parent_id, level, title, page_start, page_end)"
                " VALUES (?,?,NULL,?,?,?,?)",
                (str(uuid.uuid4()), doc_id, entry["level"], entry["title"],
                 entry["page_start"], entry["page_end"]),
            )

        # ── Chunks (triggers FTS + vec automatiques) ──
        chunk_ids = {}
        for chunk in ctx.get("chunks", []):
            if chunk["chunk_index"] in protected:
                continue  # correction humaine préservée (tech_specs §4.5)
            cid = str(uuid.uuid4())
            chunk_ids[chunk["chunk_index"]] = cid
            conn.execute(
                "INSERT INTO document_chunks (id, document_id, toc_id, page_number, chunk_index,"
                " section_title, content_markdown, pedagogical_type, pedagogical_index,"
                " has_solution, embedding_vector, token_count)"
                " VALUES (?,?,NULL,?,?,?,?,?,?,0,?,?)",
                (cid, doc_id, page_number, chunk["chunk_index"], chunk["section_title"],
                 chunk["content_markdown"], chunk["pedagogical_type"], chunk["pedagogical_index"],
                 chunk["embedding_vector"], chunk["token_count"]),
            )

        # ── Artefacts (rattachés au premier chunk de la page si présent) ──
        anchor_chunk = chunk_ids.get(0)
        for artifact in ctx.get("artifacts", []):
            if artifact.get("raw_data") is None and artifact.get("raw_binary") is None:
                continue
            conn.execute(
                "INSERT INTO scientific_artifacts (id, document_id, chunk_id, page_number, domain,"
                " artifact_type, raw_data, raw_binary, render_config_json, caption, searchable_text,"
                " bounding_box_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (str(uuid.uuid4()), doc_id, anchor_chunk, page_number, artifact["domain"],
                 artifact["artifact_type"], artifact.get("raw_data"), artifact.get("raw_binary"),
                 artifact["render_config_json"], artifact.get("caption"),
                 artifact["searchable_text"], artifact.get("bounding_box_json")),
            )

        # ── Benchmark (Couche 6) ──
        bench = ctx.get("bench", {})
        conn.execute(
            "INSERT INTO processing_benchmarks (id, document_id, page_number, engine_used,"
            " vlm_provider_used, fallback_triggered, linter_errors_json, execution_time_ms,"
            " ram_peak_mb, confidence_score, blur_score, deskew_angle)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), doc_id, page_number, bench.get("engine_used", "unknown"),
             bench.get("vlm_provider_used"), bench.get("fallback_triggered", 0),
             bench.get("linter_errors_json"),
             bench.get("execution_time_ms", sum(ctx.get("latencies", {}).values())),
             bench.get("ram_peak_mb"), bench.get("confidence_score"),
             bench.get("blur_score"), bench.get("deskew_angle")),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
        # ── Purge mémoire agressive (Skills §2.1) + checkpoint supprimé ──
        fitz_refs = ctx.pop("_fitz", None)
        for key in ("restored_rgb", "binarized_gray"):
            ctx.pop(key, None)
        if fitz_refs:
            try:
                import fitz
                fitz_refs["pixmap"] = None
                fitz_refs["page"] = None
                fitz_refs["doc"].close()
                fitz.TOOLS.store_shrink(100)
            except Exception:  # noqa: BLE001
                pass
        import gc
        gc.collect()
        for ckpt in glob.glob(os.path.join(ctx["config"]["pipeline_set_dir"], doc_id,
                                           "page_%03d_*" % page_number)):
            try:
                os.remove(ckpt)
            except OSError:
                pass

    ctx.setdefault("latencies", {})["layer_7_persist"] = int((time.perf_counter() - started) * 1000)
    return ctx
