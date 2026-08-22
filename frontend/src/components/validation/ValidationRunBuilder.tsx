import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, Play, ShieldCheck, GitBranch } from 'lucide-react'
import { api } from '@/lib/api'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import ScopeSelector from './ScopeSelector'
import type { DatabaseInfo, ValidationPreview, ValidationRun, ValidationScope } from '@/types'

interface Props {
  databases: DatabaseInfo[]
  activeDb: string | null
  readonly: boolean
  onRunCreated: (run: ValidationRun) => void
}

function isValidScope(scope: ValidationScope): boolean {
  if (!scope.db) return false
  if (scope.kind === 'database') return true
  if (!scope.document_id) return false
  if (['toc', 'chapter', 'course', 'title'].includes(scope.kind)) return Boolean(scope.toc_id)
  if (scope.kind === 'page') return Boolean(scope.page_start && scope.page_start > 0)
  if (scope.kind === 'page_range') return Boolean(scope.page_start && scope.page_end && scope.page_end >= scope.page_start)
  if (scope.kind === 'selection') return Boolean(scope.page_numbers?.length)
  return true
}

export default function ValidationRunBuilder({ databases, activeDb, readonly, onRunCreated }: Props) {
  const { t } = useLanguage()
  const toast = useToast()
  const [scope, setScope] = useState<ValidationScope>({ db: activeDb ?? '', kind: activeDb ? 'database' : 'database' })
  const workingCopy = true
  const [preserveHumanEdits, setPreserveHumanEdits] = useState(true)
  const [preview, setPreview] = useState<ValidationPreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'run' | null>(null)

  useEffect(() => {
    if (activeDb && !scope.db) setScope({ db: activeDb, kind: 'database' })
  }, [activeDb, scope.db])

  const invalidatePreview = useCallback((next: ValidationScope) => {
    setScope(next)
    setPreview(null)
  }, [])

  const options = useMemo(() => ({ working_copy: workingCopy, preserve_human_edits: preserveHumanEdits }), [workingCopy, preserveHumanEdits])
  const valid = isValidScope(scope)

  const loadPreview = async () => {
    if (!valid) return
    setBusy('preview')
    try {
      const result = await api.validation.preview({ scope, options })
      setPreview(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error_generic'))
    } finally { setBusy(null) }
  }

  const launch = async () => {
    if (!preview || !preview.runnable || readonly) return
    setBusy('run')
    try {
      const run = await api.validation.createRun({ preview_id: preview.preview_id, scope, options })
      toast.success(t('validation.builder.started'))
      onRunCreated(run)
      setPreview(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error_generic'))
    } finally { setBusy(null) }
  }

  const updatePreserve = (checked: boolean) => { setPreserveHumanEdits(checked); setPreview(null) }

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

      <fieldset className="validation-fieldset" disabled={busy !== null}>
        <legend>{t('validation.builder.options')}</legend>
        <div className="validation-options">
          <label className="validation-check">
            <input type="checkbox" checked={workingCopy} disabled readOnly />
            <GitBranch size={16} />
            <span><strong>{t('validation.builder.working_copy')}</strong><small>{t('validation.builder.working_copy_hint')}</small></span>
          </label>
          <label className="validation-check">
            <input type="checkbox" checked={preserveHumanEdits} onChange={e => updatePreserve(e.target.checked)} />
            <ShieldCheck size={16} />
            <span><strong>{t('validation.builder.preserve_human')}</strong><small>{t('validation.builder.preserve_human_hint')}</small></span>
          </label>
        </div>
      </fieldset>

      {preview && (
        <div className={`validation-preview ${preview.runnable ? '' : 'is-blocked'}`} role="status" aria-live="polite">
          <h4>{t('validation.builder.preview_summary')}</h4>
          <p>{preview.summary}</p>
          <div className="validation-kpis">
            <PreviewMetric label={t('validation.metrics.pages')} value={preview.impact.pages} />
            <PreviewMetric label={t('validation.metrics.chunks')} value={preview.impact.chunks} />
            <PreviewMetric label={t('validation.metrics.artifacts')} value={preview.impact.artifacts} />
            <PreviewMetric label={t('validation.metrics.human_preserved')} value={preview.impact.human_edits_preserved} />
          </div>
          {preview.warnings.length > 0 && <ul>{preview.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>}
        </div>
      )}

      <div className="validation-actions">
        <button className="btn btn-outline-primary" onClick={loadPreview} disabled={!valid || busy !== null}>
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
