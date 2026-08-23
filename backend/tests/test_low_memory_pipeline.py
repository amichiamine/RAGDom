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
    monkeypatch.delenv("RAGDOM_OFFLINE", raising=False)

    engines = layer._get_engines(need_ocr=True, need_latex=True, need_table=True)
    assert engines["ocr"] is not None
    assert engines["latex"] is None and engines["table"] is None
    assert calls == {"ocr": 1, "latex": 0, "table": 0}
    layer._get_engines(need_ocr=True)
    assert calls["ocr"] == 1  # singleton, no duplicate model allocation


def test_low_memory_skips_layout_and_auto_full_page_vlm(monkeypatch):
    triage = _load("layer_1_triage.py", "lowmem_layer1")
    layer = _load("layer_2_extract.py", "lowmem_layer2_vlm")
    calls = {"layout": 0}

    class Layout:
        def __init__(self):
            calls["layout"] += 1

    monkeypatch.setitem(sys.modules, "rapid_layout", types.SimpleNamespace(RapidLayout=Layout))
    monkeypatch.setenv("RAGDOM_LOW_MEMORY", "true")
    monkeypatch.setenv("RAGDOM_VLM_PAGE_OCR", "auto")
    monkeypatch.delenv("RAGDOM_OFFLINE", raising=False)

    assert triage._get_layout_engine() is None
    assert calls["layout"] == 0
    assert layer._maybe_vlm_page_ocr({}, "") is None


def test_explicit_vlm_opt_in_remains_distinct_from_auto(monkeypatch):
    layer = _load("layer_2_extract.py", "lowmem_layer2_optin")
    monkeypatch.setenv("RAGDOM_LOW_MEMORY", "true")
    monkeypatch.setenv("RAGDOM_VLM_PAGE_OCR", "false")
    assert layer._maybe_vlm_page_ocr({}, "") is None
    # The true mode passes the low-memory guard; a missing image still returns safely.
    monkeypatch.setenv("RAGDOM_VLM_PAGE_OCR", "true")
    assert layer._maybe_vlm_page_ocr({}, "") is None
