-- Validation and queue hardening, version 6.
ALTER TABLE assessments ADD COLUMN document_id TEXT REFERENCES documents(id) ON DELETE CASCADE;
ALTER TABLE validation_events ADD COLUMN document_id TEXT REFERENCES documents(id) ON DELETE CASCADE;
ALTER TABLE validation_run_pages ADD COLUMN baseline_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_assessments_document ON assessments(document_id);
CREATE INDEX IF NOT EXISTS idx_validation_events_document ON validation_events(document_id, page_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_active_page
ON pipeline_jobs(document_id, page_number)
WHERE status IN ('QUEUED','PROCESSING_CV','SEGMENTING','EXTRACTING','LINTING','VLM_RECOVERY','INDEXED');
