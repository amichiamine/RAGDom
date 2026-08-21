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


# Racine du projet = parent de backend/ — les chemins par défaut en découlent :
# le .env devient OPTIONNEL (portabilité clone-and-run), l'env reste prioritaire.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _path(name: str, default: Path) -> str:
    value = os.environ.get(name)
    if value:
        return value
    os.environ[name] = str(default)  # visible par le lifespan et les sous-modules
    return str(default)


# ── Chemins physiques (tech_specs §10 — défauts relatifs à la racine du projet) ──
SOURCES_DIR = _path("SOURCES_DIR", _PROJECT_ROOT / "sources")
DATABASES_DIR = _path("DATABASES_DIR", _PROJECT_ROOT / "databases")
PIPELINE_SET_DIR = _path("PIPELINE_SET_DIR", _PROJECT_ROOT / "pipeline_set")
MODELS_DIR = _path("MODELS_DIR", _PROJECT_ROOT / "models")
ENGINES_DIR = _path("ENGINES_DIR", _PROJECT_ROOT / "engines")
CONFIG_DB_PATH = _path("CONFIG_DB_PATH", _PROJECT_ROOT / "backend" / "ragdom_config.sqlite")

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

# ── Phase 7 : Lot Web-Ready (défauts = comportement local inchangé) ──────────
# Mode consultation : seules les routes de LECTURE (library/search/system-read)
# répondent ; toute route d'administration est absente (404).
RAGDOM_READONLY = os.environ.get("RAGDOM_READONLY", "false").lower() == "true"
# Jeton d'administration (Palier 3) : si défini, les routes admin exigent
# Authorization: Bearer <jeton>. Vide = aucun contrôle (mode local nominal).
RAGDOM_AUTH_TOKEN = os.environ.get("RAGDOM_AUTH_TOKEN", "") or None
# Révélation des clés LLM en clair (/api/llm/keys/{id}/reveal).
# true par défaut (postulat local §7) — DOIT être false sur tout déploiement web.
RAGDOM_ALLOW_REVEAL = os.environ.get("RAGDOM_ALLOW_REVEAL", "true").lower() == "true"
# Quota /api/search/ask par IP et par minute (0 = désactivé, défaut local).
RAGDOM_ASK_RATE_PER_MIN = int(os.environ.get("RAGDOM_ASK_RATE_PER_MIN", "0"))

# ── Phase 6 (post-v1, D4-B) : parallélisme intra-page borné ──────────────────
# 1 = séquentiel strict (D4-A, défaut). 2-3 = pool de workers PAR BLOCS d'une
# même page, via les modules *_v2 add-only déclarés par le moteur.
RAGDOM_INTRA_PAGE_WORKERS = max(1, min(3, int(os.environ.get("RAGDOM_INTRA_PAGE_WORKERS", "1"))))


def env_api_key(provider: str) -> Optional[str]:
    """Clé API de fallback depuis l'environnement (jamais loggée)."""
    return os.environ.get(provider.upper() + "_API_KEY") or None


VERSION = "3.5.0"
