# -*- coding: utf-8 -*-
"""RAGDom — Tests unitaires : génération AUTOMATIQUE du curriculum (V5).

Base jouet EN MÉMOIRE construite avec le DDL RÉEL du projet (db.connection.
SCHEMA_CORE) — aucune dépendance lourde (pas de cv2/fitz : le builder est
100 % SQL/algorithmique, zéro LLM). Couvre :
- comptes {lessons, exercises, solutions, assessments} depuis TOC + chunks typés ;
- rattachement des exercices à leur leçon par plage de pages (via un cours
  représentant, contrat _curriculum_aggregates) ;
- assessments depuis chunks evaluation_exam ET documents entiers typés sujet ;
- idempotence (2e run = pas de doublon) ;
- non-destructivité (une ligne saisie à la main survit à la reconstruction) ;
- cohérence avec le consommateur _curriculum_aggregates (onglets Vue 2).
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
# Le builder vit dans le moteur (engines/sci-engine/pipeline).
_ENGINE_PIPE = os.path.join(os.path.dirname(__file__), "..", "..",
                            "engines", "sci-engine", "pipeline")
sys.path.insert(0, os.path.abspath(_ENGINE_PIPE))

import pytest  # noqa: E402

from db.connection import SCHEMA_CORE  # noqa: E402
import curriculum_builder as cb  # noqa: E402


# ── Fabrique de base jouet ────────────────────────────────────────────────────
def _fresh_conn():
    """Connexion :memory: avec le DDL réel (curriculum_* inclus)."""
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA_CORE)
    return conn


_DOC_ID = "doc-jouet"


def _seed_document(conn, doc_id=_DOC_ID, doc_type="unknown", title="Manuel"):
    conn.execute(
        "INSERT INTO documents (id,title,filename,source_path,total_pages,doc_type)"
        " VALUES (?,?,?,?,?,?)", (doc_id, title, "m.pdf", "/x/m.pdf", 100, doc_type))


def _seed_toc(conn, toc_id, level, title, page_start, page_end, doc_id=_DOC_ID):
    conn.execute(
        "INSERT INTO document_toc (id,document_id,parent_id,level,title,page_start,page_end)"
        " VALUES (?,?,?,?,?,?,?)", (toc_id, doc_id, None, level, title, page_start, page_end))


def _seed_chunk(conn, chunk_id, ped_type, page, doc_id=_DOC_ID, idx=0,
                section_title=None, linked_solution=None):
    conn.execute(
        "INSERT INTO document_chunks (id,document_id,page_number,chunk_index,section_title,"
        " content_markdown,pedagogical_type,linked_solution_chunk_id) VALUES (?,?,?,?,?,?,?,?)",
        (chunk_id, doc_id, page, idx, section_title, "contenu", ped_type, linked_solution))


def _seed_typical(conn):
    """Corpus minimal représentatif : 2 leçons (L1), cours + exercices + corrigés."""
    _seed_document(conn)
    # Leçon A : pages 10-20 (avec cours) ; Leçon B : pages 21-30 (avec cours).
    _seed_toc(conn, "tocA", 1, "Leçon A", 10, 20)
    _seed_toc(conn, "tocB", 1, "Leçon B", 21, 30)
    # Une section niveau 2 (NE DOIT PAS devenir une leçon).
    _seed_toc(conn, "secA", 2, "Section A.1", 11, 12)
    # Cours (course_theory) dans chaque leçon.
    _seed_chunk(conn, "cA", "course_theory", 11)
    _seed_chunk(conn, "cB", "course_theory", 22)
    # Exercices : 2 en leçon A (p12, p15), 1 en leçon B (p25).
    _seed_chunk(conn, "eA1", "exercise_unsolved", 12)
    _seed_chunk(conn, "eA2", "exercise_unsolved", 15)
    _seed_chunk(conn, "eB1", "exercise_solved", 25)
    # Corrigés (solution_only) : 2.
    _seed_chunk(conn, "sA1", "solution_only", 13)
    _seed_chunk(conn, "sB1", "solution_only", 26)
    conn.commit()


# ── Comptes de base ───────────────────────────────────────────────────────────
def test_build_counts_from_toc_and_chunks():
    conn = _fresh_conn()
    _seed_typical(conn)
    counts = cb.build_curriculum(conn, _DOC_ID)
    # 2 leçons (seuls les TOC niveau 1) — la section niveau 2 est ignorée.
    assert counts["lessons"] == 2
    # 3 exercices, tous rattachables (chaque leçon a un cours représentant).
    assert counts["exercises"] == 3
    assert counts["solutions"] == 2
    assert counts["assessments"] == 0
    conn.close()


def test_programs_and_term_created_with_auto_marker():
    conn = _fresh_conn()
    _seed_typical(conn)
    cb.build_curriculum(conn, _DOC_ID)
    # 1 terme auto + 2 programmes auto.
    assert conn.execute("SELECT COUNT(*) FROM curriculum_terms").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM curriculum_programs").fetchone()[0] == 2
    # Tous marqués auto (competencies_json.source == 'auto').
    autos = conn.execute(
        "SELECT COUNT(*) FROM curriculum_programs"
        " WHERE json_extract(competencies_json,'$.source')='auto'").fetchone()[0]
    assert autos == 2
    # Plage de pages rangée dans competencies_json (pas de colonne inventée).
    row = conn.execute("SELECT competencies_json FROM curriculum_programs"
                       " WHERE title='Leçon A'").fetchone()
    import json
    meta = json.loads(row[0])
    assert meta["page_start"] == 10 and meta["page_end"] == 20 and meta["toc_id"] == "tocA"
    conn.close()


def test_content_links_types_and_directions():
    conn = _fresh_conn()
    _seed_typical(conn)
    cb.build_curriculum(conn, _DOC_ID)
    types = dict(conn.execute(
        "SELECT link_type, COUNT(*) FROM content_links GROUP BY link_type").fetchall())
    assert types["program_term"] == 2       # 1 par programme
    assert types["course_program"] == 2     # 1 par chunk cours
    assert types["course_exercise"] == 3    # 1 par exercice rattaché
    # course_exercise : from_id = chunk cours, to_id = chunk exercice (contrat consommateur).
    row = conn.execute("SELECT from_id, to_id FROM content_links"
                       " WHERE link_type='course_exercise' AND to_id='eA1'").fetchone()
    assert row[0] == "cA" and row[1] == "eA1"
    conn.close()


# ── Rattachement par plage de pages ──────────────────────────────────────────
def test_exercise_without_course_in_lesson_not_linked_but_counted_globally():
    """Une leçon SANS cours ne peut pas fabriquer de course_exercise (pas de
    from_id valide) : l'exercice n'est PAS compté per-term mais reste dans
    document_chunks (agrégat global)."""
    conn = _fresh_conn()
    _seed_document(conn)
    _seed_toc(conn, "tocX", 1, "Leçon sans cours", 40, 50)  # aucune course_theory
    _seed_chunk(conn, "eX1", "exercise_unsolved", 45)
    conn.commit()
    counts = cb.build_curriculum(conn, _DOC_ID)
    assert counts["lessons"] == 1
    assert counts["exercises"] == 0  # pas de cours → pas de lien per-term
    # mais l'exercice existe toujours en base (agrégat global le comptera).
    assert conn.execute("SELECT COUNT(*) FROM document_chunks"
                        " WHERE pedagogical_type='exercise_unsolved'").fetchone()[0] == 1
    conn.close()


def test_exercise_outside_any_lesson_range_ignored():
    conn = _fresh_conn()
    _seed_document(conn)
    _seed_toc(conn, "tocA", 1, "Leçon A", 10, 20)
    _seed_chunk(conn, "cA", "course_theory", 11)
    _seed_chunk(conn, "eOut", "exercise_unsolved", 999)  # hors de toute plage
    conn.commit()
    counts = cb.build_curriculum(conn, _DOC_ID)
    assert counts["exercises"] == 0
    conn.close()


# ── Évaluations / sujets ─────────────────────────────────────────────────────
def test_assessments_from_evaluation_exam_chunks():
    conn = _fresh_conn()
    _seed_document(conn)
    _seed_toc(conn, "tocA", 1, "Leçon A", 10, 20)
    _seed_chunk(conn, "corr1", "solution_only", 60)
    _seed_chunk(conn, "exam1", "evaluation_exam", 61, section_title="Devoir 1",
                linked_solution="corr1")
    conn.commit()
    counts = cb.build_curriculum(conn, _DOC_ID)
    assert counts["assessments"] == 1
    row = conn.execute("SELECT subject_chunk_id, correction_chunk_id, title, kind,"
                       " json_extract(scale_json,'$.source') FROM assessments").fetchone()
    assert row[0] == "exam1" and row[1] == "corr1" and row[2] == "Devoir 1"
    assert row[3] == "autre" and row[4] == "auto"
    conn.close()


def test_assessments_from_whole_document_typed_subject():
    conn = _fresh_conn()
    # Document ENTIER typé sujet (base sources : sujets dzexams).
    _seed_document(conn, doc_id="sujet-1", doc_type="sujet", title="Sujet BEM 2024")
    conn.commit()
    counts = cb.build_curriculum(conn, "sujet-1")
    assert counts["assessments"] == 1
    row = conn.execute("SELECT document_id, subject_chunk_id, title FROM assessments").fetchone()
    assert row[0] == "sujet-1" and row[1] is None and row[2] == "Sujet BEM 2024"
    conn.close()


# ── Idempotence ──────────────────────────────────────────────────────────────
def test_idempotent_second_run_no_duplicates():
    conn = _fresh_conn()
    _seed_typical(conn)
    c1 = cb.build_curriculum(conn, _DOC_ID)
    n_terms1 = conn.execute("SELECT COUNT(*) FROM curriculum_terms").fetchone()[0]
    n_prog1 = conn.execute("SELECT COUNT(*) FROM curriculum_programs").fetchone()[0]
    n_links1 = conn.execute("SELECT COUNT(*) FROM content_links").fetchone()[0]

    c2 = cb.build_curriculum(conn, _DOC_ID)
    assert c1 == c2
    assert conn.execute("SELECT COUNT(*) FROM curriculum_terms").fetchone()[0] == n_terms1
    assert conn.execute("SELECT COUNT(*) FROM curriculum_programs").fetchone()[0] == n_prog1
    assert conn.execute("SELECT COUNT(*) FROM content_links").fetchone()[0] == n_links1
    conn.close()


# ── Non-destructivité ────────────────────────────────────────────────────────
def test_human_rows_preserved_across_rebuild():
    conn = _fresh_conn()
    _seed_typical(conn)
    cb.build_curriculum(conn, _DOC_ID)
    # Programme + terme saisis à la main (SANS marqueur auto).
    conn.execute("INSERT INTO curriculum_programs (id,term_id,seq_index,title,source,"
                 "competencies_json) VALUES ('hum-p',NULL,999,'Leçon manuelle','human',NULL)")
    conn.execute("INSERT INTO curriculum_terms (id,term_index,label,metadata_json)"
                 " VALUES ('hum-t',3,'Trimestre manuel','{\"source\":\"human\"}')")
    conn.commit()

    cb.build_curriculum(conn, _DOC_ID)  # reconstruction
    # Les lignes humaines survivent ; les lignes auto sont exactement 2 (pas de doublon).
    assert conn.execute("SELECT title FROM curriculum_programs WHERE id='hum-p'").fetchone()[0] \
        == "Leçon manuelle"
    assert conn.execute("SELECT label FROM curriculum_terms WHERE id='hum-t'").fetchone()[0] \
        == "Trimestre manuel"
    auto_prog = conn.execute("SELECT COUNT(*) FROM curriculum_programs"
                             " WHERE json_extract(competencies_json,'$.source')='auto'").fetchone()[0]
    assert auto_prog == 2
    # Total = 2 auto + 1 humain.
    assert conn.execute("SELECT COUNT(*) FROM curriculum_programs").fetchone()[0] == 3
    conn.close()


# ── Cohérence avec le consommateur (onglets Vue 2) ────────────────────────────
def test_consumer_aggregates_activate_curriculum():
    conn = _fresh_conn()
    _seed_typical(conn)
    cb.build_curriculum(conn, _DOC_ID)
    from api.routes_library import _curriculum_aggregates
    agg = _curriculum_aggregates(conn)
    # Le curriculum devient « disponible » : per_term non vide, compteurs cohérents.
    assert agg["per_term"] and agg["per_term"][0]["programs"] == 2
    assert agg["global"]["programs"] == 2
    assert agg["global"]["exercises"] == 3   # exercise_unsolved + exercise_solved
    assert agg["global"]["solutions"] == 2
    conn.close()


# ── Base vide : dégradation gracieuse (jamais d'exception) ────────────────────
def test_empty_database_returns_zero_counts():
    conn = _fresh_conn()
    counts = cb.build_curriculum(conn, None)
    assert counts == {"lessons": 0, "exercises": 0, "solutions": 0, "assessments": 0}
    conn.close()


if __name__ == "__main__":  # pragma: no cover
    sys.exit(pytest.main([__file__, "-v"]))
