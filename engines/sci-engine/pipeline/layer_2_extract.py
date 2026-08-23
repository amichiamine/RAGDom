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
import uuid

import cv2

_engines = {"tried": set(), "ocr": None, "latex": None, "table": None}
_FORMULA_RE = re.compile(r"\$\$(.+?)\$\$|\$([^$\n]{2,200})\$", re.S)
_FIGURE_MARKER_RE = re.compile(r"^[ \t]*\[\[FIGURE:(\d+)\]\][ \t]*$", re.M)
# Seuil « cadre quasi-pleine-page » : au-delà, un crop n'est NI qualifié NI ancré
# (c'est le fond de page, pas une sous-figure). Cohérent avec la route de requalif.
_AREA_RATIO_MAX = 0.70


def _get_engines(need_ocr=False, need_latex=False, need_table=False):
    """Load only engines required by this page; never preload the full ONNX stack."""
    tried = _engines["tried"]
    offline = os.environ.get("RAGDOM_OFFLINE", "false").lower() == "true"
    low_memory = os.environ.get("RAGDOM_LOW_MEMORY", "false").lower() == "true"
    allow_low_memory_ocr = os.environ.get("RAGDOM_LOW_MEMORY_OCR", "true").lower() == "true"
    if need_ocr and (not low_memory or allow_low_memory_ocr) and "ocr" not in tried:
        tried.add("ocr")
        try:
            from rapidocr_onnxruntime import RapidOCR  # modèles PP-OCRv4 embarqués (pip)
            _engines["ocr"] = RapidOCR()
        except Exception:  # noqa: BLE001
            _engines["ocr"] = None
    # LaTeX/table models are optional refiners. On 512 Mo they are deliberately
    # skipped; the crop is preserved for later targeted requalification.
    if need_latex and not offline and not low_memory and "latex" not in tried:
        tried.add("latex")
        try:
            from rapid_latex_ocr import LatexOCR
            _engines["latex"] = LatexOCR()
        except Exception:  # noqa: BLE001 — Tier 2 (VLM) prendra le relais
            _engines["latex"] = None
    if need_table and not offline and not low_memory and "table" not in tried:
        tried.add("table")
        try:
            from rapid_table import RapidTable
            _engines["table"] = RapidTable()
        except Exception:  # noqa: BLE001
            _engines["table"] = None
    return _engines




_VOWELLESS_RE = re.compile(r"[A-Za-z]{4,}")


def _looks_unreadable(text: str) -> bool:
    """Gate qualité GÉNÉRIQUE : vide/court, soupe latine sans voyelles, ou
    poussière de jetons ultra-courts (OCR inadapté à l'écriture, police
    non-Unicode). Ne se déclenche jamais sur du texte arabe/latin sain."""
    t = text.strip()
    if len(t) < 20:
        return True
    letters = [ch for ch in t if ch.isalpha()]
    if not letters:
        return True
    arabic = sum(1 for ch in letters if "\u0600" <= ch <= "\u06ff")
    if arabic / len(letters) >= 0.3:
        return False  # texte arabe substantiel : lisible
    tokens = re.findall(r"[A-Za-z\u00c0-\u024f]+", t)
    if len(tokens) < 6:
        return False
    short_ratio = sum(1 for w in tokens if len(w) <= 3) / len(tokens)
    long_words = [w for w in tokens if len(w) >= 4]
    vowelless = (sum(1 for w in long_words if not re.search(r"[aeiouyAEIOUY]", w))
                 / len(long_words)) if long_words else 0.0
    return short_ratio > 0.55 or vowelless > 0.4


_VLM_OCR_PROMPT = (
    "Transcris INTÉGRALEMENT cette page de manuel scolaire en Markdown fidèle :\n"
    "- titres et sous-titres en ## / ###, texte arabe EXACT (sens RTL préservé) ;\n"
    "- toute formule ou expression mathématique en LaTeX ($...$ ou $$...$$) ;\n"
    "- numéros d'exercices/activités conservés tels quels ;\n"
    "- tableaux en Markdown ; ignore les décorations purement graphiques ;\n"
    "- à l'emplacement EXACT de CHAQUE figure, schéma, graphique, opération posée "
    "ou DÉMONSTRATION VISUELLE (dans l'ordre de lecture RTL), insère un marqueur "
    "sur une ligne SEULE : [[FIGURE:n]] (n = 1, 2, 3… incrémenté par apparition). "
    "N'écris RIEN d'autre sur la ligne du marqueur.\n"
    "Retourne UNIQUEMENT la transcription, sans commentaire ni préambule.")


def _maybe_vlm_page_ocr(ctx: dict, current_text: str):
    """Tier 2 (contrat D3-B) : OCR de PAGE ENTIÈRE par VLM quand l'extraction
    Tier 1 est illisible. Rotation de clés/providers gérée par le noyau
    (llm.key_manager.generate) ; aucun provider joignable → None (repli Tier 1,
    le pipeline ne s'arrête jamais ici). Désactivable : RAGDOM_VLM_PAGE_OCR=false."""
    vlm_mode = os.environ.get("RAGDOM_VLM_PAGE_OCR", "auto").lower()
    if vlm_mode == "false":
        return None
    if (os.environ.get("RAGDOM_LOW_MEMORY", "false").lower() == "true"
            and vlm_mode != "true"):
        return None  # 512 Mo : évite l'image pleine page/base64 ; opt-in explicite seulement
    if not _looks_unreadable(current_text):
        return None
    try:
        import base64
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend"))
        from llm.key_manager import generate
    except Exception:  # noqa: BLE001
        return None
    image = ctx.get("restored_rgb")
    if image is None:
        return None
    webp = _webp(image)
    if not webp:
        return None
    result = generate(_VLM_OCR_PROMPT, image_b64=base64.b64encode(webp).decode("ascii"),
                      timeout_s=90)
    if result and result.get("content") and len(result["content"].strip()) > 20:
        ctx.setdefault("vlm", {})["page_ocr_provider"] = result.get("provider")
        return result["content"].strip()
    return None


def _crop(ctx, bbox):
    x0, y0, x1, y1 = [max(0, int(v)) for v in bbox]
    return ctx["restored_rgb"][y0:min(y1, ctx["height_px"]), x0:min(x1, ctx["width_px"])]


def _webp(image_rgb) -> bytes:
    ok, buf = cv2.imencode(".webp", cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR),
                           [cv2.IMWRITE_WEBP_QUALITY, 80])
    return buf.tobytes() if ok else b""


def _area_ratio(bbox, width_px, height_px) -> float:
    """Surface du crop / surface de la page (0-1). 1.0 si non calculable (→ traité
    comme cadre pleine page, donc ni qualifié ni ancré)."""
    if not width_px or not height_px:
        return 1.0
    x0, y0, x1, y1 = bbox
    w, h = (x1 - x0), (y1 - y0)
    page = float(width_px) * float(height_px)
    if w <= 0 or h <= 0 or page <= 0:
        return 1.0
    return (w * h) / page


def _vlm_qualifier():
    """Récupère (qualify_visual_artifact, generate) du moteur+noyau, ou (None, None).

    Désactivable : RAGDOM_VLM_ARTIFACTS=false (défaut « auto » = activé). Ne lève
    jamais : import indisponible → pas de qualification (repli dense_illustration)."""
    if os.environ.get("RAGDOM_VLM_ARTIFACTS", "auto").lower() == "false":
        return None, None
    try:
        from artifact_qualifier import qualify_visual_artifact
    except Exception:  # noqa: BLE001 — module absent : pas de qualification
        try:
            import sys
            sys.path.insert(0, os.path.dirname(__file__))
            from artifact_qualifier import qualify_visual_artifact
        except Exception:  # noqa: BLE001
            return None, None
    try:
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend"))
        from llm.key_manager import generate
    except Exception:  # noqa: BLE001 — noyau injoignable : pas de qualification
        return None, None
    return qualify_visual_artifact, generate


def _apply_qualification(artifact: dict, qualified: dict) -> None:
    """Applique EN PLACE le résultat VLM à un artefact (raw_binary JAMAIS touché).

    Re-typage complet si artifact_type fourni ; sinon simple mise à jour de la
    légende + fusion de la sémantique dans render_config_json (dense conservé)."""
    if qualified.get("artifact_type"):
        artifact["artifact_type"] = qualified["artifact_type"]
        artifact["raw_data"] = qualified["raw_data"]
        artifact["render_config_json"] = qualified["render_config_json"]
    elif qualified.get("render_config_json"):
        artifact["render_config_json"] = qualified["render_config_json"]
    if qualified.get("caption"):
        artifact["caption"] = qualified["caption"]
    if qualified.get("searchable_text"):
        artifact["searchable_text"] = qualified["searchable_text"][:500]


def _anchor_artifacts(markdown: str, artifacts: list, height_px: int) -> str:
    """Ancre les artefacts VISUELS dans content_markdown à leur vraie position.

    (a) Les artefacts ancrables (raw_binary présent, bbox connue, ≤70 % de page)
        sont triés par (y0, x0) — ordre de lecture.
    (b) Les marqueurs [[FIGURE:n]] (seuls sur leur ligne) sont remplacés dans
        l'ordre par `![{caption}](asset://artifacts/{id})`. Les marqueurs
        excédentaires sont supprimés.
    (c) Un artefact restant sans marqueur est ancré au \\n\\n le plus proche du
        ratio y0/height_px (insertion d'une ligne image)."""
    anchorable = []
    for art in artifacts:
        if art.get("raw_binary") is None:
            continue
        box = art.get("_bbox")
        if not box:
            continue
        if _area_ratio(box, art.get("_page_w"), height_px) > _AREA_RATIO_MAX:
            continue
        anchorable.append(art)
    anchorable.sort(key=lambda a: (a["_bbox"][1], a["_bbox"][0]))

    def _img(art):
        return "![%s](asset://artifacts/%s)" % (art.get("caption") or "", art["id"])

    # (b) Remplacement des marqueurs présents, dans l'ordre.
    remaining = list(anchorable)
    used = []

    def _sub(match):
        if remaining:
            art = remaining.pop(0)
            used.append(art)
            return _img(art)
        return ""  # marqueur excédentaire → supprimé

    markdown = _FIGURE_MARKER_RE.sub(_sub, markdown)

    # (c) Artefacts sans marqueur : ancrage au \n\n le plus proche du ratio.
    if remaining:
        # Positions des séparateurs de paragraphe (offset de chaque \n\n).
        seps = [m.start() for m in re.finditer(r"\n\n+", markdown)]
        total = max(1, len(markdown))
        insertions = []  # (offset, texte)
        for art in remaining:
            ratio = 0.0
            if height_px:
                ratio = max(0.0, min(1.0, art["_bbox"][1] / float(height_px)))
            if seps:
                target = ratio * total
                offset = min(seps, key=lambda s: abs(s - target))
            else:
                offset = len(markdown)  # aucun \n\n : append en fin
            insertions.append((offset, "\n\n%s\n\n" % _img(art)))
        # Insertions de la fin vers le début pour préserver les offsets.
        for offset, text in sorted(insertions, key=lambda t: t[0], reverse=True):
            markdown = markdown[:offset] + text + markdown[offset:]

    return markdown


def run(ctx: dict) -> dict:
    started = time.perf_counter()
    block_types = {block.get("type") for block in ctx.get("layout_blocks", [])}
    engines = _get_engines(need_ocr=not ctx["is_native_vector"],
                           need_latex=(not ctx["is_native_vector"] and "formula" in block_types),
                           need_table=(not ctx["is_native_vector"] and "table" in block_types))
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
            if os.environ.get("RAGDOM_LOW_MEMORY", "false").lower() == "true":
                engine_used = "ImageOnly-LowMemory"

    # ── Tier 2 (D3-B) : OCR de page entière par VLM — page SCANNÉE : toujours
    # tenté (RapidOCR sans modèle adapté = repli hors-ligne) ; page native :
    # seulement si le texte extrait est illisible (police non-Unicode).
    force_vlm = not ctx["is_native_vector"]
    vlm_text = _maybe_vlm_page_ocr(ctx, "" if force_vlm else content_markdown)
    if vlm_text:
        content_markdown = vlm_text
        engine_used = "VLM-OCR"

    # ── Artefacts : formules LaTeX inline du markdown (Tier 1) ──
    for i, match in enumerate(_FORMULA_RE.finditer(content_markdown), start=1):
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

    # ── Artefacts : blocs détectés au triage ──
    for block in ctx["layout_blocks"]:
        bbox_json = '{"x0": %d, "y0": %d, "x1": %d, "y1": %d}' % tuple(block["bbox"])
        if block["type"] == "image":
            crop = _crop(ctx, block["bbox"])
            if crop.size == 0 or min(crop.shape[:2]) < 24:
                continue
            artifacts.append({
                "id": str(uuid.uuid4()),
                "block_id_ref": block["block_id"], "domain": "general",
                "artifact_type": "dense_illustration", "raw_data": None,
                "raw_binary": _webp(crop),
                "render_config_json": '{"renderer": "openseadragon", "tileSources": null, "showNavigator": true}',
                "caption": "Illustration page %d" % page_number,
                "searchable_text": "illustration figure page %d" % page_number,
                "bounding_box_json": bbox_json,
                "_bbox": tuple(block["bbox"]), "_page_w": ctx["width_px"],
            })
        elif block["type"] == "formula" and not ctx["is_native_vector"]:
            latex_text = None
            if engines["latex"] is not None:
                try:
                    latex_text, _ = engines["latex"](_webp(_crop(ctx, block["bbox"])))
                except Exception:  # noqa: BLE001
                    latex_text = None
            artifacts.append({
                "id": str(uuid.uuid4()),
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
                    "id": str(uuid.uuid4()),
                    "block_id_ref": block["block_id"], "domain": "general", "artifact_type": "data_table",
                    "raw_data": html, "raw_binary": None if html else _webp(_crop(ctx, block["bbox"])),
                    "render_config_json": '{"renderer": "tanstack-table", "pagination": true, "pageSize": 20}',
                    "caption": "Tableau page %d" % page_number,
                    "searchable_text": (html or "tableau page %d" % page_number)[:500],
                    "bounding_box_json": bbox_json,
                    "needs_vlm": html is None,
                })

    # ── Qualification VLM des découpes visuelles (§12) — contrat consolidé ──
    # Chaque vraie sous-figure (crop WebP, ≤70 % de page) est RE-TYPÉE + STRUCTURÉE
    # + SÉMANTIQUE. raw_binary JAMAIS supprimé. Échec / photo → dense_illustration
    # conservé. Le pipeline NE S'ARRÊTE JAMAIS ici.
    qualify_fn, generate_fn = _vlm_qualifier()
    qualified_count = 0
    if qualify_fn is not None and generate_fn is not None:
        timeout_s = int(ctx.get("config", {}).get("vlm_timeout_seconds", 30))
        for art in artifacts:
            if art.get("raw_binary") is None or art.get("artifact_type") != "dense_illustration":
                continue
            box = art.get("_bbox")
            if not box or _area_ratio(box, art.get("_page_w"), ctx["height_px"]) > _AREA_RATIO_MAX:
                continue  # cadre quasi-pleine-page : ni qualifié ni ancré (c)
            try:
                result = qualify_fn(art["raw_binary"], generate_fn, timeout_s=timeout_s)
            except Exception:  # noqa: BLE001 — jamais d'arrêt
                result = None
            if result:
                _apply_qualification(art, result)
                if result.get("artifact_type"):
                    qualified_count += 1
    ctx.setdefault("vlm", {})["artifacts_qualified"] = qualified_count

    # ── Ancrage : chaque artefact visuel à sa vraie position dans le markdown ──
    content_markdown = _anchor_artifacts(content_markdown, artifacts, ctx["height_px"])

    # Champs internes d'ancrage retirés avant persistance (non colonnes).
    for art in artifacts:
        art.pop("_bbox", None)
        art.pop("_page_w", None)

    ctx.update(content_markdown=content_markdown, artifacts=artifacts, engine_used=engine_used,
               extraction_latency_ms=int((time.perf_counter() - started) * 1000))
    ctx.setdefault("latencies", {})["layer_2_extract"] = ctx["extraction_latency_ms"]
    return ctx
