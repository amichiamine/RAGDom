# -*- coding: utf-8 -*-
"""RAGDom — Connexion dynamique multi-bases + résilience vectorielle.

Implémente : Skills.md §3.3/§3.4 (init_vector_support, sanitisation anti
path-traversal du paramètre ?db=), tech_specs §1 (application conditionnelle
schema_core.sql / schema_vec.sql), §6 (migrations), §7 (ragdom_config.sqlite).
Python 3.9+.
"""
import json
import logging
import os
import re
import sqlite3
import tempfile
from pathlib import Path
from typing import Optional, Tuple

import config

logger = logging.getLogger("ragdom.db")

_DB_DIR = Path(__file__).resolve().parent
SCHEMA_CORE = (_DB_DIR / "schema_core.sql").read_text(encoding="utf-8")
SCHEMA_VEC = (_DB_DIR / "schema_vec.sql").read_text(encoding="utf-8")

DB_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]+\.sqlite$")
VALIDATION_WORKING_DB_PREFIX = "validation_test_"


def is_validation_working_db(db_name: str) -> bool:
    """Return True only for the reserved, non-official validation copy namespace."""
    return bool(DB_NAME_RE.fullmatch(db_name or "") and db_name.startswith(VALIDATION_WORKING_DB_PREFIX))

# État vectoriel global du processus (exposé par /api/system/health)
_vector_state = {"engine": "unknown", "status": "unknown", "message": "", "force": config.RAGDOM_FORCE_SQLITE_VEC}


def sanitize_db_name(db_name: str) -> str:
    """Valide ?db= : regex stricte + realpath confiné à DATABASES_DIR (→ HTTP 400 sinon)."""
    if not DB_NAME_RE.fullmatch(db_name or ""):
        raise ValueError("Nom de base invalide : %r" % db_name)
    db_path = os.path.realpath(os.path.join(config.DATABASES_DIR, db_name))
    root = os.path.realpath(config.DATABASES_DIR) + os.sep
    if not db_path.startswith(root):
        raise ValueError("Chemin hors DATABASES_DIR interdit")
    return db_path


def _confined_backup_destination(destination: str) -> str:
    destination = os.path.realpath(destination)
    root = os.path.realpath(config.DATABASES_DIR)
    try:
        confined = os.path.commonpath((root, destination)) == root
    except ValueError:
        confined = False
    if not confined or destination == root:
        raise ValueError("Destination backup hors DATABASES_DIR interdite")
    return destination


def backup_connection(source: sqlite3.Connection, destination: str) -> str:
    """Back up an already-open source connection into a confined physical file."""
    destination = _confined_backup_destination(destination)
    target = sqlite3.connect(destination, check_same_thread=False)
    try:
        source.backup(target)
        target.commit()
    finally:
        target.close()
    return destination


def backup_database(db_name: str, destination: Optional[str] = None) -> str:
    """Create a transactionally consistent SQLite image using Connection.backup."""
    source_path = sanitize_db_name(db_name)
    if destination is None:
        fd, destination = tempfile.mkstemp(prefix=".ragdom-backup-", suffix=".sqlite",
                                           dir=config.DATABASES_DIR)
        os.close(fd)
    source = sqlite3.connect(source_path, check_same_thread=False)
    try:
        return backup_connection(source, destination)
    finally:
        source.close()


def init_vector_support(conn: sqlite3.Connection, force_strict: Optional[bool] = None) -> str:
    """Option B (résiliente) par défaut ; Option A (stricte) si forcée.

    Retourne "sqlite-vec" ou "fts5-fallback". En fallback sur une base créée
    en mode hybride, droppe les triggers vec pour éviter tout crash d'INSERT
    (tech_specs §1, Règle d'Application Conditionnelle, point b).
    """
    if force_strict is None:
        force_strict = _vector_state["force"]
    try:
        conn.enable_load_extension(True)
        import sqlite_vec  # noqa: WPS433 — import local volontaire (extension optionnelle)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        # Returning from a previous fallback must recreate every vector object,
        # including UPDATE synchronization, and backfill rows inserted meanwhile.
        try:
            conn.executescript(SCHEMA_VEC)
            source_count = conn.execute("SELECT COUNT(*) FROM document_chunks"
                                        " WHERE embedding_vector IS NOT NULL").fetchone()[0]
            vector_count = conn.execute("SELECT COUNT(*) FROM vec_chunks").fetchone()[0]
            if vector_count != source_count:
                # vec0 does not honor INSERT OR REPLACE like a regular SQLite table:
                # reinserting an existing primary key raises UNIQUE. Rebuild only
                # when counts diverge (typical return from FTS fallback).
                conn.execute("DELETE FROM vec_chunks")
                conn.execute("INSERT INTO vec_chunks (chunk_id, embedding)"
                             " SELECT id, embedding_vector FROM document_chunks"
                             " WHERE embedding_vector IS NOT NULL")
                vector_count = conn.execute("SELECT COUNT(*) FROM vec_chunks").fetchone()[0]
        except Exception as schema_exc:  # extension chargée, index/backfill non fiable
            # Ne jamais annoncer ready tant que le schéma ET le backfill n'ont pas
            # réussi. Les probes :memory: sans schéma restent utiles pour vérifier
            # le chargement de l'extension mais exposent explicitement cet état.
            _vector_state.update(engine="sqlite-vec", status="loaded_not_ready",
                                 message="sqlite-vec chargé mais schéma/backfill en échec: %s" % schema_exc)
            return "sqlite-vec"
        _vector_state.update(
            engine="sqlite-vec", status="ready",
            message="Moteur hybride opérationnel; vec_chunks=%d (schéma et backfill vérifiés)" % vector_count)
        return "sqlite-vec"
    except Exception as exc:  # noqa: BLE001 — tout échec de chargement => fallback contrôlé
        if force_strict:
            raise RuntimeError("Échec critique : sqlite-vec non chargeable alors que le mode strict est forcé. (%s)" % exc)
        logger.warning("[WARN] sqlite-vec non disponible (%s). Bascule en mode dégradé FTS5 BM25.", exc)
        for trig in ("trg_chunks_vec_sync", "trg_chunks_vec_delete", "trg_chunks_vec_update"):
            conn.execute("DROP TRIGGER IF EXISTS %s" % trig)
        _vector_state.update(engine="fts5-fallback", status="fallback_bm25_only",
                             message="Mode dégradé FTS5 BM25 actif (sqlite-vec non chargé). Recherche sémantique vectorielle désactivée.")
        return "fts5-fallback"


def vector_state() -> dict:
    return dict(_vector_state)


def set_force_strict(value: bool) -> None:
    _vector_state["force"] = bool(value)
    _set_app_setting("force_sqlite_vec", "true" if value else "false")


def test_vector_engine() -> Tuple[bool, str]:
    """Test à chaud du chargement de la DLL sqlite-vec (route /vector-engine/test)."""
    conn = sqlite3.connect(":memory:")
    try:
        engine = init_vector_support(conn, force_strict=False)
        ok = engine == "sqlite-vec"
        msg = ("Extension sqlite-vec chargée avec succès." if ok
               else "sqlite-vec indisponible — mode dégradé FTS5 BM25.")
        return ok, msg
    finally:
        conn.close()


def get_connection(db_name: str) -> sqlite3.Connection:
    """Connexion à la demande sur une base documentaire (pas de pool — Skills §3.4)."""
    db_path = sanitize_db_name(db_name)
    if not os.path.exists(db_path):
        raise FileNotFoundError("Base %s introuvable dans /databases/" % db_name)
    # mode=rw closes the TOCTOU window between exists() and connect(): a database
    # removed by reject/test teardown can never be silently recreated by a late poller.
    uri = Path(db_path).resolve().as_uri() + "?mode=rw"
    try:
        conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
    except sqlite3.OperationalError as exc:
        if not os.path.exists(db_path):
            raise FileNotFoundError("Base %s introuvable dans /databases/" % db_name) from exc
        raise
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode=WAL")
    init_vector_support(conn)
    apply_migrations(conn)
    return conn


def get_connection_or_http(db_name: str) -> sqlite3.Connection:
    """Ouvre une base documentaire en traduisant les erreurs d'ouverture en
    HTTPException (contrat API commun : 400 nom invalide / 404 base introuvable).

    Factorisation du garde-fou historique de routes_library._conn — utilisée par
    library, curriculum et pipeline pour qu'un ?db= invalide ne remonte jamais en
    500 (Skills §3.3/§3.4).
    """
    from fastapi import HTTPException  # import local : db/ reste utilisable hors HTTP
    try:
        return get_connection(db_name)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))


def require_official_mutation_target(db_name: str) -> None:
    """Deny generic mutations against the reserved validation sandbox namespace."""
    if is_validation_working_db(db_name):
        from fastapi import HTTPException  # import local : db/ reste utilisable hors HTTP
        raise HTTPException(403, "Copie validation_test_ mutable uniquement via /api/validation")


def get_mutable_connection_or_http(db_name: str) -> sqlite3.Connection:
    """Open an official DB for a generic mutating route, fail-closed for sandboxes."""
    require_official_mutation_target(db_name)
    return get_connection_or_http(db_name)


def create_database(db_name: str) -> sqlite3.Connection:
    """Crée (ou ouvre) une base documentaire et applique le DDL conditionnel."""
    db_path = sanitize_db_name(db_name)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA_CORE)
    engine = init_vector_support(conn)
    if engine == "sqlite-vec":
        conn.executescript(SCHEMA_VEC)
    conn.commit()
    apply_migrations(conn)
    return conn


def _sql_statements(script: str):
    """Parse SQLite statements without breaking trigger bodies on semicolons."""
    buffer = []
    for line in script.splitlines(True):
        buffer.append(line)
        candidate = "".join(buffer).strip()
        if candidate and sqlite3.complete_statement(candidate):
            yield candidate
            buffer = []
    if "".join(buffer).strip():
        raise sqlite3.OperationalError("Migration SQL incomplète")


def _prepare_legacy_validation_schema(conn: sqlite3.Connection) -> None:
    """Repair tables absent from partial historical/public database images."""
    conn.execute("CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE IF NOT EXISTS processing_benchmarks (id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE IF NOT EXISTS curriculum_terms (id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE IF NOT EXISTS curriculum_programs (id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE IF NOT EXISTS content_links (id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE IF NOT EXISTS scientific_artifacts (id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE IF NOT EXISTS assessments (id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE IF NOT EXISTS pipeline_jobs"
                 " (id TEXT PRIMARY KEY, document_id TEXT, page_number INTEGER, status TEXT)")
    conn.execute("CREATE TABLE IF NOT EXISTS ingestion_batches (id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE IF NOT EXISTS document_toc (id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE IF NOT EXISTS document_chunks (id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE IF NOT EXISTS page_scans (id TEXT PRIMARY KEY)")
    # Published images have existed with partially-created historical tables. Add
    # the columns consumed by current routes before numbered migrations add their
    # own V5/V6 ownership columns.
    repairs = {
        "documents": (("title", "TEXT"), ("filename", "TEXT"), ("source_path", "TEXT"),
                      ("total_pages", "INTEGER"), ("doc_type", "TEXT")),
        "pipeline_jobs": (("document_id", "TEXT"), ("page_number", "INTEGER"), ("status", "TEXT"),
                          ("batch_id", "TEXT"), ("retry_count", "INTEGER DEFAULT 0"),
                          ("error_log", "TEXT"), ("updated_at", "DATETIME")),
        "ingestion_batches": (("source_path", "TEXT"), ("target_db", "TEXT"), ("mode", "TEXT"),
                              ("page_start", "INTEGER"), ("page_end", "INTEGER"), ("status", "TEXT"),
                              ("pages_total", "INTEGER"), ("pages_done", "INTEGER DEFAULT 0"),
                              ("updated_at", "DATETIME")),
        "document_toc": (("document_id", "TEXT"), ("level", "INTEGER"), ("title", "TEXT"),
                         ("page_start", "INTEGER"), ("page_end", "INTEGER")),
        "document_chunks": (("document_id", "TEXT"), ("toc_id", "TEXT"), ("page_number", "INTEGER"),
                            ("chunk_index", "INTEGER"), ("section_title", "TEXT"),
                            ("content_markdown", "TEXT"), ("pedagogical_type", "TEXT"),
                            ("has_solution", "INTEGER DEFAULT 0"), ("linked_solution_chunk_id", "TEXT"),
                            ("is_human_edited", "INTEGER DEFAULT 0"), ("pedagogical_index", "INTEGER"),
                            ("updated_at", "DATETIME"), ("embedding_vector", "BLOB"),
                            ("token_count", "INTEGER"), ("created_at", "DATETIME")),
        "scientific_artifacts": (("document_id", "TEXT"), ("chunk_id", "TEXT"),
                                 ("page_number", "INTEGER"), ("domain", "TEXT"),
                                 ("artifact_type", "TEXT"), ("raw_data", "TEXT"),
                                 ("raw_binary", "BLOB"), ("render_config_json", "TEXT"),
                                 ("caption", "TEXT"), ("searchable_text", "TEXT"),
                                 ("bounding_box_json", "TEXT"), ("is_human_edited", "INTEGER DEFAULT 0"),
                                 ("updated_at", "DATETIME"), ("created_at", "DATETIME")),
        "processing_benchmarks": (("document_id", "TEXT"), ("page_number", "INTEGER"),
                                  ("engine_used", "TEXT"), ("vlm_provider_used", "TEXT"),
                                  ("fallback_triggered", "INTEGER DEFAULT 0"),
                                  ("linter_errors_json", "TEXT"), ("execution_time_ms", "INTEGER"),
                                  ("ram_peak_mb", "REAL"), ("confidence_score", "REAL"),
                                  ("blur_score", "REAL"), ("deskew_angle", "REAL"),
                                  ("created_at", "DATETIME")),
        "page_scans": (("document_id", "TEXT"), ("page_number", "INTEGER"), ("width_px", "INTEGER"),
                       ("height_px", "INTEGER"), ("dpi", "INTEGER"), ("image_webp", "BLOB"),
                       ("thumb_webp", "BLOB"), ("created_at", "DATETIME")),
        "curriculum_terms": (("term_index", "INTEGER"), ("label", "TEXT"), ("metadata_json", "TEXT")),
        "curriculum_programs": (("term_id", "TEXT"), ("seq_index", "INTEGER"), ("title", "TEXT"),
                                ("source", "TEXT"), ("competencies_json", "TEXT")),
        "assessments": (("term_id", "TEXT"), ("kind", "TEXT"), ("title", "TEXT"),
                        ("subject_chunk_id", "TEXT"), ("correction_chunk_id", "TEXT"),
                        ("scale_json", "TEXT")),
        "content_links": (("link_type", "TEXT"), ("from_id", "TEXT"), ("to_id", "TEXT"),
                          ("page_number", "INTEGER"), ("metadata_json", "TEXT")),
    }
    for table, columns in repairs.items():
        existing = {row[1] for row in conn.execute("PRAGMA table_info(%s)" % table)}
        for name, declaration in columns:
            if name not in existing:
                conn.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, name, declaration))
    conn.execute("DELETE FROM pipeline_jobs WHERE rowid NOT IN (SELECT MIN(rowid) FROM pipeline_jobs"
                 " WHERE status IN ('QUEUED','PROCESSING_CV','SEGMENTING','EXTRACTING','LINTING',"
                 " 'VLM_RECOVERY','INDEXED') GROUP BY document_id,page_number)"
                 " AND status IN ('QUEUED','PROCESSING_CV','SEGMENTING','EXTRACTING','LINTING',"
                 " 'VLM_RECOVERY','INDEXED')")


def _repair_legacy_curriculum_scope(conn: sqlite3.Connection) -> int:
    """Backfill legacy curriculum ownership without assigning global terms blindly."""
    documents = [row[0] for row in conn.execute("SELECT id FROM documents ORDER BY id").fetchall()]
    if len(documents) == 1:
        for table in ("curriculum_terms", "curriculum_programs", "assessments", "content_links"):
            columns = {row[1] for row in conn.execute("PRAGMA table_info(%s)" % table)}
            if "document_id" in columns:
                conn.execute("UPDATE %s SET document_id=? WHERE document_id IS NULL" % table,
                             (documents[0],))
        conn.commit()
        return 0

    # Auto-generated programs carry their originating toc_id in competencies_json.
    for program_id, raw_metadata in conn.execute(
            "SELECT id, competencies_json FROM curriculum_programs WHERE document_id IS NULL").fetchall():
        try:
            toc_id = (json.loads(raw_metadata or "{}") or {}).get("toc_id")
        except (TypeError, ValueError):
            toc_id = None
        owner = conn.execute("SELECT document_id FROM document_toc WHERE id=?", (toc_id,)).fetchone() if toc_id else None
        if owner:
            conn.execute("UPDATE curriculum_programs SET document_id=? WHERE id=?", (owner[0], program_id))

    # Assessments are owned by the document of either referenced chunk.
    for assessment_id, subject_id, correction_id in conn.execute(
            "SELECT id, subject_chunk_id, correction_chunk_id FROM assessments WHERE document_id IS NULL").fetchall():
        owners = {row[0] for chunk_id in (subject_id, correction_id) if chunk_id
                  for row in conn.execute("SELECT document_id FROM document_chunks WHERE id=?", (chunk_id,)).fetchall()}
        if len(owners) == 1:
            conn.execute("UPDATE assessments SET document_id=? WHERE id=?", (owners.pop(), assessment_id))

    def entity_owners(entity_id):
        owners = set()
        for table in ("curriculum_programs", "assessments", "document_chunks", "document_toc"):
            columns = {row[1] for row in conn.execute("PRAGMA table_info(%s)" % table)}
            if "document_id" in columns:
                owners.update(row[0] for row in conn.execute(
                    "SELECT document_id FROM %s WHERE id=? AND document_id IS NOT NULL" % table,
                    (entity_id,)).fetchall())
        return owners

    # Links inherit ownership from whichever endpoint is document-scoped.
    for link_id, from_id, to_id in conn.execute(
            "SELECT id, from_id, to_id FROM content_links WHERE document_id IS NULL").fetchall():
        owners = entity_owners(from_id) | entity_owners(to_id)
        if len(owners) == 1:
            conn.execute("UPDATE content_links SET document_id=? WHERE id=?", (owners.pop(), link_id))

    # A term shared by programs from several documents is intentionally global.
    for term_id, in conn.execute("SELECT id FROM curriculum_terms WHERE document_id IS NULL").fetchall():
        owners = {row[0] for row in conn.execute(
            "SELECT DISTINCT document_id FROM curriculum_programs"
            " WHERE term_id=? AND document_id IS NOT NULL", (term_id,)).fetchall()}
        if len(owners) == 1:
            conn.execute("UPDATE curriculum_terms SET document_id=? WHERE id=?", (owners.pop(), term_id))

    conn.commit()
    ambiguous = 0
    # NULL terms may be deliberate cross-document containers; actionable ambiguity
    # is limited to rows that must own a document to be processed or promoted.
    for table in ("curriculum_programs", "assessments", "content_links"):
        ambiguous += conn.execute("SELECT COUNT(*) FROM %s WHERE document_id IS NULL" % table).fetchone()[0]
    return ambiguous


def _hardened_schema_present(conn: sqlite3.Connection) -> bool:
    required = {
        "processing_benchmarks": {"validation_run_id", "vlm_provider_used", "fallback_triggered",
                                  "linter_errors_json", "ram_peak_mb", "confidence_score", "blur_score",
                                  "deskew_angle", "created_at"},
        "page_scans": {"created_at"},
        "curriculum_terms": {"document_id"},
        "curriculum_programs": {"document_id"},
        "content_links": {"document_id"},
        "scientific_artifacts": {"validation_run_id"},
        "assessments": {"document_id"},
        "validation_runs": {"status", "scope_json", "working_db_filename", "operation", "batch_id",
                            "batch_ids_json", "execution_status", "progress_current", "progress_total",
                            "error_log", "started_at", "completed_at"},
        "validation_run_pages": {"document_id", "baseline_json", "working_json", "baseline_hash"},
        "validation_events": {"document_id", "event_type", "payload_json"},
        "validation_snapshots": {"run_id", "snapshot_type", "payload_json"},
        "embedding_profiles": {"model_name", "dimensions"},
        "document_embedding_profiles": {"document_id", "profile_id"},
        "pipeline_jobs": {"document_id", "page_number", "status"},
    }
    for table, columns in required.items():
        actual = {row[1] for row in conn.execute("PRAGMA table_info(%s)" % table)}
        if not columns.issubset(actual):
            return False
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='index'"
                        " AND name='uq_jobs_active_page'").fetchone() is not None


def _verify_hardened_schema(conn: sqlite3.Connection) -> None:
    required = {
        "processing_benchmarks": {"validation_run_id", "vlm_provider_used", "fallback_triggered",
                                  "linter_errors_json", "ram_peak_mb", "confidence_score", "blur_score",
                                  "deskew_angle", "created_at"},
        "page_scans": {"created_at"},
        "curriculum_terms": {"document_id"},
        "curriculum_programs": {"document_id"},
        "content_links": {"document_id"},
        "scientific_artifacts": {"validation_run_id"},
        "assessments": {"document_id"},
        "validation_runs": {"status", "scope_json", "working_db_filename", "operation", "batch_id",
                            "batch_ids_json", "execution_status", "progress_current", "progress_total",
                            "error_log", "started_at", "completed_at"},
        "validation_run_pages": {"document_id", "baseline_json", "working_json", "baseline_hash"},
        "validation_events": {"document_id", "event_type", "payload_json"},
        "validation_snapshots": {"run_id", "snapshot_type", "payload_json"},
        "embedding_profiles": {"model_name", "dimensions"},
        "document_embedding_profiles": {"document_id", "profile_id"},
        "pipeline_jobs": {"document_id", "page_number", "status"},
    }
    for table, columns in required.items():
        actual = {row[1] for row in conn.execute("PRAGMA table_info(%s)" % table)}
        missing = columns - actual
        if missing:
            raise sqlite3.OperationalError("Post-migration invalide: %s manque %s" %
                                           (table, ",".join(sorted(missing))))
    index = conn.execute("SELECT 1 FROM sqlite_master WHERE type='index'"
                         " AND name='uq_jobs_active_page'").fetchone()
    if index is None:
        raise sqlite3.OperationalError("Post-migration invalide: index actif absent")


def apply_migrations(conn: sqlite3.Connection) -> int:
    """Applique les migrations numérotées manquantes.

    Les migrations restent additives et reprenables après une interruption : les
    ``ALTER TABLE ... ADD COLUMN`` déjà appliqués sont ignorés explicitement, puis
    la version n'est inscrite qu'après succès de tous les autres statements.
    """
    mig_dir = _DB_DIR / "migrations"
    conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY,"
                 " applied_at DATETIME DEFAULT CURRENT_TIMESTAMP, description TEXT)")
    conn.commit()
    repair_hardened = not _hardened_schema_present(conn)
    if repair_hardened:
        _prepare_legacy_validation_schema(conn)
        conn.commit()
    applied = {r[0] for r in conn.execute("SELECT version FROM schema_version")}
    count = 0
    for path in sorted(mig_dir.glob("migration_*.sql")):
        match = re.match(r"migration_(\d+)", path.name)
        if not match:
            continue
        num = int(match.group(1))
        # Une version déclarée n'est pas une preuve que son DDL est complet : des
        # images historiques ont été interrompues après l'écriture schema_version.
        # Rejouer V5+ est sûr (CREATE IF NOT EXISTS + ALTER duplicate toléré) et
        # répare notamment validation_events et les colonnes d'exécution physique.
        if num in applied and not (repair_hardened and num >= 5):
            continue
        script = "\n".join(line for line in path.read_text(encoding="utf-8").splitlines()
                           if not line.lstrip().startswith("--"))
        statements = list(_sql_statements(script))
        try:
            conn.execute("BEGIN")
            for statement in statements:
                try:
                    conn.execute(statement)
                except sqlite3.OperationalError as exc:
                    if statement.lstrip().upper().startswith("ALTER TABLE") and \
                            "duplicate column name" in str(exc).lower():
                        continue
                    raise
            conn.execute("INSERT OR IGNORE INTO schema_version (version, description) VALUES (?, ?)",
                         (num, path.stem))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        count += 1
    _verify_hardened_schema(conn)
    ambiguous = _repair_legacy_curriculum_scope(conn)
    if ambiguous:
        logger.warning("Curriculum legacy ambigu: %d ligne(s) document_id NULL dans une base multi-document",
                       ambiguous)
    return count


# ── Base de configuration système (tech_specs §7 — séparée des documentaires) ──
_CONFIG_DDL = """
CREATE TABLE IF NOT EXISTS llm_keys (
    id              TEXT PRIMARY KEY,
    provider        TEXT NOT NULL,
    api_key         TEXT NOT NULL,
    active_model    TEXT,               -- modèle PROPRE À CETTE CLÉ (quotas par modèle ;
                                        -- la même clé peut être enregistrée N fois avec N modèles)
    status          TEXT DEFAULT 'active' CHECK(status IN ('active', 'blocked', 'disabled')),
    blocked_until   DATETIME,
    last_error_code INTEGER,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_llm_keys_provider ON llm_keys(provider);
CREATE INDEX IF NOT EXISTS idx_llm_keys_status   ON llm_keys(status);
CREATE TABLE IF NOT EXISTS llm_settings (
    provider      TEXT PRIMARY KEY,
    active_model  TEXT,
    is_enabled    INTEGER DEFAULT 1,
    priority      INTEGER DEFAULT 99,
    base_url      TEXT,                -- V3.5+ : endpoint personnalisé (LM Studio, proxy, webhook Make)
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- ZÉRO modèle codé en dur : active_model NULL → auto-détection live après saisie de la clé
INSERT OR IGNORE INTO llm_settings (provider, active_model, is_enabled, priority) VALUES
    ('gemini',    NULL, 0, 1),
    ('groq',      NULL, 0, 2),
    ('openai',    NULL, 0, 3),
    ('anthropic', NULL, 0, 4),
    ('lmstudio',  NULL, 0, 5),
    ('make',      NULL, 0, 6),
    ('ollama',    NULL, 0, 7);
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
INSERT OR IGNORE INTO app_settings (key, value) VALUES
    ('force_sqlite_vec',       'false'),
    ('vec_distance_threshold', '0.45'),
    ('bm25_score_threshold',   '-0.3');
"""


def get_config_db() -> sqlite3.Connection:
    conn = sqlite3.connect(config.CONFIG_DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode=WAL")
    # Initialisation paresseuse : les appels TestClient sans contexte lifespan et
    # les workers CLI disposent quand même toujours du schéma de configuration.
    conn.executescript(_CONFIG_DDL)
    conn.commit()
    return conn


def init_config_db() -> None:
    conn = get_config_db()
    conn.executescript(_CONFIG_DDL)
    # Migration douce (bases de config antérieures) : colonne base_url, PUIS défauts.
    cols = [r[1] for r in conn.execute("PRAGMA table_info(llm_settings)")]
    if "base_url" not in cols:
        conn.execute("ALTER TABLE llm_settings ADD COLUMN base_url TEXT")
    key_cols = [r[1] for r in conn.execute("PRAGMA table_info(llm_keys)")]
    if "active_model" not in key_cols:
        conn.execute("ALTER TABLE llm_keys ADD COLUMN active_model TEXT")
    conn.execute("UPDATE llm_settings SET base_url='http://localhost:1234/v1'"
                 " WHERE provider='lmstudio' AND base_url IS NULL")
    # Purge des anciens modèles seedés en dur (obsolètes chez les providers → 404 au test)
    conn.execute("UPDATE llm_settings SET active_model=NULL WHERE active_model IN"
                 " ('gemini-1.5-flash','llama-3.1-70b-versatile','gpt-4o-mini',"
                 "  'claude-3-haiku-20240307','local-model','llama3','webhook')")
    conn.commit()
    _seed_llm_keys_from_env(conn)
    row = conn.execute("SELECT value FROM app_settings WHERE key='force_sqlite_vec'").fetchone()
    if row is not None:
        _vector_state["force"] = (row[0] == "true") or config.RAGDOM_FORCE_SQLITE_VEC
    conn.close()


def _seed_llm_keys_from_env(conn) -> None:
    """Seed IDEMPOTENT des clés LLM depuis RAGDOM_SEED_LLM_KEYS (déploiements web).

    Format : entrées séparées par des virgules ou retours ligne, chacune
    `provider:clé` ou `provider:clé:modèle`. À chaque démarrage, toute entrée
    absente de llm_keys (même provider + même clé + même modèle) est insérée et
    le provider est activé — indispensable sur disque ÉPHÉMÈRE (Render) où la
    base de config repart de zéro. Jamais de secret dans le dépôt.
    """
    import os as _os
    import uuid as _uuid
    raw = _os.environ.get("RAGDOM_SEED_LLM_KEYS", "").strip()
    if not raw:
        return
    for entry in [e.strip() for e in raw.replace("\n", ",").split(",") if e.strip()]:
        parts = entry.split(":", 2)
        if len(parts) < 2:
            continue
        provider, api_key = parts[0].strip().lower(), parts[1].strip()
        model = parts[2].strip() if len(parts) > 2 and parts[2].strip() else None
        exists = conn.execute(
            "SELECT 1 FROM llm_keys WHERE provider=? AND api_key=?"
            " AND COALESCE(active_model,'')=COALESCE(?,'')",
            (provider, api_key, model)).fetchone()
        if not exists:
            conn.execute("INSERT INTO llm_keys (id, provider, api_key, active_model)"
                         " VALUES (?,?,?,?)", (str(_uuid.uuid4()), provider, api_key, model))
        conn.execute("UPDATE llm_settings SET is_enabled=1 WHERE provider=?", (provider,))
    conn.commit()

def _set_app_setting(key: str, value: str) -> None:
    conn = get_config_db()
    conn.execute("INSERT INTO app_settings (key, value) VALUES (?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
    conn.commit()
    conn.close()


def get_app_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    conn = get_config_db()
    row = conn.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    conn.close()
    return row[0] if row else default
