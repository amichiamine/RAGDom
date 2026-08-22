import { useMemo, useState } from 'react'
import { FileImage, Layers, Shapes, ListTree, GraduationCap, Gauge, CircleAlert } from 'lucide-react'
import MarkdownContent from '@/components/common/MarkdownContent'
import ArtifactRenderer from '@/components/library/ArtifactRenderer'
import { api } from '@/lib/api'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ValidationInspection } from '@/types'

interface Props {
  inspection: ValidationInspection | null | undefined
  db: string
  documentId?: string
  pageNumber: number
}

type Tab = 'scan' | 'chunks' | 'artifacts' | 'toc' | 'curriculum' | 'benchmarks' | 'errors'

export default function ValidationInspector({ inspection, db, documentId, pageNumber }: Props) {
  const { t } = useLanguage()
  const [active, setActive] = useState<Tab>('scan')
  const tabs = useMemo<Array<{ key: Tab; icon: typeof FileImage; count?: number }>>(() => [
    { key: 'scan', icon: FileImage },
    { key: 'chunks', icon: Layers, count: inspection?.chunks.length },
    { key: 'artifacts', icon: Shapes, count: inspection?.artifacts.length },
    { key: 'toc', icon: ListTree, count: inspection?.toc.length },
    { key: 'curriculum', icon: GraduationCap },
    { key: 'benchmarks', icon: Gauge, count: inspection?.benchmarks.length },
    { key: 'errors', icon: CircleAlert, count: inspection?.errors.length },
  ], [inspection])

  if (!inspection) return <p className="validation-empty">{t('validation.inspection.empty')}</p>
  const scanUrl = inspection.scan_url ?? (documentId ? api.library.getPageScanUrl(db, documentId, pageNumber) : null)

  return (
    <section aria-labelledby="validation-inspection-title">
      <h4 id="validation-inspection-title">{t('validation.inspection.title')}</h4>
      <div className="validation-subtabs" role="tablist" aria-label={t('validation.inspection.title')}>
        {tabs.map(({ key, icon: Icon, count }) => (
          <button key={key} role="tab" aria-selected={active === key} className={active === key ? 'active' : ''} onClick={() => setActive(key)}>
            <Icon size={14} /> {t(`validation.inspection.${key}`)} {count != null && <span className="badge badge-subtle">{count}</span>}
          </button>
        ))}
      </div>

      <div className="validation-inspection-panel" role="tabpanel">
        {active === 'scan' && (scanUrl
          ? <img className="validation-scan" src={scanUrl} alt={`${t('library.scan')} ${pageNumber}`} loading="lazy" />
          : <Empty />)}
        {active === 'chunks' && (inspection.chunks.length
          ? <div className="validation-stack">{inspection.chunks.map(chunk => <article className="validation-content-card" key={chunk.id}><header><span className="badge badge-subtle">#{chunk.chunk_index}</span><span>{chunk.section_title ?? chunk.pedagogical_type ?? '—'}</span></header><MarkdownContent source={chunk.content_markdown} /></article>)}</div>
          : <Empty />)}
        {active === 'artifacts' && (inspection.artifacts.length
          ? <div className="validation-artifact-grid">{inspection.artifacts.map(artifact => <ArtifactRenderer key={artifact.id} artifact={artifact} fallbackImageUrl={artifact.has_binary ? api.library.getArtifactBinaryUrl(db, artifact.id) : undefined} />)}</div>
          : <Empty />)}
        {active === 'toc' && (inspection.toc.length
          ? <div className="validation-stack">{inspection.toc.map(node => <article className="validation-content-card" key={node.id}><strong>{node.title}</strong><span className="badge badge-subtle">p.{node.page_start}{node.page_end ? `–${node.page_end}` : ''}</span></article>)}</div>
          : <Empty />)}
        {active === 'curriculum' && (inspection.curriculum
          ? <dl className="validation-definition-list"><dt>{t('validation.inspection.terms')}</dt><dd>{inspection.curriculum.terms?.length ?? 0}</dd><dt>{t('validation.inspection.programs')}</dt><dd>{inspection.curriculum.programs?.length ?? 0}</dd><dt>{t('validation.inspection.assessments')}</dt><dd>{inspection.curriculum.assessments?.length ?? 0}</dd><dt>{t('validation.inspection.links')}</dt><dd>{inspection.curriculum.links?.length ?? 0}</dd></dl>
          : <Empty />)}
        {active === 'benchmarks' && (inspection.benchmarks.length
          ? <div className="validation-table-wrap"><table className="data-table"><thead><tr><th>{t('library.page')}</th><th>{t('common.engine')}</th><th>{t('validation.metrics.latency')}</th><th>{t('validation.metrics.confidence')}</th><th>RAM</th></tr></thead><tbody>{inspection.benchmarks.map(row => <tr key={row.id}><td>{row.page_number}</td><td>{row.engine_used}</td><td>{row.execution_time_ms} ms</td><td>{row.confidence_score != null ? `${(row.confidence_score * 100).toFixed(1)}%` : '—'}</td><td>{row.ram_peak_mb ?? '—'}</td></tr>)}</tbody></table></div>
          : <Empty />)}
        {active === 'errors' && (inspection.errors.length
          ? <div className="validation-stack">{inspection.errors.map((error, index) => <article className="validation-error-card" key={`${error.code}-${index}`}><strong>{error.code ?? error.layer ?? t('status.error')}</strong><p>{error.message}</p>{error.details && <pre>{error.details}</pre>}</article>)}</div>
          : <Empty />)}
      </div>
    </section>
  )
}

function Empty() {
  const { t } = useLanguage()
  return <p className="validation-empty">{t('common.empty')}</p>
}
