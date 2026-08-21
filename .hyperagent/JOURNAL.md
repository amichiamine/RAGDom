# JOURNAL des passes (le plus récent en premier)

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
