# -*- coding: utf-8 -*-
"""RAGDom — Tests unitaires : qualification VLM des artefacts visuels (§12).

Couvre le contrat consolidé multimodal COMPLET :
- parseur JSON robuste (premier {...} équilibré, bruit avant/après, ```json) ;
- mapping type→artifact_type + render_config pour TOUTES les familles ;
- sémantique (demonstration/illustration/exercise_support) fusionnée dans
  render_config_json, y compris pour un dense_illustration conservé ;
- ancrage d'un artefact sans marqueur au \\n\\n le plus proche du ratio y0/height.
Aucun réseau : generate_fn est un stub déterministe.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
# Le qualifier vit dans le moteur (engines/sci-engine/pipeline).
_ENGINE_PIPE = os.path.join(os.path.dirname(__file__), "..", "..",
                            "engines", "sci-engine", "pipeline")
sys.path.insert(0, os.path.abspath(_ENGINE_PIPE))

import artifact_qualifier as q  # noqa: E402
import layer_2_extract as l2  # noqa: E402


def _gen(payload_dict, provider="gemini/test", wrap=""):
    """Fabrique un generate_fn stub renvoyant `payload_dict` sérialisé, avec bruit."""
    body = wrap + json.dumps(payload_dict, ensure_ascii=False) + " (fin)"

    def _fn(prompt, image_b64=None, timeout_s=60):
        assert image_b64  # l'image est toujours transmise en base64
        return {"content": body, "provider": provider}

    return _fn


# ── Parseur robuste ──────────────────────────────────────────────────────────
def test_parser_isolates_first_balanced_object():
    text = 'préambule ```json\n{"type":"other","caption_ar":"x"}\n``` suite {"foo":1}'
    parsed = q._extract_json(text)
    assert parsed == {"type": "other", "caption_ar": "x"}


def test_parser_returns_none_on_garbage():
    assert q._extract_json("aucun json ici") is None
    assert q._extract_json("") is None
    assert q._extract_json(None) is None


def test_parser_handles_braces_inside_strings():
    parsed = q._extract_json('{"code":"if (x) { y() }","lang":"js"}')
    assert parsed["code"] == "if (x) { y() }"


# ── Mapping — toutes les familles ────────────────────────────────────────────
def test_map_geometry_svg():
    fn = _gen({"type": "geometry", "semantic": None, "caption_ar": "مثلث",
               "svg": '<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10"/></svg>'})
    r = q.qualify_visual_artifact(b"webp", fn)
    assert r["artifact_type"] == "geometry_vector"
    rc = json.loads(r["render_config_json"])
    assert rc["renderer"] == "svg" and rc["sanitize"] is True and rc["zoomable"] is True
    assert r["raw_data"].startswith("<svg")


def test_map_drawing_svg():
    fn = _gen({"type": "drawing", "caption_ar": "رسم",
               "svg": '<svg viewBox="0 0 4 4"><path d="M0 0L4 4"/></svg>'})
    assert q.qualify_visual_artifact(b"w", fn)["artifact_type"] == "geometry_vector"


def test_map_operation_latex_array():
    fn = _gen({"type": "operation", "caption_ar": "جمع",
               "latex": r"\begin{array}{r}12\\+\ 9\\\hline 21\end{array}"})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r["artifact_type"] == "matrix"
    rc = json.loads(r["render_config_json"])
    assert rc["renderer"] == "katex" and rc["displayMode"] is True
    assert r["raw_data"].startswith("$$") and r["raw_data"].endswith("$$")


def test_map_matrix_latex():
    fn = _gen({"type": "matrix", "caption_ar": "م",
               "latex": r"\begin{pmatrix}1&0\\0&1\end{pmatrix}"})
    assert q.qualify_visual_artifact(b"w", fn)["artifact_type"] == "matrix"


def test_map_diagram_mermaid_vs_svg():
    fn_m = _gen({"type": "diagram", "caption_ar": "د", "mermaid": "graph TD;A-->B"})
    assert q.qualify_visual_artifact(b"w", fn_m)["artifact_type"] == "flowchart"
    fn_s = _gen({"type": "diagram", "caption_ar": "د",
                 "svg": '<svg viewBox="0 0 3 3"><rect/></svg>'})
    assert q.qualify_visual_artifact(b"w", fn_s)["artifact_type"] == "geometry_vector"


def test_map_flowchart_mermaid():
    fn = _gen({"type": "flowchart", "caption_ar": "مخطط", "mermaid": "graph LR;X-->Y"})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r["artifact_type"] == "flowchart"
    assert json.loads(r["render_config_json"])["renderer"] == "mermaid"


def test_map_plot_plotly():
    fn = _gen({"type": "plot", "caption_ar": "منحنى",
               "plotly_json": {"data": [{"x": [1, 2], "y": [3, 4], "type": "scatter"}],
                               "layout": {"title": "t"}}})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r["artifact_type"] == "signal_waveform"
    rc = json.loads(r["render_config_json"])
    assert rc["renderer"] == "plotly" and rc["type"] == "scatter"
    assert json.loads(r["raw_data"])["data"]  # plotly json valide et non vide


def test_map_plot_rejects_empty_data():
    fn = _gen({"type": "plot", "caption_ar": "x", "plotly_json": {"data": []}})
    # data vide → non structurable → dense conservé (artifact_type None) mais caption gardée.
    r = q.qualify_visual_artifact(b"w", fn)
    assert r is None or r["artifact_type"] is None


def test_map_table_markdown():
    fn = _gen({"type": "table", "caption_ar": "ج",
               "markdown": "| a | b |\n|---|---|\n| 1 | 2 |"})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r["artifact_type"] == "data_table"
    assert json.loads(r["render_config_json"])["renderer"] == "tanstack-table"


def test_map_chemistry_smiles():
    fn = _gen({"type": "chemistry", "caption_ar": "كحول", "smiles": "CCO"})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r["artifact_type"] == "smiles_chem"
    assert json.loads(r["render_config_json"])["renderer"] == "ketcher"
    assert r["raw_data"] == "CCO"


def test_map_code_with_lang():
    fn = _gen({"type": "code", "caption_ar": "شفرة", "code": "print('hi')", "lang": "python"})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r["artifact_type"] == "code_snippet"
    rc = json.loads(r["render_config_json"])
    assert rc["renderer"] == "shiki" and rc["lang"] == "python"


def test_map_code_defaults_lang_text():
    fn = _gen({"type": "code", "caption_ar": "x", "code": "echo hi"})
    r = q.qualify_visual_artifact(b"w", fn)
    assert json.loads(r["render_config_json"])["lang"] == "text"


# ── Familles PARAMÉTRIQUES (V5, extension §12) ───────────────────────────────
def test_map_number_line_valid():
    fn = _gen({"type": "number_line", "semantic": "exercise_support", "caption_ar": "مستقيم",
               "number_line": {"min": 0, "max": 4, "step": 1,
                               "points": [{"label": "A", "value": 2.4},
                                          {"label": "B", "value": 1.0}],
                               "highlight_segments": [[1.6, 2.0]]}})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r["artifact_type"] == "number_line"
    rc = json.loads(r["render_config_json"])
    assert rc["renderer"] == "param-number-line" and rc["semantic"] == "exercise_support"
    data = json.loads(r["raw_data"])  # raw_data = paramètres SÉRIALISÉS
    assert data["min"] == 0 and data["max"] == 4 and data["step"] == 1
    assert {p["label"] for p in data["points"]} == {"A", "B"}
    assert data["highlight_segments"] == [[1.6, 2.0]]


def test_map_number_line_filters_out_of_range_points_and_bad_segments():
    fn = _gen({"type": "number_line", "caption_ar": "م",
               "number_line": {"min": 0, "max": 10, "step": 2,
                               "points": [{"label": "A", "value": 3},
                                          {"label": "HORS", "value": 99}],  # hors [0,10] → filtré
                               "highlight_segments": [[8, 3], [2, 4]]}})  # 1re paire mal ordonnée
    r = q.qualify_visual_artifact(b"w", fn)
    assert r["artifact_type"] == "number_line"
    data = json.loads(r["raw_data"])
    assert [p["label"] for p in data["points"]] == ["A"]  # le point hors plage est retiré
    assert data["highlight_segments"] == [[2, 4]]         # seule la paire valide survit


def test_map_number_line_invalid_min_max_falls_back():
    # min >= max → droite non structurable → repli (dense conservé ou None).
    fn = _gen({"type": "number_line", "caption_ar": "x",
               "number_line": {"min": 5, "max": 2, "step": 1,
                               "points": [{"label": "A", "value": 3}]}})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r is None or r["artifact_type"] is None


def test_map_number_line_invalid_step_falls_back():
    fn = _gen({"type": "number_line", "caption_ar": "x",
               "number_line": {"min": 0, "max": 4, "step": 0,  # step <= 0 → invalide
                               "points": [{"label": "A", "value": 2}]}})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r is None or r["artifact_type"] is None


def test_map_number_line_no_valid_point_falls_back():
    fn = _gen({"type": "number_line", "caption_ar": "x",
               "number_line": {"min": 0, "max": 4, "step": 1, "points": []}})  # aucun point
    r = q.qualify_visual_artifact(b"w", fn)
    assert r is None or r["artifact_type"] is None


def test_map_decimal_grid_valid():
    fn = _gen({"type": "decimal_grid", "semantic": "illustration", "caption_ar": "شبكة",
               "decimal_grid": {"rows": 10, "cols": 10,
                                "cells": [{"count": 30, "color": "blue", "label": "3/10"},
                                          {"count": 5, "color": "red", "label": "5/100"}]}})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r["artifact_type"] == "decimal_grid"
    rc = json.loads(r["render_config_json"])
    assert rc["renderer"] == "param-decimal-grid" and rc["semantic"] == "illustration"
    data = json.loads(r["raw_data"])
    assert data["rows"] == 10 and data["cols"] == 10
    assert data["cells"][0] == {"count": 30, "color": "blue", "label": "3/10"}


def test_map_decimal_grid_filters_invalid_cells():
    # count > capacité (5) et couleur hors palette → cellules rejetées ; 1 valide reste.
    fn = _gen({"type": "decimal_grid", "caption_ar": "ش",
               "decimal_grid": {"rows": 2, "cols": 2,
                                "cells": [{"count": 99, "color": "blue"},   # > 4 → rejet
                                          {"count": 2, "color": "pink"},    # couleur invalide
                                          {"count": 3, "color": "green"}]}})  # valide
    r = q.qualify_visual_artifact(b"w", fn)
    assert r["artifact_type"] == "decimal_grid"
    data = json.loads(r["raw_data"])
    assert data["cells"] == [{"count": 3, "color": "green"}]


def test_map_decimal_grid_invalid_dims_falls_back():
    # rows hors [1,20] → grille non structurable → repli.
    fn = _gen({"type": "decimal_grid", "caption_ar": "x",
               "decimal_grid": {"rows": 50, "cols": 10,
                                "cells": [{"count": 3, "color": "blue"}]}})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r is None or r["artifact_type"] is None


def test_map_decimal_grid_no_valid_cell_falls_back():
    fn = _gen({"type": "decimal_grid", "caption_ar": "x",
               "decimal_grid": {"rows": 10, "cols": 10,
                                "cells": [{"count": -1, "color": "blue"}]}})  # count < 0
    r = q.qualify_visual_artifact(b"w", fn)
    assert r is None or r["artifact_type"] is None


def test_param_family_invalid_but_caption_keeps_dense():
    # Paramètres invalides MAIS caption/sémantique utiles → dense conservé, caption gardée,
    # sémantique fusionnée (repli exactement comme photo/other).
    fn = _gen({"type": "number_line", "semantic": "illustration", "caption_ar": "صورة",
               "number_line": {"min": 0, "max": 0, "step": 1, "points": []}})  # min==max invalide
    r = q.qualify_visual_artifact(b"w", fn)
    assert r is not None and r["artifact_type"] is None
    assert r["caption"] == "صورة"
    assert json.loads(r["render_config_json"])["semantic"] == "illustration"


def test_photo_keeps_dense_but_updates_caption_and_semantic():
    fn = _gen({"type": "photo", "semantic": "illustration", "caption_ar": "صورة واقعية"})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r is not None and r["artifact_type"] is None  # reste dense_illustration
    assert r["caption"] == "صورة واقعية"
    rc = json.loads(r["render_config_json"])
    assert rc["renderer"] == "openseadragon" and rc["semantic"] == "illustration"


def test_invalid_svg_over_budget_not_structured():
    huge = "<svg>" + ("x" * (200 * 1024 + 10)) + "</svg>"
    fn = _gen({"type": "geometry", "caption_ar": "c", "svg": huge})
    r = q.qualify_visual_artifact(b"w", fn)
    assert r is None or r["artifact_type"] is None  # SVG hors gabarit → non structuré


def test_returns_none_on_unparseable_content():
    def _fn(prompt, image_b64=None, timeout_s=60):
        return {"content": "désolé, aucune figure", "provider": "p"}
    assert q.qualify_visual_artifact(b"w", _fn) is None


def test_generate_exception_never_raises():
    def _boom(prompt, image_b64=None, timeout_s=60):
        raise RuntimeError("VLM down")
    assert q.qualify_visual_artifact(b"w", _boom) is None


# ── Sémantique fusionnée quel que soit le type ───────────────────────────────
def test_semantic_demonstration_fused_in_render_config():
    fn = _gen({"type": "geometry", "semantic": "demonstration", "caption_ar": "برهان",
               "svg": '<svg viewBox="0 0 2 2"><line/></svg>'})
    r = q.qualify_visual_artifact(b"w", fn)
    assert json.loads(r["render_config_json"])["semantic"] == "demonstration"


def test_semantic_ignored_when_invalid_value():
    fn = _gen({"type": "table", "semantic": "bogus", "caption_ar": "x",
               "markdown": "| a |\n|---|\n| 1 |"})
    r = q.qualify_visual_artifact(b"w", fn)
    assert "semantic" not in json.loads(r["render_config_json"])


# ── Ancrage au ratio (layer_2) ───────────────────────────────────────────────
def test_anchor_markerless_artifact_at_closest_ratio_paragraph():
    # 4 paragraphes, height 400. y0=300 → ratio 0.75 → près du 3e séparateur.
    md = "P0 haut\n\nP1\n\nP2 milieu\n\nP3 bas"
    art = {"id": "abc-123", "caption": "fig", "raw_binary": b"x",
           "_bbox": (0, 300, 50, 350), "_page_w": 100}
    out = l2._anchor_artifacts(md, [art], height_px=400)
    assert "![fig](asset://artifacts/abc-123)" in out
    # L'ancre est placée dans la moitié basse (après "P2 milieu"), pas au tout début.
    assert out.index("asset://artifacts/abc-123") > out.index("P2 milieu")


def test_anchor_replaces_figure_marker_in_reading_order():
    md = "intro\n\n[[FIGURE:1]]\n\nmilieu\n\n[[FIGURE:2]]\n\nfin"
    a = {"id": "id-a", "caption": "A", "raw_binary": b"x", "_bbox": (0, 10, 5, 20), "_page_w": 100}
    b = {"id": "id-b", "caption": "B", "raw_binary": b"x", "_bbox": (0, 200, 5, 210), "_page_w": 100}
    out = l2._anchor_artifacts(md, [a, b], height_px=400)
    assert "![A](asset://artifacts/id-a)" in out
    assert "![B](asset://artifacts/id-b)" in out
    assert "[[FIGURE:" not in out  # tous les marqueurs consommés
    assert out.index("id-a") < out.index("id-b")  # ordre de lecture (y0 croissant)


def test_anchor_removes_excess_markers():
    md = "a\n\n[[FIGURE:1]]\n\nb\n\n[[FIGURE:2]]\n\nc"
    only = {"id": "solo", "caption": "S", "raw_binary": b"x", "_bbox": (0, 5, 5, 9), "_page_w": 100}
    out = l2._anchor_artifacts(md, [only], height_px=400)
    assert "![S](asset://artifacts/solo)" in out
    assert "[[FIGURE:" not in out  # le marqueur excédentaire est supprimé


def test_anchor_skips_full_page_frames():
    md = "texte\n\nplus de texte"
    frame = {"id": "big", "caption": "cadre", "raw_binary": b"x",
             "_bbox": (0, 0, 100, 100), "_page_w": 100}  # 100 % de la page
    out = l2._anchor_artifacts(md, [frame], height_px=100)
    assert "asset://artifacts/big" not in out  # cadre >70 % : jamais ancré
