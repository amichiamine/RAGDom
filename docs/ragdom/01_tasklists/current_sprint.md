# Sprint en cours — Sprint 1 : Couches du Moteur sci-engine

- [x] layer_0_cv.py (Restauration Visuelle : pixmap 300 DPI, blur Laplacien, deskew, Sauvola/CLAHE)
- [x] layer_1_triage.py (rapid-layout, ratio vectoriel/bitmap, TOC fitz.get_toc + DBSCAN)
- [x] layer_2_extract.py (PyMuPDF4LLM + RapidOCR + rapid-latex-ocr + rapid-table)
- [x] layer_3_qualify.py (regex FR/AR/EN, pedagogical_type + pedagogical_index)
- [x] layer_3bis_link.py (SolutionLinker post-document)
- [x] layer_4_lint.py (linters déterministes < 5ms)
- [x] layer_5_vlm.py (Key Manager + fallback — squelette conditionnel)
- [x] layer_6_bench.py (métrologie psutil)
- [x] layer_7_persist.py (transaction ACID : chunks + artifacts + page_scans + benchmarks)
- [x] Tests D.O.D : Memory 3 paliers, Recovery SIGTERM, INVALID_SOURCE, Linter <5ms, Base Autonome

**Sprint 1 TERMINÉ le 2026-08-21 — pytest 21/21 PASSED (e2e réel sur PDF généré).**
