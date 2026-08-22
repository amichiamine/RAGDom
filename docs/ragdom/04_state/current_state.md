# État Actuel du Projet RAGDom

**Phase :** V3.11.1 — v1 complète + extensions Web-Ready et Parallélisme D4-B
**fusionnées sur une BRANCHE UNIQUE `main`** (plus de branche `post-v1` : tout est
sur `main`).
**Date de mise à jour :** 2026-08-22

> **Mémoire de reprise :** `.hyperagent/` à la racine du dépôt sert de mémoire de
> reprise inter-sessions (état d'avancement, décisions, points de reprise). À
> consulter au démarrage de toute session de travail.

## OPÉRATIONNEL SUR MAIN (preuves : pytest, bench réels, e2e)
- [x] Backend COMPLET : noyau agnostique, moteur sci-engine, **7 routers** exposant
      **60 routes** (décompte réel `grep -c '@router\.' backend/api/*.py` au 2026-08-22 :
      auth 4 · curriculum 5 · library 13 · llm 10 · pipeline 11 · search 3 · system 14),
      Key Manager (modèle par clé + auto-détection live), purge scopée, `/pipeline/reprocess`,
      reprise auto des files + chaînage multi-bases, OCR VLM de page entière (Tier 2), ask RAG, SSE
- [x] **Lot 1 sprint** : GET /library/page-scans (manifeste galerie), agrégats curriculum
      (per_term + global en SQL), filtres chunks (pedagogical_type/page_start/page_end/toc_id)
- [x] **Frontend pixel-perfect COMPLET (vagues A/B/C/D + audit croisé)** :
      moteur KaTeX monopasse (auto-guérison l.2128-2251 du template + 5 rubriques didactiques),
      ponts relationnels halo doré 2.3s, shell sidebar 320px + topbar blur + TabHost,
      les 6 onglets (Matrice 360°, Programme, Cours side-by-side 50/50, Exercices VIRTUALISÉS,
      Évaluations sujet/corrigé lazy, Galerie scans VIRTUALISÉE), Splash télémétrique (chunks de 35),
      CurriculumStudio (sortie du Mode Repli), ChunkEditor, TelemetryExplorer (SVG pur),
      DatabaseLifecycle, ArtifactImportModal, Command Palette Ctrl+K
      — Mode Repli Générique intact (zéro régression)
- [x] **Phase 5 partielle** : bench RAM 100 pages (plancher 57 / pic 489 ≤ 2048 / résiduel 356 Mo,
      86 pages/min), Recovery SIGTERM processus réel PASS, guide utilisateur
- [x] Audit statique croisé : 2 bugs bloquants-runtime corrigés (formes pagination getChunks
      et getPageScansManifest — perte silencieuse au-delà de la page 1)

## FUSIONNÉ SUR MAIN (ex-branche post-v1, désormais unique)
- [x] Lot Web-Ready (Phase 7) : RAGDOM_READONLY (admin absent = 404), auth Bearer,
      rate-limit /ask (429), verrou /reveal (403), CORS multi-origines, health.readonly
- [x] Phase 6 (D4-B) : layer_2_extract_v2 add-only, pool 2-3 workers par blocs,
      équivalence des sorties prouvée, flag RAGDOM_INTRA_PAGE_WORKERS
- [x] Déploiement Docker single-origin, bases publiées (release GitHub → databases_publiees/
      → seed DATABASES_DIR), RAGDOM_LOW_MEMORY (BM25 seul ≤512 Mo), RAGDOM_SEED_LLM_KEYS

## RESTE À FAIRE (machine cible uniquement)
1. ~~npm install + tsc + vite build~~ **FAIT le 2026-08-21 soir** (registre ouvert par l'utilisateur) :
   tsc strict **0 erreur** (1 corrigée : câblage pages_total de la carte ETA), build **OK**
   (1 647 modules). VITE_API_URL ajouté + wrangler.jsonc (vitrine Cloudflare Workers-assets).
2. Recette visuelle pixel-perfect sur base 2G réelle (checklist Lot 11 du sprint) + modèles
   rapid-*/fastembed au 1er run (RAGDOM_OFFLINE=false).
3. Tests Jest/Playwright (node_modules requis). Reliquat mineur PARTIE 8 : toggle densité,
   sélection en masse, Inspecteur de Cycle de Vie.
4. Chiffrement des clés LLM au repos (seul item Web-Ready restant). *(Le merge post-v1 → main
   est FAIT : branche unique `main`.)*

## Prochaine Action Prioritaire
Machine cible Windows : cloner, README §0, backend 47/47, npm install + build, ingérer un
premier manuel réel, peupler le curriculum via CurriculumStudio → les 6 onglets s'activent.


**MAJ 2026-08-21 (V3.8)** : modèle LLM par clé (active_model), POST /pipeline/reprocess (ré-exécution scopée), PipelineLauncher UI (lancer/ré-exécuter/stop/file), SourcesManager avec dossiers imbriqués + upload ciblé, 3 écarts d'audit Library corrigés. 53/53 tests, tsc/build verts.

**MAJ 2026-08-22 (Contrat de Portabilité)** : ajout de `tech_specs.md` §12.1 « Contrat de Portabilité de la Base Autonome » (contrat plug-and-play du `.sqlite` autonome : autonomie mono-fichier, ancrage in-situ `asset://artifacts/` + `asset://figures/`, familles v1 garanties + repli universel `raw_binary`, clé additive `semantic`, ordre de lecture + `area_ratio` >70 %, recette de conformité consommateur en 7 points) ; pointeur ajouté dans « Blueprint Master RAGDom.md » §5.3.

**MAJ 2026-08-22 (V3.11.1)** : alignement de la doc normative sur le code audité (le code fait référence) — décompte réel 60 routes / 7 routers, branche unique `main` (post-v1 fusionné), `.hyperagent/` = mémoire de reprise. Documenté côté specs : OCR VLM de page entière Tier 2 (RAGDOM_VLM_PAGE_OCR), modèle par clé + auto-détection live, /pipeline/reprocess + reprise/chaînage + sommaire de repli au finalize, déploiement Docker single-origin (bases publiées, RAGDOM_LOW_MEMORY), variables d'env web réelles, .env versionné pré-rempli sans secrets, formes {data,pagination}+alias, toc/curriculum non paginés.
