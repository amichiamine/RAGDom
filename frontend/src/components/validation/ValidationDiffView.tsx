import { GitCompare, Shapes, Gauge } from 'lucide-react'
import MarkdownContent from '@/components/common/MarkdownContent'
import { ValidationArtifact } from './ValidationAssets'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ValidationDiff } from '@/types'

interface Props {
  diff: ValidationDiff | null | undefined
  runId: string
  db: string
  documentId: string
  pageNumber: number
}

export default function ValidationDiffView({ diff, runId, db, documentId, pageNumber }: Props) {
  const { t } = useLanguage()
  if (!diff) return <p className="validation-empty">{t('validation.diff.empty')}</p>

  return (
    <section aria-labelledby="validation-diff-title">
      <h4 id="validation-diff-title"><GitCompare size={16} /> {t('validation.diff.title')}</h4>
      {diff.markdown && (
        <div className="validation-diff-grid">
          <article><header>{t('validation.diff.before')}</header><MarkdownContent source={diff.markdown.before || ''} /></article>
          <article><header>{t('validation.diff.after')}</header><MarkdownContent source={diff.markdown.after || ''} /></article>
        </div>
      )}

      {diff.artifacts.length > 0 && (
        <div className="validation-diff-section">
          <h5><Shapes size={15} /> {t('validation.diff.artifacts')}</h5>
          <div className="validation-artifact-grid">{diff.artifacts.map(item => {
            const artifact = item.after ?? item.before
            const version = item.after ? 'working' : 'baseline'
            return artifact ? (
              <article key={`${item.artifact_id}-${item.change}`} className={`validation-artifact-diff is-${item.change}`}>
                <span className="badge badge-subtle">{t(`validation.diff.${item.change}`)}</span>
                <ValidationArtifact artifact={artifact} runId={runId} db={db} documentId={documentId} pageNumber={pageNumber} version={version} />
              </article>
            ) : null
          })}</div>
        </div>
      )}

      {diff.metrics.length > 0 && (
        <div className="validation-diff-section">
          <h5><Gauge size={15} /> {t('validation.diff.metrics')}</h5>
          <div className="validation-table-wrap"><table className="data-table"><thead><tr><th>{t('validation.diff.metric')}</th><th>{t('validation.diff.before')}</th><th>{t('validation.diff.after')}</th><th>Δ</th></tr></thead><tbody>{diff.metrics.map(metric => <tr key={metric.key}><td>{t(`validation.metrics.${metric.key}`)}</td><td>{String(metric.before ?? '—')}</td><td>{String(metric.after ?? '—')}</td><td className={metric.delta != null && metric.delta < 0 ? 'validation-delta-negative' : 'validation-delta-positive'}>{metric.delta == null ? '—' : metric.delta > 0 ? `+${metric.delta}` : metric.delta}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </section>
  )
}
