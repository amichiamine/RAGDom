import { useCallback, useEffect, useState } from 'react'
import { Eye, Play, ShieldCheck, GitBranch } from 'lucide-react'
import { api } from '@/lib/api'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import ScopeSelector from './ScopeSelector'
import { isValidationScopeValid } from '@/lib/validation'
import type { DatabaseInfo, ValidationPreview, ValidationRun, ValidationScope } from '@/types'

interface Props {
  databases: DatabaseInfo[]
  activeDb: string | null
  readonly: boolean
  onRunCreated: (run: ValidationRun) => void
}

export default function ValidationRunBuilder({ databases, activeDb, readonly, onRunCreated }: Props) {
  const { t } = useLanguage()
  const toast = useToast()
  const [scope, setScope] = useState<ValidationScope>({ db: activeDb ?? '', kind: 'database' })
  const [preview, setPreview] = useState<ValidationPreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'run' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (activeDb && !scope.db) setScope({ db: activeDb, kind: 'database' })
  }, [activeDb, scope.db])

  const invalidatePreview = useCallback((next: ValidationScope) => {
    setScope(next)
    setPreview(null)
  }, [])

  const valid = isValidationScopeValid(scope)

  const loadPreview = async () => {
    if (!valid || readonly) return
    setBusy('preview')
    setError(null)
    try {
      setPreview(await api.validation.preview({ scope }))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('common.error_generic')
      setError(message)
      toast.error(message)
    } finally { setBusy(null) }
  }

  const launch = async () => {
    if (!preview?.runnable || readonly) return
    setBusy('run')
    setError(null)
    try {
      const created = await api.validation.createRun({ scope })
      const run = await api.validation.getRun(created.id, scope.db)
      toast.success(t('validation.builder.started'))
      onRunCreated(run)
      setPreview(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('common.error_generic')
      setError(message)
      toast.error(message)
    } finally { setBusy(null) }
  }

  return (
    <section className="auto-card validation-builder" aria-labelledby="validation-builder-title">
      <div className="validation-section-heading">
        <div>
          <h3 id="validation-builder-title"><ShieldCheck size={20} /> {t('validation.builder.title')}</h3>
          <p>{t('validation.builder.hint')}</p>
        </div>
        {readonly && <span className="badge badge-warning" role="status">{t('validation.readonly')}</span>}
      </div>

      <ScopeSelector databases={databases} activeDb={activeDb} value={scope} onChange={invalidatePreview} disabled={busy !== null} />

      <fieldset className="validation-fieldset" disabled>
        <legend>{t('validation.builder.options')}</legend>
        <div className="validation-options">
          <label className="validation-check">
            <input type="checkbox" checked readOnly />
            <GitBranch size={16} />
            <span><strong>{t('validation.builder.working_copy')}</strong><small>{t('validation.builder.working_copy_hint')}</small></span>
          </label>
        </div>
      </fieldset>

      {error && <p className="validation-inline-error" role="alert">{error}</p>}
      {preview && (
        <div className={`validation-preview ${preview.runnable ? '' : 'is-blocked'}`} role="status" aria-live="polite">
          <h4>{t('validation.builder.preview_summary')}</h4>
          <div className="validation-kpis">
            <PreviewMetric label={t('validation.metrics.pages')} value={preview.scope.page_count} />
            <PreviewMetric label={t('validation.metrics.targets')} value={preview.scope.targets.length} />
          </div>
        </div>
      )}

      <div className="validation-actions">
        <button className="btn btn-outline-primary" onClick={loadPreview} disabled={!valid || readonly || busy !== null}>
          <Eye size={16} /> {busy === 'preview' ? t('common.loading') : t('validation.builder.preview')}
        </button>
        <button className="btn btn-primary" onClick={launch} disabled={!preview?.runnable || readonly || busy !== null} title={!preview ? t('validation.builder.preview_required') : undefined}>
          <Play size={16} /> {busy === 'run' ? t('common.loading') : t('validation.builder.launch')}
        </button>
      </div>
    </section>
  )
}

function PreviewMetric({ label, value }: { label: string; value: number | null }) {
  return <div><span className="font-num">{value ?? '—'}</span><small>{label}</small></div>
}
