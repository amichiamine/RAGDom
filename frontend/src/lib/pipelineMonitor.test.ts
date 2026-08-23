import { describe, expect, it } from 'vitest'
import {
  eventBelongsToActiveBatch,
  freshRunCounters,
  isCompletionStatus,
  pageCompletionKey,
  recordPageCompletion,
  sseConnectionState,
} from './pipelineMonitor'
import type { PipelineSSEEvent } from '@/types'

const readStateEvent = (type: PipelineSSEEvent['type'], overrides: Partial<PipelineSSEEvent> = {}): PipelineSSEEvent =>
  ({ type, ...overrides })

describe('sseConnectionState', () => {
  it('maps OPEN → connected', () => expect(sseConnectionState(1)).toBe('connected'))
  it('maps CONNECTING → reconnecting', () => expect(sseConnectionState(0)).toBe('reconnecting'))
  it('maps CLOSED/undefined → disconnected', () => {
    expect(sseConnectionState(2)).toBe('disconnected')
    expect(sseConnectionState(undefined)).toBe('disconnected')
  })
})

describe('isCompletionStatus', () => {
  it('recognizes READY and INDEXED only', () => {
    expect(isCompletionStatus('READY')).toBe(true)
    expect(isCompletionStatus('INDEXED')).toBe(true)
    expect(isCompletionStatus('PROCESSING_CV')).toBe(false)
    expect(isCompletionStatus(undefined)).toBe(false)
  })
})

describe('pageCompletionKey + recordPageCompletion', () => {
  it('dedupes the same page across READY → INDEXED', () => {
    const seen = new Set<string>()
    const ready = readStateEvent('page_update', { batch_id: 'b1', job_id: 'j1', page_number: 3, status: 'READY' })
    const indexed = readStateEvent('page_update', { batch_id: 'b1', job_id: 'j1', page_number: 3, status: 'INDEXED' })
    expect(recordPageCompletion(seen, ready)).toBe(true)
    expect(recordPageCompletion(seen, indexed)).toBe(false)
  })

  it('re-emissitiion of the same completion is deduped', () => {
    const seen = new Set<string>()
    const e = readStateEvent('page_update', { batch_id: 'b1', job_id: 'j1', page_number: 3, status: 'READY' })
    expect(recordPageCompletion(seen, e)).toBe(true)
    expect(recordPageCompletion(seen, e)).toBe(false)
  })

  it('does not dedupe across distinct pages', () => {
    const seen = new Set<string>()
    expect(recordPageCompletion(seen, readStateEvent('page_update', { batch_id: 'b1', page_number: 1, status: 'READY' }))).toBe(true)
    expect(recordPageCompletion(seen, readStateEvent('page_update', { batch_id: 'b1', page_number: 2, status: 'READY' }))).toBe(true)
  })

  it('returns false for non-completion events', () => {
    expect(pageCompletionKey(readStateEvent('queue_update', { queue_length: 3 }))).toBeNull()
    expect(recordPageCompletion(new Set(), readStateEvent('error', { error: 'x' }))).toBe(false)
  })
})

describe('eventBelongsToActiveBatch', () => {
  const ev = (batch_id?: string) => readStateEvent('page_update', { batch_id, status: 'READY', page_number: 1 })
  it('accepts everything when no batch is tracked', () => {
    expect(eventBelongsToActiveBatch(ev(), new Set())).toBe(true)
    expect(eventBelongsToActiveBatch(ev('b1'), new Set())).toBe(true)
  })
  it('filters to tracked batches', () => {
    const active = new Set(['b1', 'b2'])
    expect(eventBelongsToActiveBatch(ev('b1'), active)).toBe(true)
    expect(eventBelongsToActiveBatch(ev('b9'), active)).toBe(false)
    expect(eventBelongsToActiveBatch(ev(), active)).toBe(false)
  })
})

describe('freshRunCounters', () => {
  it('resets all counters for a new launch', () => {
    expect(freshRunCounters()).toEqual({
      pagesDone: 0, pagesTotal: 0, lines: [], latencies: [], currentStatus: null, running: true,
    })
  })
})
