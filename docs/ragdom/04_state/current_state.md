# État Actuel du Projet RAGDom

**Phase :** Phase 1 TERMINÉE (Backend Pipeline complet) → Phase 2 : API REST
**Date de mise à jour :** 2026-08-21
**Sprint actuel :** Sprint 2 — Routes API (library, search, pipeline+SSE, llm, administration §7.6)

## Ce qui est OPÉRATIONNEL (preuve : pytest 21/21 PASSED, 4.4s)
- [x] Noyau : orchestrateur (queue stricte, recovery, skip READY, batchs, clôture + job_complete),
      registre moteurs, connexion Option A/B, config DB, routes system live
- [x] Moteur sci-engine COMPLET : couches 0→7 + 3bis dans /engines/sci-engine/pipeline/
      · L0 : pixmap 300 DPI, blur Laplacien, deskew, Sauvola/CLAHE, checkpoint
      · L1 : blocs natifs fitz / rapid-layout gardé, TOC outlines
      · L2 : PyMuPDF4LLM + RapidOCR + rapid-latex-ocr/table gardés, artefacts LaTeX/images/tableaux
      · L3 : qualification regex FR/AR/EN + pedagogical_index, chunking 512t/15%, embeddings fastembed gardés
      · L3bis : SolutionLinker post-document (testé : exercice n°7 ↔ corrigé n°7)
      · L4 : linters déterministes (mesuré < 5ms) · L5 : VLM conditionnel (Key Manager Phase 2)
      · L6 : métrologie psutil/confiance · L7 : transaction ACID (page_scans WebP+thumb+dims,
        ré-ingestion propre is_human_edited préservé, purge mémoire + checkpoints)
- [x] E2E réel : PDF 3 pages → 3 READY, batch COMPLETED, FTS interrogeable, Base Autonome vérifiée
      (copie .sqlite seule = 100% servie), INVALID_SOURCE sans arrêt

## Ce qui est EN COURS
- [ ] Sprint 2 : routes_library / routes_search (hybrid RRF + ask) / routes_pipeline (start/stop/purge/
      quarantine + SSE) / routes_llm + llm/key_manager.py / routes administration §7.6

## Blocages & Points d'Attention
- Incident reproduit et résolu : rapid-* a tiré opencv-python complet (libGL) → procédure
  post-install tech_specs §8 appliquée (notre propre documentation a servi de fix) ; numpy
  repinné 1.26.4 après le force-reinstall.
- RAGDOM_OFFLINE=true en sandbox : modèles rapid-layout/latex/table + fastembed non téléchargés
  (HF inaccessible ici) — chemins de repli testés ; sur la machine cible : téléchargement au 1er run.

## Prochaine Action Prioritaire
- Sprint 2 : llm/key_manager.py (rotation 429/401/backoff, fallback Ollama) puis les 5 routers.
