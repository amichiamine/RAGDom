# OPERATIONS — comment agir sur ce projet

## Dev local (machine utilisateur : Windows)
- `npm run dev` À LA RACINE : lance backend (venv auto-détecté, port libre auto)
  + frontend Vite (concurrently, scripts/dev-backend.mjs). Modes : --setup, --pytest.
- Backend seul : cd backend && python main.py (chemins auto-déduits, .env pré-rempli).
- Tests backend : `cd backend && python -m pytest tests/ -q --ignore=tests/bench_ram_100p.py` → **154/154** attendus; rejouer aussi avec `RAGDOM_LOW_MEMORY=true` → **154/154**.
- Frontend : `cd frontend && npm test` → **13/13**; `npm run build` (TypeScript strict + Vite **8.2.2**) ; `npm audit` → **0 vulnérabilité**. React Router DOM est verrouillé en **7.18.2**.

## Exploitation du Studio de validation
- Le Studio est dans Automation. Toujours faire `POST /api/validation/resolve-scope` avant `POST /api/validation/runs`; les scopes API sont `base`, `document`, `toc|chapter|course|title`, `page`, `page_range`, `page_selection` (l'UI traduit `database`→`base` et `selection`→`page_selection`).
- `POST /runs` crée une copie physique `validation_test_<run>.sqlite` par `Connection.backup`; appeler ensuite `POST /runs/{id}/execute`. Le pipeline complet et ses batches/jobs tournent uniquement sur cette copie, jamais sur l'officielle.
- Le détail expose `CREATED/QUEUED/RUNNING/COMPLETED/BLOCKED/FAILED`, progression, opération, batch(s), copie et erreur. `BLOCKED` signifie notamment PDF source officiel absent; aucun contenu officiel n'a alors changé.
- `accept` et `reject` s'appliquent au **run entier**. Reject supprime copie/WAL/SHM; accept vérifie hash et éditions humaines, promeut transactionnellement le scope depuis la copie, puis la supprime.
- Le frontend suit seulement le run ouvert par polling toutes les 5 s; GET détail réconcilie aussi un batch après restart. Aucun SSE Validation dédié.
- En `RAGDOM_READONLY=true`, les routes Validation sont administratives et renvoient 404.
- Une requalification avec `run_id` n'est mutante que pour un run `COMPLETED`; elle est redirigée vers sa copie physique puis resynchronisée. Toute autre situation retourne 409.

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
- **Le disque Render est ÉPHÉMÈRE : tout redéploiement/spin-down réinitialise
  DATABASES_DIR *et* ragdom_config.sqlite.** Conséquences vérifiées le 2026-08-22 :
  (a) une base enrichie en ligne est PERDUE si elle n'a pas été republiée en asset
  de la release `corpus-1am-v1` — TOUJOURS exporter
  (`GET /api/system/databases/{f}/export`, route admin) puis republier AVANT de
  redéployer ; (b) les `key_id` des clés LLM CHANGENT à chaque boot (re-seed depuis
  RAGDOM_SEED_LLM_KEYS) et `active_model` est perdu → ne jamais mémoriser un key_id,
  toujours refaire `GET /api/llm/keys` ; la ré-auto-détection consomme du quota.
- **`autoDeploy: yes` est MENSONGER côté API Render** : un push sur main ne
  déclenche AUCUN déploiement (vérifié — dernier deploy resté sur le commit
  précédent après push). Toujours déclencher via `POST /v1/services/{id}/deploys`.
- **403 ≠ 429 sur Gemini** : 403 = PERMISSION_DENIED (projet banni / API non
  activée — clés 2 et 4, définitif) ; 429 = quota épuisé qui se réarme (clé 1).
  Le listing des modèles peut réussir alors que `generateContent` renvoie 403 :
  tester la GÉNÉRATION, jamais seulement le listing.
- pkill/pgrep avec motif de sa propre commande = suicide shell → kill par PID.
- Render FREE : 512 Mo → encodeur ONNX = OOM kill (RAGDOM_LOW_MEMORY=true en ligne).
- google-genai : version PyPI réelle = 0.8.0 (0.8.3 n'existe pas).
- Dockerfile python:3.11-slim : PAS de curl par défaut (installé désormais).
- Les listes de modèles Gemini contiennent des modèles 404 (dépréciés nouveaux
  comptes) et non-texte (400) → toujours parcourir jusqu'au premier qui répond.
- TestClient sans `with` ne déclenche PAS le lifespan (tests ≠ reprise de files).
- page_scans : colonnes width_px/height_px ; pagination API {data, pagination}.
