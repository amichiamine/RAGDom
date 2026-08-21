# État Actuel du Projet RAGDom

**Phase :** Phases 0-3 TERMINÉES · Phase 4 : Mode Repli Générique LIVRÉ (parité pixel-perfect
curriculum = sprint restant) · Phase 5 : backend validé (46 routes live), build frontend à rejouer sur machine cible
**Date de mise à jour :** 2026-08-21

## OPÉRATIONNEL (preuves : pytest 35/35, serveur live 46 routes, e2e PDF réel)
- [x] Backend COMPLET : noyau agnostique (orchestrateur, registre moteurs, Option A/B),
      moteur sci-engine 9 couches, 6 routers (46 routes dont purge scopée 7 niveaux,
      ask RAG, SSE, corrections humaines, curriculum CRUD, sources/bases/settings),
      Key Manager rotation/backoff/fallback Ollama
- [x] Frontend (49 fichiers) : fondations verbatim + 3 vues fonctionnelles Mode Repli —
      IndexView KPIs, LibraryView (TOC, side-by-side KaTeX/scans, Search+Ask),
      AutomationView (SSE, ETA, PurgeStudio, Quarantine, Settings, KeyManager, Sources)
- [x] Calibration réelle : bm25_score_threshold -0.3 (docs synchronisées)

## RESTE À FAIRE (backlog assumé, priorisé)
1. Machine cible : npm install + npx tsc --noEmit + vite build (frontend/VALIDATION.md) ;
   modèles rapid-*/fastembed au 1er run (RAGDOM_OFFLINE=false) ; llama-cpp-python si GGUF local.
2. Phase 4 parité pixel-perfect : 6 onglets curriculum (library.php), Splash Screen, halo doré,
   ponts relationnels — s'active via CurriculumStudio + bases 2G réelles.
3. PARTIE 7/8 UI restants : ChunkEditor, CurriculumStudio, TelemetryExplorer, DatabaseLifecycle,
   ArtifactImportModal, Command Palette, densité, virtualisation react-virtual (après npm).
4. D.O.D restants : benchmarks RAM 3 paliers PDF 100 pages, Recovery SIGTERM processus réel,
   Jest/Playwright (node_modules requis).

## Blocages
- Registre npm inaccessible dans le sandbox (403 pare-feu) — demande d'accès envoyée,
  contournement documenté dans frontend/VALIDATION.md. Aucun autre blocage.

## Prochaine Action Prioritaire
- Machine cible : cloner le dépôt, suivre README §0 + frontend/VALIDATION.md, lancer
  backend+frontend, ingérer un premier manuel réel, puis sprint parité pixel-perfect.
