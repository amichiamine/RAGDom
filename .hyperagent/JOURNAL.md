# JOURNAL des passes (le plus récent en premier)

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
