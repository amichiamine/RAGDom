# Sprint en cours — Sprint 1 : Couches du Moteur sci-engine

- [ ] layer_0_cv.py (Restauration Visuelle : pixmap 300 DPI, blur Laplacien, deskew, Sauvola/CLAHE)
- [ ] layer_1_triage.py (rapid-layout, ratio vectoriel/bitmap, TOC fitz.get_toc + DBSCAN)
- [ ] layer_2_extract.py (PyMuPDF4LLM + RapidOCR + rapid-latex-ocr + rapid-table)
- [ ] layer_3_qualify.py (regex FR/AR/EN, pedagogical_type + pedagogical_index)
- [ ] layer_3bis_link.py (SolutionLinker post-document)
- [ ] layer_4_lint.py (linters déterministes < 5ms)
- [ ] layer_5_vlm.py (Key Manager + fallback — squelette conditionnel)
- [ ] layer_6_bench.py (métrologie psutil)
- [ ] layer_7_persist.py (transaction ACID : chunks + artifacts + page_scans + benchmarks)
- [ ] Tests D.O.D : Memory 3 paliers, Recovery SIGTERM, INVALID_SOURCE, Linter <5ms, Base Autonome
