# -*- coding: utf-8 -*-
"""Non-régression : seuls les canaux éligibles contribuent à la fusion RRF."""
import os
import struct
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402
from api import routes_search  # noqa: E402
from db import connection as db  # noqa: E402


TEST_DB = "RrfThreshold_Test.sqlite"


def _blob(values):
    return struct.pack("<384f", *values)


def _cleanup():
    for suffix in ("", "-wal", "-shm"):
        path = os.path.join(config.DATABASES_DIR, TEST_DB + suffix)
        if os.path.exists(path):
            os.remove(path)


def test_below_threshold_vector_ranks_cannot_reorder_bm25(monkeypatch):
    """Des voisins hors seuil ne doivent ni compter ni décaler les rangs RRF."""
    _cleanup()
    conn = db.create_database(TEST_DB)
    try:
        if db.vector_state()["engine"] != "sqlite-vec":
            pytest.skip("sqlite-vec indisponible")

        conn.execute(
            "INSERT INTO documents (id, title, filename, source_path, total_pages) "
            "VALUES ('doc', 'Test RRF', 'test.pdf', '/tmp/test.pdf', 3)"
        )
        vectors = {
            "bm25_first": [10.0] + [0.0] * 383,
            "bm25_second": [1.0] + [0.0] * 383,
            "vector_only": [2.0] + [0.0] * 383,
        }
        rows = [
            ("bm25_first", 1, "Exercice : fractions à simplifier", vectors["bm25_first"]),
            ("bm25_second", 2, "Cours : les fractions et leur définition", vectors["bm25_second"]),
            ("vector_only", 3, "bruit", vectors["vector_only"]),
        ]
        for index, (chunk_id, page, content, vector) in enumerate(rows):
            conn.execute(
                "INSERT INTO document_chunks "
                "(id, document_id, page_number, chunk_index, content_markdown, embedding_vector) "
                "VALUES (?, 'doc', ?, ?, ?, ?)",
                (chunk_id, page, index, content, _blob(vector)),
            )
        # Un artefact peut ajouter une deuxième ligne FTS au même chunk : le rang
        # public doit rester unique et conserver le meilleur score de ce chunk.
        conn.execute(
            "INSERT INTO scientific_artifacts "
            "(id, document_id, chunk_id, page_number, domain, artifact_type, searchable_text) "
            "VALUES ('artifact', 'doc', 'bm25_first', 1, 'math', 'latex_formula', "
            "'fractions simplifier')"
        )
        conn.commit()
    finally:
        conn.close()

    monkeypatch.setattr(routes_search, "_thresholds", lambda: (0.45, 0.0))
    monkeypatch.setattr(
        routes_search,
        "_query_embedding",
        lambda _text: _blob([0.0] * 384),
    )

    try:
        results = routes_search._hybrid_search(  # noqa: SLF001 — test ciblé du fusionneur
            TEST_DB,
            routes_search.SearchBody(query="fractions simplifier", top_k=5),
        )
        assert [row["chunk_id"] for row in results[:2]] == ["bm25_first", "bm25_second"]
        assert results[0]["bm25_rank"] == 1
        assert all(row["vec_rank"] is None for row in results)
    finally:
        _cleanup()
