# -*- coding: utf-8 -*-
"""RAGDom — Authentification embarquée (Phase 7, décision utilisateur 2026-08-21).

Login par NOM D'UTILISATEUR (pas d'email) + mot de passe. Comptes et sessions
stockés dans ragdom_config.sqlite (embarqué avec le projet). Mot de passe HACHÉ
par scrypt (stdlib hashlib — aucune dépendance hors whitelist), sel aléatoire
par compte. La session émise sert de jeton Bearer : elle emprunte exactement le
canal d'administration existant (access_policy).

Règles d'activation (zéro friction en local, verrouillé sur le web) :
  - Tant qu'AUCUN compte n'existe et qu'aucun RAGDOM_AUTH_TOKEN n'est défini,
    l'administration reste ouverte (postulat Local-First inchangé).
  - Dès qu'un compte existe (ou qu'un jeton env est défini), l'administration
    exige une session valide (ou le jeton env — compat).
  - /auth/setup (création du PREMIER compte) : libre en local ; si un
    RAGDOM_AUTH_TOKEN env est défini (déploiement web), il est exigé — le
    premier visiteur ne peut PAS s'approprier l'instance.
"""
import hashlib
import secrets
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import config
from db import connection as db

router = APIRouter()

SESSION_TTL_S = 12 * 3600  # 12 h glissantes

_AUTH_DDL = """
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash BLOB NOT NULL,
    salt          BLOB NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
"""


def _conn():
    conn = db.get_config_db()
    conn.executescript(_AUTH_DDL)
    return conn


def _hash_password(password: str, salt: bytes) -> bytes:
    # scrypt (stdlib) : n=2^14, r=8, p=1 — recommandations OWASP, zéro dépendance.
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)


def users_exist() -> bool:
    conn = _conn()
    try:
        return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] > 0
    finally:
        conn.close()


def validate_session(token: str) -> Optional[str]:
    """Retourne le username si la session est valide (et la prolonge), sinon None."""
    if not token:
        return None
    conn = _conn()
    try:
        now = int(time.time())
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        row = conn.execute("SELECT username FROM sessions WHERE token=? AND expires_at >= ?",
                           (token, now)).fetchone()
        if row:
            conn.execute("UPDATE sessions SET expires_at=? WHERE token=?",
                         (now + SESSION_TTL_S, token))
        conn.commit()
        return row[0] if row else None
    finally:
        conn.close()


class CredentialsBody(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_\-\.]+$")
    password: str = Field(min_length=8, max_length=256)


@router.get("/me")
def me(request: Request):
    """État d'authentification — route PUBLIQUE (pilote l'UI : login/setup/rien)."""
    has_users = users_exist()
    auth_required = has_users or bool(config.RAGDOM_AUTH_TOKEN)
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    username = validate_session(token)
    if not username and config.RAGDOM_AUTH_TOKEN and token == config.RAGDOM_AUTH_TOKEN:
        username = "__jeton_env__"
    return {"auth_required": auth_required, "setup_required": not has_users,
            "init_token_required": (not has_users) and bool(config.RAGDOM_AUTH_TOKEN),
            "authenticated": username is not None,
            "username": None if username in (None, "__jeton_env__") else username,
            "readonly": config.RAGDOM_READONLY}


@router.post("/setup", status_code=201)
def setup(body: CredentialsBody, request: Request):
    """Création du PREMIER compte. Web (jeton env défini) : jeton exigé."""
    if users_exist():
        raise HTTPException(409, "Un compte existe déjà — utilisez /auth/login")
    if config.RAGDOM_AUTH_TOKEN:
        auth = request.headers.get("authorization", "")
        if auth != "Bearer %s" % config.RAGDOM_AUTH_TOKEN:
            raise HTTPException(401, "Jeton d'administration requis pour créer le premier compte")
    salt = secrets.token_bytes(32)
    conn = _conn()
    try:
        conn.execute("INSERT INTO users (id, username, password_hash, salt) VALUES (?,?,?,?)",
                     (secrets.token_hex(8), body.username, _hash_password(body.password, salt), salt))
        conn.commit()
    finally:
        conn.close()
    return _issue_session(body.username)


@router.post("/login")
def login(body: CredentialsBody):
    conn = _conn()
    try:
        row = conn.execute("SELECT password_hash, salt, username FROM users WHERE username=?",
                           (body.username,)).fetchone()
    finally:
        conn.close()
    if row is None:
        # hachage factice : temps de réponse constant (anti-énumération d'utilisateurs)
        _hash_password(body.password, b"\x00" * 32)
        raise HTTPException(401, "Identifiants invalides")
    expected, salt, username = row
    if not secrets.compare_digest(_hash_password(body.password, bytes(salt)), bytes(expected)):
        raise HTTPException(401, "Identifiants invalides")
    return _issue_session(username)


def _issue_session(username: str) -> dict:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    conn = _conn()
    try:
        conn.execute("INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?,?,?,?)",
                     (token, username, now, now + SESSION_TTL_S))
        conn.commit()
    finally:
        conn.close()
    return {"session_token": token, "username": username, "expires_in_s": SESSION_TTL_S}


@router.post("/logout")
def logout(request: Request):
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    conn = _conn()
    try:
        conn.execute("DELETE FROM sessions WHERE token=?", (token,))
        conn.commit()
    finally:
        conn.close()
    return {"logged_out": True}
