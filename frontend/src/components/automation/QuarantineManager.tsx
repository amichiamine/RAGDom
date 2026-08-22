import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { api } from '@/lib/api'
import type { QuarantineJob } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import { Spinner, ErrorBanner, EmptyState } from '@/components/common/Feedback'
import { formatDate } from '@/lib/utils'

interface Props {
  db: string
  onCount: (n: number) => void
}

/** §7.5 QuarantineManager — liste + retry (INVALID_SOURCE grisés). */
export default function QuarantineManager({ db, onCount }: Props) {
  const { t } = useLanguage()
  const toast = useToast()
  const [jobs, setJobs] = useState<QuarantineJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  // Ancre de la dernière ligne cochée pour la sélection de plage par Maj+clic (§8.2.3).
  const lastClickedRef = useRef<string | null>(null)

  const load = () => {
    setLoading(true); setError(null)
    api.pipeline.getQuarantine(db)
      .then(res => { setJobs(res.jobs); onCount(res.jobs.length); setSelected(new Set()); lastClickedRef.current = null })
      .catch(e => setError(e instanceof Error ? e.message : t('common.error_generic')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (db) load() }, [db]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lignes retryables uniquement (INVALID_SOURCE exclu du lot et du « tout sélectionner »).
  const retryableIds = useMemo(() => jobs.filter(j => j.status === 'QUARANTINE').map(j => j.id), [jobs])
  const allSelected = retryableIds.length > 0 && retryableIds.every(id => selected.has(id))

  // Case par ligne + Maj+clic : coche toute la plage entre l'ancre et la ligne cliquée.
  const toggle = (id: string, shiftKey = false) => {
    if (jobs.find(j => j.id === id)?.status !== 'QUARANTINE') return
    setSelected(prev => {
      const next = new Set(prev)
      if (shiftKey && lastClickedRef.current) {
        const order = jobs.map(j => j.id)
        const a = order.indexOf(lastClickedRef.current)
        const b = order.indexOf(id)
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          for (let i = lo; i <= hi; i++) {
            const jid = order[i]
            if (jobs.find(j => j.id === jid)?.status === 'QUARANTINE') next.add(jid)
          }
          return next
        }
      }
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    lastClickedRef.current = id
  }

  const toggleAll = () => {
    setSelected(prev => (retryableIds.every(id => prev.has(id)) ? new Set() : new Set(retryableIds)))
    lastClickedRef.current = null
  }

  const toggleExpand = (id: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const retry = async () => {
    const ids = [...selected].filter(id => jobs.find(j => j.id === id)?.status === 'QUARANTINE')
    if (ids.length === 0) return
    setBusy(true)
    try {
      await api.pipeline.retry(db, ids)
      toast.success(t('quarantine.retry_selected'))
      setSelected(new Set())
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
    finally { setBusy(false) }
  }

  return (
    <div className="auto-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}><i className="fa-solid fa-triangle-exclamation" /> {t('sections.quarantine')}</h3>
        <button className="btn btn-sm btn-outline-primary" onClick={retry} disabled={busy || selected.size === 0}>
          <i className="fa-solid fa-rotate-right" /> {t('quarantine.retry_selected')}
        </button>
      </div>

      {loading ? <Spinner /> : error ? <ErrorBanner message={error} onRetry={load} /> : jobs.length === 0 ? (
        <EmptyState icon="fa-shield-halved" title={t('quarantine.empty')} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" aria-label={t('quarantine.select_all')}
                    disabled={retryableIds.length === 0}
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && !allSelected }}
                    onChange={toggleAll} title={t('quarantine.select_all')} />
                </th>
                <th>{t('quarantine.page')}</th><th>{t('quarantine.document')}</th>
                <th>{t('quarantine.status')}</th><th>{t('quarantine.retries')}</th><th>{t('quarantine.date')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => {
                const notRetryable = j.status === 'INVALID_SOURCE'
                return (
                  <Fragment key={j.id}>
                    <tr style={notRetryable ? { opacity: 0.55 } : undefined}>
                      <td>
                        <input type="checkbox" disabled={notRetryable} checked={selected.has(j.id)}
                          onClick={e => toggle(j.id, (e as unknown as { shiftKey: boolean }).shiftKey)}
                          onChange={() => { /* sélection pilotée par onClick (support Maj+clic) */ }}
                          title={notRetryable ? t('quarantine.not_retryable') : ''} />
                      </td>
                      <td className="font-num">{j.page_number}</td>
                      <td dir="auto" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.document_id}</td>
                      <td><span className={`badge ${notRetryable ? 'badge-secondary' : 'badge-danger'}`}>{j.status}</span></td>
                      <td className="font-num">{j.retry_count}</td>
                      <td>{formatDate(j.updated_at)}</td>
                      <td>
                        {j.error_log && (
                          <button className="btn btn-sm btn-outline-secondary" onClick={() => toggleExpand(j.id)}>
                            <i className={`fa-solid ${expanded.has(j.id) ? 'fa-chevron-up' : 'fa-chevron-down'}`} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded.has(j.id) && j.error_log && (
                      <tr>
                        <td colSpan={7}>
                          <pre className="code-block">{j.error_log}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Barre d'actions flottante (§8.2.3) — apparaît dès qu'une ligne est sélectionnée. */}
      {selected.size > 0 && (
        <div className="bulk-action-bar" role="region" aria-label={t('quarantine.retry_selected')}>
          <div className="bulk-action-bar__inner">
            <span className="bulk-action-bar__count">
              {t('quarantine.n_selected').replace('{n}', String(selected.size))}
            </span>
            <button className="btn btn-sm btn-primary" onClick={retry} disabled={busy}>
              <i className="fa-solid fa-rotate-right" /> {t('quarantine.retry_selected')}
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setSelected(new Set())} disabled={busy}>
              {t('quarantine.clear_selection')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
