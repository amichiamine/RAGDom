# Plan Global Macro — Projet RAGDom

## Phase 0 : Initialisation & Architecture (Actuelle)
- [x] Création de l'arborescence physique du projet (/backend, /frontend, /docs...) — FAIT 2026-08-21
- [x] Génération de schema_core.sql + schema_vec.sql — EXTRAITS PROGRAMMATIQUEMENT de tech_specs §1 (zéro retranscription), validés par exécution SQLite
- [x] Configuration de l'environnement Python (venv + whitelist installée ; déviation Python 3.9 documentée dans feedback_log)
- [ ] Configuration de l'environnement Node.js (package.json, Vite, Tailwind)
- [x] Vérification pip réelle et gel de la whitelist — FAIT 2026-08-21 : rapid-layout 0.4.0, rapid-table 3.0.2, rapid-latex-ocr 0.0.9, fastembed 0.7.4, numpy 1.26.4 pivot, zéro torch (voir tech_specs §8)

## Phase 1 : Backend — Pipeline d'Ingestion (Couches 0 à 7)
- [x] main.py + uvicorn (FastAPI) — démarrage vérifié, health/engines/databases répondent
- [x] db/connection.py — sanitisation ?db=, init_vector_support Option A/B, migrations, ragdom_config.sqlite
- [x] db/schema_core.sql + db/schema_vec.sql appliqués conditionnellement + schema_version (v4)
- [x] core/engine_registry.py + engines/sci-engine/engine.json — chargement importlib par chemin de fichier, manifeste invalide ignoré avec WARN (testé)
- [ ] Couches 0→7 + 3bis ci-dessous : implémentées dans /engines/sci-engine/pipeline/ (le noyau /backend reste agnostique — V3.4)
- [ ] layer_0_cv.py (Restauration Visuelle)
- [ ] layer_1_triage.py (rapid-layout, TOC)
- [ ] layer_2_extract.py (Multi-moteurs)
- [ ] layer_3_qualify.py (Regex pédagogique)
- [ ] layer_3bis_link.py (SolutionLinker — liaisons Énoncé→Corrigé post-document)
- [ ] layer_4_lint.py (Linter < 5ms)
- [ ] layer_5_vlm.py (Key Manager + Fallback)
- [ ] layer_6_bench.py (Métrologie)
- [ ] layer_7_persist.py (ACID SQLite)
- [x] core/orchestrator.py — queue séquentielle stricte, recovery, skip READY, isolation par page, batchs, événements SSE (testé)

## Phase 2 : Backend — API REST (FastAPI Routes)
- [ ] routes_system.py (/api/system/*)
- [ ] routes_library.py (/api/library/*)
- [ ] routes_pipeline.py (/api/pipeline/* + SSE + /stop)
- [ ] routes_search.py (/api/search/hybrid + /api/search/hybrid-multi)
- [ ] llm/key_manager.py + /api/llm/*
- [ ] Tests Pytest (D.O.D. tech_specs.md section 5)

## Phase 3 : Frontend — Fondations & Design System
- [ ] Initialisation Vite + React 19 + TypeScript + Tailwind
- [ ] lib/api.ts (Client API centralisé)
- [ ] App.tsx + React Router (3 vues)
- [ ] Charte graphique (couleurs, typographie)

## Phase 4 : Frontend — Vues & Composants
- [ ] CHECKPOINT OBLIGATOIRE : Demande de confirmation à ArchiSys3.0 + Imprégnation et relecture intégrale des 3 fichiers de `/Template_UI-UX/` (index.php, library.php, automation.php)
- [ ] IndexView.tsx (Dashboard métriques réelles — index.php)
- [ ] LibraryView.tsx (6 onglets complets, Splash Screen, Scans rail, KaTeX 2G — library.php)
- [ ] SideBySideViewer.tsx (Sync-Scroll + Overlay Diff + Scans)
- [ ] ArtifactRenderer.tsx (25 familles d'artefacts)
- [ ] SearchStudio.tsx (RRF multi-bases)
- [ ] Sprint Curriculum & Mode Repli (GET /api/library/curriculum : tables peuplées → 6 onglets ; vides → exploration générique)
- [ ] Carte ETA & Débit (AutomationView — D4-A)
- [ ] AutomationView.tsx (Terminal SSE, Step-pills, Alerte Moteur Vectoriel, KeyManager — automation.php)
- [ ] Tests Jest + Playwright (D.O.D. section 5.2)

## Phase 4B : Frontend — Administration & Couverture Totale (V3.2 — Frontend_UI_Specs PARTIE 7)
- [ ] Routes backend §7.6 : /search/ask, /pipeline/purge (+dry_run), /pipeline/quarantine + retry, PUT chunks/artifacts, /system/sources*, /system/databases/{f}/export|duplicate|delete, /system/settings, /library/benchmarks, /curriculum/* CRUD + import, /library/artifacts/import
- [ ] AskStudio.tsx (chat RAG + citations cliquables + cas no_context)
- [ ] SearchStudio multi-bases (hybrid ↔ hybrid-multi)
- [ ] ChunkEditor.tsx (correction humaine, aperçu KaTeX live, is_human_edited)
- [ ] PurgeStudio.tsx (7 portées, modale d'impact dry-run, double saisie scope base)
- [ ] QuarantineManager.tsx (+retry) et SourcesManager.tsx (upload glisser-déposer)
- [ ] DatabaseLifecycle.tsx (export/dupliquer/supprimer) et SettingsPanel.tsx (seuils)
- [ ] TelemetryExplorer.tsx (benchmarks + agrégats + graphe Plotly)
- [ ] CurriculumStudio.tsx (CRUD 4 tables + import JSON — sortie du Mode Repli)
- [ ] ArtifactImportModal.tsx (import Tier 3)
- [ ] OnboardingEmptyState.tsx + ConnectionGuard.tsx + passe Accessibilité (§7.13)
- [ ] PARTIE 8 (V3.3) : tokens motion dans index.css + table d'application, virtualisation @tanstack/react-virtual (listes >100), toggle densité, sélection en masse + barre d'actions, Command Palette Ctrl+K, Inspecteur de Cycle de Vie par page, compteurs animés, couleurs de domaine algorithmiques (hash→HSL), badge moteur actif + token --engine-accent

## Phase 5 : Intégration, Tests & Documentation
- [ ] Tests d'intégration End-to-End complets
- [ ] Benchmarks RAM 3 paliers (plancher / pic / non-fuite) sur PDF 100 pages + Baseline de débit
- [ ] Test Recovery SIGTERM
- [ ] Documentation utilisateur

## Phase 6 (OPTIONNELLE, post-v1) : Parallélisme Intra-Page Borné (D4-B)
- [ ] Activable uniquement si la Baseline de débit le justifie
- [ ] Pool 2-3 workers par blocs d'une même page (module_v2, add-only, garantie RAM maintenue)
