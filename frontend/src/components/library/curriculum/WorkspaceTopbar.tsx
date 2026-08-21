import { Link } from 'react-router-dom'
import { House, Cog, PanelRight } from 'lucide-react'
import { useCurriculumBridge, type TabKey } from '@/contexts/CurriculumBridgeContext'

/** Libellés arabes normatifs des onglets (template l.1808-1815). */
export const TAB_LABELS: Record<TabKey, string> = {
  matrix: 'المصفوفة الشاملة 360°',
  programme: 'المنهاج والتدرج السنوي (2G)',
  cours: 'مستودع الدروس والمفاهيم',
  exercices: 'بنك التمارين والأنشطة',
  evaluations: 'بنك الفروض والاختبارات',
  scans: 'المستودع البصري (كتاب + اختبارات)',
}

interface Props {
  dbName: string | null
  pagesCount: number
  docsCount: number
  dbApproved: boolean
  onToggleSidebar: () => void
}

/**
 * Topbar sticky du workspace (§5.2.3) — backdrop blur 12px, pills retour /
 * automation / toggle sidebar, breadcrumb Base / Onglet, badges pages+docs
 * (doré) et état base (vert « معتمدة » / gris « غير مبنية »).
 */
export default function WorkspaceTopbar({ dbName, pagesCount, docsCount, dbApproved, onToggleSidebar }: Props) {
  const { activeTab } = useCurriculumBridge()

  return (
    <div className="workspace-topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Link to="/" className="btn btn-outline-primary btn-sm rounded-pill"><House size={15} /> العودة للبوابة</Link>
        <Link to="/automation" className="btn btn-outline-success btn-sm rounded-pill"><Cog size={15} /> الأتمتة</Link>
        <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={onToggleSidebar} aria-label="toggle sidebar">
          <PanelRight size={15} />
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600 }} dir="auto">
          {dbName ?? '—'} <span style={{ opacity: 0.5 }}>/</span> {TAB_LABELS[activeTab]}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="badge badge-warning font-num" title="صفحات الكتاب ووثائق ممسوحة">
          {pagesCount} ص · {docsCount} وثيقة
        </span>
        {dbApproved ? (
          <span className="badge badge-success">✓ قاعدة بيانات معتمدة</span>
        ) : (
          <span className="badge badge-secondary">قاعدة غير مبنية</span>
        )}
      </div>
    </div>
  )
}
