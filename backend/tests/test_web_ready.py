# -*- coding: utf-8 -*-
"""RAGDom — Phase 7 (Lot Web-Ready) : tests de la politique d'accès.

Les drapeaux sont bascu­lés via monkeypatch sur le module config (le middleware
les relit à chaque requête). Défauts = tout ouvert (mode local : suites Phase 1-5
inchangées).
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402
from main import app  # noqa: E402
from core.access_policy import is_public  # noqa: E402

client = TestClient(app)


def test_defaults_keep_local_behavior():
    assert config.RAGDOM_READONLY is False
    assert config.RAGDOM_AUTH_TOKEN is None
    assert config.RAGDOM_ASK_RATE_PER_MIN == 0
    health = client.get("/api/system/health").json()
    assert health["readonly"] is False
    # Une route admin répond normalement (settings whitelist → 400, pas 404/401).
    assert client.put("/api/system/settings",
                      json={"key": "hack", "value": "1"}).status_code == 400


def test_public_classification():
    assert is_public("GET", "/api/library/documents")
    assert is_public("GET", "/api/library/page-scans")
    assert is_public("POST", "/api/search/ask")
    assert is_public("GET", "/api/system/health")
    assert not is_public("PUT", "/api/system/settings")
    assert not is_public("POST", "/api/pipeline/start")
    assert not is_public("POST", "/api/pipeline/purge")
    assert not is_public("GET", "/api/llm/keys")
    assert not is_public("POST", "/api/curriculum/terms")
    assert not is_public("GET", "/api/system/sources")
    assert not is_public("GET", "/api/system/databases/x.sqlite/export")


def test_readonly_hides_admin(monkeypatch):
    monkeypatch.setattr(config, "RAGDOM_READONLY", True)
    assert client.get("/api/system/health").json()["readonly"] is True
    # Lecture : toujours servie (400 = db manquant, PAS 404 de la politique).
    assert client.get("/api/library/documents",
                      params={"db": "Zz_Inexistante.sqlite"}).status_code == 404  # base absente
    assert client.get("/api/system/databases").status_code == 200
    # Administration : ABSENTE (404), quelle que soit la validité de l'appel.
    assert client.post("/api/pipeline/start", json={"source_path": "x"}).status_code == 404
    assert client.get("/api/llm/keys").status_code == 404
    assert client.put("/api/system/settings",
                      json={"key": "vec_distance_threshold", "value": "0.45"}).status_code == 404
    assert client.request("DELETE", "/api/system/databases/Zz.sqlite",
                          json={"confirm": "Zz.sqlite"}).status_code == 404
    assert client.post("/api/curriculum/terms?db=x.sqlite",
                       json={"term_index": 1, "label": "x"}).status_code == 404


def test_auth_token_guards_admin(monkeypatch):
    monkeypatch.setattr(config, "RAGDOM_AUTH_TOKEN", "s3cret")
    # Sans jeton : 401 sur l'admin, 200 sur le public.
    assert client.get("/api/llm/keys").status_code == 401
    assert client.get("/api/system/health").status_code == 200
    # Mauvais jeton : 401. Bon jeton : la route répond (200).
    assert client.get("/api/llm/keys",
                      headers={"Authorization": "Bearer faux"}).status_code == 401
    assert client.get("/api/llm/keys",
                      headers={"Authorization": "Bearer s3cret"}).status_code == 200


def test_ask_rate_limit(monkeypatch):
    monkeypatch.setattr(config, "RAGDOM_ASK_RATE_PER_MIN", 3)
    from core import access_policy
    access_policy.ask_limiter._hits.clear()
    payload = {"query": "q", "databases": []}
    codes = [client.post("/api/search/ask", json=payload).status_code for _ in range(5)]
    assert codes[:3] != [429, 429, 429] and codes[3] == 429 and codes[4] == 429
    # hybrid n'est PAS limité.
    assert client.post("/api/search/hybrid?db=Zz_Inexistante.sqlite",
                       json={"query": "q"}).status_code != 429


def test_make_docs_route():
    # LECTURE seule : renvoie {contract, prompts} non vides (docs/make/*.md présents).
    res = client.get("/api/system/docs/make")
    assert res.status_code == 200, res.text
    body = res.json()
    assert isinstance(body.get("contract"), str) and "Contrat" in body["contract"]
    assert isinstance(body.get("prompts"), str) and "AI Scenario Builder" in body["prompts"]
    # Route d'ADMINISTRATION : jamais classée publique.
    assert not is_public("GET", "/api/system/docs/make")


def test_make_docs_is_admin_guarded(monkeypatch):
    monkeypatch.setattr(config, "RAGDOM_AUTH_TOKEN", "s3cret")
    # Sans jeton : 401 (admin) ; avec le bon jeton : 200.
    assert client.get("/api/system/docs/make").status_code == 401
    assert client.get("/api/system/docs/make",
                      headers={"Authorization": "Bearer s3cret"}).status_code == 200


def test_reveal_lock(monkeypatch):
    monkeypatch.setattr(config, "RAGDOM_ALLOW_REVEAL", False)
    created = client.post("/api/llm/keys", json={"provider": "gemini", "api_key": "AIzaFAKEXXXX9999"})
    key_id = created.json()["key_id"]
    try:
        assert client.post("/api/llm/keys/%s/reveal" % key_id).status_code == 403
        monkeypatch.setattr(config, "RAGDOM_ALLOW_REVEAL", True)
        assert client.post("/api/llm/keys/%s/reveal" % key_id).json()["api_key"].endswith("9999")
    finally:
        client.delete("/api/llm/keys/%s" % key_id)
