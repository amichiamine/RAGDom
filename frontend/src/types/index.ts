export interface DatabaseMetrics {
  document_count: number;
  chunk_count: number;
  artifact_count: number;
  page_count: number;
  indexed_page_count: number;
}

export interface DatabaseInfo {
  filename: string;
  size_bytes: number;
  last_modified: string;
  metrics: DatabaseMetrics;
}

export interface SystemHealth {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  queue_length: number;
  vector_engine: 'sqlite-vec' | 'fts5-fallback';
  vector_engine_status: 'ready' | 'fallback_bm25_only' | 'error';
  vector_engine_message: string;
  force_sqlite_vec: boolean;
  readonly: boolean; // V3.6 : mode lecture seule (GET /system/health) — masque les actions mutatives
}

export interface Document {
  id: string;
  title: string;
  filename: string;
  total_pages: number;
  doc_type: string;
  academic_level: string | null;
  domain_tags_json: string;
  created_at: string;
}

export interface TocNode {
  id: string;
  parent_id: string | null;
  level: number;
  title: string;
  page_start: number;
  page_end: number | null;
  children?: TocNode[];
}

export interface Chunk {
  id: string;
  page_number: number;
  chunk_index: number;
  section_title: string | null;
  content_markdown: string;
  pedagogical_type: PedagogicalType | null;
  pedagogical_index: number | null;  // V3.5 : numéro d'exercice/leçon extrait — badge des cartes Vue 2
  has_solution: 0 | 1;
  is_human_edited: 0 | 1;            // V3.2/V3.5 : badge « مصحّح يدويًا »
  updated_at: string | null;         // V3.5 : date de correction humaine
  token_count: number | null;
}

export type PedagogicalType =
  | 'course_theory' | 'proof_demonstration' | 'exercise_unsolved'
  | 'exercise_solved' | 'solution_only' | 'evaluation_exam'
  | 'practical_work' | 'general_content';

export interface Artifact {
  id: string;
  domain: string;
  artifact_type: string;
  raw_data: string | null;
  raw_binary: null; // BLOB jamais sérialisé en JSON — les binaires sont servis via /library/page-scan (image/webp)
  render_config_json: string;
  caption: string | null;
  bounding_box_json: string | null;
  page_number?: number | null;   // V3.5 : page d'origine (rendu multimodal côté lecture)
  has_binary?: boolean;          // V3.5 : crop WebP disponible via /library/artifact-binary
  is_human_edited?: number | boolean; // V3.2/V3.5 : artefact corrigé manuellement (badge édition humaine)
  area_ratio?: number | null;    // surface bbox / surface page (0-1) ; null si non calculable — >0.7 = re-cadrage pleine page
}

export interface FacetItem {
  domain?: string;
  pedagogical_type?: string;
  artifact_type?: string;
  count: number;
}

export interface Facets {
  domains: FacetItem[];
  pedagogical_types: FacetItem[];
  artifact_types: FacetItem[];
}

// ── Curriculum (V3.1 — D1-B, tables optionnelles) ──
export interface CurriculumTerm { id: string; term_index: number; label: string; }
export interface CurriculumProgram { id: string; term_id: string | null; seq_index: number | null; title: string; source: string | null; competencies_json: string | null; }
export interface Assessment { id: string; document_id: string | null; term_id: string | null; kind: 'devoir' | 'composition' | 'examen' | 'autre'; title: string; subject_chunk_id: string | null; correction_chunk_id: string | null; scale_json: string | null; }
export interface ContentLink { id: string; link_type: 'course_exercise' | 'course_program' | 'course_scan' | 'exercise_scan' | 'assessment_scan' | 'program_term'; from_id: string; to_id: string; page_number: number | null; }
// ── Manifeste des scans de pages (Vue 2 — galerie & side-by-side, Lot 1 API) ──
export interface PageScanManifestEntry {
  document_id: string;
  page_number: number;
  width: number;
  height: number;
  has_thumb: boolean;
  chapter_toc_id: string | null;
  chapter_title: string | null;
  exercises_count: number;
}

// ── Agrégats curriculum (calculés en SQL — jamais côté client, préambule §5.2) ──
export interface CurriculumTermAggregate {
  term_id: string;
  term_index: number;
  programs: number;
  assessments: number;
  courses: number;
  exercises: number;
}
export interface CurriculumGlobalAggregate {
  programs: number;
  assessments: number;
  courses: number;
  exercises: number;
  solutions: number;
  page_scans: number;
  chapters: number;
}
export interface CurriculumAggregates {
  per_term: CurriculumTermAggregate[];
  global: CurriculumGlobalAggregate;
}

export interface CurriculumPayload { curriculum_available: boolean; terms: CurriculumTerm[]; programs: CurriculumProgram[]; assessments: Assessment[]; links: ContentLink[]; aggregates: CurriculumAggregates; }

export interface PipelineJob {
  id: string;
  document_id: string;
  page_number: number;
  status: PipelineStatus;
  retry_count: number;
  error_log: string | null;
  updated_at: string;
}

export type PipelineStatus =
  | 'QUEUED' | 'PROCESSING_CV' | 'SEGMENTING' | 'EXTRACTING'
  | 'LINTING' | 'VLM_RECOVERY' | 'INDEXED' | 'READY'
  | 'QUARANTINE' | 'INVALID_SOURCE';

export interface SearchResult {
  chunk_id: string;
  document_id: string;
  document_title: string;
  page_number: number;
  section_title: string | null;
  pedagogical_type: PedagogicalType | null;
  content_markdown: string;            // V3.1 : aligné sur la réponse du contrat Blueprint Partie 7
  rrf_score: number;
  bm25_rank: number | null;            // V3.1
  vec_rank: number | null;             // V3.1 (null en mode fts5-fallback)
  database_filename?: string;          // V3.1 : renseigné par /search/hybrid-multi
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; total_pages: number; };
}

export interface LlmKey {
  id: string;
  provider: LlmProvider;
  masked_key: string; // V3.1 : la clé en clair n'est retournée que par POST /llm/keys/{id}/reveal
  status: 'active' | 'blocked' | 'disabled';
  blocked_until: string | null;
  last_error_code: number | null;
  created_at: string;
  active_model: string | null; // V3.8 : modèle propre à la clé (null = hérite du modèle global du provider)
}

export type LlmProvider = 'gemini' | 'groq' | 'openai' | 'anthropic' | 'lmstudio' | 'make' | 'ollama';

export interface LlmSetting {
  provider: LlmProvider;
  active_model: string | null;
  is_enabled: boolean;
  priority: number;
  base_url: string | null; // V3.6 : endpoint personnalisable (lmstudio local, make webhook…)
}

// ── Authentification session (V3.6 — atelier web, canal Bearer réutilisé) ──
export interface AuthState {
  auth_required: boolean;
  setup_required: boolean
  init_token_required?: boolean;
  authenticated: boolean;
  username: string | null;
  readonly: boolean;
}
export interface AuthSession { session_token: string; username: string; }

export type BatchStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'FAILED'; // V3.1.1

export interface PipelineSSEEvent {
  // V3.1.1 : champ-par-champ aligné sur le contrat SSE Blueprint Partie 7.4
  type: 'page_update' | 'queue_update' | 'job_complete' | 'error';
  batch_id?: string;
  job_id?: string;
  page_number?: number;          // page_update, error
  status?: PipelineStatus;       // page_update
  ram_mb?: number;               // page_update
  latency_ms?: number;           // page_update (alimente la carte ETA & Débit)
  line?: string;                 // page_update (console)
  queue_length?: number;         // queue_update
  pages_indexed?: number;        // job_complete
  artifacts_extracted?: number;  // job_complete
  done?: boolean;                // job_complete
  success?: boolean;             // job_complete
  error?: string;                // error
  details?: string;              // error
}

// ── État de la file séquentielle (GET /pipeline/queue?db=) ──
export interface PipelineQueueState {
  current_job: { batch_id: string | null; job_id: string; status: PipelineStatus; page_number: number } | null;
  queued_jobs: number;
  completed_today: number;
}

export interface BatchStatusResponse { // V3.1.1
  batch_id: string;
  status: BatchStatus;
  pages_total: number;
  pages_done: number;
  current_page: { page_number: number; status: PipelineStatus; retry_count: number; error_log: string | null } | null;
  updated_at: string;
}

// ── AJOUTS V3.2 (§7.14) ──
export interface AskSource { chunk_id: string; document_id: string; document_title: string; page_number: number; database_filename: string; rrf_score: number; }
export interface AskResponse { answer: string; no_context: boolean; sources: AskSource[]; provider_used: string | null; fallback_triggered: boolean; }
export type PurgeScope = 'page' | 'page_range' | 'chapter' | 'document' | 'database' | 'artifacts_only' | 'curriculum_only';
export interface PurgePayload { db: string; scope: PurgeScope; document_id?: string; page_start?: number; page_end?: number; toc_id?: string; dry_run: boolean; preserve_human_edits?: boolean; confirm?: string; }
export interface PurgeResult { dry_run: boolean; deleted: { chunks: number; artifacts: number; toc_entries: number; jobs: number; curriculum_links: number; vec_rows: number; page_scans: number }; preserved_human_edited: number; message: string; }
export interface QuarantineJob { id: string; document_id: string; page_number: number; status: 'QUARANTINE' | 'INVALID_SOURCE'; retry_count: number; error_log: string | null; updated_at: string; }
export interface SourceFile { name: string; size_bytes: number; ingested: boolean; target_db: string | null; }
export interface SourceNode { rel_path: string; folders: SourceNode[]; files: SourceFile[]; }
export interface BenchmarkRow { id: string; page_number: number; engine_used: string; vlm_provider_used: string | null; fallback_triggered: 0 | 1; execution_time_ms: number; ram_peak_mb: number | null; confidence_score: number | null; created_at: string; }
export interface BenchmarkAggregates { avg_latency_ms: number; avg_confidence: number; avg_ram_peak_mb: number; vlm_usage_rate: number; fallback_rate: number; }
export interface AppSettings { vec_distance_threshold: number; bm25_score_threshold: number; force_sqlite_vec: boolean; }
export interface EngineManifest { id: string; label: string; version: string; accent: string; families_tier1: string[]; status: 'active' | 'inactive'; } // V3.4
