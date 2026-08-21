# -*- coding: utf-8 -*-
"""RAGDom — tests du login embarqué (users/sessions dans ragdom_config.sqlite)."""
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402
from main import app  # noqa: E402
from db import connection as db  # noqa: E402

db.init_config_db()  # applique la migration base_url (le TestClient ne joue pas le lifespan)
client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_users():
    conn = db.get_config_db()
    conn.executescript("DROP TABLE IF EXISTS users; DROP TABLE IF EXISTS sessions;")
    conn.commit(); conn.close()
    yield
    conn = db.get_config_db()
    conn.executescript("DROP TABLE IF EXISTS users; DROP TABLE IF EXISTS sessions;")
    conn.commit(); conn.close()


def test_me_initial_state():
    me = client.get("/api/auth/me").json()
    assert me["setup_required"] is True and me["authenticated"] is False
    # Local nominal (aucun compte, aucun jeton env) : admin encore ouverte
    assert client.get("/api/llm/keys").status_code == 200


def test_setup_login_logout_cycle():
    created = client.post("/api/auth/setup",
                          json={"username": "archisys", "password": "MotDePasse#2026"})
    assert created.status_code == 201
    token = created.json()["session_token"]
    # Un compte existe → l'admin exige désormais une session
    assert client.get("/api/llm/keys").status_code == 401
    assert client.get("/api/llm/keys",
                      headers={"Authorization": "Bearer " + token}).status_code == 200
    # Second setup interdit
    assert client.post("/api/auth/setup",
                       json={"username": "intrus", "password": "xxxxxxxxxx"}).status_code == 409
    # Login mauvais / bon
    assert client.post("/api/auth/login",
                       json={"username": "archisys", "password": "mauvais-mdp"}).status_code == 401
    good = client.post("/api/auth/login",
                       json={"username": "archisys", "password": "MotDePasse#2026"})
    assert good.status_code == 200
    session2 = good.json()["session_token"]
    me = client.get("/api/auth/me", headers={"Authorization": "Bearer " + session2}).json()
    assert me["authenticated"] is True and me["username"] == "archisys"
    # Logout invalide la session
    client.post("/api/auth/logout", headers={"Authorization": "Bearer " + session2})
    assert client.get("/api/llm/keys",
                      headers={"Authorization": "Bearer " + session2}).status_code == 401


def test_setup_guarded_by_env_token_on_web(monkeypatch):
    monkeypatch.setattr(config, "RAGDOM_AUTH_TOKEN", "jeton-web")
    assert client.post("/api/auth/setup",
                       json={"username": "pirate", "password": "xxxxxxxxxx"}).status_code == 401
    ok = client.post("/api/auth/setup", json={"username": "admin", "password": "xxxxxxxxxx"},
                     headers={"Authorization": "Bearer jeton-web"})
    assert ok.status_code == 201


def test_llm_settings_base_url_roundtrip():
    settings = client.get("/api/llm/settings").json()["settings"]
    providers = {s["provider"] for s in settings}
    assert {"lmstudio", "make", "ollama"} <= providers  # nouveaux providers présents
    assert client.put("/api/llm/settings",
                      json={"provider": "lmstudio", "base_url": "http://localhost:9999/v1",
                            "is_enabled": True}).json()["success"]
    lm = next(s for s in client.get("/api/llm/settings").json()["settings"]
              if s["provider"] == "lmstudio")
    assert lm["base_url"] == "http://localhost:9999/v1" and lm["is_enabled"] is True
    client.put("/api/llm/settings", json={"provider": "lmstudio", "is_enabled": False})
