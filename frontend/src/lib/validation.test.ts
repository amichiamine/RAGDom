import { describe, expect, it } from 'vitest'
import {
  isValidationRunTerminal,
  isValidationScopeValid,
  readValidationDeepLink,
  updateValidationDeepLink,
  validationPageStatusCounts,
  validationRunProgress,
  validationScopeFromDto,
  validationScopeToDto,
  validationTargetsFromPages,
} from './validation'
import type { ValidationRunStatus } from '@/types'

describe('validation scopes', () => {
  it('maps a page range to the API contract', () => {
    expect(validationScopeToDto({
      db: 'physics.sqlite',
      kind: 'page_range',
      document_id: 'document-42',
      page_start: 12,
      page_end: 18,
    })).toEqual({
      scope_type: 'page_range',
      document_id: 'document-42',
      toc_id: null,
      page: null,
      page_start: 12,
      page_end: 18,
      pages: null,
    })
  })

  it('reconstructs a resolved selection from API targets', () => {
    const target = {
      document_id: 'document-42',
      toc_id: null,
      pages: [3, 8],
      page_start: 3,
      page_end: 8,
      total_pages: 2,
    }
    expect(validationScopeFromDto('physics.sqlite', {
      scope_type: 'page_selection',
      document_id: 'document-42',
      toc_id: null,
      page: null,
      page_start: null,
      page_end: null,
      pages: [3, 8],
    }, 2, [target])).toEqual({
      db: 'physics.sqlite',
      kind: 'selection',
      document_id: 'document-42',
      toc_id: undefined,
      page_start: undefined,
      page_end: undefined,
      page_numbers: [3, 8],
      page_count: 2,
      targets: [target],
    })
  })

  it('rejects incomplete or reversed scopes', () => {
    expect(isValidationScopeValid({ db: '', kind: 'database' })).toBe(false)
    expect(isValidationScopeValid({ db: 'physics.sqlite', kind: 'document' })).toBe(false)
    expect(isValidationScopeValid({
      db: 'physics.sqlite',
      kind: 'page_range',
      document_id: 'document-42',
      page_start: 9,
      page_end: 4,
    })).toBe(false)
    expect(isValidationScopeValid({
      db: 'physics.sqlite',
      kind: 'selection',
      document_id: 'document-42',
      page_numbers: [4, 9],
    })).toBe(true)
  })

  it('groups, deduplicates and sorts selected pages by document', () => {
    expect(validationTargetsFromPages([
      { document_id: 'document-b', page_number: 6 },
      { document_id: 'document-a', page_number: 9 },
      { document_id: 'document-a', page_number: 2 },
      { document_id: 'document-a', page_number: 9 },
    ], 'toc-7')).toEqual([
      {
        document_id: 'document-b',
        toc_id: 'toc-7',
        pages: [6],
        page_start: 6,
        page_end: 6,
        total_pages: 1,
      },
      {
        document_id: 'document-a',
        toc_id: 'toc-7',
        pages: [2, 9],
        page_start: 2,
        page_end: 9,
        total_pages: 2,
      },
    ])
  })
})

describe('validation deep links', () => {
  it('reads a browser URL and falls back to the active database', () => {
    window.history.replaceState(null, '', '/automation?tab=validation&run=run-17&page=6&doc=document-42')
    expect(readValidationDeepLink(new URLSearchParams(window.location.search), 'physics.sqlite')).toEqual({
      db: 'physics.sqlite',
      runId: 'run-17',
      pageNumber: 6,
      documentId: 'document-42',
    })
  })

  it('updates validation coordinates while preserving unrelated parameters', () => {
    const next = updateValidationDeepLink(
      new URLSearchParams('tab=monitoring&density=compact'),
      'run-18',
      11,
      'document-7',
      'chemistry.sqlite',
    )
    expect(next.toString()).toBe('tab=validation&density=compact&db=chemistry.sqlite&run=run-18&page=11&doc=document-7')
  })

  it('clears stale run coordinates and rejects invalid page numbers', () => {
    const cleared = updateValidationDeepLink(
      new URLSearchParams('db=physics.sqlite&run=old&page=3&doc=old-document'),
      null,
    )
    expect(cleared.get('run')).toBeNull()
    expect(cleared.get('page')).toBeNull()
    expect(cleared.get('doc')).toBeNull()
    expect(readValidationDeepLink(new URLSearchParams('page=-2'), null).pageNumber).toBeNull()
  })
})

describe('validation terminal states and progress', () => {
  it('recognizes only final run states as terminal', () => {
    const statuses: ValidationRunStatus[] = ['DRAFT', 'CREATED', 'QUEUED', 'RUNNING', 'COMPLETED', 'BLOCKED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'FAILED']
    expect(statuses.filter(isValidationRunTerminal)).toEqual(['BLOCKED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'FAILED'])
  })

  it('computes progress from terminal page states', () => {
    const pages = [
      { document_id: 'document-42', page_number: 1, status: 'READY' as const, updated_at: '2026-01-01T00:00:00Z' },
      { document_id: 'document-42', page_number: 2, status: 'PROCESSING' as const, updated_at: '2026-01-01T00:00:00Z' },
      { document_id: 'document-42', page_number: 3, status: 'FAILED' as const, updated_at: '2026-01-01T00:00:00Z' },
      { document_id: 'document-42', page_number: 4, status: 'PENDING' as const, updated_at: '2026-01-01T00:00:00Z' },
    ]
    expect(validationRunProgress({ status: 'RUNNING', pages })).toBe(50)
    expect(validationRunProgress({ status: 'CANCELLED', pages })).toBe(100)
    expect(validationPageStatusCounts(pages)).toEqual({ READY: 1, PROCESSING: 1, FAILED: 1, PENDING: 1 })
  })
})
