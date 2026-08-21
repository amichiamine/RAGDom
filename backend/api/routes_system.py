# -*- coding: utf-8 -*-
"""RAGDom — Routes /api/system/* (Blueprint §7.1 + §7.6 partiel : engines).

Phase 1 : découverte des bases (Zéro Mock), santé + moteur vectoriel, registre
des moteurs. Les routes d'administration sources/databases/settings arrivent
en Phase 2 (elles vivent aussi dans ce module).
"""
import os
import sqlite3
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import config
from core import engine_registry, orchestrator as orch
from db import connection as db

router = APIRouter()


def _metrics(db_path: str) -> dict:
    conn = sqlite3.connect(db_path)
    try:
        def count(sql: str) -> int:
            try:
                return conn.execute(sql).fetchone()[0]
            except sqlite3.Error:
                return 0
        return {
            "document_count": count("SELECT COUNT(*) FROM documents"),
            "chunk_count": count("SELECT COUNT(*) FROM document_chunks"),
            "artifact_count": count("SELECT COUNT(*) FROM scientific_artifacts"),
            "page_count": count("SELECT COALESCE(SUM(total_pages),0) FROM documents"),
            "indexed_page_count": count("SELECT COUNT(*) FROM pipeline_jobs WHERE status='READY'"),
        }
    finally:
        conn.close()


@router.get("/databases")
def list_databases() -> dict:
    """Scanne physiquement /databases/ — le Frontend n'a AUCUNE donnée hardcodée."""
    items = []
    for name in sorted(os.listdir(config.DATABASES_DIR)):
        if not db.DB_NAME_RE.fullmatch(name):
            continue
        path = os.path.join(config.DATABASES_DIR, name)
        stat = os.stat(path)
        items.append({
            "filename": name,
            "size_bytes": stat.st_size,
            "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
            "metrics": _metrics(path),
        })
    return {"databases": items}


@router.get("/health")
def health() -> dict:
    state = db.vector_state()
    if state["engine"] == "unknown":  # première interrogation : sonde à chaud
        ok, _ = db.test_vector_engine()
        state = db.vector_state()
    queue_len = 0
    current = orch.orchestrator.current_job
    return {
        "status": "ok",
        "version": "3.5",
        "queue_length": queue_len if current is None else queue_len + 1,
        "vector_engine": state["engine"],
        "vector_engine_status": state["status"],
        "vector_engine_message": state["message"],
        "force_sqlite_vec": state["force"],
    }


class ToggleStrictBody(BaseModel):
    force_sqlite_vec: bool


@router.post("/vector-engine/toggle-strict")
def toggle_strict(body: ToggleStrictBody) -> dict:
    db.set_force_strict(body.force_sqlite_vec)
    return {"success": True, "force_sqlite_vec": body.force_sqlite_vec,
            "message": "Mode strict sqlite-vec configuré."}


@router.post("/vector-engine/test")
def test_vector_engine() -> dict:
    ok, message = db.test_vector_engine()
    return {"success": ok, "engine": db.vector_state()["engine"], "message": message}


@router.get("/engines")
def list_engines() -> dict:
    """Registre des moteurs (V3.4) — alimente le badge moteur et --engine-accent."""
    engines = engine_registry.scan_engines()
    active = engine_registry.active_engine()
    return {"engines": engines, "active_engine": active["id"] if active else None}
