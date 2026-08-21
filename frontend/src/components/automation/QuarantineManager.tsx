import { useEffect, useState, Fragment } from 'react'
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

  const load = () => {
    setLoading(true); setError(null)
    api.pipeline.getQuarantine(db)
      .then(res => { setJobs(res.jobs); onCount(res.jobs.length) })
      .catch(e => setError(e instanceof Error ? e.message : t('common.error_generic')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (db) load() }, [db]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
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
                <th></th><th>{t('quarantine.page')}</th><th>{t('quarantine.document')}</th>
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
                        <input type="checkbox" disabled={notRetryable} checked={selected.has(j.id)} onChange={() => toggle(j.id)}
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
    </div>
  )
}
