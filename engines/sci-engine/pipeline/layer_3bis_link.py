# -*- coding: utf-8 -*-
"""sci-engine — Couche 3bis : SolutionLinker (tech_specs §4.4, passe post-document).

Déclenchée par l'orchestrateur quand TOUTES les pages du document sont READY.
Appariement purement algorithmique (zéro VLM) : solution_only ↔ exercise_unsolved
par pedagogical_index (V3.5), transaction unique, écrit linked_solution_chunk_id
et has_solution=1. Ambiguïtés consignées. Python 3.9+.
"""
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend"))

logger = logging.getLogger("ragdom.sci-engine.linker")


def run(ctx: dict) -> dict:
    """No-op dans la séquence par page (la liaison est impossible au fil de l'eau)."""
    return ctx


def run_post_document(db_name: str, document_id: str) -> int:
    from db import connection as db

    conn = db.get_connection(db_name)
    linked = 0
    try:
        solutions = conn.execute(
            "SELECT id, pedagogical_index FROM document_chunks"
            " WHERE document_id=? AND pedagogical_type='solution_only' AND pedagogical_index IS NOT NULL"
            " ORDER BY page_number, chunk_index", (document_id,),
        ).fetchall()
        by_index = {}
        ambiguous = set()
        for sol_id, idx in solutions:
            if idx in by_index:
                ambiguous.add(idx)  # deux corrigés pour le même numéro : on garde le premier
            else:
                by_index[idx] = sol_id
        if ambiguous:
            logger.warning("SolutionLinker %s : indices ambigus %s (premier corrigé retenu)",
                           document_id, sorted(ambiguous))

        conn.execute("BEGIN")
        exercises = conn.execute(
            "SELECT id, pedagogical_index FROM document_chunks"
            " WHERE document_id=? AND pedagogical_type='exercise_unsolved'"
            " AND pedagogical_index IS NOT NULL AND linked_solution_chunk_id IS NULL",
            (document_id,),
        ).fetchall()
        for ex_id, idx in exercises:
            sol_id = by_index.get(idx)
            if sol_id:
                conn.execute(
                    "UPDATE document_chunks SET linked_solution_chunk_id=?, has_solution=1,"
                    " pedagogical_type='exercise_solved' WHERE id=?", (sol_id, ex_id))
                linked += 1
        conn.commit()
        return linked
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
