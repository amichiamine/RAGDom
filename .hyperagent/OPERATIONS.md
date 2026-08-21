# OPERATIONS — comment agir sur ce projet

## Dev local (machine utilisateur : Windows)
- `npm run dev` À LA RACINE : lance backend (venv auto-détecté, port libre auto)
  + frontend Vite (concurrently, scripts/dev-backend.mjs). Modes : --setup, --pytest.
- Backend seul : cd backend && python main.py (chemins auto-déduits, .env pré-rempli).
- Tests : cd backend && python -m pytest tests/ -q --ignore=tests/bench_ram_100p.py
  (53 verts attendus). Frontend : cd frontend && npx tsc --noEmit && npm run build.

## Skills Hyperagent (credentials chiffrés côté plateforme)
- **render-ragdom** (RENDER_API_KEY) : FetchSkillScripts puis RunWithCredentials.
  Scripts utiles à (ré)écrire dans /agent/workspace/skills/render-ragdom/ :
  redeploy.py (POST /v1/services/srv-da49300ae00c739urldg/deploys puis poll),
  set_env (GET env-vars → merge → PUT ; ABANDONNER si GET ≠ 200 — PUT destructif).
- **github-pat-ragdom** (GITHUB_PAT) : push git natif (binaire >100 Mo interdit
  dans le dépôt → assets de release). Le PAT n'est jamais affiché/loggé.
- Intégration GitHub OAuth (MCP) : ExecuteIntegration github__push_files avec
  paramsFile (texte uniquement). En panne d'outils : flux OAuth device GitHub
  (client_id gh CLI 178c6fc778ccc68e1d6a) — l'utilisateur autorise sur
  github.com/login/device, jeton en mémoire, purgé après usage.

## Déploiement web
1. Push sur **main** uniquement.
2. Redéployer : RunWithCredentials(render-ragdom, "python3 …/redeploy.py").
3. VÉRIFIER live : /api/system/health, /api/system/databases, une recherche
   hybride réelle, le bundle JS (grep d'un marqueur de la feature).
Gros binaires (bases .sqlite) : release GitHub (assets ≤ 2 Go) + téléchargement
au build Docker (déjà câblé pour corpus-1am-v1) → databases_publiees/.

## Pièges connus (payés cher — ne pas re-tomber dedans)
- pkill/pgrep avec motif de sa propre commande = suicide shell → kill par PID.
- Render FREE : 512 Mo → encodeur ONNX = OOM kill (RAGDOM_LOW_MEMORY=true en ligne).
- google-genai : version PyPI réelle = 0.8.0 (0.8.3 n'existe pas).
- Dockerfile python:3.11-slim : PAS de curl par défaut (installé désormais).
- Les listes de modèles Gemini contiennent des modèles 404 (dépréciés nouveaux
  comptes) et non-texte (400) → toujours parcourir jusqu'au premier qui répond.
- TestClient sans `with` ne déclenche PAS le lifespan (tests ≠ reprise de files).
- page_scans : colonnes width_px/height_px ; pagination API {data, pagination}.
