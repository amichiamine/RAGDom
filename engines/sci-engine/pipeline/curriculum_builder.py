# -*- coding: utf-8 -*-
"""sci-engine — Génération AUTOMATIQUE et DÉTERMINISTE du curriculum (V5).

Comble le « trou » CurriculumStudio : au lieu de saisir à la main la Matrice /
le Programme des onglets Library, on PEUPLE les tables curriculum du schéma réel
(curriculum_terms / curriculum_programs / assessments / content_links) à partir
de l'existant déjà produit par l'ingestion — ZÉRO LLM, 100 % SQL/algorithmique.

Sources d'entrée (déjà en base après le finalize) :
  - document_toc          → hiérarchie leçons/chapitres (niveau 1) + plages pages ;
  - document_chunks       → course_theory / exercise_* / solution_only /
                            evaluation_exam (types pédagogiques V3.5) ;
  - documents             → sujets d'examen entiers (doc_type typé 'sujet').

Sorties (tables curriculum du DDL réel — AUCUNE colonne inventée) :
  - curriculum_terms      : périodes (ici 1 terme synthétique « programme entier »
                            faute de marqueur de trimestre dans le corpus) ;
  - curriculum_programs   : 1 ligne par LEÇON (entrée TOC niveau 1), rattachée au
                            terme ; plage de pages + toc_id rangés dans
                            competencies_json (champ JSON libre du DDL) ;
  - assessments           : 1 ligne par sujet d'évaluation (chunk evaluation_exam
                            ou document entier typé sujet) ;
  - content_links         : program_term (program→term), course_program
                            (chunk cours→program), course_exercise (chunk
                            cours→chunk exercice) — les 3 seuls types que le
                            consommateur _curriculum_aggregates (routes_library)
                            sait lire pour ses badges/compteurs Vue 2.

IDEMPOTENT & NON-DESTRUCTIF : les tables curriculum du DDL réel ne portent PAS de
marqueur is_human_edited. On marque donc TOUTES nos lignes « auto » dans leur
champ JSON libre (metadata_json / competencies_json / scale_json) et, pour les
content_links, dans metadata_json. La reconstruction ne SUPPRIME QUE les lignes
marquées auto (jamais une ligne saisie à la main via CurriculumStudio, qui n'aura
pas ce marqueur) puis les recrée → 2 exécutions successives = pas de doublon.

Contrat public : build_curriculum(conn, document_id=None) -> dict de comptes
{lessons, exercises, solutions, assessments}. Ne lève JAMAIS pour une base vide
ou partielle (dégradation gracieuse) ; propage en revanche une vraie erreur SQL
à l'appelant, qui l'isole (le finalize de l'orchestrateur ne meurt jamais).
Python 3.9+.
"""
import json
import logging
import uuid

logger = logging.getLogger("ragdom.sci-engine.curriculum")

# ── Marqueur d'origine « auto » : seule clé qui distingue nos lignes des lignes
#    saisies à la main. Rangée dans le champ JSON libre de CHAQUE table. ──
_AUTO_MARKER = "auto"
_AUTO_SOURCE = {"source": _AUTO_MARKER}

# Niveau TOC considéré comme « leçon / chapitre » (le consommateur compte lui
# aussi document_toc WHERE level=1 comme unités de lecture réelles).
_LESSON_TOC_LEVEL = 1

# Terme synthétique par défaut : le corpus manuel n'expose aucun marqueur de
# trimestre exploitable déterministiquement. On ancre donc tous les programmes
# sur un terme unique « programme entier » pour que per_term ne soit pas vide.
_DEFAULT_TERM_INDEX = 1
_DEFAULT_TERM_LABEL = "البرنامج"  # « le programme » (arabe) — repli neutre

# Types pédagogiques (V3.5) exploités.
_COURSE_TYPES = ("course_theory", "proof_demonstration")
_EXERCISE_TYPES = ("exercise_unsolved", "exercise_solved")
_SOLUTION_TYPE = "solution_only"
_EXAM_TYPE = "evaluation_exam"

# doc_type marquant un DOCUMENT entier comme sujet d'évaluation (base sources :
# sujets dzexams). Liste fermée, insensible à la casse.
_EXAM_DOC_TYPES = ("sujet", "exam", "examen", "subject", "assessment")
# Mapping doc_type/section → `kind` du DDL (CHECK IN devoir/composition/examen/autre).
_ASSESSMENT_KIND_DEFAULT = "autre"

# Types de content_links émis (sous-ensemble du CHECK du DDL réellement lu par
# _curriculum_aggregates + provenance).
_LINK_PROGRAM_TERM = "program_term"
_LINK_COURSE_PROGRAM = "course_program"
_LINK_COURSE_EXERCISE = "course_exercise"


def _uid() -> str:
    return str(uuid.uuid4())


def _auto_json(extra: dict = None) -> str:
    """Sérialise un champ JSON libre porteur du marqueur auto (+ métadonnées)."""
    payload = dict(_AUTO_SOURCE)
    if extra:
        payload.update(extra)
    return json.dumps(payload, ensure_ascii=False)


def _is_auto_row(json_text) -> bool:
    """True si un champ JSON libre porte le marqueur d'origine auto."""
    if not json_text:
        return False
    try:
        return json.loads(json_text).get("source") == _AUTO_MARKER
    except (ValueError, TypeError):
        return False


def _purge_auto_rows(conn, document_id) -> None:
    """Supprime UNIQUEMENT les lignes curriculum d'origine auto (idempotence
    non-destructive : les lignes saisies à la main n'ont pas le marqueur).

    Ordre de suppression = enfants avant parents (content_links puis assessments,
    puis programs, puis terms) pour ne pas laisser de lien orphelin. Le périmètre
    est le document quand document_id est fourni, sinon toute la base. Depuis V5,
    programs/terms/links portent aussi document_id : aucune reconstruction d'un
    document ne peut supprimer le curriculum automatique d'un autre."""
    # content_links auto : V5 porte document_id, donc un build document ne touche
    # jamais les liens d'un autre document.
    link_sql = ("DELETE FROM content_links WHERE link_type IN (?,?,?)"
                " AND metadata_json IS NOT NULL AND json_extract(metadata_json,'$.source')=?")
    link_args = [_LINK_PROGRAM_TERM, _LINK_COURSE_PROGRAM, _LINK_COURSE_EXERCISE, _AUTO_MARKER]
    if document_id:
        link_sql += " AND document_id=?"
        link_args.append(document_id)
    conn.execute(link_sql, link_args)
    # assessments auto (scopables par document).
    if document_id:
        conn.execute(
            "DELETE FROM assessments WHERE document_id=?"
            " AND scale_json IS NOT NULL AND json_extract(scale_json,'$.source')=?",
            (document_id, _AUTO_MARKER))
    else:
        conn.execute(
            "DELETE FROM assessments WHERE scale_json IS NOT NULL"
            " AND json_extract(scale_json,'$.source')=?", (_AUTO_MARKER,))
    # programs + terms auto, scopés par document depuis V5.
    suffix = " AND document_id=?" if document_id else ""
    args = (_AUTO_MARKER, document_id) if document_id else (_AUTO_MARKER,)
    conn.execute(
        "DELETE FROM curriculum_programs WHERE competencies_json IS NOT NULL"
        " AND json_extract(competencies_json,'$.source')=?" + suffix, args)
    conn.execute(
        "DELETE FROM curriculum_terms WHERE metadata_json IS NOT NULL"
        " AND json_extract(metadata_json,'$.source')=?" + suffix, args)


def _ensure_default_term(conn, document_id) -> str:
    """Retourne le terme auto du document courant, sans collision inter-document."""
    row = conn.execute(
        "SELECT id FROM curriculum_terms WHERE metadata_json IS NOT NULL"
        " AND json_extract(metadata_json,'$.source')=? AND document_id IS ?"
        " ORDER BY term_index LIMIT 1", (_AUTO_MARKER, document_id)).fetchone()
    if row:
        return row[0]
    term_id = _uid()
    conn.execute(
        "INSERT INTO curriculum_terms (id, document_id, term_index, label, metadata_json)"
        " VALUES (?,?,?,?,?)",
        (term_id, document_id, _DEFAULT_TERM_INDEX, _DEFAULT_TERM_LABEL, _auto_json()))
    return term_id


def _fetch_lessons(conn, document_id):
    """Entrées TOC niveau 1 (leçons/chapitres) triées par page de début puis titre
    (ordre DÉTERMINISTE), scopées au document si fourni. Renvoie une liste de
    tuples (toc_id, title, page_start, page_end)."""
    if document_id:
        sql = ("SELECT id, title, page_start, page_end FROM document_toc"
               " WHERE document_id=? AND level=? ORDER BY page_start, title")
        args = (document_id, _LESSON_TOC_LEVEL)
    else:
        sql = ("SELECT id, title, page_start, page_end FROM document_toc"
               " WHERE level=? ORDER BY page_start, title")
        args = (_LESSON_TOC_LEVEL,)
    return conn.execute(sql, args).fetchall()


def _fetch_chunks_by_types(conn, document_id, types):
    """Chunks d'un ou plusieurs types pédagogiques, triés (page, chunk_index).
    Renvoie (id, page_number). document_id optionnel."""
    placeholders = ",".join("?" * len(types))
    sql = ("SELECT id, page_number FROM document_chunks"
           " WHERE pedagogical_type IN (%s)" % placeholders)
    args = list(types)
    if document_id:
        sql += " AND document_id=?"
        args.append(document_id)
    sql += " ORDER BY page_number, chunk_index"
    return conn.execute(sql, args).fetchall()


def _lesson_of_page(lessons, page_number):
    """Retourne la leçon (tuple TOC) dont la plage de pages CONTIENT page_number.

    Rattachement DÉTERMINISTE : première leçon (ordre page_start, titre) dont
    [page_start, page_end] englobe la page. page_end NULL = ouverte jusqu'à la
    fin (utilise un plafond très grand). Renvoie None si aucune ne convient."""
    if page_number is None:
        return None
    for toc_id, title, page_start, page_end in lessons:
        start = page_start if page_start is not None else 0
        end = page_end if page_end is not None else 10 ** 9
        if start <= page_number <= end:
            return (toc_id, title, page_start, page_end)
    return None


def _build_programs(conn, term_id, lessons, document_id):
    """Crée 1 curriculum_programs par leçon (ordre déterministe) + le lien
    program_term. Renvoie {toc_id: program_id} pour le rattachement aval."""
    toc_to_program = {}
    for seq_index, (toc_id, title, page_start, page_end) in enumerate(lessons, start=1):
        program_id = _uid()
        competencies = _auto_json({
            "toc_id": toc_id,
            "page_start": page_start,
            "page_end": page_end,
        })
        conn.execute(
            "INSERT INTO curriculum_programs (id, document_id, term_id, seq_index, title, source,"
            " competencies_json) VALUES (?,?,?,?,?,?,?)",
            (program_id, document_id, term_id, seq_index, title or "", _AUTO_MARKER, competencies))
        # Lien program→term (provenance auto).
        conn.execute(
            "INSERT INTO content_links (id, document_id, link_type, from_id, to_id, page_number,"
            " metadata_json) VALUES (?,?,?,?,?,?,?)",
            (_uid(), document_id, _LINK_PROGRAM_TERM, program_id, term_id, page_start, _auto_json()))
        toc_to_program[toc_id] = program_id
    return toc_to_program


def _link_courses(conn, lessons, toc_to_program, course_chunks, document_id):
    """Rattache chaque chunk de cours à sa leçon (par plage de pages) via un lien
    course_program (from_id=chunk cours, to_id=program). Renvoie
    {toc_id: [chunk_id, ...]} des cours de chaque leçon (représentants pour les
    exercices — cf. _link_exercises)."""
    courses_by_toc = {}
    for chunk_id, page_number in course_chunks:
        lesson = _lesson_of_page(lessons, page_number)
        if lesson is None:
            continue
        program_id = toc_to_program.get(lesson[0])
        if program_id is None:
            continue
        conn.execute(
            "INSERT INTO content_links (id, document_id, link_type, from_id, to_id, page_number,"
            " metadata_json) VALUES (?,?,?,?,?,?,?)",
            (_uid(), document_id, _LINK_COURSE_PROGRAM, chunk_id, program_id, page_number, _auto_json()))
        courses_by_toc.setdefault(lesson[0], []).append(chunk_id)
    return courses_by_toc


def _link_exercises(conn, lessons, courses_by_toc, exercise_chunks, document_id):
    """Rattache chaque exercice à sa leçon via un lien course_exercise
    (from_id=chunk cours REPRÉSENTATIF de la leçon, to_id=chunk exercice).

    Le consommateur _curriculum_aggregates compte les exercices d'un terme via
    `course_exercise.from_id IN (cours liés à un program du terme)` : le from_id
    DOIT donc être un chunk cours de la leçon. Quand une leçon n'a AUCUN chunk
    course_theory (fréquent : pages d'exercices pures), on ne peut pas fabriquer
    ce lien per-term ; l'exercice reste néanmoins compté GLOBALEMENT (l'agrégat
    global lit document_chunks directement). Renvoie le nombre de liens créés."""
    linked = 0
    for chunk_id, page_number in exercise_chunks:
        lesson = _lesson_of_page(lessons, page_number)
        if lesson is None:
            continue
        course_reps = courses_by_toc.get(lesson[0])
        if not course_reps:
            continue  # leçon sans cours → pas de from_id valide (compté au global)
        from_course = course_reps[0]  # représentant déterministe (1er cours de la leçon)
        conn.execute(
            "INSERT INTO content_links (id, document_id, link_type, from_id, to_id, page_number,"
            " metadata_json) VALUES (?,?,?,?,?,?,?)",
            (_uid(), document_id, _LINK_COURSE_EXERCISE, from_course, chunk_id, page_number, _auto_json()))
        linked += 1
    return linked


def _title_of_chunk(conn, chunk_id):
    """Titre lisible d'un chunk (section_title, repli sur « page N »)."""
    row = conn.execute(
        "SELECT section_title, page_number FROM document_chunks WHERE id=?",
        (chunk_id,)).fetchone()
    if row is None:
        return "تقييم"
    return (row[0] or "").strip() or ("تقييم — صفحة %s" % row[1])


def _build_assessments_from_chunks(conn, document_id, exam_chunks):
    """1 assessment par chunk evaluation_exam (subject_chunk_id = le chunk ; sa
    correction éventuelle via linked_solution_chunk_id). scale_json porte le
    marqueur auto. Renvoie le nombre créé."""
    created = 0
    for chunk_id, _page in exam_chunks:
        doc_id, linked_sol = conn.execute(
            "SELECT document_id, linked_solution_chunk_id FROM document_chunks WHERE id=?",
            (chunk_id,)).fetchone()
        conn.execute(
            "INSERT INTO assessments (id, document_id, term_id, kind, title,"
            " subject_chunk_id, correction_chunk_id, scale_json) VALUES (?,?,?,?,?,?,?,?)",
            (_uid(), doc_id, None, _ASSESSMENT_KIND_DEFAULT, _title_of_chunk(conn, chunk_id),
             chunk_id, linked_sol, _auto_json()))
        created += 1
    return created


def _fetch_exam_documents(conn, document_id):
    """Documents ENTIERS typés sujet d'évaluation (doc_type dans la liste fermée
    _EXAM_DOC_TYPES). Périmètre = document_id si fourni. Renvoie [(id, title)]."""
    placeholders = ",".join("?" * len(_EXAM_DOC_TYPES))
    sql = ("SELECT id, title FROM documents WHERE LOWER(doc_type) IN (%s)" % placeholders)
    args = [t.lower() for t in _EXAM_DOC_TYPES]
    if document_id:
        sql += " AND id=?"
        args.append(document_id)
    return conn.execute(sql, args).fetchall()


def _has_exam_documents(conn, document_id) -> bool:
    """True s'il existe au moins un document entier typé sujet dans le périmètre."""
    return bool(_fetch_exam_documents(conn, document_id))


def _build_assessments_from_documents(conn, document_id) -> int:
    """1 assessment par DOCUMENT entier typé sujet d'évaluation (doc_type dans la
    liste fermée _EXAM_DOC_TYPES). subject_chunk_id/correction_chunk_id restent
    NULL (le sujet EST le document). Périmètre = document_id si fourni. Renvoie
    le nombre créé."""
    created = 0
    for doc_id, title in _fetch_exam_documents(conn, document_id):
        conn.execute(
            "INSERT INTO assessments (id, document_id, term_id, kind, title,"
            " subject_chunk_id, correction_chunk_id, scale_json) VALUES (?,?,?,?,?,?,?,?)",
            (_uid(), doc_id, None, _ASSESSMENT_KIND_DEFAULT, title or "سلسلة تمارين",
             None, None, _auto_json()))
        created += 1
    return created


def build_curriculum(conn, document_id=None) -> dict:
    """Peuple DÉTERMINISTIQUEMENT (zéro LLM) les tables curriculum depuis l'existant.

    Args:
        conn        : connexion sqlite3 OUVERTE (l'appelant gère open/close). La
                      fonction ouvre sa PROPRE transaction et commit en fin.
        document_id : périmètre optionnel. None = toute la base.

    Returns:
        dict {lessons, exercises, solutions, assessments} — comptes RÉELS des
        entités produites (leçons=programmes créés ; exercices=liens
        course_exercise ; solutions=chunks solution_only du périmètre ;
        assessments=lignes assessments créées).

    Idempotent (purge des seules lignes auto puis reconstruction) et
    non-destructif (lignes humaines préservées). Transaction unique."""
    if document_id is None:
        totals = {"lessons": 0, "exercises": 0, "solutions": 0, "assessments": 0}
        for (doc_id,) in conn.execute("SELECT id FROM documents ORDER BY id").fetchall():
            result = build_curriculum(conn, doc_id)
            for key in totals:
                totals[key] += result[key]
        return totals
    conn.execute("BEGIN")
    try:
        # 1) Idempotence non-destructive : on efface nos anciennes lignes auto.
        _purge_auto_rows(conn, document_id)

        # 2) Leçons ← TOC niveau 1 (source d'ancrage des programmes).
        lessons = _fetch_lessons(conn, document_id)

        # 3) Évaluations « documents » repérées AVANT de décider s'il y a du contenu
        #    (un document entier typé sujet suffit à justifier un curriculum).
        exam_chunks = _fetch_chunks_by_types(conn, document_id, (_EXAM_TYPE,))
        has_content = bool(lessons) or bool(exam_chunks) or _has_exam_documents(conn, document_id)

        # 4) Aucun contenu pédagogique structurant → on NE crée RIEN (le curriculum
        #    reste indisponible : Mode Repli Générique de la Vue 2). Évite un terme
        #    « vide » qui basculerait faussement curriculum_available à True.
        if not has_content:
            conn.commit()
            counts = {"lessons": 0, "exercises": 0, "solutions": 0, "assessments": 0}
            logger.info("build_curriculum(%s) : aucun contenu structurant, rien créé",
                        document_id or "ALL")
            return counts

        # 5) Terme d'ancrage (réutilisé s'il existe déjà en auto).
        term_id = _ensure_default_term(conn, document_id)

        # 6) Leçons → curriculum_programs (+ program_term).
        toc_to_program = _build_programs(conn, term_id, lessons, document_id)

        # 7) Cours ← chunks course_theory/proof → course_program.
        course_chunks = _fetch_chunks_by_types(conn, document_id, _COURSE_TYPES)
        courses_by_toc = _link_courses(conn, lessons, toc_to_program, course_chunks, document_id)

        # 8) Exercices ← chunks exercise_* → course_exercise (rattachés par page).
        exercise_chunks = _fetch_chunks_by_types(conn, document_id, _EXERCISE_TYPES)
        exercises_linked = _link_exercises(conn, lessons, courses_by_toc, exercise_chunks, document_id)

        # 9) Évaluations ← chunks evaluation_exam ET documents entiers typés sujet.
        assessments = _build_assessments_from_chunks(conn, document_id, exam_chunks)
        assessments += _build_assessments_from_documents(conn, document_id)

        # Comptes rapportés (solutions = corrigés présents dans le périmètre).
        solutions = len(_fetch_chunks_by_types(conn, document_id, (_SOLUTION_TYPE,)))

        conn.commit()
        counts = {
            "lessons": len(toc_to_program),
            "exercises": exercises_linked,
            "solutions": solutions,
            "assessments": assessments,
        }
        logger.info("build_curriculum(%s) : %s", document_id or "ALL", counts)
        return counts
    except Exception:
        conn.rollback()
        raise
