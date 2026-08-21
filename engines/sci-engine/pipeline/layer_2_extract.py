# -*- coding: utf-8 -*-
"""sci-engine — Couche 2 : Extraction multi-moteurs Tier 1 (tech_specs §2.3, D3-B).

Natif vectoriel → PyMuPDF4LLM (markdown fidèle). Scan → RapidOCR (modèles
embarqués dans le paquet — fonctionne hors-ligne). Formules LaTeX inline
détectées dans le markdown → artefacts latex_formula ; blocs image → crops
WebP dense_illustration (Tier 1) ; blocs formula/table des scans → rapid-latex-ocr /
rapid-table si disponibles, sinon marqués pour VLM (Tier 2). Python 3.9+.
"""
import os
import re
import time

import cv2

_engines = {"tried": False, "ocr": None, "latex": None, "table": None}
_FORMULA_RE = re.compile(r"\$\$(.+?)\$\$|\$([^$\n]{2,200})\$", re.S)


def _get_engines():
    if _engines["tried"]:
        return _engines
    _engines["tried"] = True
    offline = os.environ.get("RAGDOM_OFFLINE", "false").lower() == "true"
    try:
        from rapidocr_onnxruntime import RapidOCR  # modèles PP-OCRv4 embarqués (pip)
        _engines["ocr"] = RapidOCR()
    except Exception:  # noqa: BLE001
        _engines["ocr"] = None
    if not offline:
        try:
            from rapid_latex_ocr import LatexOCR
            _engines["latex"] = LatexOCR()
        except Exception:  # noqa: BLE001 — Tier 2 (VLM) prendra le relais
            _engines["latex"] = None
        try:
            from rapid_table import RapidTable
            _engines["table"] = RapidTable()
        except Exception:  # noqa: BLE001
            _engines["table"] = None
    return _engines


def _crop(ctx, bbox):
    x0, y0, x1, y1 = [max(0, int(v)) for v in bbox]
    return ctx["restored_rgb"][y0:min(y1, ctx["height_px"]), x0:min(x1, ctx["width_px"])]


def _webp(image_rgb) -> bytes:
    ok, buf = cv2.imencode(".webp", cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR),
                           [cv2.IMWRITE_WEBP_QUALITY, 80])
    return buf.tobytes() if ok else b""


def run(ctx: dict) -> dict:
    started = time.perf_counter()
    engines = _get_engines()
    page = ctx["_fitz"]["page"]
    doc = ctx["_fitz"]["doc"]
    page_number = ctx["job"]["page_number"]
    artifacts = []
    engine_used = "PyMuPDF4LLM"

    # ── Texte / Markdown ──
    if ctx["is_native_vector"]:
        try:
            import pymupdf4llm
            content_markdown = pymupdf4llm.to_markdown(doc, pages=[page_number - 1], show_progress=False)
        except Exception:  # noqa: BLE001 — repli extraction brute fitz
            content_markdown = page.get_text("text")
            engine_used = "PyMuPDF"
    else:
        engine_used = "RapidOCR"
        content_markdown = ""
        if engines["ocr"] is not None:
            result, _elapse = engines["ocr"](ctx["binarized_gray"])
            if result:
                content_markdown = "\n".join(str(line[1]) for line in result)
        if not content_markdown:
            content_markdown = ""  # page image sans texte détecté : chunk vide filtré en couche 3

    # ── Artefacts : formules LaTeX inline du markdown (Tier 1) ──
    for i, match in enumerate(_FORMULA_RE.finditer(content_markdown), start=1):
        latex = (match.group(1) or match.group(2) or "").strip()
        if len(latex) < 2:
            continue
        artifacts.append({
            "block_id_ref": "md_f%02d" % i, "domain": "math", "artifact_type": "latex_formula",
            "raw_data": "$%s$" % latex if match.group(2) else "$$%s$$" % latex,
            "raw_binary": None,
            "render_config_json": '{"renderer": "katex", "displayMode": %s, "throwOnError": false}'
                                  % ("true" if match.group(1) else "false"),
            "caption": None, "searchable_text": latex,
            "bounding_box_json": None,
        })

    # ── Artefacts : blocs détectés au triage ──
    for block in ctx["layout_blocks"]:
        bbox_json = '{"x0": %d, "y0": %d, "x1": %d, "y1": %d}' % tuple(block["bbox"])
        if block["type"] == "image":
            crop = _crop(ctx, block["bbox"])
            if crop.size == 0 or min(crop.shape[:2]) < 24:
                continue
            artifacts.append({
                "block_id_ref": block["block_id"], "domain": "general",
                "artifact_type": "dense_illustration", "raw_data": None,
                "raw_binary": _webp(crop),
                "render_config_json": '{"renderer": "openseadragon", "tileSources": null, "showNavigator": true}',
                "caption": "Illustration page %d" % page_number,
                "searchable_text": "illustration figure page %d" % page_number,
                "bounding_box_json": bbox_json,
            })
        elif block["type"] == "formula" and not ctx["is_native_vector"]:
            latex_text = None
            if engines["latex"] is not None:
                try:
                    latex_text, _ = engines["latex"](_webp(_crop(ctx, block["bbox"])))
                except Exception:  # noqa: BLE001
                    latex_text = None
            artifacts.append({
                "block_id_ref": block["block_id"], "domain": "math", "artifact_type": "latex_formula",
                "raw_data": "$$%s$$" % latex_text if latex_text else None,
                "raw_binary": None if latex_text else _webp(_crop(ctx, block["bbox"])),
                "render_config_json": '{"renderer": "katex", "displayMode": true, "throwOnError": false}',
                "caption": None,
                "searchable_text": latex_text or ("formule page %d" % page_number),
                "bounding_box_json": bbox_json,
                "needs_vlm": latex_text is None,  # Tier 2 : transcription VLM en couche 5
            })
        elif block["type"] == "table":
            html = None
            if engines["table"] is not None and not ctx["is_native_vector"]:
                try:
                    html, *_ = engines["table"](_crop(ctx, block["bbox"]))
                except Exception:  # noqa: BLE001
                    html = None
            if html or not ctx["is_native_vector"]:
                artifacts.append({
                    "block_id_ref": block["block_id"], "domain": "general", "artifact_type": "data_table",
                    "raw_data": html, "raw_binary": None if html else _webp(_crop(ctx, block["bbox"])),
                    "render_config_json": '{"renderer": "tanstack-table", "pagination": true, "pageSize": 20}',
                    "caption": "Tableau page %d" % page_number,
                    "searchable_text": (html or "tableau page %d" % page_number)[:500],
                    "bounding_box_json": bbox_json,
                    "needs_vlm": html is None,
                })

    ctx.update(content_markdown=content_markdown, artifacts=artifacts, engine_used=engine_used,
               extraction_latency_ms=int((time.perf_counter() - started) * 1000))
    ctx.setdefault("latencies", {})["layer_2_extract"] = ctx["extraction_latency_ms"]
    return ctx
