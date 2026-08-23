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
    if (os.environ.get("RAGDOM_OFFLINE", "false").lower() == "true"
            or os.environ.get("RAGDOM_LOW_MEMORY", "false").lower() == "true"):
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
    # page_end CALCULÉ (V4.3, correctif (B) côté natif) : fin d'une entrée de niveau N
    # = (page_start du prochain signet de niveau <= N ET commençant plus loin) - 1,
    # bornée au document. Sans ce calcul les entrées natives restaient à page_end=NULL,
    # forçant l'UI et les agrégats SQL (page-scans) à un COALESCE à 100000 → un chapitre
    # « débordait » sur tout le reste du document (mêmes plages incohérentes que (B)).
    toc_entries = []
    if ctx["job"]["page_number"] == 1:
        raw_toc = doc.get_toc() or []
        try:
            total_pages = int(ctx.get("document", {}).get("total_pages") or doc.page_count)
        except Exception:  # noqa: BLE001 — page_count indisponible : borne repli
            total_pages = None
        parsed = [{"level": int(lvl), "title": str(title).strip(), "page_start": int(ps)}
                  for lvl, title, ps in raw_toc]
        for i, entry in enumerate(parsed):
            nxt = next((n["page_start"] for n in parsed[i + 1:]
                        if n["level"] <= entry["level"] and n["page_start"] > entry["page_start"]), None)
            if nxt is not None:
                page_end = nxt - 1
            else:
                page_end = total_pages if total_pages else entry["page_start"]
            # Bornage défensif : jamais de plage inversée ni au-delà du document.
            upper = total_pages if total_pages else page_end
            page_end = max(entry["page_start"], min(page_end, upper))
            toc_entries.append({"level": entry["level"], "title": entry["title"],
                                "page_start": entry["page_start"], "page_end": page_end})

    ctx.update(layout_blocks=layout_blocks, toc_entries=toc_entries,
               triage_latency_ms=int((time.perf_counter() - started) * 1000))
    ctx.setdefault("latencies", {})["layer_1_triage"] = ctx["triage_latency_ms"]
    return ctx
