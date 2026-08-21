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
from api.routes_auth import router as auth_router  # noqa: E402
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

    from api import routes_pipeline
    resumed = routes_pipeline.resume_pending_queues()
    if resumed:
        print("[RAGDom] Reprise des files interrompues : %s" % resumed)

    # Bases PUBLIÉES : toute base .sqlite présente dans databases_publiees/
    # (dépôt local ou image Docker) est copiée vers DATABASES_DIR si absente —
    # la bibliothèque renaît identique à chaque réveil du disque éphémère.
    import shutil
    published = os.environ.get("RAGDOM_PUBLISHED_DBS") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "databases_publiees")
    if os.path.isdir(published):
        os.makedirs(os.environ["DATABASES_DIR"], exist_ok=True)
        for name in os.listdir(published):
            if name.endswith(".sqlite"):
                target = os.path.join(os.environ["DATABASES_DIR"], name)
                if not os.path.exists(target):
                    shutil.copy2(os.path.join(published, name), target)
                    print("[RAGDom] Base publiée installée : %s" % name)

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

# ── CORS (liste d'origines — Phase 7 : « http://localhost:5173,https://exemple.dz ») ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in config.FRONTEND_URL.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Politique d'accès web (Phase 7 — inactive par défaut en local) ──
from core.access_policy import AccessPolicyMiddleware  # noqa: E402

app.add_middleware(AccessPolicyMiddleware)

# ── Routes ───────────────────────────────────────────────────
app.include_router(system_router, prefix="/api/system", tags=["System"])
app.include_router(library_router, prefix="/api/library", tags=["Library"])
app.include_router(search_router, prefix="/api/search", tags=["Search"])
app.include_router(pipeline_router, prefix="/api/pipeline", tags=["Pipeline"])
app.include_router(llm_router, prefix="/api/llm", tags=["LLM"])
app.include_router(curriculum_router, prefix="/api/curriculum", tags=["Curriculum"])
app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])

# ── Single-Origin (Phase 7) : FastAPI sert l'UI compilée s'il la trouve ──
# UN SEUL processus sert tout (UI + API) : zéro CORS inter-origines, zéro
# VITE_API_URL. Actif dès que frontend/dist existe (npm run build) ou que
# RAGDOM_UI_DIST pointe vers un dossier de build. Les routes /api/* gardent
# la priorité (montées avant) ; toute autre URL sert l'application (SPA).
_DIST_DIR = os.environ.get("RAGDOM_UI_DIST") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
if os.path.isdir(_DIST_DIR):
    from fastapi.staticfiles import StaticFiles
    from starlette.exceptions import HTTPException as StarletteHTTPException

    class _SPAStaticFiles(StaticFiles):
        async def get_response(self, path: str, scope):
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code == 404 and "." not in path.rsplit("/", 1)[-1]:
                    return await super().get_response("index.html", scope)  # routes SPA
                raise

    app.mount("/", _SPAStaticFiles(directory=_DIST_DIR, html=True), name="ui")
    print("[RAGDom] UI servie en single-origin depuis %s" % _DIST_DIR)

# ── Point d'entrée direct ─────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=config.BACKEND_HOST, port=config.BACKEND_PORT, reload=True)
