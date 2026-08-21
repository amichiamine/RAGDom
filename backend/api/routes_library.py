# -*- coding: utf-8 -*-
"""RAGDom — Routes /api/library/* (Blueprint §7.2 + §7.6 : corrections, benchmarks,
curriculum GET, import Tier 3). Pagination tech_specs §14. Python 3.9+."""
import struct
import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel

from core import engine_registry
from db import connection as db

router = APIRouter()


def _conn(db_name: str):
    try:
        return db.get_connection(db_name)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))


def _paginate(page: int, limit: int, total: int) -> dict:
    return {"page": page, "limit": limit, "total": total,
            "total_pages": max(1, (total + limit - 1) // limit)}


@router.get("/documents")
def documents(db_name: str = Query(alias="db"), page: int = 1, limit: int = Query(50, le=200)):
    conn = _conn(db_name)
    try:
        total = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        rows = conn.execute(
            "SELECT id, title, filename, total_pages, doc_type, academic_level, domain_tags_json,"
            " created_at FROM documents ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, (page - 1) * limit)).fetchall()
        data = [{"id": r[0], "title": r[1], "filename": r[2], "total_pages": r[3], "doc_type": r[4],
                 "academic_level": r[5], "domain_tags_json": r[6], "created_at": r[7]} for r in rows]
        return {"data": data, "documents": data, "pagination": _paginate(page, limit, total)}
    finally:
        conn.close()


@router.get("/toc")
def toc(db_name: str = Query(alias="db"), document_id: str = Query(...)):
    conn = _conn(db_name)
    try:
        rows = conn.execute(
            "SELECT id, parent_id, level, title, page_start, page_end FROM document_toc"
            " WHERE document_id=? ORDER BY page_start, level", (document_id,)).fetchall()
        nodes = {r[0]: {"id": r[0], "parent_id": r[1], "level": r[2], "title": r[3],
                        "page_start": r[4], "page_end": r[5], "children": []} for r in rows}
        roots = []
        for node in nodes.values():
            parent = nodes.get(node["parent_id"])
            (parent["children"] if parent else roots).append(node)
        return {"toc": roots}
    finally:
        conn.close()


@router.get("/facets")
def facets(db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    try:
        return {
            "domains": [{"domain": r[0], "count": r[1]} for r in conn.execute(
                "SELECT domain, COUNT(*) FROM scientific_artifacts GROUP BY domain ORDER BY 2 DESC")],
            "pedagogical_types": [{"pedagogical_type": r[0], "count": r[1]} for r in conn.execute(
                "SELECT pedagogical_type, COUNT(*) FROM document_chunks WHERE pedagogical_type IS NOT NULL"
                " GROUP BY pedagogical_type ORDER BY 2 DESC")],
            "artifact_types": [{"artifact_type": r[0], "count": r[1]} for r in conn.execute(
                "SELECT artifact_type, COUNT(*) FROM scientific_artifacts GROUP BY artifact_type ORDER BY 2 DESC")],
        }
    finally:
        conn.close()


@router.get("/chunks")
def chunks(db_name: str = Query(alias="db"), document_id: str = Query(...),
           page_number: Optional[int] = None, pedagogical_type: Optional[str] = None,
           page_start: Optional[int] = None, page_end: Optional[int] = None,
           toc_id: Optional[str] = None, page: int = 1, limit: int = Query(50, le=200)):
    conn = _conn(db_name)
    try:
        where, args = "document_id=?", [document_id]
        if page_number is not None:
            where += " AND page_number=?"
            args.append(page_number)
        if pedagogical_type is not None:  # V3.5 sprint pixel-perfect : filtres onglet Exercices
            if pedagogical_type == "exercise":  # raccourci : solved + unsolved
                where += " AND pedagogical_type IN ('exercise_solved','exercise_unsolved')"
            else:
                where += " AND pedagogical_type=?"
                args.append(pedagogical_type)
        if page_start is not None:
            where += " AND page_number>=?"
            args.append(page_start)
        if page_end is not None:
            where += " AND page_number<=?"
            args.append(page_end)
        if toc_id is not None:
            where += " AND toc_id=?"
            args.append(toc_id)
        total = conn.execute("SELECT COUNT(*) FROM document_chunks WHERE " + where, args).fetchone()[0]
        rows = conn.execute(
            "SELECT id, page_number, chunk_index, section_title, content_markdown, pedagogical_type,"
            " pedagogical_index, has_solution, is_human_edited, updated_at, token_count"
            " FROM document_chunks WHERE %s ORDER BY page_number, chunk_index LIMIT ? OFFSET ?" % where,
            args + [limit, (page - 1) * limit]).fetchall()
        data = [{"id": r[0], "page_number": r[1], "chunk_index": r[2], "section_title": r[3],
                 "content_markdown": r[4], "pedagogical_type": r[5], "pedagogical_index": r[6],
                 "has_solution": r[7], "is_human_edited": r[8], "updated_at": r[9],
                 "token_count": r[10]} for r in rows]
        return {"data": data, "chunks": data, "pagination": _paginate(page, limit, total)}
    finally:
        conn.close()


@router.get("/artifacts")
def artifacts(db_name: str = Query(alias="db"), chunk_id: Optional[str] = None,
              document_id: Optional[str] = None, page_number: Optional[int] = None):
    conn = _conn(db_name)
    try:
        where, args = [], []
        if chunk_id:
            where.append("chunk_id=?"); args.append(chunk_id)
        if document_id:
            where.append("document_id=?"); args.append(document_id)
        if page_number is not None:
            where.append("page_number=?"); args.append(page_number)
        clause = " AND ".join(where) or "1=1"
        rows = conn.execute(
            "SELECT id, domain, artifact_type, raw_data, render_config_json, caption,"
            " bounding_box_json, is_human_edited, page_number, (raw_binary IS NOT NULL)"
            " FROM scientific_artifacts WHERE %s ORDER BY page_number LIMIT 500" % clause, args).fetchall()
        return {"artifacts": [{"id": r[0], "domain": r[1], "artifact_type": r[2], "raw_data": r[3],
                               "raw_binary": None, "render_config_json": r[4], "caption": r[5],
                               "bounding_box_json": r[6], "is_human_edited": r[7],
                               "page_number": r[8], "has_binary": bool(r[9])} for r in rows]}
    finally:
        conn.close()


@router.get("/artifact-binary")
def artifact_binary(db_name: str = Query(alias="db"), artifact_id: str = Query(...)):
    """Sert le raw_binary d'un artefact (crops WebP, glTF…) — la base reste autonome."""
    conn = _conn(db_name)
    try:
        row = conn.execute("SELECT raw_binary FROM scientific_artifacts WHERE id=?", (artifact_id,)).fetchone()
        if row is None or row[0] is None:
            raise HTTPException(404, "Artefact sans binaire")
        return Response(content=row[0], media_type="application/octet-stream")
    finally:
        conn.close()


@router.get("/page-scan")
def page_scan(db_name: str = Query(alias="db"), document_id: str = Query(...),
              page: int = Query(...), thumb: bool = False):
    """Image binaire WebP servie DEPUIS page_scans (V3.5 Base Autonome) — jamais /sources/."""
    conn = _conn(db_name)
    try:
        row = conn.execute(
            "SELECT image_webp, thumb_webp, width_px, height_px FROM page_scans"
            " WHERE document_id=? AND page_number=?", (document_id, page)).fetchone()
        if row is None:
            raise HTTPException(404, "Aucun scan persisté pour cette page")
        payload = row[1] if (thumb and row[1]) else row[0]
        return Response(content=payload, media_type="image/webp",
                        headers={"X-Scan-Width": str(row[2]), "X-Scan-Height": str(row[3]),
                                 "Cache-Control": "max-age=3600"})
    finally:
        conn.close()


@router.get("/page-scans")
def page_scans_manifest(db_name: str = Query(alias="db"), document_id: Optional[str] = None,
                        page: int = 1, limit: int = Query(200, le=500)):
    """Manifeste de la galerie (sprint pixel-perfect Lot 1) : métadonnées SANS binaires.

    Chaque entrée porte le chapitre TOC englobant (niveau 1) et le compte
    d'exercices de la page — agrégats SQL, jamais calculés côté client.
    """
    conn = _conn(db_name)
    try:
        where, args = ("WHERE ps.document_id=?", [document_id]) if document_id else ("", [])
        total = conn.execute("SELECT COUNT(*) FROM page_scans ps %s" % where, args).fetchone()[0]
        rows = conn.execute(
            "SELECT ps.document_id, ps.page_number, ps.width_px, ps.height_px,"
            " (ps.thumb_webp IS NOT NULL),"
            " (SELECT t.id FROM document_toc t WHERE t.document_id=ps.document_id AND t.level=1"
            "   AND t.page_start<=ps.page_number AND COALESCE(t.page_end, 100000)>=ps.page_number"
            "   ORDER BY t.page_start DESC LIMIT 1),"
            " (SELECT t.title FROM document_toc t WHERE t.document_id=ps.document_id AND t.level=1"
            "   AND t.page_start<=ps.page_number AND COALESCE(t.page_end, 100000)>=ps.page_number"
            "   ORDER BY t.page_start DESC LIMIT 1),"
            " (SELECT COUNT(*) FROM document_chunks c WHERE c.document_id=ps.document_id"
            "   AND c.page_number=ps.page_number"
            "   AND c.pedagogical_type IN ('exercise_solved','exercise_unsolved'))"
            " FROM page_scans ps %s ORDER BY ps.document_id, ps.page_number"
            " LIMIT ? OFFSET ?" % where, args + [limit, (page - 1) * limit]).fetchall()
        data = [{"document_id": r[0], "page_number": r[1], "width": r[2], "height": r[3],
                 "has_thumb": bool(r[4]), "chapter_toc_id": r[5], "chapter_title": r[6],
                 "exercises_count": r[7]} for r in rows]
        return {"data": data, "pagination": _paginate(page, limit, total)}
    finally:
        conn.close()


def _curriculum_aggregates(conn) -> dict:
    """Agrégats SQL du curriculum (sprint pixel-perfect Lot 1) — badges/compteurs de la Vue 2."""
    def one(sql, args=()):
        row = conn.execute(sql, args).fetchone()
        return row[0] if row and row[0] is not None else 0

    per_term = []
    for term_id, term_index in conn.execute(
            "SELECT id, term_index FROM curriculum_terms ORDER BY term_index"):
        courses = one(
            "SELECT COUNT(DISTINCT l2.from_id) FROM content_links l2"
            " JOIN curriculum_programs p ON p.id = l2.to_id"
            " WHERE l2.link_type='course_program' AND p.term_id=?", (term_id,))
        exercises = one(
            "SELECT COUNT(*) FROM content_links le WHERE le.link_type='course_exercise'"
            " AND le.from_id IN (SELECT l2.from_id FROM content_links l2"
            "   JOIN curriculum_programs p ON p.id = l2.to_id"
            "   WHERE l2.link_type='course_program' AND p.term_id=?)", (term_id,))
        per_term.append({
            "term_id": term_id, "term_index": term_index,
            "programs": one("SELECT COUNT(*) FROM curriculum_programs WHERE term_id=?", (term_id,)),
            "assessments": one("SELECT COUNT(*) FROM assessments WHERE term_id=?", (term_id,)),
            "courses": courses, "exercises": exercises,
        })
    return {
        "per_term": per_term,
        "global": {
            "programs": one("SELECT COUNT(*) FROM curriculum_programs"),
            "assessments": one("SELECT COUNT(*) FROM assessments"),
            "courses": one("SELECT COUNT(*) FROM document_chunks WHERE pedagogical_type='course_theory'"),
            "exercises": one("SELECT COUNT(*) FROM document_chunks"
                             " WHERE pedagogical_type IN ('exercise_solved','exercise_unsolved')"),
            "solutions": one("SELECT COUNT(*) FROM document_chunks WHERE pedagogical_type='solution_only'"),
            "page_scans": one("SELECT COUNT(*) FROM page_scans"),
            "chapters": one("SELECT COUNT(*) FROM document_toc WHERE level=1"),
        },
    }


@router.get("/curriculum")
def curriculum(db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    try:
        terms = [{"id": r[0], "term_index": r[1], "label": r[2]} for r in
                 conn.execute("SELECT id, term_index, label FROM curriculum_terms ORDER BY term_index")]
        programs = [{"id": r[0], "term_id": r[1], "seq_index": r[2], "title": r[3], "source": r[4],
                     "competencies_json": r[5]} for r in conn.execute(
                    "SELECT id, term_id, seq_index, title, source, competencies_json"
                    " FROM curriculum_programs ORDER BY seq_index")]
        assessments = [{"id": r[0], "document_id": r[1], "term_id": r[2], "kind": r[3], "title": r[4],
                        "subject_chunk_id": r[5], "correction_chunk_id": r[6], "scale_json": r[7]}
                       for r in conn.execute("SELECT id, document_id, term_id, kind, title,"
                                             " subject_chunk_id, correction_chunk_id, scale_json FROM assessments")]
        links = [{"id": r[0], "link_type": r[1], "from_id": r[2], "to_id": r[3], "page_number": r[4]}
                 for r in conn.execute("SELECT id, link_type, from_id, to_id, page_number FROM content_links")]
        return {"curriculum_available": bool(terms or programs or assessments),
                "terms": terms, "programs": programs, "assessments": assessments, "links": links,
                "aggregates": _curriculum_aggregates(conn)}
    finally:
        conn.close()


@router.get("/benchmarks")
def benchmarks(db_name: str = Query(alias="db"), document_id: Optional[str] = None,
               page: int = 1, limit: int = Query(50, le=200)):
    conn = _conn(db_name)
    try:
        where, args = ("WHERE document_id=?", [document_id]) if document_id else ("", [])
        total = conn.execute("SELECT COUNT(*) FROM processing_benchmarks %s" % where, args).fetchone()[0]
        rows = conn.execute(
            "SELECT id, page_number, engine_used, vlm_provider_used, fallback_triggered,"
            " execution_time_ms, ram_peak_mb, confidence_score, created_at FROM processing_benchmarks"
            " %s ORDER BY created_at DESC LIMIT ? OFFSET ?" % where,
            args + [limit, (page - 1) * limit]).fetchall()
        agg = conn.execute(
            "SELECT AVG(execution_time_ms), AVG(confidence_score), AVG(ram_peak_mb),"
            " AVG(vlm_provider_used IS NOT NULL), AVG(fallback_triggered) FROM processing_benchmarks %s" % where,
            args).fetchone()
        return {"data": [{"id": r[0], "page_number": r[1], "engine_used": r[2],
                          "vlm_provider_used": r[3], "fallback_triggered": r[4],
                          "execution_time_ms": r[5], "ram_peak_mb": r[6], "confidence_score": r[7],
                          "created_at": r[8]} for r in rows],
                "aggregates": {"avg_latency_ms": round(agg[0] or 0, 1), "avg_confidence": round(agg[1] or 0, 3),
                               "avg_ram_peak_mb": round(agg[2] or 0, 1), "vlm_usage_rate": round(agg[3] or 0, 3),
                               "fallback_rate": round(agg[4] or 0, 3)},
                "pagination": _paginate(page, limit, total)}
    finally:
        conn.close()


class ChunkPatch(BaseModel):
    content_markdown: Optional[str] = None
    section_title: Optional[str] = None
    pedagogical_type: Optional[str] = None


@router.put("/chunks/{chunk_id}")
def update_chunk(chunk_id: str, patch: ChunkPatch, db_name: str = Query(alias="db")):
    """Correction humaine (tech_specs §4.5) : re-lint → re-embed → update → FTS/vec par triggers."""
    conn = _conn(db_name)
    try:
        row = conn.execute("SELECT content_markdown FROM document_chunks WHERE id=?", (chunk_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Chunk introuvable")
        new_md = patch.content_markdown if patch.content_markdown is not None else row[0]
        lint = {"is_valid": True, "errors": []}
        embedding = None
        try:  # linter + embedder du moteur actif (jamais bloquants : l'humain a le dernier mot)
            active = engine_registry.active_engine()
            layer4 = engine_registry.load_layer(active["id"], "layer_4_lint")
            ctx = {"chunks": [{"chunk_index": 0, "content_markdown": new_md}], "artifacts": [], "latencies": {}}
            layer4.run(ctx)
            lint = {"is_valid": ctx["lint"]["is_valid"], "errors": ctx["lint"]["errors"]}
            layer3 = engine_registry.load_layer(active["id"], "layer_3_qualify")
            embedder = layer3._get_embedder()  # noqa: SLF001 — singleton du moteur réutilisé sciemment
            if embedder is not None:
                vector = next(iter(embedder.embed(["passage: " + new_md[:2000]])))
                embedding = struct.pack("<384f", *vector[:384])
        except Exception:  # noqa: BLE001
            pass
        sets, args = ["content_markdown=?", "is_human_edited=1", "updated_at=CURRENT_TIMESTAMP"], [new_md]
        if patch.section_title is not None:
            sets.append("section_title=?"); args.append(patch.section_title)
        if patch.pedagogical_type is not None:
            sets.append("pedagogical_type=?"); args.append(patch.pedagogical_type)
        if embedding is not None:
            sets.append("embedding_vector=?"); args.append(embedding)
        conn.execute("UPDATE document_chunks SET %s WHERE id=?" % ", ".join(sets), args + [chunk_id])
        if embedding is not None and db.vector_state()["engine"] == "sqlite-vec":
            conn.execute("DELETE FROM vec_chunks WHERE chunk_id=?", (chunk_id,))
            conn.execute("INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?,?)", (chunk_id, embedding))
        conn.commit()
        return {"updated": True, "lint": lint, "is_human_edited": 1}
    finally:
        conn.close()


class ArtifactPatch(BaseModel):
    raw_data: Optional[str] = None
    caption: Optional[str] = None
    render_config_json: Optional[str] = None


@router.put("/artifacts/{artifact_id}")
def update_artifact(artifact_id: str, patch: ArtifactPatch, db_name: str = Query(alias="db")):
    conn = _conn(db_name)
    try:
        if conn.execute("SELECT 1 FROM scientific_artifacts WHERE id=?", (artifact_id,)).fetchone() is None:
            raise HTTPException(404, "Artefact introuvable")
        sets, args = ["is_human_edited=1", "updated_at=CURRENT_TIMESTAMP"], []
        for field in ("raw_data", "caption", "render_config_json"):
            value = getattr(patch, field)
            if value is not None:
                sets.append(field + "=?"); args.append(value)
        if patch.raw_data is not None:
            sets.append("searchable_text=?"); args.append(patch.raw_data[:500])
        conn.execute("UPDATE scientific_artifacts SET %s WHERE id=?" % ", ".join(sets), args + [artifact_id])
        conn.commit()
        return {"updated": True, "is_human_edited": 1}
    finally:
        conn.close()


_RENDER_CONFIGS = {  # dictionnaire tech_specs §12 (types Tier 3 usuels)
    "pdb_protein": '{"renderer": "3dmol", "style": "cartoon", "backgroundColor": "white"}',
    "cif_crystal": '{"renderer": "3dmol", "style": "cartoon", "backgroundColor": "white"}',
    "cad_3d_model": '{"renderer": "three", "format": "gltf"}',
    "bim_ifc_slice": '{"renderer": "web-ifc", "readOnly": true}',
    "geojson_map": '{"renderer": "maplibre", "style": "https://demotiles.maplibre.org/style.json", "zoom": 5}',
    "dicom_slice": '{"renderer": "openseadragon", "tileSources": null, "showNavigator": true}',
}
_TEXT_TYPES = ("geojson_map", "fasta_sequence", "genbank_record", "smiles_chem")


@router.post("/artifacts/import")
async def import_artifact(db_name: str = Query(alias="db"), file: UploadFile = File(...),
                          document_id: str = Form(...), page_number: int = Form(...),
                          domain: str = Form(...), artifact_type: str = Form(...),
                          chunk_id: Optional[str] = Form(None), caption: Optional[str] = Form(None)):
    """Import Tier 3 (D3-B) : l'actif est stocké, indexé et rendu — jamais « détecté »."""
    payload = await file.read()
    if len(payload) > 50 * 1024 * 1024:
        raise HTTPException(413, "Fichier > 50 Mo")
    conn = _conn(db_name)
    try:
        is_text = artifact_type in _TEXT_TYPES
        conn.execute(
            "INSERT INTO scientific_artifacts (id, document_id, chunk_id, page_number, domain,"
            " artifact_type, raw_data, raw_binary, render_config_json, caption, searchable_text,"
            " is_human_edited) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)",
            (str(uuid.uuid4()), document_id, chunk_id, page_number, domain, artifact_type,
             payload.decode("utf-8", "replace") if is_text else None,
             None if is_text else payload,
             _RENDER_CONFIGS.get(artifact_type, '{"renderer": "svg", "sanitize": true, "zoomable": true}'),
             caption, (caption or artifact_type) + " " + (file.filename or "")))
        conn.commit()
        return {"imported": True, "artifact_type": artifact_type, "size_bytes": len(payload)}
    finally:
        conn.close()
