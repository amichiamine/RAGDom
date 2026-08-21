# -*- coding: utf-8 -*-
"""sci-engine — Couche 0 : Restauration Visuelle (Blueprint §5.2, tech_specs §2.1).

Pixmap 300 DPI en mmap, variance du Laplacien (flou), deskew, binarisation
Sauvola pour l'OCR. Produit le RestorationResult dans ctx (width/height inclus
— V3.5, source unique des dimensions BBox). Checkpoint JSON dans /pipeline-set/.
Python 3.9+.
"""
import json
import os
import time

import cv2
import numpy as np


def run(ctx: dict) -> dict:
    started = time.perf_counter()
    job, document = ctx["job"], ctx["document"]
    page_number = job["page_number"]
    try:
        import fitz  # PyMuPDF — accès mmap natif
        doc = fitz.open(document["source_path"])
        if doc.needs_pass:
            doc.close()
            ctx.update(status="INVALID_SOURCE", error="PDF protégé par mot de passe")
            return ctx
        if page_number < 1 or page_number > doc.page_count:
            doc.close()
            ctx.update(status="INVALID_SOURCE", error="Page %d hors du document (%d pages)" % (page_number, doc.page_count))
            return ctx
        page = doc.load_page(page_number - 1)
    except Exception as exc:  # noqa: BLE001 — fichier corrompu/illisible => INVALID_SOURCE
        ctx.update(status="INVALID_SOURCE", error="Ouverture impossible : %s" % exc)
        return ctx

    # 1. Pixmap 300 DPI en mémoire tampon (jamais le PDF entier).
    matrix = fitz.Matrix(300 / 72, 300 / 72)
    pixmap = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB, alpha=False)
    img = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

    # 2. Évaluation du flou (variance du Laplacien).
    blur_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    # 3. Détection d'angle & rotation inverse (deskew sur copie réduite = rapide).
    deskew_angle = 0.0
    is_native_vector = len(page.get_text("text").strip()) > 40
    if not is_native_vector:  # inutile de redresser un rendu vectoriel natif
        try:
            from deskew import determine_skew
            small = cv2.resize(gray, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
            angle = determine_skew(small)
            if angle is not None and 0.2 < abs(angle) < 30:
                deskew_angle = float(angle)
                center = (img.shape[1] // 2, img.shape[0] // 2)
                rot = cv2.getRotationMatrix2D(center, deskew_angle, 1.0)
                img = cv2.warpAffine(img, rot, (img.shape[1], img.shape[0]),
                                     flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
                gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        except Exception:  # noqa: BLE001 — un deskew raté ne bloque jamais la page
            deskew_angle = 0.0

    # 4. Binarisation adaptative Sauvola + CLAHE (pour l'OCR uniquement — le scan
    #    persisté dans page_scans reste l'image restaurée couleur).
    binarized = gray
    if not is_native_vector:
        try:
            from skimage.filters import threshold_sauvola
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
            thresh = threshold_sauvola(clahe, window_size=25)
            binarized = ((clahe > thresh) * 255).astype(np.uint8)
        except Exception:  # noqa: BLE001 — repli binarisation Otsu
            _, binarized = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    ctx.update(
        status="SUCCESS",
        page_id=job["id"],
        blur_variance=round(blur_variance, 2),
        deskew_angle=round(deskew_angle, 2),
        is_native_vector=is_native_vector,
        width_px=int(img.shape[1]),
        height_px=int(img.shape[0]),
        restored_rgb=img,           # np.ndarray RGB — persisté en WebP par la Couche 7
        binarized_gray=binarized,   # pour RapidOCR (couche 2)
        cv_latency_ms=int((time.perf_counter() - started) * 1000),
        _fitz={"doc": doc, "page": page, "pixmap": pixmap},  # purgé par la Couche 7
    )
    # Checkpoint de reprise (état minimal, jamais le pointeur — tech_specs §2.1).
    ckpt_dir = os.path.join(ctx["config"]["pipeline_set_dir"], document["id"])
    os.makedirs(ckpt_dir, exist_ok=True)
    with open(os.path.join(ckpt_dir, "page_%03d_state.json" % page_number), "w", encoding="utf-8") as fh:
        json.dump({"page_id": job["id"], "status": "PROCESSING_CV", "page_number": page_number}, fh)
    ctx.setdefault("latencies", {})["layer_0_cv"] = ctx["cv_latency_ms"]
    return ctx
