# État Actuel du Projet RAGDom

**Phase :** EXÉCUTION AUTONOME N°2 TERMINÉE — v1 complète livrée sur `main` ·
extensions post-v1 (Web-Ready + Parallélisme D4-B) livrées sur la branche `post-v1`
**Date de mise à jour :** 2026-08-21 (soir)

## OPÉRATIONNEL SUR MAIN (preuves : pytest 47/47, bench réels, e2e)
- [x] Backend COMPLET : noyau agnostique, moteur sci-engine 9 couches, 6 routers
      (48 routes avec le manifeste page-scans), Key Manager, purge scopée, ask RAG, SSE
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

## BRANCHE post-v1
- [x] Lot Web-Ready (Phase 7) : RAGDOM_READONLY (admin absent = 404), auth Bearer,
      rate-limit /ask (429), verrou /reveal (403), CORS multi-origines, health.readonly
- [x] Phase 6 (D4-B) : layer_2_extract_v2 add-only, pool 2-3 workers par blocs,
      équivalence des sorties prouvée, flag RAGDOM_INTRA_PAGE_WORKERS

## RESTE À FAIRE (machine cible uniquement)
1. ~~npm install + tsc + vite build~~ **FAIT le 2026-08-21 soir** (registre ouvert par l'utilisateur) :
   tsc strict **0 erreur** (1 corrigée : câblage pages_total de la carte ETA), build **OK**
   (1 647 modules). VITE_API_URL ajouté + wrangler.jsonc (vitrine Cloudflare Workers-assets).
2. Recette visuelle pixel-perfect sur base 2G réelle (checklist Lot 11 du sprint) + modèles
   rapid-*/fastembed au 1er run (RAGDOM_OFFLINE=false).
3. Tests Jest/Playwright (node_modules requis). Reliquat mineur PARTIE 8 : toggle densité,
   sélection en masse, Inspecteur de Cycle de Vie.
4. Post-v1 : chiffrement des clés LLM au repos (seul item Web-Ready restant) ; merge de
   la branche post-v1 quand un déploiement web est décidé.

## Prochaine Action Prioritaire
Machine cible Windows : cloner, README §0, backend 47/47, npm install + build, ingérer un
premier manuel réel, peupler le curriculum via CurriculumStudio → les 6 onglets s'activent.
