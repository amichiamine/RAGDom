# JOURNAL des passes (le plus récent en premier)

## 2026-08-23 — Mode Render 512 Mo final, OCR opt-in
- Deux recettes live ont provoqué un restart Render après le lancement de la page 1 sur l'instance 512 Mo. Pour éviter un troisième restart, le profil `RAGDOM_LOW_MEMORY=true` ne charge désormais **aucun moteur ONNX par défaut**.
- Le scan passe de **300 à 150 DPI** uniquement dans ce mode; deskew, Sauvola, rapid-layout, rapid-latex-ocr et rapid-table sont sautés. RapidOCR est lui aussi désactivé par défaut et ne s'active qu'avec l'opt-in explicite `RAGDOM_LOW_MEMORY_OCR=true`.
- Sans cet opt-in, une page scannée reste **image-only** à 150 DPI dans la working DB; l'interface et `processing_benchmarks` la signalent avec `ImageOnly-LowMemory`. Elle pourra être retraitée ultérieurement sur un environnement plus large ou avec l'opt-in OCR.
- Une page native conserve l'extraction texte PyMuPDF sans ONNX. L'OCR VLM de page entière en mode `auto` reste désactivé sous 512 Mo; seul `RAGDOM_VLM_PAGE_OCR=true` constitue un opt-in explicite. `page_scans` persiste le DPI réellement utilisé.
- Preuves finales inchangées : pytest **165/165** en mode normal et **165/165** avec `RAGDOM_LOW_MEMORY=true`; Vitest **17/17**; `npm audit` **0 vulnérabilité**.

## 2026-08-23 — Portabilité finale des chemins sources Validation
- `POST /api/validation/runs/{id}/execute` accepte d'abord tout chemin direct existant vers un PDF (comportement local-first), puis relocalise les anciens chemins absolus Windows/Linux en réutilisant leur suffixe sous `sources/` dans le `SOURCES_DIR` courant.
- En dernier recours, un nom de fichier n'est accepté que s'il correspond à un unique PDF sous `SOURCES_DIR`; un nom ambigu ou une source introuvable laisse le run `BLOCKED`.
- Le chemin résolu est écrit uniquement dans la working DB `validation_test_<run>.sqlite`; la base officielle conserve sa provenance et reste inchangée. Test de non-régression Windows/Linux ajouté; suite backend finale **161/161** dans les modes normal et faible mémoire.

## 2026-08-23 — Hotfix de vérification runtime Render
- Le premier déploiement du Studio a révélé deux états dégradés sans perte de service : `vec_chunks` était réinséré en bloc avec `INSERT OR REPLACE` (collision de clé primaire dans vec0) et 40 lignes curriculum legacy multi-documents restaient sans propriétaire.
- Correctif vectoriel : le backfill ne reconstruit `vec_chunks` que si les comptes divergent ; reconstruction par suppression/réinsertion, puis réouverture idempotente sans doublons.
- Correctif curriculum : programmes attribués via `competencies_json.toc_id`, assessments via leurs chunks, liens via leurs entités ; les termes réellement globaux peuvent rester sans document sans dégrader le health.
- Preuves locales : pytest **161/161** normal et **161/161** faible mémoire ; tests ciblés réouverture vec0 et backfill multi-documents verts.

## 2026-08-23 — Correctifs release finaux documentés
- **Exécution physique** : la migration additive/idempotente **007** ajoute à `validation_runs` working DB, opération, batch(s), état/progression, erreur et dates. `POST /runs` crée la copie `validation_test_<run>.sqlite` par `Connection.backup`; `/execute` y lance réellement le pipeline, sans mutation officielle avant acceptation.
- **Inspection complète** : le Studio lit scans et binaires d'artefacts baseline/working depuis la base correspondante; TOC, curriculum et benchmarks proviennent de la working DB. L'inspection tolère aussi les schémas TOC legacy dépourvus de `parent_id`.
- **Décision et concurrence** : accept/reject restent atomiques au niveau du run. Le `baseline_hash` courant couvre toutes les lignes promues, y compris `page_scans` et `processing_benchmarks`; une modification officielle concurrente de l'un de ces éléments ferme l'acceptation en 409, sans écrasement.
- **Confinement** : le namespace `validation_test_` est réservé, masqué de la découverte/health et non exportable/duplicable; les mutations génériques library/curriculum/pipeline y sont refusées. Une requalification mutante avec `run_id` est autorisée uniquement sur la copie physique d'un run `COMPLETED`, puis resynchronise `working_json`; l'officielle n'est jamais ciblée.
- **Annulation** : cancel supprime tous les jobs actifs/reprenables de la working DB et stoppe ses batchs. Recovery ne peut pas ressusciter le run, et `/execute` refuse un run `CANCELLED`.
- **Frontend/auth** : les deep-links Validation `db/run/doc/page` (query et hash inclus) sont conservés après login via un paramètre `next` limité aux routes internes sûres; les redirections externes ou inconnues retombent sur `/automation`.
- **Qualité finale rejouée** : pytest **161/161** normal puis **161/161** avec `RAGDOM_LOW_MEMORY=true`; Vitest **17/17**; build TypeScript strict + Vite **8.2.2** vert (**3 711 modules**); React Router DOM **7.18.2**; `npm audit` **0 vulnérabilité**.
- **Prochaine action** : push de `feat/validation-integration`, déploiement, puis recette live.

## 2026-08-22 20:58 — V5.1 : seuils par canal avant fusion RRF
- **Cause racine mesurée** : les 20 voisins vectoriels contribuaient tous au RRF,
  même avec une distance supérieure au seuil 0,45, dès que le chunk restait éligible
  par BM25. Sur le mini-manuel réel, les distances 4,20 / 5,33 / 5,61 (toutes hors
  seuil) inversaient le rang lexical : le chunk BM25 n°2 + vecteur n°1 passait devant
  le chunk BM25 n°1 + vecteur n°3.
- **Correctif** : filtrage indépendant BM25/vectoriel AVANT calcul des rangs et fusion ;
  ordre FTS déterministe ; rang BM25 unique par chunk en conservant sa meilleure ligne
  FTS (un artefact lié peut indexer une seconde ligne pour le même chunk).
- **Non-régression** : nouveau test synthétique avec voisins vectoriels hors seuil +
  ligne FTS d'artefact dupliquée ; test API qui échouait désormais vert en mode hybride.
- **Qualité locale** : pytest 106/106 en mode hybride complet ET 106/106 avec
  RAGDOM_LOW_MEMORY=true ; tsc strict 0 ; build Vite vert.

## 2026-08-22 20:15 — V5 : composition didactique + familles paramétriques + CURRICULUM AUTO
- **CURRICULUM AUTOMATIQUE (zéro LLM)** : nouveau curriculum_builder.py — peuple
  terms/programs/assessments/content_links depuis TOC L1 + chunks classés +
  documents typés sujets. Idempotent, NON-DESTRUCTIF (marqueur {"source":"auto"}
  dans les JSON libres — les lignes CurriculumStudio survivent), rien créé sur un
  document sans structure (Mode Repli préservé). Câblé au finalize
  (RAGDOM_AUTO_CURRICULUM, défaut true) + route admin POST /api/curriculum/build.
  EXÉCUTÉ SUR LE LIVE : official-books {lessons:40, solutions:13} et sources
  {lessons:15, exercises:7, solutions:7} → curriculum_available=true, l'onglet
  Matrice 360° S'ACTIVE AUTOMATIQUEMENT (vérifié navigateur + après reboot).
- **FAMILLES PARAMÉTRIQUES (§12 étendu)** : number_line (min/max/step/points/
  segments) et decimal_grid (rows/cols/cells couleurs fermées) — le qualifieur
  VLM sort des PARAMÈTRES validés strictement, le front redessine en SVG natif
  toujours net (ParametricFigures.tsx, chiffres LTR, dixièmes colonne-major,
  comparateur + badge d'état). Production de données au fil des requalifications
  (quotas) ; renderers prêts et testés.
- **COMPOSITION DIDACTIQUE** : chaque artefact = cadre titré (bandeau coloré par
  la sémantique : demonstration=indigo, illustration=cyan, exercise_support=ambre),
  badges famille/état/sémantique, pied explicatif anti-doublon, variante inline,
  cadre minimal pour crops non qualifiés. VÉRIFIÉ LIVE : 47 cadres rendus dans la
  galerie, 0 erreur console.
- Qualité : pytest 94 passés (+21 nets : 11 curriculum_builder + 11 qualifier
  paramétrique, retranchés recouvrements) / 11 échecs sandbox préexistants ;
  tsc strict 0 ; build Vite vert ; bases republiées (curriculum inclus) +
  redeploy clearCache — curriculum_available=true confirmé APRÈS reboot.
- Limites honnêtes : terme unique synthétique (aucun marqueur de trimestre
  exploitable dans le corpus) ; course_exercise per-term faible (1) sur cette
  base (contrainte du contrat _curriculum_aggregates) ; 0 assessment sur ces
  bases (documents sources en doc_type=unknown — typage des sujets à venir) ;
  variante inline des cadres pas encore branchée dans le flux du cours.

## 2026-08-22 19:20 — V4.4 : EXPLOSION CV-FIRST (zéro LLM) + hygiène LaTeX — TOUS les cadres explosés
- **Constat utilisateur validé** : « les mêmes quotas suffisaient à l'autre moteur » —
  exact. Le goulot n'était pas le quota mais NOTRE patron d'appel (image pleine page
  + JSON géant → 429 immédiat sur la clé forte, flash-lite incapable). Remède
  architectural : le maximum se fait SANS LLM.
- **NOUVEAU frame_segmenter.py** : segmentation locale CPU (XY-cut par profils de
  projection, cv2+numpy, ~0,5 s/cadre sandbox). Route requalify-artifacts :
  `strategy:"cv"` (défaut) | `"vlm"` (historique).
- **RÉSULTAT EN PRODUCTION** : 217 cadres non-échec + 46 vlm_failed retryés =
  **TOUS les cadres pleine page explosés, frames=0 atteint DEUX fois** (flux normal
  + retry_failed). **+2 142 sous-artefacts créés/ancrés, 0 échec, 0 appel LLM.**
  Base : 993 → **3 135 artefacts**. Republiée (301,4 Mo) + redeploy clearCache.
- **HYGIÈNE LaTeX de bout en bout** (rouge brut constaté par l'utilisateur, cause :
  raw_data avec délimiteurs $$ embarqués — 612 artefacts — exposés par le fix F8,
  + throwOnError:false qui peint les erreurs en rouge en comptant le rendu comme
  structuré, + repli text-danger du pipeline markdown) :
  frontend stripMathDelimiters + repairLatex + renderKatexStrict (réussit ou repli
  NEUTRE), data_table au raw_data LaTeX array redirigé vers KaTeX ; backend
  _sanitize_latex dans le qualifieur + garde d'ancrage (jamais d'insertion au
  milieu d'un bloc $$). VÉRIFIÉ LIVE : 0 rouge, 0 $$ visible, 0 begin{array} brut,
  0 erreur console.
- **BUG DOCKER LATENT TROUVÉ ET CORRIGÉ (cv2 absent de l'image web !)** :
  opencv-python et opencv-python-headless partagent le dossier cv2/ ; le
  `pip uninstall opencv-python` du Dockerfile SUPPRIMAIT les fichiers, et le
  `pip install headless` suivant répondait « already satisfied » sans rien réécrire
  → ModuleNotFoundError: cv2 au runtime (cassait silencieusement TOUTE ingestion
  web). Fix : --force-reinstall --no-deps + `python -c "import cv2"` au build.
  Diagnostiqué par sonde d'inventaire dans le 503 (numpy/PIL/fitz ok, cv2 absent).
- **RESTE (quotas uniquement)** : qualification VLM des 2 142 nouveaux crops par
  petits appels — clés 1 ET 3 sont parties en 429 (quotas JOUR épuisés par la
  journée entière de travail). Boucle idempotente prête :
  `enrich_loop.py qualify 230 10` en rafales au réarmement quotidien (les crops
  non qualifiés s'affichent proprement en attendant : crop + badge أصل + comparateur).
  38 crops marqués vlm_failed_at aujourd'hui → `retry_failed` les reprendra.
- Pièges neufs consignés : lots CV calibrés pour le CPU 0.1 du FREE (limit<=6,
  ~25 s/lot ; limit 50 = timeout HTTP + verrou d'écriture tenu ~10 min par le lot
  survivant — « database is locked » pour tout appel concurrent) ; les réponses
  client peuvent mourir alors que le lot serveur CONTINUE et committe.

## 2026-08-22 17:45 — V4.3 EN PRODUCTION : vérifié live + données corrigées + enrichissement
- **Déploiements** : dep-da4rlbgjo6nc73dtggkg (code V4.3, build Docker Render vert =
  npm install + tsc + vite build validés avec mermaid/plotly) puis
  dep-da4s3r67bikc73ahv3ag (données corrigées, **clearCache obligatoire** — piège :
  le cache de build Docker fige la couche qui télécharge les assets de release ;
  sans {"clearCache":"clear"} un redéploiement SERT LES ANCIENNES BASES).
- **Enrichissement des données (exécuté sur le live)** : les 98 illustrations ≤70 %
  jamais soumises ont TOUTES été requalifiées (candidats restants = 0) →
  geometry_vector 21→50, data_table +3, matrix +1, sémantique posée (~50 nouveaux
  badges). Bases exportées, CORRIGÉES HORS-LIGNE (nouveau calcul TOC + nouvelle
  classification + linker), republiées en assets corpus-1am-v1, redéployées.
- **Vérifié AU NAVIGATEUR sur le live (0 erreur console)** :
  capsules de pages : 0 plage « X-210 » (échantillons : ص 10, ص 11-25, ص 26) ;
  badges d'état de rendu VISIBLES (1431 « مُهيكل » / 42 « أصل ») ;
  ponts « مسح ص N » présents (259) ; onglet Exercices : **8 exercices** (était 0) ;
  sidebar : Cours 40, Exercices 8, Évaluations 0 (les 2 anciens étaient des faux
  positifs « BAC »=angle — purgés ; les vrais sujets vivent dans 1AM_math_sources).
- **État final de la base official-books** : 993 artefacts, **701 structurés (70 %)**
  — latex 605/613, geometry_vector 50/50, data_table 35/40, matrix 8/8, plot 2/2,
  flowchart 1/1, dense_illustration 279 (267 cadres pleine page + photos + échecs).
- **RESTE (quotas Gemini)** : explosion des cadres pleine page IMPOSSIBLE aujourd'hui :
  la clé1 (gemini-3.6-flash) part en 429 sur CHAQUE appel image pleine page (blocage
  ~20 min à chaque tentative), et flash-lite (clé3) échoue sur le JSON complexe
  d'explosion (42 cadres marqués vlm_failed_at aujourd'hui, retryables). La réussite
  du matin (124 sous-artefacts) passait vraisemblablement par la clé …7890 ajoutée
  EN UI et PERDUE au reboot (absente de RAGDOM_SEED_LLM_KEYS). REPRISE :
  (1) idéalement ré-ajouter une clé à quota frais (UI Fournisseurs IA ou seed env) ;
  (2) python3 skills/ragdom-live-admin/enrich_loop.py explode 240 8 en rafales
  jusqu'à frames=0, PUIS {"retry_failed":true} pour les 42+4 marqués ;
  (3) export des 2 bases → republication assets → redeploy AVEC clearCache.
- Pièges neufs consignés : RunWithCredentials coupe à 300 s (borner les rafales à
  ~240 s) ; un lot requalify serveur CONTINUE même si le client HTTP est coupé
  (verrou d'écriture → 500 sur les appels suivants tant que le lot tourne).
## 2026-08-22 16:05 — V4.3 : GO Complet — conformité multimodale et structurelle totale
- Mandat utilisateur : « combler tous les trous, Production Ready », GO permanent.
  4 agents parallèles (backend pipeline, backend structure, frontend rendu,
  frontend navigation) + agent doc + agent vérification tsc.
- **Backend** : (1) layer_2_extract_v2 câble désormais la qualification VLM
  séquentielle post-pool + l'ancrage in-situ (helpers v1 réutilisés, équivalence
  prouvée par exécution, test_phase6_parallel 3/3) — le mode parallèle ne produit
  plus 0 % de structuré ; (2) sommaire dérivé INCRÉMENTAL pendant l'ingestion
  (RAGDOM_TOC_INCREMENTAL_EVERY, défaut 10, 0=off, jamais d'écrasement du natif) ;
  (3) BUG plages « ص X-210 » : le successeur de niveau <= N devait être STRICTEMENT
  postérieur — corrigé dans _build_toc_from_headings + page_end calculé aussi pour
  le TOC natif (layer_1_triage, fini les NULL) ; sur base réelle : 20 entrées
  aberrantes → 1 ; (4) classification arabe : normalisation harakat, marqueurs nus
  (تمرين/نشاط/وضعية/أتذكر/أتحقق/أطبق), solutions AVANT exercices, faux positifs
  BAC/Tp éliminés — base réelle : 0→8 exercise_unsolved, 6 faux positifs purgés ;
  (5) /library/chunks expose linked_solution_chunk_id + toc_id + filtre has_solution.
- **Frontend** : renderer du contrat §12 lu EN PRIORITÉ (repli heuristique) ;
  mermaid 11 + plotly.js-dist-min EMBARQUÉS (imports dynamiques, chunks async) ;
  BADGE D'ÉTAT DE RENDU sur chaque artefact (مُهيكل/أصل/عارض غير مثبت) calculé sur
  le rendu EFFECTIF — réponse directe à la confusion utilisateur ; badge de type
  in-situ ; data_table via tanstack-table (tri) ; comparateur étendu mermaid/plotly ;
  asset:// résolu dans lib/markdown.ts (SideBySideViewer réparé) ; formules sans
  binaire rendues (plus masquées) ; capsules de plages fiabilisées côté client ;
  ponts dorés bidirectionnels exercice↔corrigé + chunk→scan + badges de type
  effectif dans Cours (aucun contenu masqué) ; préchargement des artefacts par
  plage de pages (fini le repli image transitoire des ancres).
- **Dev local** : scripts/fetch_published_dbs.mjs + npm run fetch:dbs (seed des
  bases publiées depuis la release corpus-1am-v1) — répond à « la Library locale
  est vide » : sans seed ni ingestion, il n'y a simplement aucune base localement.
- **Qualité** : pytest 73 passés / 11 échoués sandbox (baseline STRICTEMENT
  identique avant/après) ; tsc strict EXIT 0 sur l'état fusionné via harnais
  jsdelivr (registre npm bloqué dans le sandbox — demande d'accès en attente) ;
  une VRAIE erreur TS2665 (declare module plotly inline) détectée et corrigée
  (déplacée dans src/plotly-shim.d.ts) — elle aurait cassé le build Render.
  LIMITE HONNÊTE : le build Vite complet n'a pas pu tourner dans le sandbox
  (registre npm bloqué) — il est validé par le build Docker de Render (déploiement
  atomique : en cas d'échec, l'ancien déploiement reste live).
- Docs alignées : Blueprint §5.2/§6.2/§7.2/§7.4, tech_specs §3.6/§10/§12,
  current_state (V4.3), changelog racine + changelog vivant 04_state, README §0bis
  (seed local), GUIDE_UTILISATEUR §5, backend/.env (RAGDOM_TOC_INCREMENTAL_EVERY).

## 2026-08-22 14:30 — V4.2 : FIX boucle explode + GRAND AUDIT multimodal + bases sécurisées
- **BUG BLOQUANT CORRIGÉ (routes_pipeline.py)** : le filtre d'exclusion de
  `/pipeline/requalify-artifacts` omettait `vlm_exploded_at` (il ne retirait que
  `vlm_failed_at`/`vlm_qualified_at`). Conséquence mesurée sur le live : avec
  `{"explode":true,"limit":12}`, le lot sélectionné était **12/12 cadres DÉJÀ
  explosés** (pages 1-9) → doublons de sous-artefacts + d'ancres, quota Gemini
  brûlé, boucle ne convergeant JAMAIS vers frames=0. Correctif : `vlm_exploded_at`
  TOUJOURS exclu (même sous `retry_failed`, qui vise les échecs, pas les succès)
  + garde défensive d'idempotence dans `_explode_fullpage_frames`.
  Preuve par exécution (SQLite reproduisant l'état live) : ancienne clause = 12
  doublons ; nouvelle = 0 doublon et convergence frames=0 en 2 passes.
  Non-régression : pytest 73 passés / 11 échoués AVANT comme APRÈS (échecs dus aux
  deps absentes du sandbox, baseline identique vérifiée par git stash).
- **BASES ENRICHIES SÉCURISÉES** : les assets de la release `corpus-1am-v1`
  dataient du 22/08 11:30 UTC, soit AVANT l'enrichissement V4.1 — le disque Render
  étant ÉPHÉMÈRE, tout redémarrage/spin-down aurait PERDU les 12 cadres explosés et
  leurs sous-artefacts. Export authentifié des 2 bases live
  (`GET /api/system/databases/{f}/export`) → republication en assets de release.
  Le TODO de republication du 12:45 est donc SOLDÉ ; un redéploiement est sûr.
- **ÉTAT RÉEL MESURÉ** (SQL direct sur la base live, 993 artefacts) :
  latex_formula 613 (605 structurés), dense_illustration 312 (**0 structuré**),
  data_table 37 (32), geometry_vector 21 (21), matrix 7, signal_waveform 2,
  flowchart 1 → **67 % structurés / 33 % restés bitmap**. Marqueurs :
  exploded 12, qualified 43, failed 4. Sémantique : exercise_support 72,
  illustration 26, demonstration 5. Ancrage in-situ : 45/255 chunks.
  Renderers déclarés : katex 620, openseadragon 213, tanstack-table 37, svg 21,
  plotly 2, mermaid 1 (→ 99 dense_illustration sans render_config_json du tout).
- **RESTE À TRAITER** : 155 cadres pleine page à exploser + 98 illustrations
  ≤70 % JAMAIS soumises au VLM (quotas Gemini quotidiens).
- **AUDIT — écarts doc↔code identifiés** (détail dans AUDIT_MULTIMODAL.md) :
  1) `layer_2_extract_v2.py` (mode parallèle, RAGDOM_INTRA_PAGE_WORKERS>=2) NE
     QUALIFIE JAMAIS les illustrations — aucun appel au qualifier => 0 % structuré
     dans cette configuration.
  2) PDF natif : tout bloc non-texte typé `image` (layer_1_triage) et branches
     formula/table mortes en natif => formules/tableaux vectoriels → images.
  3) Frontend : `render_config_json.renderer` JAMAIS lu ; routage par sous-chaîne
     de `artifact_type` (detectFamily). 5 des 9 familles « v1 garanties » sont
     dégradées en image (flowchart/signal_waveform/smiles_chem/code_snippet/
     dense_illustration) ; data_table rendu en markdown, pas tanstack-table.
  4) Renderers mermaid/plotly/ketcher/shiki NON installés (confirmé package.json).
  5) AUCUN indicateur ne distingue « rendu structuré fidèle » de « image de repli »
     → c'est exactement la confusion signalée par l'utilisateur.
  6) `MarkdownContent`/`lib/markdown.ts` ne résolvent pas `asset://artifacts/{id}`
     => images cassées dans SideBySideViewer.
- **Clés Gemini 2 et 4 : verdict définitif** — 403 PERMISSION_DENIED constant
  (listing des modèles OK, `generateContent` refusé), reproduit 2x à 3 s d'écart.
  Ce n'est PAS un rate-limit (qui renverrait 429) : projets Google bannis/API non
  activée. Diagnostic antérieur CONFIRMÉ par test live.
- Accès vérifiés : PAT GitHub (scope `repo`, push:true), RENDER_API_KEY (service
  ragdom non suspendu, branche main). Skills créées : `ragdom-live-admin`
  (RAGDOM_AUTH_TOKEN — les routes admin sont derrière Bearer), `render-ragdom`.
- **VÉRIFIÉ EN PRODUCTION (14:39)** : deploy dep-da4qcbjm8hqs73d67d3g LIVE sur
  commit b0027e8. Bases intactes après redémarrage (993 + 30 artefacts) grâce à la
  republication. Test de fumée `{"explode":true,"limit":1}` : la boucle a
  sélectionné la page **14** (premier cadre NEUF) au lieu de repiocher les pages
  1-13 déjà traitées → correctif confirmé de bout en bout en réel.
- **Piège découvert** : le redéploiement réinitialise AUSSI `ragdom_config.sqlite`
  → les `key_id` changent à chaque boot et `active_model` est perdu. Après deploy,
  toujours refaire `GET /api/llm/keys`. Nouveaux états : clé1 (BuDQ) **429** quota
  épuisé (se réarme), clé3 (bZEg) **OK** flash-lite, clés 2/4 **403** définitif.
  Le contraste 429 vs 403 prouve que 2/4 ne sont PAS un problème de quota.

## 2026-08-22 12:45 — V4.1 : EXPLOSION des cadres pleine page (dernière passe, suite)
- Comparaison PDF↔base (p27) : la couche CV ne segmente qu'UN bloc pleine page sur
  les pages denses → les opérations posées/encadrés/schémas internes n'étaient pas
  extraits individuellement. REMÈDE LIVRÉ : requalify-artifacts {"explode":true} —
  le VLM liste chaque élément visuel (type+forme structurée+bbox norme 0-1000
  auto-détectée), chacun reçoit SON crop WebP découpé (comparateur), son ancre
  in-situ, sa sémantique. 124 sous-artefacts créés/ancrés en réel (dont matrices
  d'opérations posées LaTeX + tableaux + géométrie).
- RESTE À FAIRE (quotas/budget) : ~127 cadres du manuel — commande de reprise :
  POST /pipeline/requalify-artifacts {"db":"1AM_math_official-books.sqlite",
  "explode":true,"limit":12,"pace_s":4} en boucle jusqu'à frames=0 ; puis
  re-publier les 2 .sqlite en assets de la release corpus-1am-v1 et redéployer.
## 2026-08-22 12:10 — Passe finale : consultation visuelle + consignation
- Vérification navigateur directe du live V4.0 : texte+KaTeX+SVG in-situ+comparateurs
  +galerie+badges opérationnels, 0 erreur console. Voir BILAN_FINAL.md (limites
  honnêtes + procédure de reprise). Fin de mandat sur budget.
## 2026-08-22 11:15 — V4.0 : MULTIMODAL STRUCTURÉ PORTABLE (contrat consolidé 7 messages)
- Qualifieur VLM toutes familles (artifact_qualifier.py) : geometry/dessins libres/
  opérations posées (LaTeX array)/diagrammes états-structures/organigrammes (Mermaid)/
  courbes (Plotly JSON)/matrices/tableaux/chimie (SMILES)/code + SÉMANTIQUE pédagogique
  (demonstration/illustration/exercise_support dans render_config_json).
- ANCRAGE in-situ : ![caption](asset://artifacts/{id}) écrit dans content_markdown
  (marqueurs [[FIGURE:n]] au prompt OCR, tri y0/x0, repli au ratio de paragraphe) —
  base .sqlite plug-and-play (contrat consigné tech_specs §12.1).
- Originaux WebP TOUJOURS conservés (comparateur UI : structuré/original/comparer).
- POST /pipeline/requalify-artifacts (corpus existant, sans ré-OCR, idempotent).
- Frontend : ancres rendues in-situ par famille, badges sémantiques, galerie de
  contrôle dédupliquée, area_ratio>0.7 masqués. 84 tests, tsc 0, 0 dépendance ajoutée.
- Guide déploiement HTML refondu exhaustif (46,7 Ko autonome).
## 2026-08-22 03:05 — V3.12 : GRAND AUDIT 4 axes + mise en conformité totale
- Audits parallèles : live-navigateur (0 erreur console, 2 écarts), contrats
  front↔back (1 bloquant key_id, 2 latents db manquant, types mensongers),
  backend profond (500 sur db invalide ×8 routes, agrégats cours/évals faux,
  TOC dérivé non-reconstruit après reprocess scopé), conformité doc (14 items
  corrigeables + 4 arbitrages).
- TOUT corrigé : wrapper 404/400 commun, agrégats justes (33/7 cours, 4/2 évals),
  TOC dérivé reconstruit si non-natif, splitter \n/espace, fallback embedder
  L6-v2, warning sécurité boot, key_id, db params, mapping badges sidebar,
  toggle densité, sélection en masse quarantaine, inspecteur cycle de vie 🔬.
- Doc alignée : tech_specs §3.6.1 (OCR VLM), §10 (env web), §14 (non paginés) ;
  Blueprint §3.1 (modèle par clé), §7.4 (reprocess/reprise), §5.4 (déploiement) ;
  current_state (60 routes, main unique). 55/55 tests, tsc 0.
- Env web live vérifiés conformes : reveal=false, ask rate=12, token défini.
- Multi-bases : parallélisme confirmé (ThreadPoolExecutor) — arbitrage B4 clos.
## 2026-08-22 02:00 — V3.11.1 : chargement infini élucidé AU NAVIGATEUR
- Le fix V3.11 ne suffisait pas : effet React auto-annulant dans CoursTab
  (`loading` dans les deps → setLoading(true) relance l'effet → cleanup
  alive=false → réponse jetée, spinner éternel, ZÉRO erreur console).
- Leçon de méthode : les preuves curl ne suffisent pas pour l'UI — vérifier
  au NAVIGATEUR (BrowserEvaluate : hooks console.error + window.onerror,
  performance.getEntriesByType pour tracer les requêtes réelles).
## 2026-08-22 01:40 — V3.11 : Library rend enfin TOUT (multimodal inclus)
- Causes racines corrigées : api.ts typait {chunks} alors que l'API renvoie {data}
  (chargement infini) ; useCurriculumDoc ne chargeait qu'UN document par base
  (exercices/évaluations invisibles sur bases multi-docs) ; onglet Cours exigeait
  un TOC niveau 1 (base examens illisible) ; assessments vide → Évaluations vide.
- Rendu MULTIMODAL ajouté (PageMedia) : 252 illustrations/schémas WebP, 8 tableaux,
  formules-images — affichés sous le texte de chaque page (Cours + mode classic),
  clic → HD. Repli documents-comme-chapitres ; Évaluations en vis-à-vis
  sujet/corrigé depuis les chunks typés ; Exercices agrégés multi-documents.
- Preuves curl sur bases réelles ; tsc 0 erreur ; build vert.

## 2026-08-22 (nuit) — Tests réels corpus 1AM → V3.8→V3.9.2 + .hyperagent/
- Corpus utilisateur ingéré en réel (230 p) ; 3 bugs pipeline corrigés en direct
  (OCR arabe scanné → VLM Tier 2 ; sommaire scans → dérivation titres ; worker
  multi-bases orphelin → chaîne + reprise au boot).
- Clés Gemini testées : 2 valides (modèles par clé), 2 projets bannis (403).
  Quota clé1 épuisé par l'OCR (429) — se réarme quotidiennement.
- /ask réel : réponse arabe sourcée (doc+page+section). OOM 512 Mo → LOW_MEMORY.
- UI : Automation 6 onglets (dont explorateur-éditeur Contenus) ; Library
  affiche TOUT le contenu extrait ; coquille library.php toujours active.
- Bases pré-ingérées livrées en release corpus-1am-v1, pré-chargées au boot.
- post-v1 GELÉE (ordre utilisateur) ; main = branche unique. .hyperagent/ créé.
- Render bascule branche → main ; deploys dep-da4dqhjm8hqs738vcqs0, dep-da4dt8vqj5pc73cv39lg.

## 2026-08-21 (soir) — V3.8 : 4 chantiers + refontes UI
- Modèle par clé, PipelineLauncher (lancer/ré-exécuter/stop), dossiers sources
  imbriqués à l'upload, audit Library 43/43 après 3 correctifs.
- Historique antérieur : voir docs/ragdom/04_state/ (changelog complet).
