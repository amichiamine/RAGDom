import type {
  DatabaseInfo, SystemHealth, Facets, CurriculumPayload, SearchResult,
  BatchStatus, BatchStatusResponse, LlmKey, LlmSetting,
  AskResponse, PurgePayload, PurgeResult, QuarantineJob, SourceNode,
  BenchmarkRow, BenchmarkAggregates, AppSettings, EngineManifest,
  Document, TocNode, Chunk, Artifact, PaginatedResponse,
  PageScanManifestEntry, AuthState, AuthSession, PipelineQueueState,
  ValidationPreviewRequest, ValidationPreview, ValidationRunRequest, ValidationRun,
  ValidationRunListResponse, ValidationPage, ValidationDiff, ValidationDecision,
  ValidationDecisionRequest,
} from '@/types'

// Phase 7 : VITE_API_URL (origine du backend) pour l'UI hébergée (Cloudflare/tunnel) ;
// vide en local (même origine via le proxy Vite / le reverse-proxy de production).
const BASE_URL = `${import.meta.env.VITE_API_URL ?? ''}/api`

// ── Phase 7 : jeton d'administration (mode atelier web, auth Bearer) ─────────
// Stocké en sessionStorage uniquement (jamais persisté au-delà de l'onglet).
const ADMIN_TOKEN_KEY = 'ragdom_admin_token'
export function getAdminToken(): string | null {
  try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) } catch { return null }
}
export function setAdminToken(token: string | null): void {
  try {
    if (token && token.trim()) sessionStorage.setItem(ADMIN_TOKEN_KEY, token.trim())
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY)
  } catch { /* stockage indisponible : le jeton reste requis par requête */ }
}
function authHeaders(): Record<string, string> {
  const token = getAdminToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ── Intercepteur 401 (V3.6) ──────────────────────────────────────────────────
// Si une réponse admin renvoie 401 ET que /auth/me confirme auth_required, on
// redirige vers /login. Throttle (une seule redirection par fenêtre) pour éviter
// les boucles quand plusieurs requêtes échouent en rafale.
let lastAuthRedirect = 0
const AUTH_REDIRECT_THROTTLE_MS = 4000
async function handleUnauthorized(): Promise<void> {
  const now = Date.now()
  if (now - lastAuthRedirect < AUTH_REDIRECT_THROTTLE_MS) return
  // Ne pas boucler si on est déjà sur /login.
  if (typeof window !== 'undefined' && window.location.pathname === '/login') return
  try {
    const me = await fetch(`${BASE_URL}/auth/me`, { headers: { 'Content-Type': 'application/json', ...authHeaders() } }).then(r => r.json() as Promise<AuthState>)
    if (me.auth_required && !me.authenticated) {
      lastAuthRedirect = Date.now()
      setAdminToken(null)
      window.location.assign('/login')
    }
  } catch { /* /auth/me injoignable : on n'interfère pas */ }
}


// Erreurs FastAPI : detail peut être un texte OU un tableau de validation Pydantic (422).
const FIELD_LABELS: Record<string, string> = {
  username: "Nom d'utilisateur", password: 'Mot de passe', provider: 'Fournisseur',
}
const RULE_HINTS: Record<string, string> = {
  string_pattern_mismatch: 'lettres, chiffres, _ - . uniquement (ni espaces ni accents)',
  string_too_short: 'trop court', string_too_long: 'trop long', missing: 'champ requis',
}
function humanizeApiError(detail: unknown, status: number): string {
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail)) {
    const parts = detail.map((d: { loc?: unknown[]; type?: string; msg?: string; ctx?: { min_length?: number } }) => {
      const field = String(d.loc?.[(d.loc?.length ?? 1) - 1] ?? 'champ')
      const label = FIELD_LABELS[field] ?? field
      let rule = RULE_HINTS[d.type ?? ''] ?? d.msg ?? 'invalide'
      if (d.type === 'string_too_short' && d.ctx?.min_length) rule = `${d.ctx.min_length} caractères minimum`
      return `${label} : ${rule}`
    })
    if (parts.length) return parts.join(' · ')
  }
  return `HTTP ${status}`
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    // headers fusionnés EN DERNIER : Content-Type ne doit jamais être écrasé
    // par un spread d'options (cause du bug 422 « Input should be a valid dictionary »).
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...options?.headers },
  })
  if (!res.ok) {
    // /auth/* gère ses propres 401 (login/setup échoués) : ne pas intercepter.
    if (res.status === 401 && !endpoint.startsWith('/auth/')) { void handleUnauthorized() }
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(humanizeApiError(error.detail, res.status))
  }
  return res.json()
}

function withDb(endpoint: string, db: string, params?: Record<string, string>): string {
  const p = new URLSearchParams({ db, ...params })
  return `${endpoint}?${p.toString()}`
}

// Adaptateurs du contrat Validation v1. Le backend nomme `database` → `base`
// et `selection` → `page_selection`; l'UI conserve les termes produit.
function validationScopeDto(scope: ValidationPreviewRequest['scope']) {
  return {
    scope_type: scope.kind === 'database' ? 'base' : scope.kind === 'selection' ? 'page_selection' : scope.kind,
    ...(scope.document_id ? { document_id: scope.document_id } : {}),
    ...(scope.toc_id ? { toc_id: scope.toc_id } : {}),
    ...(scope.kind === 'page' && scope.page_start ? { page: scope.page_start } : {}),
    ...(scope.page_start && scope.kind !== 'page' ? { page_start: scope.page_start } : {}),
    ...(scope.page_end && scope.kind !== 'page' ? { page_end: scope.page_end } : {}),
    ...(scope.page_numbers?.length ? { pages: scope.page_numbers } : {}),
  }
}

function validationScopeFromDto(db: string, scope: Record<string, unknown>, pageCount: number) {
  const rawType = String(scope.scope_type ?? 'base')
  const kind = rawType === 'base' ? 'database' : rawType === 'page_selection' ? 'selection' : rawType
  const pages = Array.isArray(scope.pages) ? scope.pages.filter((p): p is number => typeof p === 'number') : []
  return {
    db,
    kind: kind as ValidationRun['scope']['kind'],
    ...(typeof scope.document_id === 'string' ? { document_id: scope.document_id } : {}),
    ...(typeof scope.toc_id === 'string' ? { toc_id: scope.toc_id } : {}),
    ...(typeof scope.page === 'number' ? { page_start: scope.page, page_end: scope.page } : {}),
    ...(typeof scope.page_start === 'number' ? { page_start: scope.page_start } : {}),
    ...(typeof scope.page_end === 'number' ? { page_end: scope.page_end } : {}),
    page_count: pageCount,
    page_numbers: pages,
  }
}

export const api = {
  // ── Authentification session (V3.6) ──
  auth: {
    me: () => request<AuthState>('/auth/me'), // request() joint déjà le Bearer si présent
    setup: async (username: string, password: string, initToken?: string): Promise<AuthSession> => {
      // Si un jeton d'initialisation est fourni (cas 401 : jeton env exigé côté serveur),
      // on l'envoie en Authorization Bearer pour le POST de création du compte.
      const headers = initToken && initToken.trim() ? { Authorization: `Bearer ${initToken.trim()}` } : undefined
      const res = await request<AuthSession>('/auth/setup', {
        method: 'POST', body: JSON.stringify({ username, password }), ...(headers ? { headers } : {}),
      })
      setAdminToken(res.session_token)
      return res
    },
    login: async (username: string, password: string): Promise<AuthSession> => {
      const res = await request<AuthSession>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      setAdminToken(res.session_token)
      return res
    },
    logout: async (): Promise<void> => {
      try { await request('/auth/logout', { method: 'POST' }) }
      finally { setAdminToken(null) }
    },
  },
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
    uploadSource: (formData: FormData) => fetch(`${BASE_URL}/system/sources/upload`, { method: 'POST', headers: authHeaders(), body: formData }).then(r => r.json()),
    createSourceFolder: (relPath: string) => request('/system/sources/folder', { method: 'POST', body: JSON.stringify({ rel_path: relPath }) }),
    deleteSource: (relPath: string) => request(`/system/sources?rel_path=${encodeURIComponent(relPath)}`, { method: 'DELETE' }),
    getDatabaseExportUrl: (filename: string) => `${BASE_URL}/system/databases/${encodeURIComponent(filename)}/export`,
    duplicateDatabase: (filename: string, newName: string) => request(`/system/databases/${encodeURIComponent(filename)}/duplicate`, { method: 'POST', body: JSON.stringify({ new_name: newName }) }),
    deleteDatabase: (filename: string) => request(`/system/databases/${encodeURIComponent(filename)}`, { method: 'DELETE', body: JSON.stringify({ confirm: filename }) }),
    getSettings: () => request<{ settings: AppSettings }>('/system/settings'),
    getEngines: () => request<{ engines: EngineManifest[]; active_engine: string }>('/system/engines'), // V3.4
    updateSetting: (key: string, value: string) => request('/system/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }),
    // Documentation Make.com (LECTURE seule, route ADMIN) : { contract, prompts } en Markdown brut.
    getMakeDocs: () => request<{ contract: string; prompts: string }>('/system/docs/make'),
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
    getChunks: (db: string, documentId: string, page = 1, filters?: { pedagogical_type?: string; page_start?: number; page_end?: number; toc_id?: string; term_index?: number }) =>
      // VÉRITÉ backend (routes_library.py `chunks`) : { data:[…], pagination:{page,limit,total,total_pages} }.
      // Certaines versions ajoutent aussi `chunks` (alias) ; on lit `data` EN PREMIER (source canonique)
      // et on retombe sur `chunks` — sinon `first.chunks` était undefined → chargements infinis/vides.
      // On normalise en exposant `chunks` + `total_pages` à plat pour ne casser aucun consommateur.
      request<{ data?: Chunk[]; chunks?: Chunk[]; pagination?: { page: number; limit: number; total: number; total_pages: number } }>(withDb('/library/chunks', db, {
        document_id: documentId,
        page: String(page),
        ...(filters?.pedagogical_type ? { pedagogical_type: filters.pedagogical_type } : {}),
        ...(filters?.page_start != null ? { page_start: String(filters.page_start) } : {}),
        ...(filters?.page_end != null ? { page_end: String(filters.page_end) } : {}),
        ...(filters?.toc_id ? { toc_id: filters.toc_id } : {}),
        ...(filters?.term_index != null ? { term_index: String(filters.term_index) } : {}),
      })).then(r => ({ chunks: r.data ?? r.chunks ?? [], total_pages: r.pagination?.total_pages ?? 1 })),
    // Artefacts scientifiques : par chunk_id (rétrocompat) OU par {document_id, page_number}
    // (rendu multimodal côté lecture — l'endpoint backend accepte déjà ces 3 filtres).
    getArtifacts: (db: string, target: string | { document_id?: string; page_number?: number; chunk_id?: string }) =>
      request<{ artifacts: Artifact[] }>(withDb('/library/artifacts', db,
        typeof target === 'string'
          ? { chunk_id: target }
          : {
              ...(target.chunk_id ? { chunk_id: target.chunk_id } : {}),
              ...(target.document_id ? { document_id: target.document_id } : {}),
              ...(target.page_number != null ? { page_number: String(target.page_number) } : {}),
            },
      )).then(r => ({ artifacts: r.artifacts ?? [] })),
    getPageScanUrl: (db: string, documentId: string, pageNumber: number, thumb = false) =>
      // V3.5 : servi depuis la table page_scans (base autonome). thumb=true → vignette pour galeries virtualisées.
      `${BASE_URL}${withDb('/library/page-scan', db, { document_id: documentId, page: String(pageNumber), ...(thumb ? { thumb: 'true' } : {}) })}`,
    // V3.5 (Lot 1) : manifeste des scans de pages (jointure page_scans × toc × chunks) — jamais de glob fichiers.
    getPageScansManifest: (db: string, documentId?: string) =>
      // Backend renvoie { data, pagination } (routes_library.py page_scans_manifest) — on
      // normalise en exposant `pages` (nom consommé par CurriculumWorkspace).
      request<{ data: PageScanManifestEntry[] }>(withDb('/library/page-scans', db, documentId ? { document_id: documentId } : undefined))
        .then(r => ({ pages: r.data ?? [] })),
    // Alias sémantique (galerie de scans générique du Mode Repli, §5.2) — même manifeste page_scans.
    getPageScans: (db: string, documentId?: string) =>
      request<{ data: PageScanManifestEntry[]; pagination: { total_pages: number } }>(withDb('/library/page-scans', db, documentId ? { document_id: documentId } : undefined))
        .then(r => ({ pages: r.data ?? [], total_pages: r.pagination?.total_pages ?? 1 })),
    // Binaire d'un artefact (figure) — cible de asset://figures/… résolue par le pipeline KaTeX.
    getArtifactBinaryUrl: (db: string, artifactId: string) =>
      `${BASE_URL}${withDb('/library/artifact-binary', db, { artifact_id: artifactId })}`,
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
    // Backend /pipeline/queue exige ?db= et renvoie l'état réel de la file séquentielle.
    getQueue: (db: string) => request<PipelineQueueState>(withDb('/pipeline/queue', db)),
    start: (payload: { source_path: string; target_db?: string; mode: 'document' | 'chapter' | 'page_range' | 'folder'; page_start?: number; page_end?: number; toc_id?: string }) =>
      request<{ batch_id: string; batch_ids?: string[]; status: BatchStatus; pages_total: number; target_db: string }>('/pipeline/start', {
        method: 'POST', body: JSON.stringify(payload),
      }),
    // Ré-exécution SCOPÉE (§7.4) : purge du périmètre puis ré-ingestion complète (toutes couches).
    reprocess: (payload: { db: string; scope: 'document' | 'page_range' | 'chapter'; document_id: string; page_start?: number; page_end?: number; toc_id?: string; preserve_human_edits?: boolean }) =>
      request<{ reprocessed_scope: string; purged: unknown; batch_id: string; pages_total: number; page_start: number; page_end: number; status: BatchStatus }>('/pipeline/reprocess', {
        method: 'POST', body: JSON.stringify(payload),
      }),
    // Backend /pipeline/status EXIGE ?db= (alias du query `db_name`) — sans lui : 422.
    getStatus: (batchId: string, db: string) =>
      request<BatchStatusResponse>(withDb('/pipeline/status', db, { batch_id: batchId })),
    stop: () => request<{ stopped: boolean; batch_id: string; last_completed_page: number }>('/pipeline/stop', { method: 'POST' }),
    // Backend DELETE /pipeline/batch/{id} EXIGE ?db= (alias du query `db_name`) — sans lui : 422.
    cancelBatch: (batchId: string, db: string) =>
      request<{ cancelled: boolean; removed_jobs: number }>(withDb(`/pipeline/batch/${batchId}`, db), { method: 'DELETE' }),
    reset: (db: string, documentId?: string) => // V3.1.1 : document_id optionnel (reset base entière)
      request(withDb('/pipeline/reset', db, documentId ? { document_id: documentId } : undefined), { method: 'POST' }),
    createStream: (): EventSource => {
      const token = getAdminToken()
      const qs = token ? `?auth_token=${encodeURIComponent(token)}` : ''
      return new EventSource(`${BASE_URL}/pipeline/stream${qs}`)
    },
    // ── AJOUTS V3.2 (§7.14) ──
    purge: (payload: PurgePayload) =>
      request<PurgeResult>('/pipeline/purge', { method: 'POST', body: JSON.stringify(payload) }),
    getQuarantine: (db: string) => request<{ jobs: QuarantineJob[] }>(withDb('/pipeline/quarantine', db)),
    retry: (db: string, jobIds: string[]) => request<{ retried: number }>('/pipeline/retry', { method: 'POST', body: JSON.stringify({ db, job_ids: jobIds }) }),
  },
  llm: {
    getKeys: () => request<{ keys: LlmKey[] }>('/llm/keys'), // V3.1 : clés masquées (masked_key)
    revealKey: (keyId: string) => request<{ api_key: string }>(`/llm/keys/${keyId}/reveal`, { method: 'POST' }), // V3.1
    // VÉRITÉ backend (routes_llm.py add_key) : POST renvoie { key_id, status } — PAS un LlmKey complet.
    addKey: (provider: string, apiKey: string) =>
      request<{ key_id: string; status: string }>('/llm/keys', { method: 'POST', body: JSON.stringify({ provider, api_key: apiKey }) }),
    deleteKey: (keyId: string) => request<{ deleted: boolean }>(`/llm/keys/${keyId}`, { method: 'DELETE' }),
    getSettings: () => request<{ settings: LlmSetting[] }>('/llm/settings'),
    // V3.6 : PUT partiel — provider requis + tout sous-ensemble de {active_model, is_enabled, priority, base_url}.
    updateSettings: (provider: string, patch: { active_model?: string | null; is_enabled?: boolean; priority?: number; base_url?: string | null }) =>
      // VÉRITÉ backend (routes_llm.py put_settings) : renvoie { success, updated:{provider, active_model} }.
      request<{ success: boolean; updated: { provider: string; active_model: string | null } }>('/llm/settings', { method: 'PUT', body: JSON.stringify({ provider, ...patch }) }),
    testKey: (keyId: string) => request<{ success: boolean; status?: string; latency_ms?: number; message: string }>(`/llm/keys/${keyId}/test`, { method: 'POST' }),
    // V3.7 : détection LIVE des modèles chez le fournisseur (clé stockée + base_url).
    // Renvoie { models, error } — error non nul = pas de clé / URL injoignable / provider sans modèles.
    // key_id optionnel : détection avec CETTE clé précise (quotas/modèles propres à la clé) ;
    // sans key_id, le back retombe sur une clé active quelconque du provider.
    getProviderModels: (provider: string, keyId?: string) =>
      request<{ models: string[]; error: string | null }>(
        `/llm/providers/${encodeURIComponent(provider)}/models${keyId ? `?key_id=${encodeURIComponent(keyId)}` : ''}`),
    // V3.8 : modèle PROPRE À LA CLÉ. active_model null → la clé hérite du modèle global du provider.
    updateKey: (keyId: string, activeModel: string | null) =>
      request<{ updated: boolean; key_id: string; active_model: string | null }>(`/llm/keys/${keyId}`, {
        method: 'PUT', body: JSON.stringify({ active_model: activeModel }),
      }),
  },
  validation: {
    // `resolve-scope` est le dry-run canonique : aucun run n'est créé et aucune
    // donnée officielle n'est mutée. L'identifiant client lie ce résultat au CTA.
    preview: (payload: ValidationPreviewRequest) =>
      request<{ scope_type: string; targets: Array<{ document_id: string; toc_id?: string | null; pages: number[]; page_start: number; page_end: number; total_pages: number }>; page_count: number }>(
        '/validation/resolve-scope', {
          method: 'POST', body: JSON.stringify({ db: payload.scope.db, scope: validationScopeDto(payload.scope) }),
        },
      ).then(r => ({
        preview_id: `${payload.scope.db}:${Date.now()}`,
        created_at: new Date().toISOString(),
        scope: {
          ...payload.scope,
          page_count: r.page_count,
          page_numbers: r.targets.flatMap(target => target.pages),
        },
        options: payload.options,
        impact: { pages: r.page_count, chunks: null, artifacts: null, toc_entries: null, curriculum_entries: null, benchmarks: null, human_edits_preserved: null },
        warnings: [], runnable: r.page_count > 0,
        summary: `${r.page_count} page(s) · ${r.targets.length} cible(s)`,
      } satisfies ValidationPreview)),
    createRun: (payload: ValidationRunRequest) =>
      request<{ id: string; status: ValidationRun['status']; page_count: number; scope_type: string }>(
        '/validation/runs', {
          method: 'POST', body: JSON.stringify({ db: payload.scope.db, scope: validationScopeDto(payload.scope) }),
        },
      ).then(r => ({
        id: r.id, status: r.status, scope: { ...payload.scope, page_count: r.page_count, page_numbers: payload.scope.page_numbers ?? [] },
        options: payload.options, created_at: new Date().toISOString(), started_at: null, completed_at: null,
        pages_total: r.page_count, pages_completed: 0, pages_failed: 0, progress: 0,
        working_copy_id: r.id, snapshot_before_id: null, snapshot_after_id: null, pages: [],
      })),
    listRuns: (db: string, page = 1, limit = 25) =>
      request<{ runs: Array<{ id: string; document_id: string | null; scope_type: string; status: ValidationRun['status']; label: string | null; created_at: string; updated_at: string; page_count: number }> }>(
        withDb('/validation/runs', db),
      ).then(r => {
        const total = r.runs.length
        const start = (page - 1) * limit
        const data = r.runs.slice(start, start + limit).map(item => ({
          id: item.id, status: item.status,
          scope: validationScopeFromDto(db, { scope_type: item.scope_type, document_id: item.document_id }, item.page_count),
          options: { working_copy: true, preserve_human_edits: true }, created_at: item.created_at,
          started_at: item.created_at, completed_at: ['ACCEPTED', 'REJECTED', 'CANCELLED', 'FAILED'].includes(item.status) ? item.updated_at : null,
          pages_total: item.page_count, pages_completed: ['READY', 'ACCEPTED', 'REJECTED'].includes(item.status) ? item.page_count : 0,
          pages_failed: item.status === 'FAILED' ? item.page_count : 0,
          progress: ['READY', 'ACCEPTED', 'REJECTED'].includes(item.status) ? 100 : 0,
          working_copy_id: item.id, snapshot_before_id: null, snapshot_after_id: null,
        }))
        return { data, pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) } } satisfies ValidationRunListResponse
      }),
    getRun: (runId: string, db?: string) => {
      if (!db) return Promise.reject(new Error('db required'))
      return request<{ id: string; document_id: string | null; scope_type: string; scope: Record<string, unknown>; status: ValidationRun['status']; created_at: string; updated_at: string; accepted_at: string | null; rejected_at: string | null; pages: Array<{ document_id: string; page_number: number; status: ValidationPage['status']; updated_at: string }> }>(
        withDb(`/validation/runs/${encodeURIComponent(runId)}`, db),
      ).then(r => {
        const completed = r.pages.filter(p => ['READY', 'COMPLETED', 'ACCEPTED', 'REJECTED'].includes(p.status)).length
        return {
          id: r.id, status: r.status, scope: validationScopeFromDto(db, r.scope, r.pages.length),
          options: { working_copy: true, preserve_human_edits: true }, created_at: r.created_at,
          started_at: r.created_at, completed_at: r.accepted_at ?? r.rejected_at,
          pages_total: r.pages.length, pages_completed: completed,
          pages_failed: r.pages.filter(p => p.status === 'FAILED').length,
          progress: r.pages.length ? completed / r.pages.length * 100 : 0,
          working_copy_id: r.id, snapshot_before_id: null, snapshot_after_id: null,
          pages: r.pages.map(p => ({ run_id: r.id, document_id: p.document_id, page_number: p.page_number, status: p.status, completed_at: p.updated_at })),
        } satisfies ValidationRun
      })
    },
    getPage: async (runId: string, pageNumber: number, db?: string, documentId?: string): Promise<ValidationPage> => {
      if (!db) throw new Error('db required')
      type RawPage = { document_id: string; page_number: number; status: ValidationPage['status']; baseline: { chunks?: Chunk[]; artifacts?: Array<Artifact & { raw_binary?: unknown }> }; working: { chunks?: Chunk[]; artifacts?: Array<Artifact & { raw_binary?: unknown }> }; error_log: string | null; updated_at: string }
      const raw = await request<RawPage>(withDb(`/validation/runs/${encodeURIComponent(runId)}/pages/${pageNumber}`, db, documentId ? { document_id: documentId } : undefined))
      const [tocResult, curriculumResult, benchmarkResult] = await Promise.all([
        request<{ toc: TocNode[] }>(withDb('/library/toc', db, { document_id: raw.document_id })).catch(() => ({ toc: [] })),
        request<CurriculumPayload>(withDb('/library/curriculum', db)).catch(() => null),
        request<{ data: BenchmarkRow[] }>(withDb('/library/benchmarks', db, { document_id: raw.document_id, page: '1', limit: '250' })).catch(() => ({ data: [] })),
      ])
      const sanitizeArtifacts = (items: RawPage['working']['artifacts'] = []): Artifact[] => items.map(item => ({ ...item, raw_binary: null, has_binary: item.raw_binary != null }))
      const beforeChunks = raw.baseline.chunks ?? [], afterChunks = raw.working.chunks ?? []
      const beforeArtifacts = sanitizeArtifacts(raw.baseline.artifacts), afterArtifacts = sanitizeArtifacts(raw.working.artifacts)
      const beforeMarkdown = beforeChunks.map(c => c.content_markdown).join('\n\n'), afterMarkdown = afterChunks.map(c => c.content_markdown).join('\n\n')
      const artifactIds = new Set([...beforeArtifacts.map(a => a.id), ...afterArtifacts.map(a => a.id)])
      const artifacts = Array.from(artifactIds).map(id => {
        const before = beforeArtifacts.find(a => a.id === id) ?? null, after = afterArtifacts.find(a => a.id === id) ?? null
        const change = !before ? 'added' : !after ? 'removed' : JSON.stringify(before) === JSON.stringify(after) ? 'unchanged' : 'changed'
        return { artifact_id: id, change, before, after } as ValidationDiff['artifacts'][number]
      })
      return {
        run_id: runId, document_id: raw.document_id, page_number: raw.page_number, status: raw.status, completed_at: raw.updated_at,
        inspection: {
          chunks: afterChunks, artifacts: afterArtifacts, toc: tocResult.toc ?? [],
          curriculum: curriculumResult ? {
            terms: curriculumResult.terms, programs: curriculumResult.programs,
            assessments: curriculumResult.assessments, links: curriculumResult.links,
          } : null,
          benchmarks: (benchmarkResult.data ?? []).filter(row => row.page_number === raw.page_number),
          errors: raw.error_log ? [{ message: raw.error_log }] : [],
        },
        diff: {
          markdown: { before: beforeMarkdown, after: afterMarkdown }, artifacts,
          metrics: [
            { key: 'chunks', before: beforeChunks.length, after: afterChunks.length, delta: afterChunks.length - beforeChunks.length },
            { key: 'artifacts', before: beforeArtifacts.length, after: afterArtifacts.length, delta: afterArtifacts.length - beforeArtifacts.length },
          ],
        }, error: raw.error_log,
      }
    },
    getDiff: (runId: string, pageNumber?: number, db?: string) => {
      if (!db) return Promise.reject(new Error('db required'))
      if (pageNumber != null) return api.validation.getPage(runId, pageNumber, db).then(page => page.diff ?? { markdown: null, artifacts: [], metrics: [] })
      return request<{ changed_pages: number }>(withDb(`/validation/runs/${encodeURIComponent(runId)}/diff`, db))
        .then(r => ({ markdown: null, artifacts: [], metrics: [{ key: 'changed_pages', before: 0, after: r.changed_pages, delta: r.changed_pages }] }))
    },
    cancelRun: (runId: string, db: string) =>
      request<{ cancelled: boolean; run_id: string }>(withDb(`/validation/runs/${encodeURIComponent(runId)}/cancel`, db), { method: 'POST' }),
    decide: (runId: string, db: string, payload: ValidationDecisionRequest) => {
      const endpoint = payload.page_number != null
        ? withDb(`/validation/runs/${encodeURIComponent(runId)}/decisions`, db)
        : withDb(`/validation/runs/${encodeURIComponent(runId)}/${payload.decision}`, db)
      return request<Record<string, unknown>>(endpoint, payload.page_number != null
        ? { method: 'POST', body: JSON.stringify(payload) }
        : { method: 'POST' }).then(() => ({
          id: `${runId}:${payload.decision}:${Date.now()}`, run_id: runId,
          target: payload.page_number != null ? 'page' : 'run', page_number: payload.page_number,
          decision: payload.decision, created_at: new Date().toISOString(),
        } satisfies ValidationDecision))
    },
    createStream: (runId: string, db?: string, cursor?: string): EventSource => {
      const params = new URLSearchParams({ run_id: runId })
      if (db) params.set('db', db)
      if (cursor) params.set('cursor', cursor)
      const token = getAdminToken()
      if (token) params.set('auth_token', token)
      return new EventSource(`${BASE_URL}/validation/stream?${params.toString()}`)
    },
  },
  curriculum: {
    list: (db: string, kind: 'terms' | 'programs' | 'assessments' | 'links') => request(withDb(`/curriculum/${kind}`, db)),
    create: (db: string, kind: string, payload: object) => request(withDb(`/curriculum/${kind}`, db), { method: 'POST', body: JSON.stringify(payload) }),
    update: (db: string, kind: string, id: string, payload: object) => request(withDb(`/curriculum/${kind}/${id}`, db), { method: 'PUT', body: JSON.stringify(payload) }),
    remove: (db: string, kind: string, id: string) => request(withDb(`/curriculum/${kind}/${id}`, db), { method: 'DELETE' }),
    importJson: (db: string, payload: object, mode: 'replace' | 'merge') => request(withDb('/curriculum/import', db), { method: 'POST', body: JSON.stringify({ ...payload, mode }) }),
  },
}
