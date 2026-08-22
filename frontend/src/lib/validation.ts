import type {
  ValidationPageStatus,
  ValidationRunDetailResponse,
  ValidationRunStatus,
  ValidationScope,
  ValidationScopeDTO,
  ValidationScopeKind,
  ValidationScopeResolved,
  ValidationScopeResolutionResponse,
} from '@/types'

export function validationScopeToDto(scope: ValidationScope): ValidationScopeDTO {
  return {
    scope_type: scope.kind === 'database' ? 'base' : scope.kind === 'selection' ? 'page_selection' : scope.kind,
    document_id: scope.document_id ?? null,
    toc_id: scope.toc_id ?? null,
    page: scope.kind === 'page' ? scope.page_start ?? null : null,
    page_start: scope.kind === 'page_range' ? scope.page_start ?? null : null,
    page_end: scope.kind === 'page_range' ? scope.page_end ?? null : null,
    pages: scope.kind === 'selection' ? scope.page_numbers ?? null : null,
  }
}

export function validationScopeFromDto(
  db: string,
  scope: ValidationScopeDTO,
  pageCount: number,
  targets: ValidationScopeResolutionResponse['targets'] = [],
): ValidationScopeResolved {
  const kind: ValidationScopeKind = scope.scope_type === 'base'
    ? 'database'
    : scope.scope_type === 'page_selection'
      ? 'selection'
      : scope.scope_type
  return {
    db,
    kind,
    document_id: scope.document_id ?? undefined,
    toc_id: scope.toc_id ?? undefined,
    page_start: scope.page ?? scope.page_start ?? undefined,
    page_end: scope.page ?? scope.page_end ?? undefined,
    page_numbers: targets.flatMap(target => target.pages),
    page_count: pageCount,
    targets,
  }
}

export function isValidationScopeValid(scope: ValidationScope): boolean {
  if (!scope.db) return false
  if (scope.kind === 'database') return true
  if (!scope.document_id) return false
  if (scope.kind === 'document') return true
  if (['toc', 'chapter', 'course', 'title'].includes(scope.kind)) return Boolean(scope.toc_id)
  if (scope.kind === 'page') return Number.isInteger(scope.page_start) && (scope.page_start ?? 0) > 0
  if (scope.kind === 'page_range') {
    return Number.isInteger(scope.page_start) && Number.isInteger(scope.page_end)
      && (scope.page_start ?? 0) > 0 && (scope.page_end ?? 0) >= (scope.page_start ?? 0)
  }
  return Boolean(scope.page_numbers?.length)
}

export interface ValidationDeepLink {
  db: string | null
  runId: string | null
  pageNumber: number | null
  documentId: string | null
}

export function readValidationDeepLink(searchParams: URLSearchParams, activeDb: string | null): ValidationDeepLink {
  const rawPage = searchParams.get('page')
  const parsedPage = rawPage === null ? Number.NaN : Number(rawPage)
  return {
    db: searchParams.get('db') || activeDb,
    runId: searchParams.get('run'),
    pageNumber: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : null,
    documentId: searchParams.get('doc'),
  }
}

export function updateValidationDeepLink(
  searchParams: URLSearchParams,
  runId: string | null,
  pageNumber?: number | null,
  documentId?: string | null,
  db?: string | null,
): URLSearchParams {
  const next = new URLSearchParams(searchParams)
  next.set('tab', 'validation')
  if (db) next.set('db', db)
  if (runId) next.set('run', runId); else next.delete('run')
  if (pageNumber != null) next.set('page', String(pageNumber)); else next.delete('page')
  if (documentId) next.set('doc', documentId); else next.delete('doc')
  return next
}

export function isValidationRunTerminal(status: ValidationRunStatus): boolean {
  return status === 'ACCEPTED' || status === 'REJECTED' || status === 'CANCELLED'
    || status === 'FAILED' || status === 'BLOCKED'
}

export function validationRunProgress(run: Pick<ValidationRunDetailResponse, 'status' | 'pages'>): number {
  if (run.pages.length === 0) return 0
  if (run.status === 'READY' || run.status === 'COMPLETED' || isValidationRunTerminal(run.status)) return 100
  const completed = run.pages.filter(page =>
    page.status === 'READY' || page.status === 'ACCEPTED' || page.status === 'REJECTED'
    || page.status === 'CANCELLED' || page.status === 'FAILED',
  ).length
  return (completed / run.pages.length) * 100
}

export function validationTargetsFromPages(
  pages: Array<{ document_id: string; page_number: number }>,
  tocId: string | null,
) {
  const grouped = new Map<string, number[]>()
  for (const page of pages) {
    const numbers = grouped.get(page.document_id) ?? []
    if (!numbers.includes(page.page_number)) numbers.push(page.page_number)
    grouped.set(page.document_id, numbers)
  }
  return Array.from(grouped, ([document_id, unsorted]) => {
    const numbers = [...unsorted].sort((a, b) => a - b)
    return {
      document_id,
      toc_id: tocId,
      pages: numbers,
      page_start: numbers[0],
      page_end: numbers[numbers.length - 1],
      total_pages: numbers.length,
    }
  })
}

export function validationPageStatusCounts(pages: Array<{ status: ValidationPageStatus }>) {
  return pages.reduce((counts, page) => {
    counts[page.status] = (counts[page.status] ?? 0) + 1
    return counts
  }, {} as Partial<Record<ValidationPageStatus, number>>)
}
