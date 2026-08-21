# -*- coding: utf-8 -*-
"""sci-engine — Couche 6 : Métrologie & Télémétrie (tech_specs, table processing_benchmarks).

Agrège latences par couche, pic RSS (psutil), score de confiance heuristique
(qualité image + lint + couverture d'extraction), provider VLM. Python 3.9+.
"""
import json
import time


def run(ctx: dict) -> dict:
    started = time.perf_counter()
    try:
        import psutil
        ram_peak_mb = round(psutil.Process().memory_info().rss / (1024 * 1024), 1)
    except Exception:  # noqa: BLE001
        ram_peak_mb = None

    lint = ctx.get("lint", {"errors": []})
    n_errors = sum(1 for e in lint["errors"] if e["severity"] == "ERROR")
    n_warnings = len(lint["errors"]) - n_errors
    confidence = 1.0
    confidence -= min(0.5, 0.15 * n_errors + 0.05 * n_warnings)
    if not ctx.get("is_native_vector"):
        confidence -= 0.1  # OCR = incertitude intrinsèque
        if ctx.get("blur_variance", 1000) < 80:
            confidence -= 0.15  # page floue
    if not (ctx.get("content_markdown") or "").strip():
        confidence -= 0.3
    confidence = round(max(0.0, confidence), 2)

    ctx["bench"] = {
        "engine_used": ctx.get("engine_used", "unknown"),
        "vlm_provider_used": ctx.get("vlm", {}).get("provider_used"),
        "fallback_triggered": 1 if ctx.get("vlm", {}).get("fallback_triggered") else 0,
        "linter_errors_json": json.dumps(lint["errors"], ensure_ascii=False) if lint["errors"] else None,
        "execution_time_ms": sum(ctx.get("latencies", {}).values()),
        "ram_peak_mb": ram_peak_mb,
        "confidence_score": confidence,
        "blur_score": ctx.get("blur_variance"),
        "deskew_angle": ctx.get("deskew_angle"),
    }
    ctx.setdefault("latencies", {})["layer_6_bench"] = int((time.perf_counter() - started) * 1000)
    return ctx
