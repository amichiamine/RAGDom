import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Ban, Check, RotateCcw, X, RefreshCw, Wifi, WifiOff, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import ValidationInspector from './ValidationInspector'
import ValidationDiffView from './ValidationDiffView'
import type { ValidationDecisionKind, ValidationEvent, ValidationPage, ValidationRun, ValidationRunSummary } from '@/types'

interface Props {
  activeDb: string | null
  readonly: boolean
  createdRun?: ValidationRun | null
}

const DECIDABLE = new Set(['READY', 'COMPLETED'])
const PAGE_SIZE = 20

export default function ValidationRunsPanel({ activeDb, readonly, createdRun }: Props) {
  const { t } = useLanguage()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [runs, setRuns] = useState<ValidationRunSummary[]>([])
  const [run, setRun] = useState<ValidationRun | null>(null)
  const [selectedPage, setSelectedPage] = useState<ValidationPage | null>(null)
  const [listPage, setListPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [streamConnected, setStreamConnected] = useState(false)
  const [pollFallback, setPollFallback] = useState(false)
  const cursorRef = useRef<string | undefined>(undefined)

  const runId = searchParams.get('run')
  const pageParam = Number(searchParams.get('page')) || null
  const documentParam = searchParams.get('doc')

  const updateDeepLink = useCallback((nextRunId: string | null, pageNumber?: number | null, documentId?: string | null) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      if (nextRunId) next.set('run', nextRunId); else next.delete('run')
      if (pageNumber != null) next.set('page', String(pageNumber)); else next.delete('page')
      if (documentId) next.set('doc', documentId); else next.delete('doc')
      return next
    }, { replace: true })
  }, [setSearchParams])

  const loadRuns = useCallback((silent = false) => {
    if (!activeDb) { setRuns([]); return Promise.resolve() }
    if (!silent) setLoading(true)
    return api.validation.listRuns(activeDb, listPage, PAGE_SIZE)
      .then(response => { setRuns(response.data ?? []); setTotalPages(response.pagination?.total_pages ?? 1) })
      .catch(error => { if (!silent) toast.error(error instanceof Error ? error.message : t('common.error_generic')) })
      .finally(() => { if (!silent) setLoading(false) })
  }, [activeDb, listPage, t, toast])

  const loadRun = useCallback((id: string, silent = false) => {
    if (!silent) setLoading(true)
    return api.validation.getRun(id, activeDb ?? undefined)
      .then(result => {
        setRun(result)
        if (pageParam != null) {
          const embedded = result.pages?.find(page => page.page_number === pageParam && (!documentParam || page.document_id === documentParam))
          if (embedded) setSelectedPage(embedded)
        }
        return result
      })
      .catch(error => { if (!silent) toast.error(error instanceof Error ? error.message : t('common.error_generic')); return null })
      .finally(() => { if (!silent) setLoading(false) })
  }, [activeDb, documentParam, pageParam, t, toast])

  const selectPage = useCallback((pageNumber: number, documentId?: string) => {
    if (!runId) return
    updateDeepLink(runId, pageNumber, documentId ?? null)
    const embedded = run?.pages?.find(page => page.page_number === pageNumber && (!documentId || page.document_id === documentId))
    if (embedded?.inspection && embedded.diff) { setSelectedPage(embedded); return }
    api.validation.getPage(runId, pageNumber, activeDb ?? undefined, documentId)
      .then(setSelectedPage)
      .catch(error => toast.error(error instanceof Error ? error.message : t('common.error_generic')))
  }, [activeDb, run, runId, t, toast, updateDeepLink])

  useEffect(() => { void loadRuns() }, [loadRuns])
  useEffect(() => {
    const timer = window.setInterval(() => { void loadRuns(true) }, 10_000)
    return () => window.clearInterval(timer)
  }, [loadRuns])

  useEffect(() => {
    if (createdRun) {
      setRun(createdRun)
      updateDeepLink(createdRun.id, createdRun.pages?.[0]?.page_number ?? null)
      void loadRuns(true)
    }
  }, [createdRun, loadRuns, updateDeepLink])

  useEffect(() => {
    if (!runId) { setRun(null); setSelectedPage(null); return }
    void loadRun(runId)
  }, [loadRun, runId])

  useEffect(() => {
    if (!runId) return
    const source = api.validation.createStream(runId, activeDb ?? undefined, cursorRef.current)
    setStreamConnected(false)
    setPollFallback(false)
    const onEvent = (message: MessageEvent) => {
      let event: ValidationEvent
      try { event = JSON.parse(message.data) as ValidationEvent } catch { return }
      if (event.run_id !== runId) return
      cursorRef.current = event.id ?? message.lastEventId ?? cursorRef.current
      if (event.run) setRun(event.run)
      else void loadRun(runId, true)
      if (event.page && event.page.page_number === pageParam) setSelectedPage(event.page)
      if (event.type === 'completed' || event.type === 'cancelled') void loadRuns(true)
    }
    const names: ValidationEvent['type'][] = ['run_update', 'page_update', 'inspection_update', 'diff_ready', 'decision', 'completed', 'cancelled', 'error', 'heartbeat']
    source.addEventListener('open', () => { setStreamConnected(true); setPollFallback(false) })
    source.addEventListener('message', onEvent)
    names.forEach(name => source.addEventListener(name, onEvent))
    source.onerror = () => { setStreamConnected(false); setPollFallback(true) }
    return () => {
      source.removeEventListener('message', onEvent)
      names.forEach(name => source.removeEventListener(name, onEvent))
      source.close()
    }
  }, [activeDb, loadRun, loadRuns, pageParam, runId])

  useEffect(() => {
    if (!pollFallback || !runId) return
    const timer = window.setInterval(() => { void loadRun(runId, true) }, 3_000)
    return () => window.clearInterval(timer)
  }, [loadRun, pollFallback, runId])

  useEffect(() => {
    if (runId && pageParam != null) selectPage(pageParam, documentParam ?? undefined)
  }, [documentParam, pageParam, runId]) // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async () => {
    if (!run || readonly) return
    setMutating(true)
    try {
      await api.validation.cancelRun(run.id, run.scope.db)
      toast.success(t('validation.runs.cancelled'))
      await loadRun(run.id, true)
    } catch (error) { toast.error(error instanceof Error ? error.message : t('common.error_generic')) }
    finally { setMutating(false) }
  }

  const decide = async (decision: ValidationDecisionKind, target: 'run' | 'page') => {
    if (!run || readonly) return
    setMutating(true)
    try {
      await api.validation.decide(run.id, run.scope.db, { decision, ...(target === 'page' && selectedPage ? { page_number: selectedPage.page_number } : {}) })
      toast.success(t(`validation.decisions.${decision}_done`))
      await loadRun(run.id, true)
      if (target === 'page' && selectedPage) selectPage(selectedPage.page_number, selectedPage.document_id)
    } catch (error) { toast.error(error instanceof Error ? error.message : t('common.error_generic')) }
    finally { setMutating(false) }
  }

  return (
    <section className="validation-runs-layout" aria-label={t('validation.runs.title')}>
      <aside className="auto-card validation-run-list">
        <div className="validation-section-heading">
          <div><h3>{t('validation.runs.title')}</h3><p>{t('validation.runs.hint')}</p></div>
          <button className="btn btn-sm btn-outline-secondary" onClick={() => void loadRuns()} disabled={loading} aria-label={t('validation.runs.refresh')}><RefreshCw size={14} /></button>
        </div>
        {loading && runs.length === 0 ? <p>{t('common.loading')}</p> : runs.length === 0 ? <p className="validation-empty">{t('validation.runs.empty')}</p> : (
          <div className="validation-run-items">{runs.map(item => (
            <button key={item.id} className={item.id === runId ? 'active' : ''} onClick={() => updateDeepLink(item.id, null)}>
              <span><strong>{item.scope.document_title ?? item.scope.database_label ?? item.scope.db}</strong><small>{new Date(item.created_at).toLocaleString()}</small></span>
              <span><StatusBadge status={item.status} /><small className="font-num">{Math.round(item.progress)}%</small></span>
            </button>
          ))}</div>
        )}
        {totalPages > 1 && <div className="validation-pagination"><button className="btn btn-sm btn-outline-secondary" disabled={listPage <= 1} onClick={() => setListPage(p => p - 1)}><ChevronLeft size={14} /></button><span>{listPage}/{totalPages}</span><button className="btn btn-sm btn-outline-secondary" disabled={listPage >= totalPages} onClick={() => setListPage(p => p + 1)}><ChevronRight size={14} /></button></div>}
      </aside>

      <div className="auto-card validation-run-detail">
        {!run ? <p className="validation-empty">{t('validation.runs.select')}</p> : (
          <>
            <header className="validation-run-header">
              <div><div className="validation-run-title"><h3>{run.scope.document_title ?? run.scope.db}</h3><StatusBadge status={run.status} /></div><code dir="ltr">{run.id}</code></div>
              <div className="validation-actions">
                <span className={`badge ${streamConnected ? 'badge-success' : 'badge-warning'}`}>{streamConnected ? <Wifi size={12} /> : <WifiOff size={12} />}{streamConnected ? 'SSE' : t('validation.runs.polling')}</span>
                {['QUEUED', 'RUNNING'].includes(run.status) && <button className="btn btn-sm btn-outline-danger" onClick={cancel} disabled={readonly || mutating}><Ban size={14} /> {t('buttons.cancel')}</button>}
              </div>
            </header>
            <div className="validation-progress" aria-label={`${run.progress}%`}><span style={{ width: `${Math.min(100, Math.max(0, run.progress))}%` }} /></div>
            <div className="validation-run-summary"><span>{run.pages_completed}/{run.pages_total} {t('validation.metrics.pages')}</span><span>{run.pages_failed} {t('status.error')}</span><span>{run.options.working_copy ? t('validation.builder.working_copy') : t('validation.runs.direct')}</span></div>

            <div className="validation-page-strip" aria-label={t('validation.runs.pages')}>{run.pages?.map(page => <button key={`${page.document_id}-${page.page_number}`} className={page.page_number === pageParam && (!documentParam || page.document_id === documentParam) ? 'active' : ''} onClick={() => selectPage(page.page_number, page.document_id)} title={page.document_id}><span>{page.page_number}</span><StatusDot status={page.status} /></button>)}</div>

            {selectedPage && (
              <>
                <div className="validation-page-heading"><h4>{t('library.page')} {selectedPage.page_number}</h4><StatusBadge status={selectedPage.status} /></div>
                <div className="validation-decision-bar" aria-label={t('validation.decisions.title')}>
                  <button className="btn btn-sm btn-success" onClick={() => decide('accept', 'page')} disabled={readonly || mutating}><Check size={14} /> {t('validation.decisions.accept_page')}</button>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => decide('reject', 'page')} disabled={readonly || mutating}><X size={14} /> {t('validation.decisions.reject_page')}</button>
                  <button className="btn btn-sm btn-outline-warning" onClick={() => decide('restore', 'page')} disabled={readonly || mutating}><RotateCcw size={14} /> {t('validation.decisions.restore_page')}</button>
                </div>
                <ValidationDiffView diff={selectedPage.diff ?? run.diff} db={run.scope.db} />
                <ValidationInspector inspection={selectedPage.inspection} db={run.scope.db} documentId={selectedPage.document_id ?? run.scope.document_id} pageNumber={selectedPage.page_number} />
              </>
            )}

            {DECIDABLE.has(run.status) && (
              <div className="validation-decision-bar validation-run-decisions">
                <strong>{t('validation.decisions.run_title')}</strong>
                <button className="btn btn-sm btn-success" onClick={() => decide('accept', 'run')} disabled={readonly || mutating}><Check size={14} /> {t('validation.decisions.accept_run')}</button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => decide('reject', 'run')} disabled={readonly || mutating}><X size={14} /> {t('validation.decisions.reject_run')}</button>
                <button className="btn btn-sm btn-outline-warning" onClick={() => decide('restore', 'run')} disabled={readonly || mutating}><RotateCcw size={14} /> {t('validation.decisions.restore_run')}</button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function StatusBadge({ status }: { status: string }) {
  const klass = status === 'COMPLETED' ? 'badge-success' : status === 'FAILED' || status === 'CANCELLED' ? 'badge-danger' : status === 'RUNNING' ? 'badge-info' : 'badge-subtle'
  return <span className={`badge ${klass}`}>{status}</span>
}
function StatusDot({ status }: { status: string }) { return <i className={`validation-status-dot is-${status.toLowerCase()}`} title={status} /> }
