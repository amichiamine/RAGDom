# -*- coding: utf-8 -*-
"""RAGDom — Key Manager / Circuit Breaker (Blueprint §3, tech_specs §4.3).

Rotation multi-clés par provider (429/403 → blocage temporaire + clé suivante ;
401 → désactivation définitive ; 5xx → backoff exponentiel 2s/4s/8s), providers
par priorité croissante depuis ragdom_config.sqlite, fallback final Ollama local.
Jamais de clé loggée. Python 3.9+.
"""
import base64
import logging
import time
import uuid
from datetime import datetime, timedelta
from typing import Optional

import httpx

import config
from db import connection as db

logger = logging.getLogger("ragdom.llm")

_ENDPOINTS = {
    "gemini": "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
    "groq": "https://api.groq.com/openai/v1/chat/completions",
    "openai": "https://api.openai.com/v1/chat/completions",
    "anthropic": "https://api.anthropic.com/v1/messages",
}


def _providers_by_priority():
    conn = db.get_config_db()
    try:
        return conn.execute(
            "SELECT provider, active_model, base_url FROM llm_settings WHERE is_enabled=1 ORDER BY priority"
        ).fetchall()
    finally:
        conn.close()


def _active_keys(provider: str):
    conn = db.get_config_db()
    try:
        now = datetime.utcnow().isoformat(sep=" ")
        return conn.execute(
            "SELECT id, api_key, active_model FROM llm_keys WHERE provider=? AND status='active'"
            " AND (blocked_until IS NULL OR blocked_until < ?) ORDER BY created_at", (provider, now),
        ).fetchall()
    finally:
        conn.close()


def _mark_key(key_id: str, status: Optional[str] = None, blocked_minutes: int = 0, error_code: Optional[int] = None):
    conn = db.get_config_db()
    try:
        blocked_until = ((datetime.utcnow() + timedelta(minutes=blocked_minutes)).isoformat(sep=" ")
                         if blocked_minutes else None)
        conn.execute(
            "UPDATE llm_keys SET status=COALESCE(?,status), blocked_until=?, last_error_code=?,"
            " updated_at=CURRENT_TIMESTAMP WHERE id=?", (status, blocked_until, error_code, key_id))
        conn.commit()
    finally:
        conn.close()


def _call_make(base_url: str, prompt: str, timeout_s: int) -> str:
    """Make.com (Skills.md §Make AI Provider) : webhook REST → {content} ou texte brut."""
    response = httpx.post(base_url, json={"prompt": prompt, "source": "ragdom"}, timeout=timeout_s)
    response.raise_for_status()
    try:
        payload = response.json()
        return payload.get("content") or payload.get("answer") or response.text
    except ValueError:
        return response.text


def _call_provider(provider: str, model: str, api_key: str, prompt: str,
                   image_b64: Optional[str], timeout_s: int, base_url: Optional[str] = None) -> str:
    if provider == "gemini":
        parts = [{"text": prompt}]
        if image_b64:
            parts.append({"inline_data": {"mime_type": "image/webp", "data": image_b64}})
        response = httpx.post(_ENDPOINTS["gemini"].format(model=model, key=api_key),
                              json={"contents": [{"parts": parts}]}, timeout=timeout_s)
        response.raise_for_status()
        return response.json()["candidates"][0]["content"]["parts"][0]["text"]
    if provider == "anthropic":
        content = [{"type": "text", "text": prompt}]
        if image_b64:
            content.insert(0, {"type": "image", "source": {"type": "base64", "media_type": "image/webp",
                                                           "data": image_b64}})
        response = httpx.post(_ENDPOINTS["anthropic"],
                              headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                              json={"model": model, "max_tokens": 2048,
                                    "messages": [{"role": "user", "content": content}]}, timeout=timeout_s)
        response.raise_for_status()
        return response.json()["content"][0]["text"]
    # groq / openai / lmstudio : API OpenAI-compatible (base_url personnalisable —
    # LM Studio expose http://localhost:1234/v1 sans clé obligatoire)
    endpoint = ((base_url.rstrip("/") + "/chat/completions") if base_url
                else _ENDPOINTS.get(provider, _ENDPOINTS["openai"]))
    messages = [{"role": "user", "content": prompt if not image_b64 else [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": "data:image/webp;base64," + image_b64}}]}]
    headers = {"Authorization": "Bearer " + api_key} if api_key else {}
    response = httpx.post(endpoint, headers=headers,
                          json={"model": model, "messages": messages, "max_tokens": 2048}, timeout=timeout_s)
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def _call_ollama(prompt: str, timeout_s: int) -> Optional[str]:
    try:
        conn = db.get_config_db()
        row = conn.execute("SELECT active_model FROM llm_settings WHERE provider='ollama'").fetchone()
        conn.close()
        model = row[0] if row and row[0] else None
        if not model:  # aucun modèle choisi : auto-détection sur le serveur Ollama local
            detected = list_models("ollama")
            if not detected["models"]:
                return None
            model = detected["models"][0]
        response = httpx.post(config.OLLAMA_BASE_URL + "/api/generate",
                              json={"model": model, "prompt": prompt, "stream": False}, timeout=timeout_s)
        response.raise_for_status()
        return response.json().get("response")
    except Exception:  # noqa: BLE001 — Ollama absent : fin de la chaîne de fallback
        return None


def list_models(provider: str, key_id: Optional[str] = None) -> dict:
    """Détection EN DIRECT des modèles du provider (zéro liste codée en dur).

    Utilise la clé active stockée (ou la clé .env) et la base_url éventuelle.
    Retourne {"models": [...], "error": None|str}.
    """
    conn = db.get_config_db()
    try:
        row = conn.execute("SELECT base_url FROM llm_settings WHERE provider=?", (provider,)).fetchone()
    finally:
        conn.close()
    base_url = row[0] if row else None
    api_key = ""
    if key_id:  # détection avec CETTE clé précise
        conn = db.get_config_db()
        krow = conn.execute("SELECT api_key FROM llm_keys WHERE id=?", (key_id,)).fetchone()
        conn.close()
        api_key = krow[0] if krow else ""
    if not api_key:
        keys = _active_keys(provider)
        api_key = keys[0][1] if keys else (config.env_api_key(provider) or "")

    try:
        if provider == "gemini":
            if not api_key:
                return {"models": [], "error": "Aucune clé enregistrée"}
            response = httpx.get(
                "https://generativelanguage.googleapis.com/v1beta/models?key=" + api_key,
                timeout=15)
            response.raise_for_status()
            models = [m["name"].split("/")[-1] for m in response.json().get("models", [])
                      if "generateContent" in m.get("supportedGenerationMethods", [])]
            return {"models": models, "error": None}
        if provider == "anthropic":
            if not api_key:
                return {"models": [], "error": "Aucune clé enregistrée"}
            response = httpx.get("https://api.anthropic.com/v1/models",
                                 headers={"x-api-key": api_key,
                                          "anthropic-version": "2023-06-01"}, timeout=15)
            response.raise_for_status()
            return {"models": [m["id"] for m in response.json().get("data", [])], "error": None}
        if provider == "ollama":
            response = httpx.get((base_url or config.OLLAMA_BASE_URL) + "/api/tags", timeout=10)
            response.raise_for_status()
            return {"models": [m["name"] for m in response.json().get("models", [])], "error": None}
        if provider == "make":
            return {"models": ["webhook"], "error": None}
        # openai / groq / lmstudio : API OpenAI-compatible GET /models
        endpoint = ((base_url.rstrip("/") + "/models") if base_url
                    else {"openai": "https://api.openai.com/v1/models",
                          "groq": "https://api.groq.com/openai/v1/models"}.get(provider))
        if endpoint is None:
            return {"models": [], "error": "base_url requise pour ce provider"}
        if not api_key and provider != "lmstudio":
            return {"models": [], "error": "Aucune clé enregistrée"}
        headers = {"Authorization": "Bearer " + api_key} if api_key else {}
        response = httpx.get(endpoint, headers=headers, timeout=15)
        response.raise_for_status()
        return {"models": sorted(m["id"] for m in response.json().get("data", [])), "error": None}
    except httpx.HTTPStatusError as exc:
        return {"models": [], "error": "HTTP %d — clé invalide ou endpoint incorrect"
                                        % exc.response.status_code}
    except httpx.HTTPError as exc:
        return {"models": [], "error": "Injoignable : %s" % type(exc).__name__}


def generate(prompt: str, image_b64: Optional[str] = None,
             timeout_s: Optional[int] = None) -> Optional[dict]:
    """Chaîne complète : providers activés par priorité → rotation de clés → Ollama.

    Retourne {"content", "provider", "fallback_triggered"} ou None si toute la
    chaîne est épuisée (le pipeline continue, tracé fallback_triggered en amont).
    """
    timeout_s = timeout_s or config.VLM_TIMEOUT_SECONDS
    fallback_triggered = False
    for provider, model, base_url in _providers_by_priority():
        if provider == "ollama":
            continue  # traité en dernier recours ci-dessous
        if provider == "make":  # webhook no-code (Priorité 3, Blueprint §3) — sans clé
            if base_url:
                try:
                    content = _call_make(base_url, prompt, timeout_s)
                    return {"content": content, "provider": "make/webhook",
                            "fallback_triggered": fallback_triggered}
                except httpx.HTTPError:
                    fallback_triggered = True
            continue
        keys = _active_keys(provider)
        env_key = config.env_api_key(provider)
        if env_key and not keys:  # fallback .env de démarrage (tech_specs §10)
            keys = [(None, env_key, None)]
        if provider == "lmstudio" and not keys:  # serveur local : clé facultative
            keys = [(None, "", None)]
        for key_id, api_key, key_model in keys:
            effective_model = key_model or model  # priorité au modèle DE LA CLÉ
            for attempt, delay in enumerate((0, 2, 4, 8)):
                if delay:
                    time.sleep(delay)
                try:
                    content = _call_provider(provider, effective_model, api_key, prompt, image_b64,
                                             timeout_s, base_url=base_url)
                    return {"content": content, "provider": "%s/%s" % (provider, effective_model),
                            "fallback_triggered": fallback_triggered}
                except httpx.HTTPStatusError as exc:
                    code = exc.response.status_code
                    if code in (429, 403):  # quota → blocage temporaire + clé suivante
                        if key_id:
                            _mark_key(key_id, blocked_minutes=10, error_code=code)
                        fallback_triggered = True
                        break
                    if code == 401:  # clé invalide → désactivation définitive
                        if key_id:
                            _mark_key(key_id, status="disabled", error_code=401)
                        fallback_triggered = True
                        break
                    if code in (500, 502, 503, 504):  # backoff exponentiel puis clé suivante
                        fallback_triggered = True
                        continue
                    fallback_triggered = True
                    break
                except httpx.HTTPError:
                    fallback_triggered = True
                    break
    content = _call_ollama(prompt, timeout_s)
    if content:
        return {"content": content, "provider": "ollama", "fallback_triggered": True}
    return None


def repair_content(prompt: str, image_b64: Optional[str] = None,
                   timeout_s: Optional[int] = None) -> Optional[dict]:
    """Alias sémantique utilisé par la Couche 5 (réparation VLM)."""
    return generate(prompt, image_b64=image_b64, timeout_s=timeout_s)


def add_key(provider: str, api_key: str) -> str:
    key_id = str(uuid.uuid4())
    conn = db.get_config_db()
    conn.execute("INSERT INTO llm_keys (id, provider, api_key) VALUES (?,?,?)", (key_id, provider, api_key))
    conn.commit()
    conn.close()
    return key_id


def test_key(key_id: str) -> dict:
    conn = db.get_config_db()
    row = conn.execute("SELECT provider, api_key FROM llm_keys WHERE id=?", (key_id,)).fetchone()
    conn.close()
    if row is None:
        return {"success": False, "status": "unknown", "message": "Clé introuvable."}
    provider, api_key = row
    conn2 = db.get_config_db()
    key_model_row = conn2.execute("SELECT active_model FROM llm_keys WHERE id=?", (key_id,)).fetchone()
    settings_row = conn2.execute(
        "SELECT active_model, base_url FROM llm_settings WHERE provider=?", (provider,)).fetchone()
    conn2.close()
    model = (key_model_row[0] if key_model_row and key_model_row[0] else None)         or (settings_row[0] if settings_row else None)
    base_url = settings_row[1] if settings_row else None
    if not model:  # aucun modèle choisi : auto-détection en direct (zéro dur)
        detected = list_models(provider, key_id=key_id)
        if detected["models"]:
            model = detected["models"][0]
        elif detected["error"]:
            return {"success": False, "status": "unknown",
                    "message": "Détection des modèles impossible : %s" % detected["error"]}
    started = time.perf_counter()
    try:
        _call_provider(provider, model, api_key, "ping", None, 15, base_url=base_url)
        _mark_key(key_id, status="active")
        return {"success": True, "status": "active",
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "message": "Clé API validée avec succès."}
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        _mark_key(key_id, status="disabled" if code == 401 else None, error_code=code)
        return {"success": False, "status": "disabled" if code == 401 else "active",
                "message": "Échec provider (HTTP %d)." % code}
    except httpx.HTTPError as exc:
        return {"success": False, "status": "active", "message": "Réseau : %s" % exc}
