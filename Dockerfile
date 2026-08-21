# ============================================================================
# RAGDom — Image tout-en-un (Phase 7) : UN build = UN artefact = UN processus.
#   docker build -t ragdom .
#   docker run -p 8000:8000 -v ragdom_data:/data ragdom
# → http://localhost:8000 sert l'UI ET l'API (single-origin, zéro CORS).
#
# Étage 1 : compilation du frontend (équivalent de `npm run build`).
# Étage 2 : backend Python (whitelist gelée tech_specs §8) + dist/ copié.
# Cloudflare & co ne peuvent pas exécuter ce backend (binaires natifs) — tout
# hébergeur de CONTENEURS le peut (VPS, Fly.io, Railway, Render, Coolify…).
# ============================================================================

# ── Étage 1 : build frontend ────────────────────────────────────────────────
FROM node:20-alpine AS ui
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ── Étage 2 : backend + UI ──────────────────────────────────────────────────
FROM python:3.11-slim AS runtime
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# Outils de compilation : uniquement pour llama-cpp-python (LLM local optionnel).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt \
    # Procédure post-install obligatoire tech_specs §8 : garantir le headless.
    && pip uninstall -y opencv-python || true \
    && pip install opencv-python-headless==4.10.0.84 numpy==1.26.4

COPY backend/ backend/
COPY engines/ engines/
COPY --from=ui /app/frontend/dist frontend/dist

# Données persistantes (sources, bases, modèles) : volume /data.
ENV SOURCES_DIR=/data/sources \
    DATABASES_DIR=/data/databases \
    PIPELINE_SET_DIR=/data/pipeline_set \
    MODELS_DIR=/data/models \
    ENGINES_DIR=/app/engines \
    CONFIG_DB_PATH=/data/ragdom_config.sqlite \
    BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=8000 \
    FRONTEND_URL=http://localhost:8000 \
    RAGDOM_OFFLINE=false
VOLUME /data
EXPOSE 8000

WORKDIR /app/backend
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
