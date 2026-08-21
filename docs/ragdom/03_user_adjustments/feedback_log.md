# Feedback Log — ArchiSys3.0

## 2026-08-21 — GO global (phases 0→5)
ArchiSys3.0 : « initialise-toi à lancer l'implémentation et réalisation complète de RAGDom
jusqu'à son aboutissement complet suivant sa documentation ». Interprété comme GO global ;
rapports de tests livrés à chaque phase, commits GitHub par phase. Le Checkpoint Règle 8
(templates PHP) reste bloquant avant la Phase 4.

## 2026-08-21 — Déviations d'environnement (Règle 7, documentées)
1. Sandbox Linux (implémentation) vs machine cible Windows c:\xampp\htdocs\RAGDom :
   chemins portés par backend/.env (mécanisme prévu). Code 100% portable.
2. Python 3.9.25 disponible (spec : 3.10-3.13, recommandé 3.11) : code écrit en syntaxe
   3.9-compatible (typing.Optional, %-format) — fonctionne à l'identique en 3.11.
3. llama-cpp-python : installation différée (compilation C longue sur 2 vCPU) —
   sera installé à la Phase du Key Manager local ; les SDKs cloud suffisent avant.

## 2026-08-21 — Templates PHP reçus (Checkpoint Règle 8, prérequis Phase 4)
ArchiSys3.0 a fourni Template_UI-UX.zip : index.php (35 Ko), library.php (135 Ko),
automation.php (51 Ko) — archivés dans /Template_UI-UX/. L'imprégnation intégrale
(lecture complète des 3 fichiers + croisement avec Frontend_UI_Specs) sera exécutée
à l'entrée en Phase 4, conformément à la Règle 8.

## 2026-08-21 — Incident opencv reproduit en réel (validation de la doc)
Le piège documenté en tech_specs §8 s'est produit tel que prévu (rapid-* → opencv-python
complet → libGL manquant, 8 tests e2e rouges). La procédure post-install documentée l'a
résolu en 2 commandes ; numpy repinné 1.26.4. La documentation a prouvé sa valeur.

## 2026-08-21 — Recalibration du seuil BM25 (mesure en conditions réelles)
Sur corpus réel, bm25() d'un bon match ≈ -0.7…-1.5 : le défaut -1.5 rejetait presque
tout. Recalibré à -0.3 (code + app_settings + les 4 documents normatifs), mécanisme
app_settings/SettingsPanel utilisé comme conçu. Preuve : suite API 35/35 après.
