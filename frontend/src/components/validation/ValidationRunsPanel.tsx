import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Ban, Check, RotateCcw, X, RefreshCw, Timer, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { isValidationRunTerminal, readValidationDeepLink, updateValidationDeepLink } from '@/lib/validation'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import ValidationInspector from './ValidationInspector'
import ValidationDiffView from './ValidationDiffView'
import Modal from '@/components/common/Modal'
import type { ValidationPage, ValidationRun, ValidationRunSummary } from '@/types'

interface Props {
  activeDb: string | null
  readonly: boolean
  createdRun?: ValidationRun | null
}

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
  const [confirmAcceptOpen, setConfirmAcceptOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { db: validationDb, runId, pageNumber: pageParam, documentId: documentParam } = readValidationDeepLink(searchParams, activeDb)

  const updateDeepLink = useCallback((nextRunId: string | null, pageNumber?: number | null, documentId?: string | null, db?: string | null) => {
    setSearchParams(
      previous => updateValidationDeepLink(previous, nextRunId, pageNumber, documentId, db),
      { replace: true },
    )
  }, [setSearchParams])

  const showError = useCallback((cause: unknown, notify = true) => {
    const message = cause instanceof Error ? cause.message : t('common.error_generic')
    setError(message)
    if (notify) toast.error(message)
  }, [t, toast])

  const loadRuns = useCallback(async (silent = false) => {
    if (!validationDb || readonly) { setRuns([]); setTotalPages(1); return }
    if (!silent) setLoading(true)
    try {
      const response = await api.validation.listRuns(validationDb, listPage, PAGE_SIZE)
      setRuns(response.data)
      setTotalPages(response.pagination.total_pages)
      setError(null)
    } catch (cause) {
      showError(cause, !silent)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [listPage, readonly, showError, validationDb])

  const loadRun = useCallback(async (id: string, silent = false) => {
    if (!validationDb || readonly) return null
    if (!silent) setLoading(true)
    try {
      const result = await api.validation.getRun(id, validationDb)
      setRun(result)
      setError(null)
      return result
    } catch (cause) {
      showError(cause, !silent)
      return null
    } finally {
      if (!silent) setLoading(false)
    }
  }, [readonly, showError, validationDb])

  const selectPage = useCallback(async (pageNumber: number, documentId?: string) => {
    if (!runId || !validationDb || readonly) return
    updateDeepLink(runId, pageNumber, documentId ?? null, validationDb)
    try {
      setSelectedPage(await api.validation.getPage(runId, pageNumber, validationDb, documentId))
      setError(null)
    } catch (cause) { showError(cause) }
  }, [readonly, runId, showError, updateDeepLink, validationDb])

  useEffect(() => { setListPage(1) }, [validationDb])
  useEffect(() => { void loadRuns() }, [loadRuns])

  useEffect(() => {
    if (!createdRun) return
    setRun(createdRun)
    const first = createdRun.pages[0]
    updateDeepLink(createdRun.id, first?.page_number ?? null, first?.document_id ?? null, createdRun.scope.db)
    void loadRuns(true)
  }, [createdRun, loadRuns, updateDeepLink])

  useEffect(() => {
    if (!runId) { setRun(null); setSelectedPage(null); return }
    void loadRun(runId)
  }, [loadRun, runId])

  // routes_validation.py n'expose pas de flux SSE. Le repli contractuel interroge
  // uniquement le run profond lié par l'URL, sans recompter les événements globaux.
  useEffect(() => {
    if (!runId || (run && isValidationRunTerminal(run.status))) return
    const timer = window.setInterval(() => { void loadRun(runId, true) }, 5000)
    return () => window.clearInterval(timer)
  }, [loadRun, run, runId])

  useEffect(() => {
    if (!runId || pageParam == null || !validationDb) { setSelectedPage(null); return }
    void selectPage(pageParam, documentParam ?? undefined)
  }, [documentParam, pageParam, runId, run?.status, selectPage, validationDb])

  const refresh = async () => {
    await Promise.all([loadRuns(), runId ? loadRun(runId, true) : Promise.resolve(null)])
    if (pageParam != null) await selectPage(pageParam, documentParam ?? undefined)
  }

  const mutate = async (action: 'accept' | 'reject' | 'restore' | 'cancel', target: 'run' | 'page' = 'run') => {
    if (!run || readonly || mutating) return
    setMutating(true)
    setError(null)
    try {
      if (action === 'accept') {
        await api.validation.acceptRun(run.id, run.scope.db)
        setConfirmAcceptOpen(false)
      } else if (action === 'reject') await api.validation.rejectRun(run.id, run.scope.db)
      else if (action === 'cancel') await api.validation.cancelRun(run.id, run.scope.db)
      else if (target === 'page' && selectedPage) {
        await api.validation.restorePage(run.id, selectedPage.page_number, run.scope.db, selectedPage.document_id)
      } else await api.validation.restoreRun(run)
      toast.success(t(`validation.decisions.${action}_done`))
      await loadRun(run.id, true)
      await loadRuns(true)
      if (target === 'page' && selectedPage) await selectPage(selectedPage.page_number, selectedPage.document_id)
    } catch (cause) { showError(cause) }
    finally { setMutating(false) }
  }

  return (
    <section className="validation-runs-layout" aria-label={t('validation.runs.title')}>
      <aside className="auto-card validation-run-list">
        <div className="validation-section-heading">
          <div><h3>{t('validation.runs.title')}</h3><p>{t('validation.runs.hint')}</p></div>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void refresh()} disabled={loading} aria-label={t('validation.runs.refresh')}><RefreshCw size={14} /></button>
        </div>
        {readonly ? <p className="validation-empty" role="status">{t('validation.readonly')}</p> : loading && runs.length === 0 ? <p>{t('common.loading')}</p> : runs.length === 0 ? <p className="validation-empty">{t('validation.runs.empty')}</p> : (
          <div className="validation-run-items">{runs.map(item => (
            <button type="button" key={item.id} className={item.id === runId ? 'active' : ''} aria-current={item.id === runId ? 'true' : undefined} onClick={() => updateDeepLink(item.id, null, null, item.scope.db)}>
              <span><strong>{item.label ?? item.scope.db}</strong><small>{new Date(item.created_at).toLocaleString()}</small></span>
              <span><StatusBadge status={item.status} /><small className="font-num">{item.pages_total} {t('validation.metrics.pages')}</small></span>
            </button>
          ))}</div>
        )}
        {totalPages > 1 && <nav className="validation-pagination" aria-label={t('validation.runs.pagination')}><button type="button" className="btn btn-sm btn-outline-secondary" aria-label={t('library.prev_page')} disabled={listPage <= 1} onClick={() => setListPage(page => page - 1)}><ChevronLeft size={14} /></button><span>{listPage}/{totalPages}</span><button type="button" className="btn btn-sm btn-outline-secondary" aria-label={t('library.next_page')} disabled={listPage >= totalPages} onClick={() => setListPage(page => page + 1)}><ChevronRight size={14} /></button></nav>}
      </aside>

      <div className="auto-card validation-run-detail" aria-live="polite">
        {error && <p className="validation-inline-error" role="alert">{error}</p>}
        {!run ? <p className="validation-empty">{t('validation.runs.select')}</p> : (
          <>
            <header className="validation-run-header">
              <div><div className="validation-run-title"><h3>{run.label ?? run.scope.db}</h3><StatusBadge status={run.status} /></div><code dir="ltr">{run.id}</code></div>
              <div className="validation-actions">
                <span className="badge badge-subtle"><Timer size={12} />{t('validation.runs.polling')}</span>
                {!isValidationRunTerminal(run.status) && <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void mutate('cancel')} disabled={readonly || mutating}><Ban size={14} /> {t('buttons.cancel')}</button>}
                {(run.status === 'BLOCKED' || run.status === 'FAILED') && <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void mutate('reject')} disabled={readonly || mutating}><X size={14} /> {t('validation.decisions.reject_run')}</button>}
              </div>
            </header>
            <div className="validation-progress" role="progressbar" aria-label={t('validation.runs.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(run.progress)}><span style={{ width: `${Math.min(100, Math.max(0, run.progress))}%` }} /></div>
            <div className="validation-run-summary">
              <span>{run.pages_total} {t('validation.metrics.pages')}</span>
              <span>{run.operation}</span>
              {run.batch_id && <span><code dir="ltr">{run.batch_id.slice(0, 8)}</code></span>}
              {run.working_db_filename && <span title={run.working_db_filename}>{t('validation.builder.working_copy')} · {run.working_db_exists ? t('validation.runs.copy_available') : t('validation.runs.copy_removed')}</span>}
            </div>
            {run.error_log && <p className="validation-inline-error" role="alert">{run.status === 'BLOCKED' ? t('validation.runs.source_missing') : t('validation.runs.execution_failed')} — {run.error_log}</p>}

            <div className="validation-page-strip" aria-label={t('validation.runs.pages')}>{run.pages.map(page => <button type="button" key={`${page.document_id}-${page.page_number}`} className={page.page_number === pageParam && (!documentParam || page.document_id === documentParam) ? 'active' : ''} aria-pressed={page.page_number === pageParam && (!documentParam || page.document_id === documentParam)} onClick={() => void selectPage(page.page_number, page.document_id)} title={page.document_id}><span>{page.page_number}</span><StatusDot status={page.status} /></button>)}</div>

            {selectedPage && (
              <>
                <div className="validation-page-heading"><h4>{t('library.page')} {selectedPage.page_number}</h4><StatusBadge status={selectedPage.status} /></div>
                {run.status === 'COMPLETED' && <div className="validation-decision-bar" aria-label={t('validation.decisions.title')}>
                  <button type="button" className="btn btn-sm btn-outline-warning" onClick={() => void mutate('restore', 'page')} disabled={readonly || mutating}><RotateCcw size={14} /> {t('validation.decisions.restore_page')}</button>
                </div>}
                <ValidationDiffView diff={selectedPage.diff} db={run.scope.db} />
                <ValidationInspector inspection={selectedPage.inspection} db={run.scope.db} documentId={selectedPage.document_id} pageNumber={selectedPage.page_number} />
              </>
            )}

            {run.status === 'COMPLETED' && (
              <div className="validation-decision-bar validation-run-decisions">
                <strong>{t('validation.decisions.run_title')}</strong>
                {run.status === 'COMPLETED' && <button type="button" className="btn btn-sm btn-success" onClick={() => setConfirmAcceptOpen(true)} disabled={readonly || mutating}><Check size={14} /> {t('validation.decisions.accept_run')}</button>}
                {run.status === 'COMPLETED' && <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void mutate('reject')} disabled={readonly || mutating}><X size={14} /> {t('validation.decisions.reject_run')}</button>}
                {run.status === 'COMPLETED' && <button type="button" className="btn btn-sm btn-outline-warning" onClick={() => void mutate('restore')} disabled={readonly || mutating}><RotateCcw size={14} /> {t('validation.decisions.restore_run')}</button>}
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        open={confirmAcceptOpen && !!run}
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Check size={18} /> {t('validation.decisions.accept_confirm_title')}</span>}
        onClose={() => { if (!mutating) setConfirmAcceptOpen(false) }}
        footer={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setConfirmAcceptOpen(false)} disabled={mutating}>{t('buttons.cancel')}</button>
            <button type="button" className="btn btn-success" onClick={() => void mutate('accept')} disabled={mutating || readonly}>
              <Check size={15} /> {mutating ? t('common.loading') : t('validation.decisions.accept_confirm_action')}
            </button>
          </>
        }
      >
        {run && (
          <div>
            <p role="alert" style={{ fontWeight: 700, color: 'var(--warning)' }}>{t('validation.decisions.accept_confirm_warning')}</p>
            <dl className="validation-confirm-summary">
              <div><dt>{t('db.select')}</dt><dd dir="ltr">{run.scope.db}</dd></div>
              <div><dt>{t('validation.scope.title')}</dt><dd>{t(`validation.scope.${run.scope.kind}`)}</dd></div>
              <div><dt>{t('validation.metrics.pages')}</dt><dd className="font-num">{run.pages_total}</dd></div>
            </dl>
            <p>{t('validation.decisions.accept_confirm_detail')}</p>
            {run.scope.targets.length > 0 && (
              <ul className="validation-confirm-targets">
                {run.scope.targets.map(target => (
                  <li key={`${target.document_id}-${target.page_start}-${target.page_end}`}>
                    <code dir="ltr">{target.document_id}</code> — {t('library.page')} {target.pages.join(', ')}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </section>
  )
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage()
  const klass = status === 'ACCEPTED' || status === 'COMPLETED' ? 'badge-success' : status === 'REJECTED' || status === 'CANCELLED' || status === 'FAILED' || status === 'BLOCKED' ? 'badge-danger' : 'badge-info'
  return <span className={`badge ${klass}`}>{t(`validation.status.${status}`)}</span>
}
function StatusDot({ status }: { status: string }) {
  const { t } = useLanguage()
  const label = t(`validation.status.${status}`)
  return <i className={`validation-status-dot is-${status.toLowerCase()}`} title={label} aria-label={label} />
}
