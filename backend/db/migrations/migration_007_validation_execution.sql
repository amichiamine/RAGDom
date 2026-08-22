-- Physical validation execution staging, version 7.
ALTER TABLE validation_runs ADD COLUMN working_db_filename TEXT;
ALTER TABLE validation_runs ADD COLUMN operation TEXT NOT NULL DEFAULT 'REPROCESS';
ALTER TABLE validation_runs ADD COLUMN batch_id TEXT;
ALTER TABLE validation_runs ADD COLUMN batch_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE validation_runs ADD COLUMN execution_status TEXT NOT NULL DEFAULT 'CREATED';
ALTER TABLE validation_runs ADD COLUMN progress_current INTEGER NOT NULL DEFAULT 0;
ALTER TABLE validation_runs ADD COLUMN progress_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE validation_runs ADD COLUMN error_log TEXT;
ALTER TABLE validation_runs ADD COLUMN started_at DATETIME;
ALTER TABLE validation_runs ADD COLUMN completed_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_validation_runs_execution_status
ON validation_runs(execution_status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_validation_runs_working_db
ON validation_runs(working_db_filename)
WHERE working_db_filename IS NOT NULL;
