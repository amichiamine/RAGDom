# OPERATIONS — comment agir sur ce projet

## Dev local (machine utilisateur : Windows)
- `npm run dev` À LA RACINE : lance backend (venv auto-détecté, port libre auto)
  + frontend Vite (concurrently, scripts/dev-backend.mjs). Modes : --setup, --pytest.
- Backend seul : cd backend && python main.py (chemins auto-déduits, .env pré-rempli).
- Tests backend : `cd backend && python -m pytest tests/ -q --ignore=tests/bench_ram_100p.py` → **165/165**; rejouer aussi avec `RAGDOM_LOW_MEMORY=true` → **165/165**.
- Frontend : `cd frontend && npm test` → **17/17**; `npm run build` → TypeScript strict + Vite **8.2.2**, **3 711 modules**; `npm audit` → **0 vulnérabilité**. React Router DOM est verrouillé en **7.18.2**.

## Exploitation du Studio de validation
- Le Studio est dans Automation. Toujours faire `POST /api/validation/resolve-scope` avant `POST /api/validation/runs`; les scopes API sont `base`, `document`, `toc|chapter|course|title`, `page`, `page_range`, `page_selection` (l'UI traduit `database`→`base` et `selection`→`page_selection`).
- `POST /runs` crée une copie physique `validation_test_<run>.sqlite` par `Connection.backup`; appeler ensuite `POST /runs/{id}/execute`. Le pipeline complet et ses batches/jobs tournent uniquement sur cette copie, jamais sur l'officielle.
- À l'exécution, un chemin direct existant vers un PDF est accepté en priorité (local-first). Sinon, l'API relocalise les anciens chemins absolus Windows/Linux en prenant le suffixe situé sous `sources/` et en le rattachant au `SOURCES_DIR` courant; le chemin résolu n'est persisté que dans la working DB. Le fallback par nom de fichier exige une correspondance unique sous `SOURCES_DIR` : plusieurs correspondances restent `BLOCKED`.
- Le détail expose `CREATED/QUEUED/RUNNING/COMPLETED/BLOCKED/FAILED/CANCELLED`, progression, opération, batch(s), copie et erreur. `BLOCKED` signifie notamment PDF source officiel absent ou nom ambigu; aucun contenu officiel n'a alors changé.
- `accept` et `reject` s'appliquent au **run entier**. Reject supprime copie/WAL/SHM; accept vérifie le hash de toutes les lignes promues — scans et benchmarks inclus — et les éditions humaines, promeut transactionnellement le scope depuis la copie, puis la supprime.
- L'inspecteur sert les scans/binaires d'artefacts baseline ou working depuis la base demandée et lit TOC/curriculum/benchmarks dans la working DB. Les bases legacy dont `document_toc` n'a pas `parent_id` restent compatibles.
- Le frontend suit seulement le run ouvert par polling toutes les 5 s; GET détail réconcilie aussi un batch après restart. Aucun SSE Validation dédié. Après authentification, le paramètre `next` interne restaure le deep-link `db/run/doc/page`; aucune URL externe n'est acceptée.
- En `RAGDOM_READONLY=true`, les routes Validation sont administratives et renvoient 404.
- `cancel` supprime de la copie tous les jobs dans un état reprenable et stoppe les batchs actifs : recovery retourne 0, et le run `CANCELLED` ne peut pas être ré-exécuté.
- Une requalification **mutante** avec `run_id` n'est autorisée que sur la working DB physique d'un run `COMPLETED`; l'API ouvre cette copie, borne aux pages du run, puis resynchronise `working_json`. Elle ne cible jamais la base officielle. Toute autre situation retourne 409.
- Le namespace `validation_test_` est réservé : caché des listings/health, non exportable/duplicable et interdit aux mutations génériques; passer exclusivement par `/api/validation`.

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
- Render FREE : 512 Mo → `RAGDOM_LOW_MEMORY=true` obligatoire. Le scan passe alors de 300 à **150 DPI**; deskew, Sauvola, rapid-layout, rapid-latex-ocr et rapid-table sont sautés. RapidOCR reste activé par défaut : seul moteur ONNX, il n'est chargé que pour une page scannée; le désactiver au besoin avec `RAGDOM_LOW_MEMORY_OCR=false`. Une page native ne charge aucun OCR. `RAGDOM_VLM_PAGE_OCR=auto` est désactivé dans ce mode; utiliser `true` seulement comme opt-in explicite. `page_scans` persiste le DPI réel. Deux recettes live antérieures au durcissement ont provoqué un restart Render juste après le lancement de la page 1; la prochaine recette doit confirmer un run page 1 sans restart.
- google-genai : version PyPI réelle = 0.8.0 (0.8.3 n'existe pas).
- Dockerfile python:3.11-slim : PAS de curl par défaut (installé désormais).
- Les listes de modèles Gemini contiennent des modèles 404 (dépréciés nouveaux
  comptes) et non-texte (400) → toujours parcourir jusqu'au premier qui répond.
- TestClient sans `with` ne déclenche PAS le lifespan (tests ≠ reprise de files).
- page_scans : colonnes width_px/height_px ; pagination API {data, pagination}.
