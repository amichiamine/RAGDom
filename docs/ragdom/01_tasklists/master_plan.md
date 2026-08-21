# Plan Global Macro — Projet RAGDom

*Mis à jour le 2026-08-21 (clôture de l'exécution autonome + ajout Phase 7).*

## Phase 0 : Initialisation & Architecture — ✅ TERMINÉE
- [x] Création de l'arborescence physique du projet (/backend, /frontend, /docs...) — FAIT 2026-08-21
- [x] Génération de schema_core.sql + schema_vec.sql — EXTRAITS PROGRAMMATIQUEMENT de tech_specs §1 (zéro retranscription), validés par exécution SQLite
- [x] Configuration de l'environnement Python (venv + whitelist installée ; déviation Python 3.9 documentée dans feedback_log)
- [x] Configuration de l'environnement Node.js (package.json, Vite, Tailwind) — fichiers livrés ; `npm install`+build à rejouer sur machine cible (frontend/VALIDATION.md)
- [x] Vérification pip réelle et gel de la whitelist — FAIT 2026-08-21 : rapid-layout 0.4.0, rapid-table 3.0.2, rapid-latex-ocr 0.0.9, fastembed 0.7.4, numpy 1.26.4 pivot, zéro torch (voir tech_specs §8)

## Phase 1 : Backend — Pipeline d'Ingestion (Couches 0 à 7) — ✅ TERMINÉE (commit e59e7d9, pytest 21/21, e2e PDF réel)
- [x] main.py + uvicorn (FastAPI) — démarrage vérifié, health/engines/databases répondent
- [x] db/connection.py — sanitisation ?db=, init_vector_support Option A/B, migrations, ragdom_config.sqlite
- [x] db/schema_core.sql + db/schema_vec.sql appliqués conditionnellement + schema_version (v4)
- [x] core/engine_registry.py + engines/sci-engine/engine.json — chargement importlib par chemin de fichier
- [x] Couches implémentées dans /engines/sci-engine/pipeline/ (noyau /backend agnostique — V3.4) :
- [x] layer_0_cv.py (Restauration Visuelle 300 DPI, deskew, Sauvola/CLAHE)
- [x] layer_1_triage.py (natif fitz / rapid-layout gardé, TOC)
- [x] layer_2_extract.py (pymupdf4llm/RapidOCR, crops WebP, needs_vlm)
- [x] layer_3_qualify.py (regex FR/AR/EN, pedagogical_index, chunking, embeddings 384d)
- [x] layer_3bis_link.py (SolutionLinker — liaisons Énoncé→Corrigé post-document, testé ex7↔corrigé7)
- [x] layer_4_lint.py (< 5ms, NEEDS_VLM)
- [x] layer_5_vlm.py (conditionnel, repair_content)
- [x] layer_6_bench.py (confiance heuristique)
- [x] layer_7_persist.py (transaction ACID, page_scans image+thumb, ré-ingestion préservant is_human_edited)
- [x] core/orchestrator.py — queue séquentielle stricte, recovery, skip READY, isolation par page, batchs, événements SSE (testé)

## Phase 2 : Backend — API REST — ✅ TERMINÉE (commit 0f02c43, pytest 35/35, 46 routes live)
- [x] routes_system.py — databases/health/vector-engine/engines + admin §7.6 (sources, cycle de vie bases, settings whitelistés)
- [x] routes_library.py — documents/toc/facets/chunks/artifacts/page-scan binaire/curriculum GET/benchmarks/PUT corrections/import Tier 3
- [x] routes_pipeline.py — start (4 modes), status/queue, stop, purge scopée 7 niveaux + dry_run, quarantine+retry, SSE
- [x] routes_search.py — hybrid RRF k=60 + seuils réels (bm25 recalibré -0.3), hybrid-multi, ask (zéro LLM sans contexte)
- [x] llm/key_manager.py (rotation, backoff, fallback Ollama) + routes_llm + routes_curriculum (CRUD 4 tables + import)
- [x] Tests Pytest : 35/35 PASSED (12 socle + 9 e2e moteur + 14 API réelle)

## Phase 3 : Frontend — Fondations & Design System — ✅ TERMINÉE (commit 8d2ce08, 49 fichiers)
- [x] Initialisation Vite + React 19 + TypeScript + Tailwind (configs verbatim Frontend_UI_Specs)
- [x] lib/api.ts (Client API centralisé, types V3.2 complets)
- [x] App.tsx + React Router (3 vues) + contexts (ActiveDb, Engine, Theme, Locale ar/fr/en)
- [x] Charte graphique (index.css intégral : tokens couleurs, typographie, motion V3.3)

## Phase 4 : Frontend — Vues & Composants — 🟡 MODE REPLI LIVRÉ · parité pixel-perfect = sprint dédié
- [x] CHECKPOINT Règle 8 : templates /Template_UI-UX/ reçus d'ArchiSys3.0 et imprégnés (inventaire exhaustif de library.php réalisé)
- [x] IndexView.tsx (Dashboard métriques réelles)
- [x] LibraryView.tsx — Mode Repli Générique (TOCExplorer + SideBySideViewer + SearchStudio + AskStudio)
- [ ] LibraryView 6 onglets pixel-perfect (Splash, Matrice 360°, Programme, Cours, Exercices, Évaluations, Scans) → **voir sprint_pixel_perfect.md (11 lots)**
- [x] SideBySideViewer.tsx (KaTeX/scans ; mode fluide 50/50 avancé → sprint pixel-perfect Lot 6)
- [x] ArtifactRenderer.tsx (familles de base ; extension 25 familles au fil des besoins réels)
- [x] SearchStudio.tsx (RRF) — extension multi-bases → sprint pixel-perfect
- [x] Carte ETA & Débit (AutomationView — D4-A)
- [x] AutomationView.tsx (Terminal SSE, PurgeStudio, Quarantine, Settings, KeyManager, Sources)
- [ ] Tests Jest + Playwright (nécessite node_modules — machine cible)

## Phase 4B : Administration & Couverture Totale — 🟡 PARTIELLE
- [x] Routes backend §7.6 (100 % — voir Phase 2)
- [x] AskStudio.tsx · PurgeStudio.tsx (7 portées + dry-run + double saisie) · QuarantineManager · SourcesManager · SettingsPanel · KeyManager · OnboardingEmptyState + ConnectionGuard
- [ ] ChunkEditor.tsx (correction humaine, aperçu KaTeX live) → dépend du moteur KaTeX (sprint Lot 3)
- [ ] CurriculumStudio.tsx (sortie du Mode Repli) → sprint Lot 10
- [ ] TelemetryExplorer.tsx (graphe) · DatabaseLifecycle.tsx (UI export/duplicate/delete) · ArtifactImportModal.tsx
- [ ] PARTIE 8 restants : virtualisation @tanstack/react-virtual, toggle densité, sélection en masse, Command Palette Ctrl+K, Inspecteur de Cycle de Vie, compteurs animés

## Phase 5 : Intégration, Tests & Documentation — 🔴 À FAIRE (machine cible)
- [ ] `npm install` + `npx tsc --noEmit` + `vite build` (frontend/VALIDATION.md) — bloqué sandbox (registre npm 403)
- [ ] Tests d'intégration End-to-End complets (Playwright)
- [ ] Benchmarks RAM 3 paliers (plancher / pic / non-fuite) sur PDF 100 pages + Baseline de débit
- [ ] Test Recovery SIGTERM (processus réel)
- [ ] Documentation utilisateur finale

## Phase 6 (OPTIONNELLE, post-v1) : Parallélisme Intra-Page Borné (D4-B)
- [ ] Activable uniquement si la Baseline de débit le justifie
- [ ] Pool 2-3 workers par blocs d'une même page (module_v2, add-only, garantie RAM maintenue)

## Phase 7 (POST-v1) : Déploiement Web — 📘 DOCUMENTÉE (voir 02_walkthroughs/phase7_deploiement_web.md)
> Le Local-First reste le mode nominal (atelier d'ingestion). Le web est une projection de la même architecture pour la CONSULTATION. Incompatible serverless/edge ; serveur classique requis.
- [ ] **Lot Web-Ready** (préalable à toute exposition) : flag `RAGDOM_READONLY` (montage sélectif des routers), auth Bearer sur routers admin, rate-limit /ask, chiffrement clés LLM au repos + /reveal verrouillé, CORS multi-origines, champ `readonly` dans /health + masquage Vue 3
- [ ] Palier 1 — Tunnel (cloudflared → localhost:8000, frontend statique hébergé) : usage perso/démo
- [ ] Palier 2 — Publication de bases (RECOMMANDÉ) : ingestion locale → export .sqlite (Base Autonome) → VPS en mode consultation
- [ ] Palier 3 — Full Web : stack complet sur VPS (upload sources + ingestion à distance), exige le Lot Web-Ready complet
