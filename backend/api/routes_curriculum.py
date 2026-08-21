# -*- coding: utf-8 -*-
"""RAGDom — Routes /api/curriculum/* : CRUD + import structuré (Blueprint §7.6, D1-B).

Alimente les tables curriculum OPTIONNELLES — la clé de sortie du Mode Repli
Générique de la Vue 2. Python 3.9+."""
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from db import connection as db

router = APIRouter()

_TABLES = {
    "terms": ("curriculum_terms", ("term_index", "label", "metadata_json")),
    "programs": ("curriculum_programs", ("term_id", "seq_index", "title", "source", "competencies_json")),
    "assessments": ("assessments", ("document_id", "term_id", "kind", "title",
                                    "subject_chunk_id", "correction_chunk_id", "scale_json")),
    "links": ("content_links", ("link_type", "from_id", "to_id", "page_number", "metadata_json")),
}


def _table(kind: str):
    if kind not in _TABLES:
        raise HTTPException(404, "Type curriculum inconnu : %s" % kind)
    return _TABLES[kind]


@router.get("/{kind}")
def list_items(kind: str, db_name: str = Query(alias="db")):
    table, columns = _table(kind)
    conn = db.get_connection(db_name)
    try:
        rows = conn.execute("SELECT id, %s FROM %s" % (", ".join(columns), table)).fetchall()
        return {"items": [dict(zip(("id",) + columns, row)) for row in rows]}
    finally:
        conn.close()


@router.post("/{kind}", status_code=201)
def create_item(kind: str, payload: dict, db_name: str = Query(alias="db")):
    table, columns = _table(kind)
    values = [payload.get(col) for col in columns]
    item_id = payload.get("id") or str(uuid.uuid4())
    conn = db.get_connection(db_name)
    try:
        conn.execute("INSERT INTO %s (id, %s) VALUES (%s)" % (table, ", ".join(columns),
                     ", ".join("?" * (len(columns) + 1))), [item_id] + values)
        conn.commit()
        return {"id": item_id, "created": True}
    finally:
        conn.close()


@router.put("/{kind}/{item_id}")
def update_item(kind: str, item_id: str, payload: dict, db_name: str = Query(alias="db")):
    table, columns = _table(kind)
    sets, args = [], []
    for col in columns:
        if col in payload:
            sets.append(col + "=?")
            args.append(payload[col])
    if not sets:
        raise HTTPException(400, "Aucun champ à mettre à jour")
    conn = db.get_connection(db_name)
    try:
        cur = conn.execute("UPDATE %s SET %s WHERE id=?" % (table, ", ".join(sets)), args + [item_id])
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Élément introuvable")
        return {"updated": True}
    finally:
        conn.close()


@router.delete("/{kind}/{item_id}")
def delete_item(kind: str, item_id: str, db_name: str = Query(alias="db")):
    table, _ = _table(kind)
    conn = db.get_connection(db_name)
    try:
        cur = conn.execute("DELETE FROM %s WHERE id=?" % table, (item_id,))
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Élément introuvable")
        return {"deleted": True}
    finally:
        conn.close()


class ImportBody(BaseModel):
    mode: str = "merge"  # merge | replace
    terms: Optional[list] = None
    programs: Optional[list] = None
    assessments: Optional[list] = None
    links: Optional[list] = None


@router.post("/import")
def import_curriculum(body: ImportBody, db_name: str = Query(alias="db")):
    """Import structuré complet (Blueprint §7.6) — replace vide d'abord les 4 tables."""
    conn = db.get_connection(db_name)
    try:
        conn.execute("BEGIN")
        if body.mode == "replace":
            for table in ("content_links", "assessments", "curriculum_programs", "curriculum_terms"):
                conn.execute("DELETE FROM %s" % table)
        counts = {}
        for kind in ("terms", "programs", "assessments", "links"):
            items = getattr(body, kind) or []
            table, columns = _TABLES[kind]
            for item in items:
                conn.execute("INSERT OR REPLACE INTO %s (id, %s) VALUES (%s)"
                             % (table, ", ".join(columns), ", ".join("?" * (len(columns) + 1))),
                             [item.get("id") or str(uuid.uuid4())] + [item.get(c) for c in columns])
            counts[kind] = len(items)
        conn.commit()
        return {"imported": counts, "mode": body.mode}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        raise HTTPException(400, "Import invalide : %s" % exc)
    finally:
        conn.close()
