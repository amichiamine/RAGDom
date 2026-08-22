# -*- coding: utf-8 -*-
"""RAGDom sci-engine — Couche 2 v2 : extraction avec PARALLÉLISME INTRA-PAGE BORNÉ.

Phase 6 (post-v1, arbitrage D4-B) — module ADD-ONLY : la couche séquentielle
layer_2_extract.py reste la référence intacte. Ce module n'est chargé par
l'orchestrateur QUE si RAGDOM_INTRA_PAGE_WORKERS >= 2.

Principe : le texte de la page reste séquentiel (opération unique) ; ce sont
les BLOCS détectés au triage (images, formules, tableaux) qui sont traités par
un pool borné de 2-3 threads. Garanties maintenues :
  - une seule page en vol à la fois (la file D4-A n'est pas touchée) ;
  - RAM bornée : chaque worker ne détient qu'un crop à la fois ;
  - ordre de sortie DÉTERMINISTE (résultats réassemblés dans l'ordre des blocs) ;
  - les moteurs rapid-* sont protégés par un verrou (non thread-safe garanti).
"""
import concurrent.futures
import importlib.util
import os
import threading
import time
import uuid

import config

# ── Import du module v1 (mêmes helpers, zéro duplication de logique moteur) ──
_V1_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "layer_2_extract.py")
_spec = importlib.util.spec_from_file_location("ragdom_sci_layer2_v1_for_v2", _V1_PATH)
_v1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_v1)

_ENGINE_LOCK = threading.Lock()  # rapid-latex-ocr / rapid-table : accès sérialisé


def _process_block(ctx, block, engines):
    """Traite UN bloc du triage — retourne une liste (0..1) d'artefacts.

    Reprend à l'identique la sémantique de la boucle v1 (Tier 1/Tier 2).
    """
    page_number = ctx["job"]["page_number"]
    bbox_json = '{"x0": %d, "y0": %d, "x1": %d, "y1": %d}' % tuple(block["bbox"])
    if block["type"] == "image":
        crop = _v1._crop(ctx, block["bbox"])
        if crop.size == 0 or min(crop.shape[:2]) < 24:
            return []
        return [{
            "id": str(uuid.uuid4()),
            "block_id_ref": block["block_id"], "domain": "general",
            "artifact_type": "dense_illustration", "raw_data": None,
            "raw_binary": _v1._webp(crop),
            "render_config_json": '{"renderer": "openseadragon", "tileSources": null, "showNavigator": true}',
            "caption": "Illustration page %d" % page_number,
            "searchable_text": "illustration figure page %d" % page_number,
            "bounding_box_json": bbox_json,
            # _bbox / _page_w : requis par la qualification VLM et l'ancrage in-situ
            # (identique v1 l.315). Sans eux, l'artefact est ignoré par _anchor_artifacts.
            "_bbox": tuple(block["bbox"]), "_page_w": ctx["width_px"],
        }]
    if block["type"] == "formula" and not ctx["is_native_vector"]:
        latex_text = None
        if engines["latex"] is not None:
            try:
                with _ENGINE_LOCK:
                    latex_text, _ = engines["latex"](_v1._webp(_v1._crop(ctx, block["bbox"])))
            except Exception:  # noqa: BLE001
                latex_text = None
        return [{
            "id": str(uuid.uuid4()),
            "block_id_ref": block["block_id"], "domain": "math", "artifact_type": "latex_formula",
            "raw_data": "$$%s$$" % latex_text if latex_text else None,
            "raw_binary": None if latex_text else _v1._webp(_v1._crop(ctx, block["bbox"])),
            "render_config_json": '{"renderer": "katex", "displayMode": true, "throwOnError": false}',
            "caption": None,
            "searchable_text": latex_text or ("formule page %d" % page_number),
            "bounding_box_json": bbox_json,
            "needs_vlm": latex_text is None,
        }]
    if block["type"] == "table":
        html = None
        if engines["table"] is not None and not ctx["is_native_vector"]:
            try:
                with _ENGINE_LOCK:
                    html, *_ = engines["table"](_v1._crop(ctx, block["bbox"]))
            except Exception:  # noqa: BLE001
                html = None
        if html or not ctx["is_native_vector"]:
            return [{
                "id": str(uuid.uuid4()),
                "block_id_ref": block["block_id"], "domain": "general", "artifact_type": "data_table",
                "raw_data": html, "raw_binary": None if html else _v1._webp(_v1._crop(ctx, block["bbox"])),
                "render_config_json": '{"renderer": "tanstack-table", "pagination": true, "pageSize": 20}',
                "caption": "Tableau page %d" % page_number,
                "searchable_text": (html or "tableau page %d" % page_number)[:500],
                "bounding_box_json": bbox_json,
                "needs_vlm": html is None,
            }]
    return []


def run(ctx: dict) -> dict:
    started = time.perf_counter()
    workers = max(2, min(3, config.RAGDOM_INTRA_PAGE_WORKERS))
    engines = _v1._get_engines()
    page = ctx["_fitz"]["page"]
    doc = ctx["_fitz"]["doc"]
    page_number = ctx["job"]["page_number"]
    engine_used = "PyMuPDF4LLM+p%d" % workers

    # ── Texte / Markdown : SÉQUENTIEL (identique v1) ──
    if ctx["is_native_vector"]:
        try:
            import pymupdf4llm
            content_markdown = pymupdf4llm.to_markdown(doc, pages=[page_number - 1], show_progress=False)
        except Exception:  # noqa: BLE001
            content_markdown = page.get_text("text")
            engine_used = "PyMuPDF+p%d" % workers
    else:
        engine_used = "RapidOCR+p%d" % workers
        content_markdown = ""
        if engines["ocr"] is not None:
            result, _elapse = engines["ocr"](ctx["binarized_gray"])
            if result:
                content_markdown = "\n".join(str(line[1]) for line in result)
        if not content_markdown:
            content_markdown = ""

    # ── Formules inline du markdown (identique v1, séquentiel — regex pure) ──
    artifacts = []
    for i, match in enumerate(_v1._FORMULA_RE.finditer(content_markdown), start=1):
        latex = (match.group(1) or match.group(2) or "").strip()
        if len(latex) < 2:
            continue
        artifacts.append({
            "id": str(uuid.uuid4()),
            "block_id_ref": "md_f%02d" % i, "domain": "math", "artifact_type": "latex_formula",
            "raw_data": "$%s$" % latex if match.group(2) else "$$%s$$" % latex,
            "raw_binary": None,
            "render_config_json": '{"renderer": "katex", "displayMode": %s, "throwOnError": false}'
                                  % ("true" if match.group(1) else "false"),
            "caption": None, "searchable_text": latex,
            "bounding_box_json": None,
        })

    # ── Blocs du triage : POOL BORNÉ, résultats réassemblés dans l'ordre ──
    blocks = ctx["layout_blocks"]
    if blocks:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_process_block, ctx, block, engines) for block in blocks]
            for future in futures:  # ordre de soumission = ordre déterministe
                artifacts.extend(future.result())

    # ── Qualification VLM des découpes visuelles (§12) — SÉQUENTIELLE, APRÈS le
    # pool (le VLM est cadencé par RPM et n'est PAS parallélisable ici). Contrat
    # STRICTEMENT identique à v1 (layer_2_extract.py l.354-376) : réutilisation
    # directe des helpers v1 (_vlm_qualifier / _apply_qualification / _area_ratio)
    # — zéro duplication de logique. Respecte RAGDOM_VLM_ARTIFACTS, repli silencieux
    # si qualifier/noyau indisponibles, exclusion des cadres > 0.70 d'area_ratio,
    # timeout vlm_timeout_seconds, raw_binary JAMAIS touché. Le pipeline NE S'ARRÊTE
    # JAMAIS ici. ──
    qualify_fn, generate_fn = _v1._vlm_qualifier()
    qualified_count = 0
    if qualify_fn is not None and generate_fn is not None:
        timeout_s = int(ctx.get("config", {}).get("vlm_timeout_seconds", 30))
        for art in artifacts:
            if art.get("raw_binary") is None or art.get("artifact_type") != "dense_illustration":
                continue
            box = art.get("_bbox")
            if not box or _v1._area_ratio(box, art.get("_page_w"),
                                          ctx["height_px"]) > _v1._AREA_RATIO_MAX:
                continue  # cadre quasi-pleine-page : ni qualifié ni ancré
            try:
                result = qualify_fn(art["raw_binary"], generate_fn, timeout_s=timeout_s)
            except Exception:  # noqa: BLE001 — jamais d'arrêt
                result = None
            if result:
                _v1._apply_qualification(art, result)
                if result.get("artifact_type"):
                    qualified_count += 1
    ctx.setdefault("vlm", {})["artifacts_qualified"] = qualified_count

    # ── Ancrage in-situ : chaque artefact visuel à sa vraie position dans le
    # markdown (identique v1 l.379). Réutilise _v1._anchor_artifacts. ──
    content_markdown = _v1._anchor_artifacts(content_markdown, artifacts, ctx["height_px"])

    # Champs internes d'ancrage retirés avant persistance (non colonnes, identique v1).
    for art in artifacts:
        art.pop("_bbox", None)
        art.pop("_page_w", None)

    ctx.update(content_markdown=content_markdown, artifacts=artifacts, engine_used=engine_used,
               extraction_latency_ms=int((time.perf_counter() - started) * 1000))
    ctx.setdefault("latencies", {})["layer_2_extract"] = ctx["extraction_latency_ms"]
    return ctx
