# -*- coding: utf-8 -*-
"""RAGDom — Routes /api/llm/* : Key Manager (Blueprint §7.5 + §7.6 : clés masquées,
reveal séparé). Les clés en clair ne transitent JAMAIS par GET /keys. Python 3.9+."""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import config
from db import connection as db
from llm import key_manager

router = APIRouter()


def _mask(api_key: str) -> str:
    return (api_key[:6] + "..." + api_key[-4:]) if len(api_key) > 12 else "***"


@router.get("/providers")
def providers():
    conn = db.get_config_db()
    try:
        output = []
        for provider, model, enabled, priority in conn.execute(
                "SELECT provider, active_model, is_enabled, priority FROM llm_settings ORDER BY priority"):
            keys = [{"key_id": r[0], "masked_key": _mask(r[1]), "status": r[2], "last_error": r[3]}
                    for r in conn.execute(
                        "SELECT id, api_key, status, last_error_code FROM llm_keys WHERE provider=?",
                        (provider,))]
            output.append({"provider": provider, "keys": keys, "active_model": model,
                           "is_enabled": bool(enabled), "priority": priority,
                           "available_models": [model] if model else []})
        return {"providers": output}
    finally:
        conn.close()


@router.get("/settings")
def get_settings():
    conn = db.get_config_db()
    try:
        return {"settings": [{"provider": r[0], "active_model": r[1], "is_enabled": bool(r[2]),
                              "priority": r[3], "base_url": r[4]} for r in conn.execute(
                "SELECT provider, active_model, is_enabled, priority, base_url"
                " FROM llm_settings ORDER BY priority")]}
    finally:
        conn.close()


class SettingsBody(BaseModel):
    provider: str
    active_model: Optional[str] = None
    is_enabled: Optional[bool] = None
    priority: Optional[int] = None
    base_url: Optional[str] = None  # LM Studio / proxy OpenAI-compatible / webhook Make


@router.put("/settings")
def put_settings(body: SettingsBody):
    conn = db.get_config_db()
    try:
        if conn.execute("SELECT 1 FROM llm_settings WHERE provider=?", (body.provider,)).fetchone() is None:
            raise HTTPException(404, "Provider inconnu : %s" % body.provider)
        sets, args = ["updated_at=CURRENT_TIMESTAMP"], []
        if body.active_model is not None:
            sets.append("active_model=?"); args.append(body.active_model)
        if body.is_enabled is not None:
            sets.append("is_enabled=?"); args.append(1 if body.is_enabled else 0)
        if body.priority is not None:
            sets.append("priority=?"); args.append(body.priority)
        if body.base_url is not None:  # chaîne vide = effacer (retour à l'endpoint officiel)
            sets.append("base_url=?"); args.append(body.base_url or None)
        conn.execute("UPDATE llm_settings SET %s WHERE provider=?" % ", ".join(sets),
                     args + [body.provider])
        conn.commit()
        return {"success": True, "updated": {"provider": body.provider,
                                             "active_model": body.active_model}}
    finally:
        conn.close()


@router.get("/keys")
def list_keys():
    """Clés TOUJOURS masquées (§7.6) — le clair passe uniquement par /reveal."""
    conn = db.get_config_db()
    try:
        return {"keys": [{"id": r[0], "provider": r[1], "masked_key": _mask(r[2]), "status": r[3],
                          "blocked_until": r[4], "last_error_code": r[5], "created_at": r[6],
                          "active_model": r[7]}
                         for r in conn.execute(
                "SELECT id, provider, api_key, status, blocked_until, last_error_code, created_at,"
                " active_model FROM llm_keys ORDER BY created_at")]}
    finally:
        conn.close()


class KeyBody(BaseModel):
    provider: str
    api_key: str


@router.post("/keys", status_code=201)
def add_key(body: KeyBody):
    if body.provider not in ("gemini", "groq", "openai", "anthropic", "ollama"):
        raise HTTPException(400, "Provider non supporté")
    key_id = key_manager.add_key(body.provider, body.api_key)
    return {"key_id": key_id, "status": "active"}


@router.get("/providers/{provider}/models")
def provider_models(provider: str, key_id: Optional[str] = None):
    """Modèles AUTO-DÉTECTÉS en direct (avec la clé key_id si fournie — quotas par clé)."""
    return key_manager.list_models(provider, key_id=key_id)


class KeyPatch(BaseModel):
    active_model: Optional[str] = None


@router.put("/keys/{key_id}")
def update_key(key_id: str, patch: KeyPatch):
    """Modèle PROPRE À LA CLÉ (une même clé peut exister en N exemplaires, un par modèle)."""
    conn = db.get_config_db()
    try:
        if conn.execute("SELECT 1 FROM llm_keys WHERE id=?", (key_id,)).fetchone() is None:
            raise HTTPException(404, "Clé introuvable")
        conn.execute("UPDATE llm_keys SET active_model=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                     (patch.active_model or None, key_id))
        conn.commit()
        return {"updated": True, "key_id": key_id, "active_model": patch.active_model}
    finally:
        conn.close()


@router.post("/keys/{key_id}/test")
def test_key(key_id: str):
    return key_manager.test_key(key_id)


@router.post("/keys/{key_id}/reveal")
def reveal_key(key_id: str):
    if not config.RAGDOM_ALLOW_REVEAL:  # Phase 7 : verrouillé sur les déploiements web
        raise HTTPException(403, "Révélation des clés désactivée (RAGDOM_ALLOW_REVEAL=false)")
    """Seule route retournant la clé complète (usage local — bouton « Révéler »)."""
    conn = db.get_config_db()
    try:
        row = conn.execute("SELECT api_key FROM llm_keys WHERE id=?", (key_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Clé introuvable")
        return {"api_key": row[0]}
    finally:
        conn.close()


@router.delete("/keys/{key_id}")
def delete_key(key_id: str):
    conn = db.get_config_db()
    try:
        cur = conn.execute("DELETE FROM llm_keys WHERE id=?", (key_id,))
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Clé introuvable")
        return {"deleted": True}
    finally:
        conn.close()
