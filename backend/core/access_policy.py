# -*- coding: utf-8 -*-
"""RAGDom — Phase 7 (Lot Web-Ready) : politique d'accès HTTP.

Trois mécanismes, tous INACTIFS par défaut (mode local nominal inchangé) :
  1. RAGDOM_READONLY   : mode consultation — seules les routes de LECTURE
     répondent ; les routes d'administration retournent 404 (surface nulle).
  2. RAGDOM_AUTH_TOKEN : si défini, les routes d'administration exigent
     `Authorization: Bearer <jeton>` (401 sinon).
  3. RAGDOM_ASK_RATE_PER_MIN : quota /api/search/ask par IP/minute (429).

Les drapeaux sont relus depuis `config` À CHAQUE REQUÊTE (testabilité +
bascule à chaud par redémarrage sans réimport).
"""
import re
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

import config

# ── Classification des routes ────────────────────────────────────────────────
# PUBLIC (consultation) : lecture library, recherche/ask, lecture system.
_PUBLIC_RULES = [
    ("GET", re.compile(r"^/api/library/(documents|toc|facets|chunks|artifacts|"
                       r"artifact-binary|page-scan|page-scans|curriculum|benchmarks)$")),
    ("POST", re.compile(r"^/api/search/(hybrid|hybrid-multi|ask)$")),
    ("GET", re.compile(r"^/api/system/(health|engines|databases|settings)$")),
    ("GET", re.compile(r"^/(docs|openapi\.json|redoc)$")),  # documentation API
]
# Tout le reste est ADMINISTRATION (pipeline, llm, curriculum CRUD, sources,
# cycle de vie des bases, settings PUT, corrections PUT/POST, imports…).


def is_public(method: str, path: str) -> bool:
    return any(m == method and rx.match(path) for m, rx in _PUBLIC_RULES)


class _AskRateLimiter:
    """Fenêtre glissante 60 s par IP — mémoire process (mono-instance §7)."""

    def __init__(self):
        self._hits = defaultdict(deque)

    def allow(self, ip: str, per_min: int) -> bool:
        now = time.time()
        window = self._hits[ip]
        while window and now - window[0] > 60.0:
            window.popleft()
        if len(window) >= per_min:
            return False
        window.append(now)
        return True


ask_limiter = _AskRateLimiter()


class AccessPolicyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method
        if not path.startswith("/api/") or method == "OPTIONS":
            return await call_next(request)

        public = is_public(method, path)

        # 1) Mode consultation : l'administration N'EXISTE PAS (404).
        if config.RAGDOM_READONLY and not public:
            return JSONResponse({"detail": "Not Found"}, status_code=404)

        # 2) Jeton d'administration (Palier 3).
        if not public and config.RAGDOM_AUTH_TOKEN:
            auth = request.headers.get("authorization", "")
            if auth != "Bearer %s" % config.RAGDOM_AUTH_TOKEN:
                return JSONResponse(
                    {"detail": "Jeton d'administration requis (Authorization: Bearer)"},
                    status_code=401)

        # 3) Quota /ask (protège les clés LLM contre l'épuisement).
        if path == "/api/search/ask" and config.RAGDOM_ASK_RATE_PER_MIN > 0:
            ip = request.client.host if request.client else "?"
            if not ask_limiter.allow(ip, config.RAGDOM_ASK_RATE_PER_MIN):
                return JSONResponse(
                    {"detail": "Quota de questions atteint — réessayez dans une minute."},
                    status_code=429)

        return await call_next(request)
