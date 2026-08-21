# -*- coding: utf-8 -*-
"""sci-engine — Couche 5 : Routage VLM conditionnel (tech_specs §4.3).

Invoquée UNIQUEMENT si le linter a produit au moins un ERROR. Parcourt les
providers activés de ragdom_config.sqlite par priorité (rotation 429/403,
désactivation 401, backoff 5xx — géré par llm.key_manager du noyau), puis
Ollama local. Aucun provider joignable → les blocs restent bruts, l'échec est
tracé (fallback_triggered) : le pipeline NE S'ARRÊTE JAMAIS ici. Python 3.9+.
"""
import base64
import time

_PROMPT = ("Tu es un extracteur LaTeX expert. L'OCR a produit ce contenu invalide :\n"
           "%s\nCorrige-le et retourne UNIQUEMENT le LaTeX valide, sans explication.")


def run(ctx: dict) -> dict:
    started = time.perf_counter()
    ctx.setdefault("vlm", {"provider_used": None, "fallback_triggered": False, "repaired": 0})
    if ctx.get("skip_vlm") or ctx["lint"]["is_valid"]:
        ctx.setdefault("latencies", {})["layer_5_vlm"] = 0
        return ctx

    targets = [a for a in ctx.get("artifacts", []) if a.get("needs_vlm") or _has_error(ctx, a)]
    if not targets:
        ctx.setdefault("latencies", {})["layer_5_vlm"] = 0
        return ctx

    try:
        import sys, os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend"))
        from llm.key_manager import repair_content  # noyau : rotation/backoff/fallback
    except Exception:  # noqa: BLE001 — Key Manager indisponible : trace et continue
        repair_content = None

    repaired = 0
    for artifact in targets:
        payload = artifact.get("raw_data") or ""
        image_b64 = (base64.b64encode(artifact["raw_binary"]).decode("ascii")
                     if artifact.get("raw_binary") else None)
        result = None
        if repair_content is not None:
            result = repair_content(prompt=_PROMPT % (payload[:2000] or "(image jointe)"),
                                    image_b64=image_b64,
                                    timeout_s=int(ctx["config"]["vlm_timeout_seconds"]))
        if result and result.get("content"):
            artifact["raw_data"] = result["content"].strip()
            artifact["searchable_text"] = artifact["raw_data"][:500]
            artifact.pop("needs_vlm", None)
            ctx["vlm"]["provider_used"] = result.get("provider")
            ctx["vlm"]["fallback_triggered"] = bool(result.get("fallback_triggered"))
            repaired += 1
        else:
            ctx["vlm"]["fallback_triggered"] = True  # persisté brut, tracé (tech_specs §4.3)

    ctx["vlm"]["repaired"] = repaired
    ctx.setdefault("latencies", {})["layer_5_vlm"] = int((time.perf_counter() - started) * 1000)
    return ctx


def _has_error(ctx: dict, artifact: dict) -> bool:
    return any(e["block_id_ref"] == artifact["block_id_ref"] and e["severity"] == "ERROR"
               for e in ctx["lint"]["errors"])
