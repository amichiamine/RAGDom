# JOURNAL des passes (le plus récent en premier)

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
