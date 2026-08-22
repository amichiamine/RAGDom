# JOURNAL des passes (le plus récent en premier)

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
