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
