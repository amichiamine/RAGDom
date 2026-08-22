import { Link } from 'react-router-dom'
import { House, Cog, PanelRight, Rows3, Rows4 } from 'lucide-react'
import { useCurriculumBridge } from '@/contexts/CurriculumBridgeContext'
import { useDensity } from '@/contexts/DensityContext'
import { useLanguage } from '@/contexts/LanguageContext'

interface Props {
  dbName: string | null
  pagesCount: number
  docsCount: number
  dbApproved: boolean
  onToggleSidebar: () => void
}

/** Topbar sticky du workspace curriculum. */
export default function WorkspaceTopbar({ dbName, pagesCount, docsCount, dbApproved, onToggleSidebar }: Props) {
  const { activeTab } = useCurriculumBridge()
  const { density, toggleDensity } = useDensity()
  const { t } = useLanguage()

  return (
    <div className="workspace-topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Link to="/" className="btn btn-outline-primary btn-sm rounded-pill"><House size={15} /> {t('nav.back_portal')}</Link>
        <Link to="/automation" className="btn btn-outline-success btn-sm rounded-pill"><Cog size={15} /> {t('nav.automation')}</Link>
        <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={onToggleSidebar} aria-label="toggle sidebar"><PanelRight size={15} /></button>
        <button
          className="btn btn-outline-secondary btn-sm rounded-pill"
          onClick={toggleDensity}
          aria-pressed={density === 'compact'}
          title={density === 'compact' ? t('density.comfortable') : t('density.compact')}
        >
          {density === 'compact' ? <Rows3 size={15} /> : <Rows4 size={15} />}
          {' '}{density === 'compact' ? t('density.comfortable') : t('density.compact')}
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600 }} dir="auto">
          {dbName ?? '—'} <span style={{ opacity: 0.5 }}>/</span> {t(`curriculum_ui.tabs.${activeTab}`)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="badge badge-warning font-num" title={t('curriculum_ui.pages_documents')}>
          {pagesCount} {t('validation.metrics.pages')} · {docsCount} {t('library.documents')}
        </span>
        {dbApproved
          ? <span className="badge badge-success">✓ {t('db.active')}</span>
          : <span className="badge badge-secondary">{t('db.not_built')}</span>}
      </div>
    </div>
  )
}
