-- Studio de validation live — migration additive SQLite, version 5.
ALTER TABLE processing_benchmarks ADD COLUMN validation_run_id TEXT REFERENCES validation_runs(id) ON DELETE SET NULL;
ALTER TABLE curriculum_terms ADD COLUMN document_id TEXT REFERENCES documents(id) ON DELETE CASCADE;
ALTER TABLE curriculum_programs ADD COLUMN document_id TEXT REFERENCES documents(id) ON DELETE CASCADE;
ALTER TABLE content_links ADD COLUMN document_id TEXT REFERENCES documents(id) ON DELETE CASCADE;
ALTER TABLE scientific_artifacts ADD COLUMN validation_run_id TEXT REFERENCES validation_runs(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS validation_runs (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('base','document','toc','chapter','course','title','page','page_range','page_selection')),
    scope_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','RUNNING','READY','ACCEPTED','REJECTED','CANCELLED','FAILED')),
    label TEXT,
    embedding_profile_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    accepted_at DATETIME,
    rejected_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_validation_runs_document ON validation_runs(document_id, created_at);
CREATE INDEX IF NOT EXISTS idx_validation_runs_status ON validation_runs(status);

CREATE TABLE IF NOT EXISTS validation_run_pages (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','READY','ACCEPTED','REJECTED','CANCELLED','FAILED')),
    baseline_json TEXT NOT NULL,
    working_json TEXT NOT NULL,
    error_log TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id, document_id, page_number)
);
CREATE INDEX IF NOT EXISTS idx_validation_pages_run ON validation_run_pages(run_id, page_number);

CREATE TABLE IF NOT EXISTS validation_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    page_number INTEGER,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_validation_events_run ON validation_events(run_id, created_at);

CREATE TABLE IF NOT EXISTS validation_snapshots (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    snapshot_type TEXT NOT NULL CHECK(snapshot_type IN ('logical','physical')),
    payload_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_validation_snapshots_run ON validation_snapshots(run_id, created_at);

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

CREATE INDEX IF NOT EXISTS idx_curriculum_terms_document ON curriculum_terms(document_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_programs_document ON curriculum_programs(document_id);
CREATE INDEX IF NOT EXISTS idx_content_links_document ON content_links(document_id);
CREATE INDEX IF NOT EXISTS idx_bench_validation_run ON processing_benchmarks(validation_run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_validation_run ON scientific_artifacts(validation_run_id);
