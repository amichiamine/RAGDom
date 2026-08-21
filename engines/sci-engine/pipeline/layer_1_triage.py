# -*- coding: utf-8 -*-
"""sci-engine — Couche 1 : Triage, BBoxes & TOC (tech_specs §2.2).

Natif vectoriel → blocs via page.get_text("dict") (précis, zéro modèle).
Scan → rapid-layout (ONNX) si disponible, sinon bloc pleine page (repli
documenté ; RAGDOM_OFFLINE=true saute le chargement des modèles). TOC :
outlines natifs fitz.get_toc() extraits une seule fois (page 1). Python 3.9+.
"""
import os
import time

_layout_engine = {"tried": False, "engine": None}


def _get_layout_engine():
    """rapid-layout, initialisé une seule fois par processus (Cycle de Vie des Moteurs)."""
    if _layout_engine["tried"]:
        return _layout_engine["engine"]
    _layout_engine["tried"] = True
    if os.environ.get("RAGDOM_OFFLINE", "false").lower() == "true":
        return None
    try:
        from rapid_layout import RapidLayout
        _layout_engine["engine"] = RapidLayout()
    except Exception:  # noqa: BLE001 — modèle indisponible => repli pleine page
        _layout_engine["engine"] = None
    return _layout_engine["engine"]


def run(ctx: dict) -> dict:
    started = time.perf_counter()
    page = ctx["_fitz"]["page"]
    doc = ctx["_fitz"]["doc"]
    scale = 300.0 / 72.0  # coordonnées PDF pt → pixels 300 DPI (référentiel page_scans)

    layout_blocks = []
    if ctx["is_native_vector"]:
        raw = page.get_text("dict")
        idx = 0
        for block in raw.get("blocks", []):
            idx += 1
            x0, y0, x1, y1 = [int(v * scale) for v in block["bbox"]]
            btype = "image" if block.get("type") == 1 else "text"
            layout_blocks.append({"block_id": "b_%02d" % idx, "type": btype,
                                  "bbox": [x0, y0, x1, y1], "confidence": 0.99})
    else:
        engine = _get_layout_engine()
        if engine is not None:
            try:
                boxes, scores, classes, _elapse = engine(ctx["restored_rgb"])
                for i, (box, score, cls) in enumerate(zip(boxes, scores, classes), start=1):
                    x0, y0, x1, y1 = [int(v) for v in box[:4]] if len(box) >= 4 else [0, 0, ctx["width_px"], ctx["height_px"]]
                    kind = str(cls).lower()
                    btype = ("table" if "table" in kind else
                             "formula" if "equation" in kind or "formula" in kind else
                             "image" if "figure" in kind or "image" in kind else "text")
                    layout_blocks.append({"block_id": "b_%02d" % i, "type": btype,
                                          "bbox": [x0, y0, x1, y1], "confidence": float(score)})
            except Exception:  # noqa: BLE001 — inférence en échec => repli
                layout_blocks = []
        if not layout_blocks:  # repli : un bloc texte pleine page (OCR intégral en couche 2)
            layout_blocks = [{"block_id": "b_01", "type": "text",
                              "bbox": [0, 0, ctx["width_px"], ctx["height_px"]], "confidence": 0.5}]

    # TOC : outlines natifs, extraits une fois par document (au passage de la page 1).
    toc_entries = []
    if ctx["job"]["page_number"] == 1:
        for level, title, page_start in (doc.get_toc() or []):
            toc_entries.append({"level": int(level), "title": str(title).strip(),
                                "page_start": int(page_start), "page_end": None})

    ctx.update(layout_blocks=layout_blocks, toc_entries=toc_entries,
               triage_latency_ms=int((time.perf_counter() - started) * 1000))
    ctx.setdefault("latencies", {})["layer_1_triage"] = ctx["triage_latency_ms"]
    return ctx
