-- ============================================================
-- TABLE 1 : Pipeline State Machine (Suivi des jobs)
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    status      TEXT CHECK(status IN (
                    'QUEUED',
                    'PROCESSING_CV',
                    'SEGMENTING',
                    'EXTRACTING',
                    'LINTING',
                    'VLM_RECOVERY',
                    'INDEXED',
                    'READY',
                    'QUARANTINE',
                    'INVALID_SOURCE'
                )) DEFAULT 'QUEUED',
    batch_id    TEXT REFERENCES ingestion_batches(id),   -- V3.1
    retry_count INTEGER DEFAULT 0,
    error_log   TEXT,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_jobs_status      ON pipeline_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_document_id ON pipeline_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_jobs_batch_id    ON pipeline_jobs(batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_active_page
ON pipeline_jobs(document_id, page_number)
WHERE status IN ('QUEUED','PROCESSING_CV','SEGMENTING','EXTRACTING','LINTING','VLM_RECOVERY','INDEXED');

-- ============================================================
-- TABLE 1bis : Batches d'Ingestion (V3.1 — granularité job/batch)
-- ============================================================
CREATE TABLE IF NOT EXISTS ingestion_batches (
    id           TEXT PRIMARY KEY,
    source_path  TEXT NOT NULL,
    target_db    TEXT,
    mode         TEXT CHECK(mode IN ('document','chapter','page_range','folder')) NOT NULL,
    page_start   INTEGER,
    page_end     INTEGER,
    status       TEXT CHECK(status IN ('QUEUED','RUNNING','COMPLETED','STOPPED','FAILED')) DEFAULT 'QUEUED',
    pages_total  INTEGER,
    pages_done   INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TABLE 2 : Documents Sources
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
    id               TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    filename         TEXT NOT NULL,
    source_path      TEXT NOT NULL,   -- Chemin ABSOLU du PDF source ex: /chemin/absolu/sources/Maths/1AM/manuel.pdf
    total_pages      INTEGER NOT NULL,
    file_size_bytes  INTEGER,
    doc_type         TEXT DEFAULT 'unknown',
    doc_source       TEXT DEFAULT 'unknown',  -- Chemin RELATIF depuis /sources/ ex: "Maths/1AM"
    academic_level   TEXT,
    domain_tags_json TEXT,   -- Tableau JSON auto-généré depuis l'arborescence /sources/ ex: ["Maths", "1AM"]
    metadata_json    TEXT,   -- Métadonnées complémentaires libres (auteur, ISBN, année...)
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type   ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_doc_source ON documents(doc_source);

-- ============================================================
-- TABLE 3 : Index / TOC Reconstruit
-- ============================================================
CREATE TABLE IF NOT EXISTS document_toc (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    parent_id   TEXT,
    level       INTEGER NOT NULL,   -- 1=Chapitre, 2=Section, 3=Sous-section
    title       TEXT NOT NULL,
    page_start  INTEGER NOT NULL,
    page_end    INTEGER,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id)   REFERENCES document_toc(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_toc_document_id ON document_toc(document_id);
CREATE INDEX IF NOT EXISTS idx_toc_parent_id   ON document_toc(parent_id);

-- ============================================================
-- TABLE 4 : Chunks Texte (Typage élastique)
-- ============================================================
CREATE TABLE IF NOT EXISTS document_chunks (
    id                       TEXT PRIMARY KEY,
    document_id              TEXT NOT NULL,
    toc_id                   TEXT,
    page_number              INTEGER NOT NULL,
    chunk_index              INTEGER NOT NULL,
    section_title            TEXT,
    content_markdown         TEXT NOT NULL,
    pedagogical_type         TEXT CHECK(pedagogical_type IN (
                                 'course_theory',
                                 'proof_demonstration',
                                 'exercise_unsolved',
                                 'exercise_solved',
                                 'solution_only',
                                 'evaluation_exam',
                                 'practical_work',
                                 'general_content'
                             )) DEFAULT NULL,
    has_solution             INTEGER DEFAULT 0,  -- 0 = non, 1 = oui
    linked_solution_chunk_id TEXT,               -- FK auto-référentielle
    is_human_edited          INTEGER DEFAULT 0,  -- V3.2 : corrigé manuellement — protégé des purges (preserve_human_edits) et des ré-ingestions
    pedagogical_index        INTEGER,            -- V3.5 : numéro extrait (Exercice N°, leçon N…) — affiché en badge par la Vue 2, utilisé par SolutionLinker
    updated_at               DATETIME,           -- V3.5 : dernière correction humaine (badge « corrigé le… »)
    embedding_vector         BLOB,               -- Float32Array pour sqlite-vec (dim=384)
    token_count              INTEGER,
    created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id)              REFERENCES documents(id)       ON DELETE CASCADE,
    FOREIGN KEY (toc_id)                   REFERENCES document_toc(id)    ON DELETE SET NULL,
    FOREIGN KEY (linked_solution_chunk_id) REFERENCES document_chunks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id     ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_page_number     ON document_chunks(page_number);
CREATE INDEX IF NOT EXISTS idx_chunks_pedagogical     ON document_chunks(pedagogical_type);
CREATE INDEX IF NOT EXISTS idx_chunks_has_solution    ON document_chunks(has_solution);

-- ============================================================
-- TABLE 5 : Artefacts Multimodaux (25 Familles)
-- ============================================================
CREATE TABLE IF NOT EXISTS scientific_artifacts (
    id                 TEXT PRIMARY KEY,
    document_id        TEXT NOT NULL,
    chunk_id           TEXT,
    page_number        INTEGER NOT NULL,
    domain             TEXT NOT NULL,         -- ex: "math", "chemistry", "biology"
    artifact_type      TEXT NOT NULL,         -- ex: "latex_formula", "smiles_chem"
    raw_data           TEXT,                  -- Payload textuel (LaTeX, SVG, SMILES...)
    raw_binary         BLOB,                  -- Payload binaire (WebP, glTF...)
    render_config_json TEXT,                  -- Config du renderer frontend ex: {"renderer":"katex"}
    caption            TEXT,                  -- Légende/description textuelle
    searchable_text    TEXT NOT NULL,         -- Texte indexable FTS5 (caption + raw_data simplifié)
    bounding_box_json  TEXT,                  -- {"x0":120,"y0":340,"x1":280,"y1":370} coordonnées 300 DPI
    is_human_edited    INTEGER DEFAULT 0,     -- V3.2 : corrigé/importé manuellement — protégé des purges et ré-ingestions
    validation_run_id  TEXT REFERENCES validation_runs(id) ON DELETE SET NULL,
    updated_at         DATETIME,              -- V3.5 : dernière correction/import manuel
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(id)        ON DELETE CASCADE,
    FOREIGN KEY (chunk_id)    REFERENCES document_chunks(id)  ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_document_id  ON scientific_artifacts(document_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_domain       ON scientific_artifacts(domain);
CREATE INDEX IF NOT EXISTS idx_artifacts_type         ON scientific_artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifacts_chunk_id     ON scientific_artifacts(chunk_id);

-- ============================================================
-- TABLE 5bis : Scans de Pages (V3.5 — Base Autonome)
-- LA table qui rend le .sqlite réellement portable : l'image WebP
-- restaurée par la Couche 0 est persistée ici par la Couche 7
-- (le checkpoint /pipeline-set/ est ensuite purgé). Sans elle,
-- l'UI devrait relire /sources/ ou /pipeline-set/ — interdit.
-- ============================================================
CREATE TABLE IF NOT EXISTS page_scans (
    id           TEXT PRIMARY KEY,
    document_id  TEXT NOT NULL,
    page_number  INTEGER NOT NULL,
    width_px     INTEGER NOT NULL,       -- dimensions du scan 300 DPI
    height_px    INTEGER NOT NULL,       -- (base de la conversion BBox → CSS %)
    dpi          INTEGER DEFAULT 300,
    image_webp   BLOB NOT NULL,          -- scan pleine résolution (rendu, overlay diff, modale HD)
    thumb_webp   BLOB,                   -- vignette ~256px (galeries virtualisées, previews)
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (document_id, page_number),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scans_document_id ON page_scans(document_id);
CREATE INDEX IF NOT EXISTS idx_scans_page        ON page_scans(document_id, page_number);

-- ============================================================
-- TABLE 6 : Métrologie & Télémétrie
-- ============================================================
CREATE TABLE IF NOT EXISTS processing_benchmarks (
    id                  TEXT PRIMARY KEY,
    document_id         TEXT NOT NULL,
    page_number         INTEGER NOT NULL,
    engine_used         TEXT NOT NULL,          -- ex: "RapidOCR", "rapid-latex-ocr", "PyMuPDF4LLM"
    vlm_provider_used   TEXT,                   -- ex: "gemini-1.5-flash", "ollama/llama3", null
    fallback_triggered  INTEGER DEFAULT 0,      -- 0=non, 1=oui (fallback vers provider suivant)
    linter_errors_json  TEXT,                   -- Tableau JSON des erreurs de linter détectées
    execution_time_ms   INTEGER NOT NULL,
    ram_peak_mb         REAL,
    confidence_score    REAL,                   -- Score de confiance global (0.0 à 1.0)
    blur_score          REAL,                   -- Variance du Laplacien (qualité image)
    deskew_angle        REAL,                   -- Angle de correction appliqué en degrés
    validation_run_id   TEXT REFERENCES validation_runs(id) ON DELETE SET NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bench_document_id ON processing_benchmarks(document_id);
CREATE INDEX IF NOT EXISTS idx_bench_page_number ON processing_benchmarks(page_number);

-- ============================================================
-- TABLE 7 : Index de Recherche Hybride (FTS5)
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    chunk_id        UNINDEXED,
    artifact_id     UNINDEXED,
    document_id     UNINDEXED,
    page_number     UNINDEXED,
    title,
    section_title,
    pedagogical_type,
    search_content,
    tokenize = 'unicode61 remove_diacritics 2'  -- V3.1 : porter (anglais) retiré ; diacritiques AR/latin normalisés
);

-- ============================================================
-- TRIGGER 1 : Synchronisation FTS5 à l'insertion de chunks
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_chunks_fts_sync
AFTER INSERT ON document_chunks
BEGIN
    INSERT INTO search_index (
        chunk_id, artifact_id, document_id, page_number,
        title, section_title, pedagogical_type, search_content
    ) VALUES (
        new.id,
        NULL,
        new.document_id,
        new.page_number,
        (SELECT title FROM documents WHERE id = new.document_id),
        new.section_title,
        COALESCE(new.pedagogical_type, 'none'),
        new.content_markdown
    );
END;

-- ============================================================
-- TRIGGER 2 : Synchronisation FTS5 à l'insertion d'artefacts
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_artifacts_fts_sync
AFTER INSERT ON scientific_artifacts
BEGIN
    INSERT INTO search_index (
        chunk_id, artifact_id, document_id, page_number,
        title, section_title, pedagogical_type, search_content
    ) VALUES (
        new.chunk_id,
        new.id,
        new.document_id,
        new.page_number,
        (SELECT title FROM documents WHERE id = new.document_id),
        new.caption,
        COALESCE(
            (SELECT pedagogical_type FROM document_chunks WHERE id = new.chunk_id),
            'none'
        ),
        new.searchable_text || ' ' || COALESCE(new.raw_data, '')
    );
END;

-- ============================================================
-- TRIGGERS 3-5 : Cohérence FTS5 — DELETE / UPDATE (V3.1)
-- (corrige les entrées fantômes après /api/pipeline/reset)
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_chunks_fts_delete
AFTER DELETE ON document_chunks
BEGIN
    DELETE FROM search_index WHERE chunk_id = old.id AND artifact_id IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS trg_artifacts_fts_delete
AFTER DELETE ON scientific_artifacts
BEGIN
    DELETE FROM search_index WHERE artifact_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_chunks_fts_update
AFTER UPDATE OF content_markdown, section_title, pedagogical_type ON document_chunks
BEGIN
    DELETE FROM search_index WHERE chunk_id = old.id AND artifact_id IS NULL;
    INSERT INTO search_index (
        chunk_id, artifact_id, document_id, page_number,
        title, section_title, pedagogical_type, search_content
    ) VALUES (
        new.id, NULL, new.document_id, new.page_number,
        (SELECT title FROM documents WHERE id = new.document_id),
        new.section_title, COALESCE(new.pedagogical_type, 'none'), new.content_markdown
    );
END;

-- ============================================================
-- ⚠️ RÈGLE D'APPLICATION CONDITIONNELLE (V3.1 — D.O.D Fallback Vectoriel)
-- Frontière schema_core.sql / schema_vec.sql :
--   • schema_core.sql = TOUTES les tables et triggers de ce DDL,
--     SAUF la Table 8 (vec_chunks) et les triggers trg_chunks_vec_*.
--     Appliqué TOUJOURS, quel que soit l'état de sqlite-vec.
--   • schema_vec.sql  = Table 8 (vec_chunks) + trg_chunks_vec_sync
--     + trg_chunks_vec_delete. Appliqué UNIQUEMENT si
--     init_vector_support() retourne "sqlite-vec".
-- En mode fallback :
--   (a) vec_chunks et ses triggers ne sont PAS créés ;
--   (b) une base créée en mode hybride puis rouverte SANS l'extension
--       déclenche à la connexion : DROP TRIGGER IF EXISTS
--       trg_chunks_vec_sync; DROP TRIGGER IF EXISTS trg_chunks_vec_delete;
--       + WARN consigné. Les embeddings BLOB restent dans document_chunks ;
--   (c) le retour au mode hybride recrée table + triggers et re-remplit
--       vec_chunks depuis embedding_vector en une passe.
-- ============================================================

-- ============================================================
-- TABLES CURRICULUM (OPTIONNELLES — V3.1, D1-B)
-- Peuvent rester vides : une base non pédagogique est 100% valide.
-- Vides => la Vue 2 bascule en Mode Repli Générique.
-- ============================================================
CREATE TABLE IF NOT EXISTS curriculum_terms (
    id            TEXT PRIMARY KEY,
    document_id   TEXT REFERENCES documents(id) ON DELETE CASCADE,
    term_index    INTEGER NOT NULL,        -- 1, 2, 3
    label         TEXT NOT NULL,           -- ex: 'الفصل الأول'
    metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS curriculum_programs (
    id                TEXT PRIMARY KEY,
    document_id       TEXT REFERENCES documents(id) ON DELETE CASCADE,
    term_id           TEXT REFERENCES curriculum_terms(id) ON DELETE SET NULL,
    seq_index         INTEGER,             -- numéro de مقطع / séquence
    title             TEXT NOT NULL,
    source            TEXT,                -- ex: 'MEN 2G'
    competencies_json TEXT                 -- ressources & compétences visées
);

CREATE TABLE IF NOT EXISTS assessments (
    id                  TEXT PRIMARY KEY,
    document_id         TEXT REFERENCES documents(id) ON DELETE CASCADE,
    term_id             TEXT REFERENCES curriculum_terms(id) ON DELETE SET NULL,
    kind                TEXT CHECK(kind IN ('devoir','composition','examen','autre')) DEFAULT 'autre',
    title               TEXT NOT NULL,
    subject_chunk_id    TEXT REFERENCES document_chunks(id) ON DELETE SET NULL,
    correction_chunk_id TEXT REFERENCES document_chunks(id) ON DELETE SET NULL,
    scale_json          TEXT               -- barème
);

CREATE TABLE IF NOT EXISTS content_links (
    id            TEXT PRIMARY KEY,
    document_id   TEXT REFERENCES documents(id) ON DELETE CASCADE,
    link_type     TEXT CHECK(link_type IN ('course_exercise','course_program','course_scan','exercise_scan','assessment_scan','program_term')) NOT NULL,
    from_id       TEXT NOT NULL,           -- id source (chunk/toc/program/assessment)
    to_id         TEXT NOT NULL,           -- id cible
    page_number   INTEGER,
    metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_links_type ON content_links(link_type);
CREATE INDEX IF NOT EXISTS idx_links_from ON content_links(from_id);
CREATE INDEX IF NOT EXISTS idx_links_to   ON content_links(to_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_terms_document ON curriculum_terms(document_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_programs_document ON curriculum_programs(document_id);
CREATE INDEX IF NOT EXISTS idx_assessments_document ON assessments(document_id);
CREATE INDEX IF NOT EXISTS idx_content_links_document ON content_links(document_id);

-- ============================================================
-- STUDIO DE VALIDATION LIVE (V5 — copies de travail isolées)
-- ============================================================
CREATE TABLE IF NOT EXISTS validation_runs (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('base','document','toc','chapter','course','title','page','page_range','page_selection')),
    scope_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','RUNNING','READY','ACCEPTED','REJECTED','CANCELLED','FAILED')),
    label TEXT,
    embedding_profile_id TEXT,
    working_db_filename TEXT,
    operation TEXT NOT NULL DEFAULT 'REPROCESS',
    batch_id TEXT,
    batch_ids_json TEXT NOT NULL DEFAULT '[]',
    execution_status TEXT NOT NULL DEFAULT 'CREATED' CHECK(execution_status IN ('CREATED','QUEUED','RUNNING','COMPLETED','BLOCKED','FAILED','CANCELLED')),
    progress_current INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    error_log TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    accepted_at DATETIME,
    rejected_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_validation_runs_execution_status ON validation_runs(execution_status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_validation_runs_working_db ON validation_runs(working_db_filename) WHERE working_db_filename IS NOT NULL;
CREATE TABLE IF NOT EXISTS validation_run_pages (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','READY','ACCEPTED','REJECTED','CANCELLED','FAILED')),
    baseline_json TEXT NOT NULL,
    working_json TEXT NOT NULL,
    baseline_hash TEXT,
    error_log TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id, document_id, page_number)
);
CREATE TABLE IF NOT EXISTS validation_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS validation_snapshots (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    snapshot_type TEXT NOT NULL CHECK(snapshot_type IN ('logical','physical')),
    payload_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS embedding_profiles (
    id TEXT PRIMARY KEY,
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    pooling TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK(dimensions > 0),
    normalized INTEGER NOT NULL CHECK(normalized IN (0,1)),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(model_name, model_version, pooling, dimensions, normalized)
);
CREATE TABLE IF NOT EXISTS document_embedding_profiles (
    document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL REFERENCES embedding_profiles(id) ON DELETE RESTRICT,
    indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_validation_runs_document ON validation_runs(document_id, created_at);
CREATE INDEX IF NOT EXISTS idx_validation_runs_status ON validation_runs(status);
CREATE INDEX IF NOT EXISTS idx_validation_pages_run ON validation_run_pages(run_id, page_number);
CREATE INDEX IF NOT EXISTS idx_validation_events_run ON validation_events(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_validation_events_document ON validation_events(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_validation_snapshots_run ON validation_snapshots(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bench_validation_run ON processing_benchmarks(validation_run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_validation_run ON scientific_artifacts(validation_run_id);

-- ============================================================
-- TABLE 9 : Versioning du Schéma (Migration)
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);
-- Insertion de la version initiale (à exécuter une seule fois à la création)
INSERT OR IGNORE INTO schema_version (version, description)
VALUES (6, 'Schema RAGDom V6 — validation et queue durcies');
-- Historique migrations : migration_003_v32.sql (is_human_edited ×2),
-- migration_004_v35.sql (CREATE page_scans ; ALTER document_chunks ADD pedagogical_index, updated_at ;
--                        ALTER scientific_artifacts ADD updated_at ; backfill des scans par ré-ingestion Couche 0+7 seule).
-- Bases V3.0 existantes : appliquer /backend/db/migrations/migration_002_v31.sql
-- (ALTER pipeline_jobs ADD batch_id ; CREATE ingestion_batches + curriculum_* ;
--  triggers delete/update ; reconstruction de search_index avec le tokenizer V3.1).
