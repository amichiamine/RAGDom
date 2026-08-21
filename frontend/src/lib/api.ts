import type {
  DatabaseInfo, SystemHealth, Facets, CurriculumPayload, SearchResult,
  BatchStatus, BatchStatusResponse, LlmKey, LlmSetting,
  AskResponse, PurgePayload, PurgeResult, QuarantineJob, SourceNode,
  BenchmarkRow, BenchmarkAggregates, AppSettings, EngineManifest,
  Document, TocNode, Chunk, Artifact, PaginatedResponse,
} from '@/types'

const BASE_URL = '/api'

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(error.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

function withDb(endpoint: string, db: string, params?: Record<string, string>): string {
  const p = new URLSearchParams({ db, ...params })
  return `${endpoint}?${p.toString()}`
}

export const api = {
  system: {
    getDatabases: () => request<{ databases: DatabaseInfo[] }>('/system/databases'),
    getHealth: () => request<SystemHealth>('/system/health'),
    toggleVectorStrict: (forceStrict: boolean) =>
      request<{ success: boolean; force_sqlite_vec: boolean; message: string }>('/system/vector-engine/toggle-strict', {
        method: 'POST', body: JSON.stringify({ force_sqlite_vec: forceStrict })
      }),
    testVectorEngine: () => request<{ success: boolean; engine: string; message: string }>('/system/vector-engine/test', { method: 'POST' }),
    // ── AJOUTS V3.2 / V3.4 (§7.14) ──
    getSources: () => request<{ tree: SourceNode[] }>('/system/sources'),
    uploadSource: (formData: FormData) => fetch(`${BASE_URL}/system/sources/upload`, { method: 'POST', body: formData }).then(r => r.json()),
    createSourceFolder: (relPath: string) => request('/system/sources/folder', { method: 'POST', body: JSON.stringify({ rel_path: relPath }) }),
    deleteSource: (relPath: string) => request(`/system/sources?rel_path=${encodeURIComponent(relPath)}`, { method: 'DELETE' }),
    getDatabaseExportUrl: (filename: string) => `${BASE_URL}/system/databases/${encodeURIComponent(filename)}/export`,
    duplicateDatabase: (filename: string, newName: string) => request(`/system/databases/${encodeURIComponent(filename)}/duplicate`, { method: 'POST', body: JSON.stringify({ new_name: newName }) }),
    deleteDatabase: (filename: string) => request(`/system/databases/${encodeURIComponent(filename)}`, { method: 'DELETE', body: JSON.stringify({ confirm: filename }) }),
    getSettings: () => request<{ settings: AppSettings }>('/system/settings'),
    getEngines: () => request<{ engines: EngineManifest[]; active_engine: string }>('/system/engines'), // V3.4
    updateSetting: (key: string, value: string) => request('/system/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }),
  },
  library: {
    getDocuments: (db: string, page = 1, limit = 50) =>
      request<PaginatedResponse<Document>>(withDb('/library/documents', db, { page: String(page), limit: String(limit) })),
    getToc: (db: string, documentId: string) =>
      request<{ toc: TocNode[] }>(withDb('/library/toc', db, { document_id: documentId })),
    getFacets: (db: string) =>
      request<Facets>(withDb('/library/facets', db)),
    getCurriculum: (db: string) =>
      request<CurriculumPayload>(withDb('/library/curriculum', db)), // V3.1 — D1-B
    getChunks: (db: string, documentId: string, page = 1) =>
      request<{ chunks: Chunk[]; total_pages: number }>(withDb('/library/chunks', db, { document_id: documentId, page: String(page) })),
    getArtifacts: (db: string, chunkId: string) =>
      request<{ artifacts: Artifact[] }>(withDb('/library/artifacts', db, { chunk_id: chunkId })),
    getPageScanUrl: (db: string, documentId: string, pageNumber: number, thumb = false) =>
      // V3.5 : servi depuis la table page_scans (base autonome). thumb=true → vignette pour galeries virtualisées.
      `${BASE_URL}${withDb('/library/page-scan', db, { document_id: documentId, page: String(pageNumber), ...(thumb ? { thumb: 'true' } : {}) })}`,
    // ── AJOUTS V3.2 (§7.14) ──
    updateChunk: (db: string, id: string, patch: { content_markdown?: string; section_title?: string; pedagogical_type?: string }) =>
      request(withDb(`/library/chunks/${id}`, db), { method: 'PUT', body: JSON.stringify(patch) }),
    updateArtifact: (db: string, id: string, patch: { raw_data?: string; caption?: string; render_config_json?: string }) =>
      request(withDb(`/library/artifacts/${id}`, db), { method: 'PUT', body: JSON.stringify(patch) }),
    getBenchmarks: (db: string, documentId?: string, page = 1, limit = 50) =>
      request<{ data: BenchmarkRow[]; aggregates: BenchmarkAggregates; pagination: unknown }>(
        withDb('/library/benchmarks', db, { ...(documentId ? { document_id: documentId } : {}), page: String(page), limit: String(limit) })),
    importArtifact: (db: string, formData: FormData) =>
      fetch(`${BASE_URL}${withDb('/library/artifacts/import', db)}`, { method: 'POST', body: formData }).then(r => r.json()),
  },
  search: {
    hybrid: (db: string, query: string, topK = 5, filters?: Record<string, string>) =>
      request<{ results: SearchResult[] }>(`/search/hybrid?db=${db}`, {
        method: 'POST', body: JSON.stringify({ query, top_k: topK, ...(filters ? { filters } : {}) }),
      }),
    hybridMulti: (databases: string[], query: string, topK = 5) =>
      request<{ results: SearchResult[] }>('/search/hybrid-multi', {
        method: 'POST', body: JSON.stringify({ query, databases, top_k: topK }),
      }),
    // ── AJOUT V3.2 (§7.14) ──
    ask: (databases: string[], query: string, topK = 5, filters?: Record<string, string>) =>
      request<AskResponse>('/search/ask', { method: 'POST', body: JSON.stringify({ query, databases, top_k: topK, ...(filters ? { filters } : {}) }) }),
  },
  pipeline: {
    getQueue: () => request<{ jobs: unknown[]; queue_length: number }>('/pipeline/queue'),
    start: (payload: { source_path: string; target_db: string; mode: 'document' | 'chapter' | 'page_range' | 'folder'; page_start?: number; page_end?: number; toc_id?: string }) =>
      request<{ batch_id: string; status: BatchStatus; pages_total: number }>('/pipeline/start', {
        method: 'POST', body: JSON.stringify(payload),
      }),
    getStatus: (batchId: string) => request<BatchStatusResponse>(`/pipeline/status?batch_id=${batchId}`),
    stop: () => request<{ stopped: boolean; batch_id: string; last_completed_page: number }>('/pipeline/stop', { method: 'POST' }),
    cancelBatch: (batchId: string) => request(`/pipeline/batch/${batchId}`, { method: 'DELETE' }),
    reset: (db: string, documentId?: string) => // V3.1.1 : document_id optionnel (reset base entière)
      request(withDb('/pipeline/reset', db, documentId ? { document_id: documentId } : undefined), { method: 'POST' }),
    createStream: (): EventSource => new EventSource(`${BASE_URL}/pipeline/stream`),
    // ── AJOUTS V3.2 (§7.14) ──
    purge: (payload: PurgePayload) =>
      request<PurgeResult>('/pipeline/purge', { method: 'POST', body: JSON.stringify(payload) }),
    getQuarantine: (db: string) => request<{ jobs: QuarantineJob[] }>(withDb('/pipeline/quarantine', db)),
    retry: (db: string, jobIds: string[]) => request<{ retried: number }>('/pipeline/retry', { method: 'POST', body: JSON.stringify({ db, job_ids: jobIds }) }),
  },
  llm: {
    getKeys: () => request<{ keys: LlmKey[] }>('/llm/keys'), // V3.1 : clés masquées (masked_key)
    revealKey: (keyId: string) => request<{ api_key: string }>(`/llm/keys/${keyId}/reveal`, { method: 'POST' }), // V3.1
    addKey: (provider: string, apiKey: string) =>
      request<LlmKey>('/llm/keys', { method: 'POST', body: JSON.stringify({ provider, api_key: apiKey }) }),
    deleteKey: (keyId: string) => request<{ deleted: boolean }>(`/llm/keys/${keyId}`, { method: 'DELETE' }),
    getSettings: () => request<{ settings: LlmSetting[] }>('/llm/settings'),
    updateSettings: (provider: string, model: string, isEnabled: boolean) =>
      request('/llm/settings', { method: 'PUT', body: JSON.stringify({ provider, active_model: model, is_enabled: isEnabled }) }),
    testKey: (keyId: string) => request<{ success: boolean; message: string }>(`/llm/keys/${keyId}/test`, { method: 'POST' }),
  },
  curriculum: {
    list: (db: string, kind: 'terms' | 'programs' | 'assessments' | 'links') => request(withDb(`/curriculum/${kind}`, db)),
    create: (db: string, kind: string, payload: object) => request(withDb(`/curriculum/${kind}`, db), { method: 'POST', body: JSON.stringify(payload) }),
    update: (db: string, kind: string, id: string, payload: object) => request(withDb(`/curriculum/${kind}/${id}`, db), { method: 'PUT', body: JSON.stringify(payload) }),
    remove: (db: string, kind: string, id: string) => request(withDb(`/curriculum/${kind}/${id}`, db), { method: 'DELETE' }),
    importJson: (db: string, payload: object, mode: 'replace' | 'merge') => request(withDb('/curriculum/import', db), { method: 'POST', body: JSON.stringify({ ...payload, mode }) }),
  },
}
