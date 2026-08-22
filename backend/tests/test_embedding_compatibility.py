# -*- coding: utf-8 -*-
"""Non-régression du contrat d'espace vectoriel FastEmbed."""
import importlib.util
import json
import os
import struct
import sys
import uuid
import warnings
from dataclasses import FrozenInstanceError

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402
from api import routes_search  # noqa: E402
from core.embedding_profile import CURRENT_PROFILE  # noqa: E402
from db import connection as db  # noqa: E402
from main import app  # noqa: E402


TEST_DB = "Embedding_Compatibility_Test.sqlite"
client = TestClient(app)
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def _load(name, relative):
    path = os.path.join(ROOT, relative)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _blob(first=1.0):
    return struct.pack("<384f", first, *([0.0] * 383))


def _cleanup():
    for suffix in ("", "-wal", "-shm"):
        path = os.path.join(config.DATABASES_DIR, TEST_DB + suffix)
        if os.path.exists(path):
            os.remove(path)


@pytest.fixture(autouse=True)
def clean_database():
    _cleanup()
    yield
    _cleanup()


def _insert_document(conn, doc_id, title, content, vector=True):
    conn.execute("INSERT INTO documents (id,title,filename,source_path,total_pages) VALUES (?,?,?,?,1)",
                 (doc_id, title, doc_id + ".pdf", "/tmp/" + doc_id + ".pdf"))
    conn.execute("INSERT INTO document_chunks"
                 " (id,document_id,page_number,chunk_index,content_markdown,embedding_vector)"
                 " VALUES (?,?,1,0,?,?)", (doc_id + "-c", doc_id, content, _blob() if vector else None))


def _insert_profile(conn, profile_id, payload):
    conn.execute("INSERT INTO embedding_profiles"
                 " (id,model_name,model_version,pooling,dimensions,normalized,metadata_json)"
                 " VALUES (?,?,?,?,?,?,?)",
                 (profile_id, payload["model_name"], payload["model_version"], payload["pooling"],
                  payload["dimensions"], int(payload["normalized"]),
                  json.dumps(payload.get("metadata") or {}, sort_keys=True, separators=(",", ":"))))


def test_current_profile_is_complete_and_immutable():
    contract = CURRENT_PROFILE.contract()
    assert contract == {
        "model_name": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        "fastembed_version": "0.7.4", "pooling": "mean", "dimensions": 384,
        "normalized": True, "query_prefix": "query: ", "passage_prefix": "passage: ",
        "max_input_tokens": 512, "truncation": "tokenizer_tail",
        "passage_max_characters": 2000, "dtype": "float32", "endianness": "little",
        "metric": "l2", "pipeline_version": "ragdom-fastembed-mean-v1",
        "model_source": "qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q",
        "model_file": "model_optimized.onnx", "model_revision": None,
        "model_artifact_hash": None,
    }
    with pytest.raises(FrozenInstanceError):
        CURRENT_PROFILE.pooling = "cls"


def test_fastembed_filters_only_exact_mean_migration_warning():
    layer3 = _load("embedding_layer3_warning", "engines/sci-engine/pipeline/layer_3_qualify.py")

    class FakeTextEmbedding:
        def __init__(self, model_name):
            warnings.warn(layer3._FASTEMBED_MEAN_WARNING, UserWarning)
            warnings.warn("warning différent à conserver", UserWarning)
            self.model_name = model_name

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        layer3._create_fastembed_model(FakeTextEmbedding)
    assert [str(item.message) for item in caught] == ["warning différent à conserver"]


def test_layer7_resolves_natural_profile_after_insert_ignore_collision(monkeypatch):
    layer7 = _load("embedding_layer7_collision", "engines/sci-engine/pipeline/layer_7_persist.py")
    conn = db.create_database(TEST_DB)
    try:
        payload = CURRENT_PROFILE.storage_payload()
        _insert_profile(conn, "canonical-profile", payload)
        conn.commit()
        monkeypatch.setattr(layer7.uuid, "uuid4", lambda: uuid.UUID(int=1))
        assert layer7._resolve_profile_id(conn, payload) == "canonical-profile"
        assert conn.execute("SELECT COUNT(*) FROM embedding_profiles").fetchone()[0] == 1
    finally:
        conn.close()


def test_database_refuses_second_active_profile_with_vectors():
    conn = db.create_database(TEST_DB)
    try:
        first = CURRENT_PROFILE.storage_payload()
        second = dict(first)
        second.update(model_name="other/model")
        second["metadata"] = {"profile_contract": {**CURRENT_PROFILE.contract(),
                                                   "model_name": "other/model"}}
        _insert_document(conn, "doc-a", "A", "fractions")
        _insert_document(conn, "doc-b", "B", "fractions")
        _insert_profile(conn, "profile-a", first)
        _insert_profile(conn, "profile-b", second)
        conn.execute("INSERT INTO document_embedding_profiles(document_id,profile_id)"
                     " VALUES ('doc-a','profile-a')")
        conn.commit()
    finally:
        conn.close()

    response = client.post("/api/validation/embeddings/assign", json={
        "db": TEST_DB, "document_id": "doc-b", "profile_id": "profile-b"})
    assert response.status_code == 409
    assert "Plusieurs profils actifs" in response.json()["detail"]


def test_incompatible_query_profile_falls_back_to_bm25_with_diagnostic(monkeypatch):
    conn = db.create_database(TEST_DB)
    try:
        incompatible = CURRENT_PROFILE.storage_payload()
        incompatible.update(pooling="cls")
        incompatible["metadata"] = {"profile_contract": {**CURRENT_PROFILE.contract(), "pooling": "cls"}}
        _insert_document(conn, "doc", "Document", "fractions simplifier")
        _insert_profile(conn, "legacy-cls", incompatible)
        conn.execute("INSERT INTO document_embedding_profiles(document_id,profile_id)"
                     " VALUES ('doc','legacy-cls')")
        conn.commit()
    finally:
        conn.close()

    monkeypatch.setattr(routes_search.db, "vector_state",
                        lambda: {"engine": "sqlite-vec", "status": "ready", "message": "test"})
    monkeypatch.setattr(routes_search, "_thresholds", lambda: (0.45, 1.0))
    monkeypatch.setattr(routes_search, "_query_embedding_result",
                        lambda _text: (_blob(), CURRENT_PROFILE))
    response = client.post("/api/search/hybrid", params={"db": TEST_DB}, json={
        "query": "fractions simplifier", "top_k": 5})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["results"] and body["results"][0]["bm25_rank"] == 1
    assert body["results"][0]["vec_rank"] is None
    diagnostic = body["embedding_diagnostic"]
    assert diagnostic["mode"] == "bm25" and diagnostic["fallback_triggered"] is True
    assert "profile_pooling_mismatch" in diagnostic["reasons"]
    assert diagnostic["database_profile"]["metadata"]["profile_contract"]["pooling"] == "cls"


def test_embedding_diagnostic_exposes_full_metadata_and_reasons():
    conn = db.create_database(TEST_DB)
    try:
        payload = CURRENT_PROFILE.storage_payload()
        _insert_document(conn, "doc", "Document", "algèbre")
        _insert_profile(conn, "current", payload)
        conn.execute("INSERT INTO document_embedding_profiles(document_id,profile_id)"
                     " VALUES ('doc','current')")
        conn.commit()
    finally:
        conn.close()

    response = client.get("/api/validation/embeddings/diagnostic",
                          params={"db": TEST_DB, "document_id": "doc"})
    assert response.status_code == 200, response.text
    body = response.json()
    item = body["documents"][0]
    assert item["profile"]["metadata"]["profile_contract"] == CURRENT_PROFILE.contract()
    assert item["query_compatible"] is True and item["reasons"] == []
    assert body["query_profile"] == CURRENT_PROFILE.contract()
    assert body["database_compatible"] is True and body["reasons"] == []
