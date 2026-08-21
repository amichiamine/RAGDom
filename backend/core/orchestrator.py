# -*- coding: utf-8 -*-
"""RAGDom — PipelineOrchestrator (tech_specs §4.1) : queue séquentielle stricte.

Noyau agnostique (V3.4) : aucune logique métier ici. L'orchestrateur lit/écrit
les états dans pipeline_jobs, invoque les couches du moteur actif (résolu par
engine_registry) et applique la résilience de Skills.md §5.2 :
- reprise au démarrage (états transitoires → QUEUED) ;
- skip des pages déjà READY (jamais de double-indexation) ;
- isolation par page (une exception n'interrompt jamais la page suivante) ;
- INVALID_SOURCE sans retry ; QUARANTINE après MAX_RETRY_COUNT.
Python 3.9+.
"""
import gc
import logging
import threading
import time
import uuid
from typing import Callable, Dict, List, Optional

import config
from core import engine_registry
from db import connection as db

logger = logging.getLogger("ragdom.orchestrator")

TRANSIENT_STATES = ("PROCESSING_CV", "SEGMENTING", "EXTRACTING", "LINTING", "VLM_RECOVERY")
# Ordre d'invocation des couches d'un moteur (contrats DTO tech_specs §2).
LAYER_SEQUENCE = (
    ("layer_0_cv", "PROCESSING_CV"),
    ("layer_1_triage", "SEGMENTING"),
    ("layer_2_extract", "EXTRACTING"),
    ("layer_3_qualify", "EXTRACTING"),
    ("layer_4_lint", "LINTING"),
    ("layer_5_vlm", "VLM_RECOVERY"),
    ("layer_6_bench", "LINTING"),
    ("layer_7_persist", "INDEXED"),
)


class PipelineOrchestrator:
    """Un seul job actif à la fois ; événements publiés vers les abonnés SSE."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._running = False
        self._stop_requested = False
        self._current: Optional[dict] = None
        self._listeners: List[Callable[[str, dict], None]] = []

    # ── Abonnement SSE (routes_pipeline s'y branche en Phase 2) ──
    def subscribe(self, listener: Callable[[str, dict], None]) -> None:
        self._listeners.append(listener)

    def _emit(self, event: str, data: dict) -> None:
        for listener in list(self._listeners):
            try:
                listener(event, data)
            except Exception:  # noqa: BLE001 — un listener cassé n'arrête pas le pipeline
                logger.exception("Listener SSE en échec")

    # ── Reprise sur erreur au démarrage (Skills §5.2) ──
    def recover(self, db_name: str) -> int:
        conn = db.get_connection(db_name)
        try:
            placeholders = ",".join("?" for _ in TRANSIENT_STATES)
            cur = conn.execute(
                "UPDATE pipeline_jobs SET status='QUEUED' WHERE status IN (%s)" % placeholders,
                TRANSIENT_STATES,
            )
            conn.commit()
            if cur.rowcount:
                logger.info("Recovery %s : %d page(s) transitoire(s) remise(s) en QUEUED", db_name, cur.rowcount)
            return cur.rowcount
        finally:
            conn.close()

    # ── Mise en file d'un batch (contrat Blueprint §7.4 : 1 ligne/page) ──
    def enqueue_batch(self, db_name: str, document_id: str, source_path: str,
                      mode: str, page_start: int, page_end: int) -> dict:
        conn = db.get_connection(db_name)
        try:
            batch_id = str(uuid.uuid4())
            pages = list(range(page_start, page_end + 1))
            conn.execute(
                "INSERT INTO ingestion_batches (id, source_path, target_db, mode, page_start, page_end, status, pages_total)"
                " VALUES (?,?,?,?,?,?, 'QUEUED', ?)",
                (batch_id, source_path, db_name, mode, page_start, page_end, len(pages)),
            )
            skipped = 0
            for page in pages:
                already = conn.execute(
                    "SELECT 1 FROM pipeline_jobs WHERE document_id=? AND page_number=? AND status='READY'",
                    (document_id, page),
                ).fetchone()
                if already:
                    skipped += 1
                    continue
                conn.execute(
                    "INSERT INTO pipeline_jobs (id, document_id, page_number, status, batch_id)"
                    " VALUES (?,?,?, 'QUEUED', ?)",
                    (str(uuid.uuid4()), document_id, page, batch_id),
                )
            conn.commit()
            self._emit("queue_update", {"queue_length": len(pages) - skipped, "batch_id": batch_id})
            return {"batch_id": batch_id, "status": "QUEUED", "pages_total": len(pages), "skipped_ready": skipped}
        finally:
            conn.close()

    def request_stop(self) -> None:
        self._stop_requested = True

    @property
    def current_job(self) -> Optional[dict]:
        return dict(self._current) if self._current else None

    # ── Boucle principale : une page d'un seul document à la fois ──
    def run_queue(self, db_name: str) -> dict:
        with self._lock:
            if self._running:
                raise RuntimeError("Un traitement est déjà en cours (queue séquentielle stricte).")
            self._running = True
            self._stop_requested = False
        processed, quarantined = 0, 0
        try:
            manifest = engine_registry.active_engine()
            if manifest is None:
                raise RuntimeError("Aucun moteur actif dans /engines/ (manifeste engine.json requis).")
            while not self._stop_requested:
                job = self._next_job(db_name)
                if job is None:
                    break
                outcome = self._process_page(db_name, manifest, job)
                if outcome == "READY":
                    processed += 1
                elif outcome in ("QUARANTINE", "INVALID_SOURCE"):
                    quarantined += 1
            return {"processed": processed, "quarantined": quarantined, "stopped": self._stop_requested}
        finally:
            with self._lock:
                self._running = False

    def _next_job(self, db_name: str) -> Optional[dict]:
        conn = db.get_connection(db_name)
        try:
            row = conn.execute(
                "SELECT id, document_id, page_number, batch_id, retry_count FROM pipeline_jobs"
                " WHERE status='QUEUED' ORDER BY rowid LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            return {"id": row[0], "document_id": row[1], "page_number": row[2],
                    "batch_id": row[3], "retry_count": row[4]}
        finally:
            conn.close()

    def _set_status(self, db_name: str, job_id: str, status: str, error_log: Optional[str] = None) -> None:
        conn = db.get_connection(db_name)
        try:
            conn.execute(
                "UPDATE pipeline_jobs SET status=?, error_log=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                (status, error_log, job_id),
            )
            conn.commit()
        finally:
            conn.close()

    def _process_page(self, db_name: str, manifest: dict, job: dict) -> str:
        """Isolation par page : try/except indépendant, purge mémoire systématique."""
        self._current = dict(job, status="PROCESSING_CV")
        started = time.perf_counter()
        ctx: Dict[str, object] = {
            "db_name": db_name,
            "engine": manifest,
            "job": job,
            "config": {
                "sources_dir": config.SOURCES_DIR,
                "pipeline_set_dir": config.PIPELINE_SET_DIR,
                "max_ram_mb": config.MAX_RAM_MB,
                "vlm_timeout_seconds": config.VLM_TIMEOUT_SECONDS,
            },
        }
        try:
            for layer_module, status in LAYER_SEQUENCE:
                self._set_status(db_name, job["id"], status)
                self._current["status"] = status
                module = engine_registry.load_layer(manifest["id"], layer_module)
                ctx = module.run(ctx)
                if ctx.get("status") == "INVALID_SOURCE":
                    self._set_status(db_name, job["id"], "INVALID_SOURCE",
                                     str(ctx.get("error", "PDF corrompu ou protégé")))
                    self._emit("error", {"batch_id": job["batch_id"], "job_id": job["id"],
                                         "page_number": job["page_number"], "error": "INVALID_SOURCE",
                                         "details": str(ctx.get("error", ""))})
                    return "INVALID_SOURCE"
                if ctx.get("skip_remaining_layers"):
                    break
            self._set_status(db_name, job["id"], "READY")
            latency_ms = int((time.perf_counter() - started) * 1000)
            self._emit("page_update", {"batch_id": job["batch_id"], "job_id": job["id"],
                                       "page_number": job["page_number"], "status": "READY",
                                       "ram_mb": _rss_mb(), "latency_ms": latency_ms,
                                       "line": "[READY] Page %d indexée en %d ms" % (job["page_number"], latency_ms)})
            return "READY"
        except Exception as exc:  # noqa: BLE001 — la page N ne doit jamais tuer la page N+1
            retry = job["retry_count"] + 1
            status = "QUARANTINE" if retry >= config.MAX_RETRY_COUNT else "QUEUED"
            conn = db.get_connection(db_name)
            try:
                conn.execute(
                    "UPDATE pipeline_jobs SET status=?, retry_count=?, error_log=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                    (status, retry, "%s: %s" % (type(exc).__name__, exc), job["id"]),
                )
                conn.commit()
            finally:
                conn.close()
            logger.exception("Page %d en échec (retry %d → %s)", job["page_number"], retry, status)
            self._emit("error", {"batch_id": job["batch_id"], "job_id": job["id"],
                                 "page_number": job["page_number"],
                                 "error": type(exc).__name__, "details": str(exc)})
            return status
        finally:
            self._current = None
            gc.collect()  # Purge mémoire (Skills §2.1) — les couches purgent aussi leurs pixmaps.


def _rss_mb() -> int:
    try:
        import psutil
        return int(psutil.Process().memory_info().rss / (1024 * 1024))
    except Exception:  # noqa: BLE001 — la télémétrie ne doit jamais casser le pipeline
        return 0


# Instance unique du processus (importée par les routes en Phase 2).
orchestrator = PipelineOrchestrator()
