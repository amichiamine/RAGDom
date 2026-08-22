# -*- coding: utf-8 -*-
"""RAGDom — Routes /api/search/* : hybride RRF, multi-bases, Ask RAG (Blueprint §7.3/§7.6).

RRF k=60 (tech_specs §3.3) sur rangs BM25 (bm25() ASC = meilleur) + sqlite-vec.
Seuils anti-hallucination RÉELS depuis app_settings : cosinus ≤ 0.45 OU bm25 ≤ -0.3.
Mode fts5-fallback : BM25 seul. /ask : ZÉRO appel LLM si aucun chunk éligible.
Python 3.9+.
"""
import concurrent.futures
import math
import struct
from typing import List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from core import engine_registry
from core.embedding_profile import (CURRENT_PROFILE, active_vector_profiles,
                                    compatibility_reasons, runtime_profile)
from db import connection as db
from llm import key_manager

router = APIRouter()

NO_CONTEXT_MESSAGE = "Je ne trouve pas d'informations pertinentes dans la bibliothèque actuelle."


class SearchBody(BaseModel):
    query: str
    filters: Optional[dict] = None
    top_k: int = 5


class MultiBody(SearchBody):
    databases: List[str]


class AskBody(SearchBody):
    databases: List[str]


def _fts_escape(query: str) -> str:
    """Requête utilisateur → MATCH sûre (termes entre guillemets, OR implicite)."""
    terms = [t.replace('"', "") for t in query.split() if t.strip('"')]
    return " OR ".join('"%s"' % t for t in terms) or '""'


def _thresholds():
    vec_t = float(db.get_app_setting("vec_distance_threshold", "0.45"))
    bm25_t = float(db.get_app_setting("bm25_score_threshold", "-0.3"))
    return vec_t, bm25_t


def _eligible_ranks(rows, threshold: float) -> dict:
    """Rangs uniques et déterministes parmi les seuls résultats sous seuil."""
    ranked = {}
    for item_id, score in rows:
        if score > threshold or item_id in ranked:
            continue
        ranked[item_id] = (len(ranked) + 1, score)
    return ranked


def _query_embedding_result(text: str) -> Tuple[Optional[bytes], object]:
    profile = CURRENT_PROFILE
    try:
        active = engine_registry.active_engine()
        layer3 = engine_registry.load_layer(active["id"], "layer_3_qualify")
        embedder = layer3._get_embedder()  # noqa: SLF001 — singleton du moteur
        if embedder is None:
            return None, profile
        profile = runtime_profile(embedder)
        raw = next(iter(embedder.embed([profile.query_prefix + text])))
        vector = [float(value) for value in raw[:profile.dimensions]]
        if len(vector) != profile.dimensions:
            return None, profile
        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0.0:
            return None, profile
        normalized = [value / norm for value in vector]
        return struct.pack("<384f", *normalized), profile
    except Exception:  # noqa: BLE001 — la recherche FTS reste opérationnelle
        return None, profile


def _query_embedding(text: str) -> Optional[bytes]:
    return _query_embedding_result(text)[0]


def _hybrid_search_detailed(db_name: str, body: SearchBody) -> Tuple[List[dict], dict]:
    conn = db.get_connection(db_name)
    try:
        vec_t, bm25_t = _thresholds()
        where_extra, extra_args = "", []
        filters = body.filters or {}
        if filters.get("pedagogical_type"):
            where_extra += " AND c.pedagogical_type=?"
            extra_args.append(filters["pedagogical_type"])
        if filters.get("toc_id"):
            where_extra += " AND c.toc_id=?"
            extra_args.append(filters["toc_id"])

        # ── Passe BM25 (FTS5) : K=20, tri ASC (plus petit = meilleur) ──
        bm25_rows = conn.execute(
            "SELECT si.chunk_id, bm25(search_index) AS score FROM search_index si"
            " JOIN document_chunks c ON c.id = si.chunk_id"
            " WHERE search_index MATCH ? AND si.chunk_id IS NOT NULL%s"
            " ORDER BY score ASC, si.chunk_id ASC, si.rowid ASC LIMIT 20" % where_extra,
            [_fts_escape(body.query)] + extra_args).fetchall()
        # Un canal ne contribue au RRF que s'il franchit son propre seuil.
        # Sinon un rang vectoriel hors seuil peut inverser un résultat BM25 valide.
        bm25_rank = _eligible_ranks(bm25_rows, bm25_t)

        # ── Passe vectorielle uniquement si le contrat DB est prouvé compatible ──
        vec_rank = {}
        vector_state = db.vector_state()
        profiles, vector_count, unassigned = active_vector_profiles(conn)
        query_profile = CURRENT_PROFILE
        reasons = []
        embedding = None
        if vector_count == 0:
            reasons.append("no_persisted_vectors")
        elif vector_state["engine"] != "sqlite-vec" or vector_state.get("status") != "ready":
            reasons.append("vector_engine_unavailable")
        elif unassigned:
            reasons.append("vectors_without_embedding_profile")
        elif len(profiles) == 0:
            reasons.append("embedding_profile_missing")
        elif len(profiles) > 1:
            reasons.append("multiple_active_embedding_profiles")
        else:
            embedding, query_profile = _query_embedding_result(body.query)
            reasons.extend(compatibility_reasons(profiles[0], query_profile))
            if embedding is None:
                reasons.append("query_embedder_unavailable")
        if not reasons and embedding is not None:
            try:
                vec_rows = conn.execute(
                    "SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH ?"
                    " ORDER BY distance LIMIT 20", (embedding,)).fetchall()
                vec_rank = _eligible_ranks(vec_rows, vec_t)
            except Exception:  # noqa: BLE001 — table vec absente/corrompue : BM25 explicite
                vec_rank = {}
                reasons.append("vector_query_failed")
        diagnostic = {
            "mode": "hybrid" if not reasons else "bm25",
            "vector_used": not reasons,
            "fallback_triggered": bool(reasons),
            "reasons": reasons,
            "query_profile": query_profile.contract(),
            "database_profile": profiles[0] if len(profiles) == 1 else None,
            "active_profile_count": len(profiles),
            "vector_count": vector_count,
            "unassigned_vector_count": unassigned,
            "vector_engine": vector_state,
        }

        # ── Fusion RRF k=60 + seuils réels (V3.1) ──
        results = []
        for chunk_id in set(bm25_rank) | set(vec_rank):
            b_rank, b_score = bm25_rank.get(chunk_id, (None, None))
            v_rank, v_dist = vec_rank.get(chunk_id, (None, None))
            eligible = ((b_score is not None and b_score <= bm25_t)
                        or (v_dist is not None and v_dist <= vec_t))
            if not eligible:
                continue
            rrf = (1.0 / (60 + b_rank) if b_rank else 0.0) + (1.0 / (60 + v_rank) if v_rank else 0.0)
            results.append((rrf, chunk_id, b_rank, v_rank))
        results.sort(reverse=True)

        output = []
        for rrf, chunk_id, b_rank, v_rank in results[: body.top_k]:
            row = conn.execute(
                "SELECT c.document_id, d.title, c.page_number, c.section_title, c.content_markdown,"
                " c.pedagogical_type FROM document_chunks c JOIN documents d ON d.id=c.document_id"
                " WHERE c.id=?", (chunk_id,)).fetchone()
            if row is None:
                continue
            output.append({"chunk_id": chunk_id, "document_id": row[0], "document_title": row[1],
                           "page_number": row[2], "section_title": row[3],
                           "content_markdown": row[4][:1200], "pedagogical_type": row[5],
                           "rrf_score": round(rrf, 5), "bm25_rank": b_rank, "vec_rank": v_rank,
                           "database_filename": db_name})
        return output, diagnostic
    finally:
        conn.close()


def _hybrid_search(db_name: str, body: SearchBody) -> List[dict]:
    return _hybrid_search_detailed(db_name, body)[0]


@router.post("/hybrid")
def hybrid(body: SearchBody, db_name: str = Query(alias="db")):
    try:
        results, diagnostic = _hybrid_search_detailed(db_name, body)
        return {"results": results, "embedding_diagnostic": diagnostic}
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))


@router.post("/hybrid-multi")
def hybrid_multi(body: MultiBody):
    """Requêtes parallèles par base + seconde passe RRF globale (tech_specs §3.5)."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, len(body.databases) or 1)) as pool:
        futures = {pool.submit(_hybrid_search_detailed, name, body): name for name in body.databases}
        merged, diagnostics = [], []
        for future in concurrent.futures.as_completed(futures):
            db_name = futures[future]
            try:
                results, diagnostic = future.result()
                merged.extend(results)
                diagnostics.append({"database_filename": db_name, **diagnostic})
            except Exception as exc:  # noqa: BLE001 — une base en échec n'annule pas les autres
                diagnostics.append({"database_filename": db_name, "mode": "unavailable",
                                    "vector_used": False, "fallback_triggered": True,
                                    "reasons": ["database_search_failed"], "detail": str(exc)})
    merged.sort(key=lambda r: r["rrf_score"], reverse=True)
    diagnostics.sort(key=lambda item: item["database_filename"])
    return {"results": merged[: body.top_k], "embedding_diagnostics": diagnostics}


@router.post("/ask")
def ask(body: AskBody):
    """Chat RAG (§7.6) : retrieval → seuils réels → génération. Zéro chunk = zéro LLM."""
    retrieval = MultiBody(query=body.query, filters=body.filters,
                          top_k=body.top_k, databases=body.databases)
    sources = hybrid_multi(retrieval)["results"]
    if not sources:
        return {"answer": NO_CONTEXT_MESSAGE, "no_context": True, "sources": [],
                "provider_used": None, "fallback_triggered": False}

    # Contexte formaté (tech_specs §3.4 — format exact de provenance).
    blocks = []
    for source in sources:
        blocks.append("[Doc: %s | Page: %s | Section: %s | Type: %s]\n%s" % (
            source["document_title"], source["page_number"],
            source["section_title"] or "-", source["pedagogical_type"] or "-",
            source["content_markdown"]))
    prompt = ("Tu réponds UNIQUEMENT à partir du contexte fourni, dans la langue de la question, "
              "en citant les documents utilisés. Si le contexte ne suffit pas, dis-le.\n\n"
              "CONTEXTE :\n%s\n\nQUESTION : %s" % ("\n\n".join(blocks), body.query))
    result = key_manager.generate(prompt)
    if result is None:
        return {"answer": "Aucun fournisseur LLM n'est configuré ou joignable — voici les extraits "
                          "les plus pertinents de la bibliothèque.", "no_context": False,
                "sources": sources, "provider_used": None, "fallback_triggered": True}
    return {"answer": result["content"], "no_context": False, "sources": sources,
            "provider_used": result["provider"], "fallback_triggered": result["fallback_triggered"]}
