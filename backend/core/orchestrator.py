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
import os
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
        # État « sommaire natif ? » mémoïsé par document (clé document_id → bool).
        # Évite de rouvrir le PDF via fitz à chaque passe TOC incrémentale (V4.3).
        self._native_toc_cache: Dict[str, bool] = {}
        # Compteur de pages READY par document depuis la dernière reconstruction
        # incrémentale du sommaire dérivé (V4.3, correctif structure documentaire (A)).
        self._toc_pages_since: Dict[str, int] = {}

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
                    # (A) Structure documentaire construite AU FIL DE L'EAU : le
                    # sommaire dérivé existe pendant l'ingestion, plus seulement au
                    # finalize. Cadencé (RAGDOM_TOC_INCREMENTAL_EVERY pages) et
                    # dégradé gracieusement — une erreur ici n'arrête jamais la file.
                    self._maybe_build_toc_incremental(db_name, job["document_id"])
                elif outcome in ("QUARANTINE", "INVALID_SOURCE"):
                    quarantined += 1
            self._finalize_batches(db_name, manifest)
            return {"processed": processed, "quarantined": quarantined, "stopped": self._stop_requested}
        finally:
            # Caches d'exécution (durée de vie = une passe de file) purgés : une
            # ré-ingestion ultérieure ré-évaluera l'état natif du PDF à neuf.
            self._toc_pages_since.clear()
            self._native_toc_cache.clear()
            with self._lock:
                self._running = False

    def _is_native_toc(self, conn, document_id: str) -> bool:
        """État « le PDF porte-t-il des signets natifs ? » mémoïsé par document.

        Ouvre le PDF via fitz au plus une fois par document et par exécution de la
        file : la passe TOC incrémentale peut ainsi être appelée à chaque page sans
        coût d'I/O répété. Dégradation gracieuse (source absente → non-natif)."""
        if document_id in self._native_toc_cache:
            return self._native_toc_cache[document_id]
        row = conn.execute("SELECT source_path FROM documents WHERE id=?",
                           (document_id,)).fetchone()
        native = _has_native_toc(row[0] if row else None)
        self._native_toc_cache[document_id] = native
        return native

    def _maybe_build_toc_incremental(self, db_name: str, document_id: str) -> None:
        """Reconstruit le sommaire dérivé toutes les N pages READY d'un document.

        N = RAGDOM_TOC_INCREMENTAL_EVERY (défaut 10 ; 0 = désactivé → construction
        au finalize uniquement, comportement historique). Le sommaire natif n'est
        JAMAIS écrasé (décision D actée). Idempotent : chaque passe est un DELETE +
        rebuild complet, donc les plages restent cohérentes tout au long de l'ingestion."""
        try:
            every = int(os.environ.get("RAGDOM_TOC_INCREMENTAL_EVERY", "10"))
        except ValueError:
            every = 10
        if every <= 0:
            return  # construction incrémentale désactivée
        count = self._toc_pages_since.get(document_id, 0) + 1
        if count < every:
            self._toc_pages_since[document_id] = count
            return
        self._toc_pages_since[document_id] = 0
        conn = db.get_connection(db_name)
        try:
            if self._is_native_toc(conn, document_id):
                return  # sommaire natif : intouchable
            built = _build_toc_from_headings(conn, document_id, native_toc=False)
            if built:
                logger.info("Sommaire dérivé incrémental %s : %d entrées", document_id, built)
        except Exception:  # noqa: BLE001 — la structure ne doit jamais tuer la file
            logger.exception("Construction TOC incrémentale en échec (document %s)", document_id)
        finally:
            conn.close()

    def _fetch_document(self, db_name: str, document_id: str) -> dict:
        conn = db.get_connection(db_name)
        try:
            row = conn.execute(
                "SELECT id, title, filename, source_path, total_pages FROM documents WHERE id=?",
                (document_id,),
            ).fetchone()
            if row is None:
                raise RuntimeError("Document inconnu : %s" % document_id)
            return {"id": row[0], "title": row[1], "filename": row[2],
                    "source_path": row[3], "total_pages": row[4]}
        finally:
            conn.close()

    def _finalize_batches(self, db_name: str, manifest: dict) -> None:
        """Clôt les batchs terminés, lance la Couche 3bis (SolutionLinker, tech_specs
        §4.4) par document complet, émet job_complete (contrat SSE Blueprint §7.4)."""
        conn = db.get_connection(db_name)
        try:
            rows = conn.execute(
                "SELECT b.id FROM ingestion_batches b WHERE b.status IN ('QUEUED','RUNNING') AND NOT EXISTS ("
                " SELECT 1 FROM pipeline_jobs j WHERE j.batch_id=b.id AND j.status NOT IN"
                " ('READY','QUARANTINE','INVALID_SOURCE'))"
            ).fetchall()
            for (batch_id,) in rows:
                docs = [r[0] for r in conn.execute(
                    "SELECT DISTINCT document_id FROM pipeline_jobs WHERE batch_id=?", (batch_id,))]
                stats = conn.execute(
                    "SELECT SUM(status='READY'), COUNT(*) FROM pipeline_jobs WHERE batch_id=?",
                    (batch_id,),
                ).fetchone()
                conn.execute(
                    "UPDATE ingestion_batches SET status='COMPLETED', pages_done=?, updated_at=CURRENT_TIMESTAMP"
                    " WHERE id=?", (stats[0] or 0, batch_id))
                conn.commit()
                for doc_id in docs:
                    try:
                        linker = engine_registry.load_layer(manifest["id"], "layer_3bis_link")
                        linked = linker.run_post_document(db_name, doc_id)
                        logger.info("SolutionLinker %s : %d liaison(s)", doc_id, linked)
                    except FileNotFoundError:
                        logger.warning("layer_3bis_link absent du moteur %s", manifest["id"])
                    # Sommaire dérivé RECONSTRUIT une dernière fois, complet : capte
                    # les titres des dernières pages (au-delà du dernier lot incrémental)
                    # et répare toute dérive laissée par un reprocess scopé. Réutilise
                    # l'état natif mémoïsé quand il existe (économie d'I/O fitz).
                    built = _build_toc_from_headings(
                        conn, doc_id, native_toc=self._native_toc_cache.get(doc_id))
                    if built:
                        logger.info("Sommaire dérivé des titres pour %s : %d entrées", doc_id, built)
                    # Curriculum AUTOMATIQUE (V5) : peuplement déterministe (zéro LLM)
                    # des tables curriculum depuis le TOC + chunks typés fraîchement
                    # finalisés. Dégradation gracieuse TOTALE : jamais un crash ici ne
                    # tue la file (le curriculum est OPTIONNEL). Flag RAGDOM_AUTO_CURRICULUM.
                    self._maybe_build_curriculum(db_name, manifest["id"], doc_id, conn)
                artifacts = conn.execute(
                    "SELECT COUNT(*) FROM scientific_artifacts WHERE document_id IN (%s)"
                    % ",".join("?" * len(docs)), docs).fetchone()[0] if docs else 0
                self._emit("job_complete", {"batch_id": batch_id, "pages_indexed": stats[0] or 0,
                                            "artifacts_extracted": artifacts, "done": True,
                                            "success": (stats[0] or 0) == stats[1]})
        finally:
            conn.close()

    def _maybe_build_curriculum(self, db_name: str, engine_id: str, doc_id: str, conn) -> None:
        """Génère AUTOMATIQUEMENT le curriculum au finalize (V5), derrière le flag
        RAGDOM_AUTO_CURRICULUM (défaut « true » — auto activé, désactivable).

        Dégradation gracieuse ABSOLUE : couche curriculum absente, base sans TOC,
        erreur SQL… rien ne remonte (le curriculum est OPTIONNEL). Réutilise la
        connexion du finalize (le builder ouvre/commit sa propre transaction)."""
        if os.environ.get("RAGDOM_AUTO_CURRICULUM", "true").strip().lower() == "false":
            return
        try:
            builder = engine_registry.load_layer(engine_id, "curriculum_builder")
        except FileNotFoundError:
            logger.warning("curriculum_builder absent du moteur %s — curriculum auto ignoré", engine_id)
            return
        except Exception:  # noqa: BLE001 — chargement moteur cassé : jamais fatal
            logger.exception("Chargement curriculum_builder en échec — curriculum auto ignoré")
            return
        try:
            counts = builder.build_curriculum(conn, doc_id)
            logger.info("Curriculum auto %s : %s", doc_id, counts)
        except Exception:  # noqa: BLE001 — une exception ne tue JAMAIS la file
            logger.exception("build_curriculum en échec (document %s) — file préservée", doc_id)

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

    @staticmethod
    def _load_layer_variant(engine_id: str, layer_module: str):
        """Phase 6 (D4-B, post-v1) : préfère la variante parallèle *_v2 d'une
        couche quand RAGDOM_INTRA_PAGE_WORKERS >= 2 ET que le moteur la fournit.
        Repli silencieux sur la couche séquentielle sinon (add-only)."""
        if config.RAGDOM_INTRA_PAGE_WORKERS >= 2:
            try:
                return engine_registry.load_layer(engine_id, layer_module + "_v2")
            except Exception:  # noqa: BLE001 — variante absente : séquentiel
                pass
        return engine_registry.load_layer(engine_id, layer_module)

    def _process_page(self, db_name: str, manifest: dict, job: dict) -> str:
        """Isolation par page : try/except indépendant, purge mémoire systématique."""
        self._current = dict(job, status="PROCESSING_CV")
        started = time.perf_counter()
        document = self._fetch_document(db_name, job["document_id"])
        ctx: Dict[str, object] = {
            "db_name": db_name,
            "engine": manifest,
            "job": job,
            "document": document,
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
                module = self._load_layer_variant(manifest["id"], layer_module)
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




_HEADING_RE = None  # compilé paresseusement (module importé au boot)


def _has_native_toc(source_path) -> bool:
    """Le PDF source porte-t-il des signets NATIFS ? (fitz get_toc non vide).

    source_path vient de la base ; si le fichier est absent (disque éphémère,
    /sources/ non monté) on considère le document NON-natif — jamais de crash.
    """
    if not source_path:
        return False
    try:
        import fitz
        pdf = fitz.open(source_path)
        try:
            return bool(pdf.get_toc())
        finally:
            pdf.close()
    except Exception:  # noqa: BLE001 — fichier absent / illisible : non-natif
        return False


def _build_toc_from_headings(conn, doc_id: str, native_toc: Optional[bool] = None) -> int:
    """Sommaire de REPLI (documents scannés sans signets natifs) : dérivé des
    titres Markdown (## niveau 1, ### niveau 2) produits par l'extraction.

    Ne touche JAMAIS un sommaire NATIF (le PDF porte des signets fitz) : dans ce
    cas la fonction est inerte. Pour un document NON-natif, le sommaire dérivé est
    intégralement reconstruit à chaque appel (DELETE puis rebuild) — idempotent
    et réparateur : après un reprocess chapter qui a laissé des trous dans le TOC
    dérivé, celui-ci est recalculé sans dérive. Relie les chunks à leur entrée.

    `native_toc` (V4.3) : état natif pré-calculé et mémoïsé par l'appelant. Évite
    de rouvrir le PDF via fitz à chaque passe incrémentale (structure construite au
    fil de l'ingestion, pas seulement au finalize). Si None, l'état est déterminé ici.
    """
    import re as _re
    import uuid as _uuid
    global _HEADING_RE
    if _HEADING_RE is None:
        _HEADING_RE = _re.compile(r"^(#{2,3})\s+(.{3,120})$", _re.M)
    if native_toc is None:
        source_path = conn.execute("SELECT source_path FROM documents WHERE id=?",
                                   (doc_id,)).fetchone()
        source_path = source_path[0] if source_path else None
        native_toc = _has_native_toc(source_path)
    if native_toc:
        return 0  # sommaire natif : intouchable
    # NON-natif : on repart du TOC dérivé à neuf (répare toute dérive/trou).
    # Les liens chunk→toc sont remis à NULL pour une reconstruction complète.
    conn.execute("DELETE FROM document_toc WHERE document_id=?", (doc_id,))
    conn.execute("UPDATE document_chunks SET toc_id=NULL WHERE document_id=?", (doc_id,))
    rows = conn.execute(
        "SELECT page_number, content_markdown FROM document_chunks"
        " WHERE document_id=? AND content_markdown LIKE '%#%'"
        " ORDER BY page_number, chunk_index", (doc_id,)).fetchall()
    entries, last_title = [], {1: None, 2: None}
    for page, md in rows:
        for match in _HEADING_RE.finditer(md or ""):
            level = 1 if len(match.group(1)) == 2 else 2
            title = " ".join(match.group(2).split()).strip("*# ")
            if not title or title == last_title.get(level):
                continue
            entries.append({"level": level, "title": title[:120], "page": page})
            last_title[level] = title
            if level == 1:
                last_title[2] = None
            break  # UNE entrée par page : granularité sommaire, pas index exhaustif
    if not entries:
        conn.commit()  # persiste la purge du TOC dérivé même sans nouveau titre
        return 0
    total = conn.execute("SELECT total_pages FROM documents WHERE id=?", (doc_id,)).fetchone()[0]
    parent_l1 = None
    for i, e in enumerate(entries):
        # page_end d'une entrée de niveau N = (page_start du prochain titre de
        # niveau <= N ET commençant STRICTEMENT plus loin) - 1, borné au document.
        # Le garde-fou « n["page"] > e["page"] » corrige le bug des plages « p27-210 »
        # (V4.3) : sans lui, deux titres de même niveau co-localisés sur une page
        # faisaient chuter le successeur dans la branche « else total » → héritage
        # aberrant de la dernière page du document.
        nxt = next((n["page"] for n in entries[i + 1:]
                    if n["level"] <= e["level"] and n["page"] > e["page"]), None)
        page_end = (nxt - 1) if nxt is not None else (total or e["page"])
        # Bornage défensif : jamais de plage inversée (page_end >= page_start), jamais
        # au-delà du document. Titres co-localisés sur une même page → page_end=page_start.
        e["id"] = str(_uuid.uuid4())
        e["page_end"] = max(e["page"], min(page_end, total or e["page"]))
        e["parent"] = parent_l1 if e["level"] == 2 else None
        if e["level"] == 1:
            parent_l1 = e["id"]
        conn.execute(
            "INSERT INTO document_toc (id, document_id, parent_id, level, title, page_start, page_end)"
            " VALUES (?,?,?,?,?,?,?)",
            (e["id"], doc_id, e["parent"], e["level"], e["title"], e["page"], e["page_end"]))
        conn.execute(
            "UPDATE document_chunks SET toc_id=? WHERE document_id=? AND toc_id IS NULL"
            " AND page_number BETWEEN ? AND ?", (e["id"], doc_id, e["page"], e["page_end"]))
    conn.commit()
    return len(entries)


def _rss_mb() -> int:
    try:
        import psutil
        return int(psutil.Process().memory_info().rss / (1024 * 1024))
    except Exception:  # noqa: BLE001 — la télémétrie ne doit jamais casser le pipeline
        return 0


# Instance unique du processus (importée par les routes en Phase 2).
orchestrator = PipelineOrchestrator()
