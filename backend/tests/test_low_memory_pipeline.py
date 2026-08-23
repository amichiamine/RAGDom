# -*- coding: utf-8 -*-
"""Low-memory pipeline must not preload optional ONNX/VLM engines."""
import importlib.util
import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / "engines" / "sci-engine" / "pipeline"


def _load(filename, name):
    spec = importlib.util.spec_from_file_location(name, PIPELINE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_low_memory_loads_only_required_ocr(monkeypatch):
    layer = _load("layer_2_extract.py", "lowmem_layer2")
    calls = {"ocr": 0, "latex": 0, "table": 0}

    class OCR:
        def __init__(self):
            calls["ocr"] += 1

    class Latex:
        def __init__(self):
            calls["latex"] += 1

    class Table:
        def __init__(self):
            calls["table"] += 1

    monkeypatch.setitem(sys.modules, "rapidocr_onnxruntime", types.SimpleNamespace(RapidOCR=OCR))
    monkeypatch.setitem(sys.modules, "rapid_latex_ocr", types.SimpleNamespace(LatexOCR=Latex))
    monkeypatch.setitem(sys.modules, "rapid_table", types.SimpleNamespace(RapidTable=Table))
    monkeypatch.setenv("RAGDOM_LOW_MEMORY", "true")
    monkeypatch.setenv("RAGDOM_LOW_MEMORY_OCR", "false")
    monkeypatch.delenv("RAGDOM_OFFLINE", raising=False)

    engines = layer._get_engines(need_ocr=True, need_latex=True, need_table=True)
    assert engines["ocr"] is None
    assert engines["latex"] is None and engines["table"] is None
    assert calls == {"ocr": 0, "latex": 0, "table": 0}

    monkeypatch.setenv("RAGDOM_LOW_MEMORY_OCR", "true")
    engines = layer._get_engines(need_ocr=True)
    assert engines["ocr"] is not None and calls["ocr"] == 1
    layer._get_engines(need_ocr=True)
    assert calls["ocr"] == 1  # singleton, no duplicate model allocation


def test_low_memory_raster_uses_150_dpi_without_heavy_sauvola(tmp_path, monkeypatch):
    import fitz

    layer = _load("layer_0_cv.py", "lowmem_layer0")
    pdf = tmp_path / "scan.pdf"
    document = fitz.open()
    document.new_page(width=595, height=842)
    document.save(pdf)
    document.close()
    monkeypatch.setenv("RAGDOM_LOW_MEMORY", "true")
    context = {
        "job": {"id": "job", "page_number": 1},
        "document": {"id": "doc", "source_path": str(pdf)},
        "config": {"pipeline_set_dir": str(tmp_path / "pipeline")},
    }
    result = layer.run(context)
    try:
        assert result["status"] == "SUCCESS" and result["dpi"] == 150
        assert result["width_px"] < 1500 and result["height_px"] < 2000
    finally:
        result["_fitz"]["doc"].close()


def test_low_memory_skips_layout_engine(monkeypatch):
    triage = _load("layer_1_triage.py", "lowmem_layer1")
    calls = {"layout": 0}

    class Layout:
        def __init__(self):
            calls["layout"] += 1

    monkeypatch.setitem(sys.modules, "rapid_layout", types.SimpleNamespace(RapidLayout=Layout))
    monkeypatch.setenv("RAGDOM_LOW_MEMORY", "true")
    monkeypatch.delenv("RAGDOM_OFFLINE", raising=False)

    assert triage._get_layout_engine() is None
    assert calls["layout"] == 0


def test_explicit_vlm_disable_respected(monkeypatch):
    layer = _load("layer_2_extract.py", "lowmem_layer2_optin")
    monkeypatch.setenv("RAGDOM_VLM_PAGE_OCR", "false")
    assert layer._maybe_vlm_page_ocr({}, "") is None
