# -*- coding: utf-8 -*-
"""RAGDom — Configuration centrale (chargée depuis .env, tech_specs §10).

Compatibilité Python 3.9+ (machine cible : 3.11 — aucune syntaxe 3.10+).
"""
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Chargement du .env situé à côté de ce fichier, quel que soit le CWD.
_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(_ENV_PATH)


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError("Variable d'environnement manquante : %s (voir backend/.env)" % name)
    return value


# ── Chemins physiques (tech_specs §10) ─────────────────────────
SOURCES_DIR = _require("SOURCES_DIR")
DATABASES_DIR = _require("DATABASES_DIR")
PIPELINE_SET_DIR = _require("PIPELINE_SET_DIR")
MODELS_DIR = _require("MODELS_DIR")
ENGINES_DIR = _require("ENGINES_DIR")
CONFIG_DB_PATH = _require("CONFIG_DB_PATH")

# ── Serveur ────────────────────────────────────────────────────
BACKEND_HOST = os.environ.get("BACKEND_HOST", "0.0.0.0")
BACKEND_PORT = int(os.environ.get("BACKEND_PORT", "8000"))
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

# ── Pipeline (D2-B : Contrat Mémoire à Deux Paliers) ───────────
MAX_RAM_MB = int(os.environ.get("MAX_RAM_MB", "2048"))
VLM_TIMEOUT_SECONDS = int(os.environ.get("VLM_TIMEOUT_SECONDS", "30"))
MAX_RETRY_COUNT = int(os.environ.get("MAX_RETRY_COUNT", "3"))

# ── Mode strict vectoriel (Option A, tech_specs §3.3.1) ────────
RAGDOM_FORCE_SQLITE_VEC = os.environ.get("RAGDOM_FORCE_SQLITE_VEC", "false").lower() == "true"

# ── LLM (fallback de démarrage — gestion principale : ragdom_config.sqlite) ──
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")


def env_api_key(provider: str) -> Optional[str]:
    """Clé API de fallback depuis l'environnement (jamais loggée)."""
    return os.environ.get(provider.upper() + "_API_KEY") or None


VERSION = "3.5.0"
