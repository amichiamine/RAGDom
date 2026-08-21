# -*- coding: utf-8 -*-
"""sci-engine — Couche 4 : Linter déterministe < 5ms (Skills §5.1, zéro IA).

LaTeX (accolades, $, environnements), tableaux (colonnes), SVG (XML), Unicode
(ratio � > 5%). Produit le ValidationResult (tech_specs §2.4). is_valid ou
warnings seuls → skip de la Couche 5 (économie de quota VLM). Python 3.9+.
"""
import re
import time
import xml.etree.ElementTree as ET

_BEGIN_RE = re.compile(r"\\begin\{(\w+)\}")
_END_RE = re.compile(r"\\end\{(\w+)\}")


def _lint_latex(latex: str):
    errors = []
    if latex.count("{") != latex.count("}"):
        errors.append(("UNBALANCED_LATEX", "Accolades non appariées (%d ouvrantes / %d fermantes)"
                       % (latex.count("{"), latex.count("}")), "ERROR"))
    stripped = latex.replace("$$", "")
    if stripped.count("$") % 2 == 1:
        errors.append(("UNBALANCED_LATEX", "Délimiteur $ non apparié", "ERROR"))
    begins, ends = _BEGIN_RE.findall(latex), _END_RE.findall(latex)
    for env in begins:
        if begins.count(env) != ends.count(env):
            errors.append(("UNBALANCED_LATEX", "Missing \\end{%s}" % env, "ERROR"))
            break
    return errors


def _lint_table_markdown(markdown: str):
    errors = []
    rows = [line for line in markdown.splitlines() if line.strip().startswith("|")]
    if len(rows) >= 2:
        widths = {row.strip().strip("|").count("|") for row in rows}
        if len(widths) > 1:
            errors.append(("INVALID_TABLE_DIMENSIONS",
                           "Lignes de tableau à largeurs différentes : %s" % sorted(widths), "WARNING"))
    return errors


def _lint_svg(svg: str):
    try:
        ET.fromstring(svg)
        return []
    except ET.ParseError as exc:
        return [("MALFORMED_SVG", str(exc), "ERROR")]


def _lint_unicode(text: str):
    if not text:
        return []
    ratio = text.count("�") / len(text)
    if ratio > 0.05:
        return [("UNICODE_NOISE", "Ratio de caractères corrompus : %.1f%%" % (ratio * 100), "ERROR")]
    return []


def run(ctx: dict) -> dict:
    started = time.perf_counter()
    errors = []

    for chunk in ctx.get("chunks", []):
        for code, details, severity in (_lint_unicode(chunk["content_markdown"])
                                        + _lint_table_markdown(chunk["content_markdown"])):
            errors.append({"block_id_ref": "chunk_%d" % chunk["chunk_index"],
                           "error_type": code, "details": details, "severity": severity})

    for artifact in ctx.get("artifacts", []):
        raw = artifact.get("raw_data") or ""
        checks = []
        if artifact["artifact_type"] in ("latex_formula", "matrix", "tensor") and raw:
            checks = _lint_latex(raw)
        elif artifact["artifact_type"] in ("geometry_vector", "circuit_schematic", "technical_blueprint") and raw:
            checks = _lint_svg(raw)
        checks += _lint_unicode(raw)
        for code, details, severity in checks:
            errors.append({"block_id_ref": artifact["block_id_ref"],
                           "error_type": code, "details": details, "severity": severity})
        if artifact.get("needs_vlm"):  # extraction Tier 1 indisponible → candidat VLM (Tier 2)
            errors.append({"block_id_ref": artifact["block_id_ref"], "error_type": "NEEDS_VLM",
                           "details": "Extraction native indisponible pour ce bloc", "severity": "ERROR"})

    has_error = any(e["severity"] == "ERROR" for e in errors)
    ctx["lint"] = {"is_valid": not errors, "errors": errors,
                   "lint_latency_ms": int((time.perf_counter() - started) * 1000)}
    ctx.setdefault("latencies", {})["layer_4_lint"] = ctx["lint"]["lint_latency_ms"]
    if not has_error:  # valide ou WARNINGs seuls → VLM non invoqué (tech_specs §2.4)
        ctx["skip_vlm"] = True
    return ctx
