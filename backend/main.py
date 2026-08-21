# -*- coding: utf-8 -*-
"""RAGDom — Point d'entrée FastAPI (tech_specs §15, adapté V3.5)."""
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Chargement obligatoire du .env avant tout import des modules internes.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

import config  # noqa: E402
from api.routes_system import router as system_router  # noqa: E402
from api.routes_library import router as library_router  # noqa: E402
from api.routes_search import router as search_router  # noqa: E402
from api.routes_pipeline import router as pipeline_router  # noqa: E402
from api.routes_llm import router as llm_router  # noqa: E402
from api.routes_curriculum import router as curriculum_router  # noqa: E402
from db.connection import init_config_db  # noqa: E402
from core import engine_registry  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Événements de démarrage et d'arrêt du serveur."""
    # --- DÉMARRAGE ---
    print("[RAGDom] Initialisation de la base de configuration...")
    init_config_db()

    print("[RAGDom] Vérification des dossiers physiques...")
    for env_var in ["SOURCES_DIR", "DATABASES_DIR", "PIPELINE_SET_DIR", "MODELS_DIR", "ENGINES_DIR"]:
        path = os.environ.get(env_var)
        if not path:
            raise RuntimeError("Variable d'environnement manquante : %s" % env_var)
        os.makedirs(path, exist_ok=True)

    engines = engine_registry.scan_engines()
    print("[RAGDom] Moteurs détectés : %s" % (", ".join(e["id"] for e in engines) or "aucun"))
    print("[RAGDom] Backend prêt.")
    yield
    # --- ARRÊT ---
    print("[RAGDom] Arrêt propre du backend.")


app = FastAPI(
    title="RAGDom API",
    version="3.5.0",
    description="Backend RAGDom — Bibliothèque numérique scientifique locale",
    lifespan=lifespan,
)

# ── CORS (Développement) ──────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ───────────────────────────────────────────────────
app.include_router(system_router, prefix="/api/system", tags=["System"])
app.include_router(library_router, prefix="/api/library", tags=["Library"])
app.include_router(search_router, prefix="/api/search", tags=["Search"])
app.include_router(pipeline_router, prefix="/api/pipeline", tags=["Pipeline"])
app.include_router(llm_router, prefix="/api/llm", tags=["LLM"])
app.include_router(curriculum_router, prefix="/api/curriculum", tags=["Curriculum"])

# ── Point d'entrée direct ─────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=config.BACKEND_HOST, port=config.BACKEND_PORT, reload=True)
