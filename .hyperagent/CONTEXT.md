# CONTEXT — État complet du projet RAGDom (MAJ 2026-08-23 — correctifs release intégrés)

## Identité du projet
Bibliothèque numérique scientifique **local-first** + version web complète.
Backend FastAPI (Python 3.9+/3.11) + moteur d'ingestion PDF **sci-engine**
(9 couches, engines/sci-engine/pipeline/) + SQLite (FTS5 + sqlite-vec 384d,
RRF k=60, seuils cosinus ≤0.45 / bm25 ≤-0.3) + frontend React 19/Vite 8.2.2/
React Router DOM 7.18.2/TS strict/Tailwind, arabe RTL par défaut, single-origin (FastAPI sert
frontend/dist, SPA fallback). Dockerfile multi-étages tout-en-un.
Cible locale utilisateur : Windows, c:\xampp\htdocs\RAGDom, `npm run dev` racine.

## Emplacements
- Dépôt : github.com/amichiamine/RAGDom — **branche unique de travail : main**
  (post-v1 GELÉE le 2026-08-22 sur ordre utilisateur — ne plus y pousser sauf
  demande expresse ; contenu identique à main au gel).
- LIVE : https://ragdom.onrender.com — service Render FREE Docker
  srv-da49300ae00c739urldg (owner tea-da491bn40ujc73d3q9b0, Francfort).
  Autodeploy INOPÉRANT → redéploiement par API après chaque push (skill render-ragdom).
  Disque ÉPHÉMÈRE 512 Mo RAM ; env : RAGDOM_LOW_MEMORY=true (encodeur ONNX = OOM
  kill sinon → recherche BM25 seule en ligne), RAGDOM_SEED_LLM_KEYS (4 clés Gemini
  de l'utilisateur, seed au boot), RAGDOM_AUTH_TOKEN, RAGDOM_READONLY=false.
- Corpus réel : sources/1AM/math/official-books/ (manuel scan 210 p, 52,7 Mo)
  + sources/1AM/math/sources/ (7 sujets dzexams). Embarqué dans l'image Docker
  (SOURCES_DIR=/app/sources).
- Bases pré-ingérées : release GitHub **corpus-1am-v1** (assets 239 Mo + 6,3 Mo),
  téléchargées au build (Dockerfile) → databases_publiees/ → copiées vers
  DATABASES_DIR au démarrage (main.py). La bibliothèque live renaît pré-chargée.

## État fonctionnel (tout VÉRIFIÉ en exécution réelle)
- **Studio de validation final** : scopes universels et multi-documents, routeur `/api/validation`, runs isolés, snapshots logiques, diffs, rapports et décisions accept/reject au niveau run. Les migrations additives/idempotentes 005/006/**007** couvrent notamment la copie SQLite, l'opération, les batchs, les états/progrès, les erreurs et les dates; `/execute` lance réellement le pipeline sur `validation_test_<run>.sqlite`, jamais sur l'officielle.
- **Inspecteur et navigation** : scans et binaires d'artefacts baseline/working sont servis depuis la bonne base; TOC, curriculum et benchmarks sont lus dans la working DB. Les deep-links Validation `db/run/doc/page` survivent à l'authentification via un `next` interne validé; les TOC legacy sans `parent_id` restent inspectables.
- **Sécurité release** : résolution stricte avant mutation, DTO sans champs supplémentaires, DB sanitisée, ownership cross-document contrôlé, éditions humaines protégées et acceptation atomique. Le hash optimiste couvre aussi les scans et benchmarks promus. Le namespace `validation_test_` est masqué des listings/health et interdit aux mutations, exports et duplications génériques; seules les routes Validation pilotent ses copies. Readonly masque Validation en 404.
- **Portabilité des sources Validation** : `/api/validation/runs/{id}/execute` conserve la priorité local-first d'un chemin direct existant vers un PDF, sinon relocalise un ancien chemin absolu Windows/Linux par son suffixe sous `sources/` vers le `SOURCES_DIR` courant. Le fallback par nom n'est admis que pour une correspondance unique; toute ambiguïté reste `BLOCKED`. Seule la working DB reçoit le chemin résolu, jamais l'officielle.
- **Exécution terminale** : l'annulation supprime tous les jobs reprenables de la copie et stoppe ses batchs; un run `CANCELLED` ne peut être ni repris par recovery ni ré-exécuté. Une requalification **mutante** avec `run_id` n'est permise que sur la working DB physique d'un run `COMPLETED`, puis resynchronise `working_json`; elle ne mute jamais l'officielle.
- **Preuves finales release** : pytest **161/161** en mode normal ET **161/161** avec `RAGDOM_LOW_MEMORY=true`; Vitest **17/17**; TypeScript/build Vite **8.2.2** vert (**3 711 modules**); `npm audit` **0 vulnérabilité**.
- Recherche RRF V5.1 : chaque canal BM25/vectoriel est filtré par son seuil avant fusion ; rangs FTS uniques par chunk et déterministes.
- Ingestion réelle 230/230 pages : sommaire 45 entrées (dérivé des titres),
  613 formules LaTeX, 230 scans WebP, corrections typées, réponse Gemini réelle
  sourcée (document+page+section) via /api/search/ask.
- Clés Gemini utilisateur : clé1 (…BuDQ) gemini-3.6-flash (quota jour épuisable),
  clé3 (…bZEg) gemini-flash-lite-latest ; clés 2/4 = projets Google BANNIS
  (403 partout, vérifié) mais seedées pour visibilité.
- UI : Automation en 6 onglets (Ingestion/Suivi/Contenus/Documents/Fournisseurs
  IA/Réglages) avec explorateur-éditeur de chunks multi-scopes ; Library =
  coquille library.php TOUJOURS active (dégradation sans curriculum, lecture de
  TOUT le contenu extrait, ?classic=1 pour l'ancien mode).

## Spécificités moteur ajoutées par les tests réels
- Couche 2 : OCR VLM de page entière (Tier 2 D3-B) — pages scannées transcrites
  par le provider vision (rotation clés), gate qualité pour polices non-Unicode,
  repli RapidOCR ; flag RAGDOM_VLM_PAGE_OCR (auto/false).
- Sommaire de repli dérivé des titres Markdown au finalize (orchestrator).
- Modèle LLM PAR CLÉ (active_model sur llm_keys, détection live ?key_id=,
  auto-détection robuste : 404 dépréciés/400 non-texte/403 par clé → parcours).
- Classifieur : ordinaux arabes (التمرين الأول → n°1).
- Worker multi-bases (relance en chaîne), reprise des files au démarrage,
  /pipeline/reprocess (purge+ré-ingestion scopée document/plage/chapitre).
