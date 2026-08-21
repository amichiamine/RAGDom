import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Atom, Network, GraduationCap, BookOpen, PenTool, FilePen, Images,
  X, Search, Sun, Moon, ChevronDown, Database, CalendarRange, ArrowRight, MessageSquare,
} from 'lucide-react'
import type { DatabaseInfo, CurriculumAggregates } from '@/types'
import { useTheme } from '@/contexts/ThemeContext'
import { useCurriculumBridge, type TabKey } from '@/contexts/CurriculumBridgeContext'

interface Props {
  open: boolean
  onClose: () => void
  databases: DatabaseInfo[]
  activeDb: string | null
  onSelectDb: (db: string) => void
  aggregates: CurriculumAggregates | null
  /** Bornes du Page Jumper : min/max réels issus du manifeste des scans. */
  pageBounds: { min: number; max: number } | null
  onPageJump: (page: number) => void
  /** Curriculum peuplé ? Sinon le filtre trimestre 360° est désactivé (tooltip). */
  curriculumAvailable: boolean
}

/** Filtres trimestre 360° (libellés + emojis normatifs, §5.2.2). */
const TRIM_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'جميع الفصول (360°)' },
  { value: 1, label: 'الفصل الأول 🍂' },
  { value: 2, label: 'الفصل الثاني ❄️' },
  { value: 3, label: 'الفصل الثالث 🌸' },
]

/** Les 6 boutons de navigation (icône lucide + couleur + libellé arabe normatif). */
const NAV_ITEMS: { tab: TabKey; icon: ReactNode; label: string; color: string }[] = [
  { tab: 'matrix', icon: <Network size={17} />, label: 'المصفوفة الشاملة 360°', color: 'var(--warning)' },
  { tab: 'programme', icon: <GraduationCap size={17} />, label: 'المنهاج والتدرج السنوي', color: 'var(--success)' },
  { tab: 'cours', icon: <BookOpen size={17} />, label: 'مستودع الدروس', color: 'var(--primary)' },
  { tab: 'exercices', icon: <PenTool size={17} />, label: 'بنك التمارين', color: 'var(--danger)' },
  { tab: 'evaluations', icon: <FilePen size={17} />, label: 'الفروض والاختبارات', color: 'var(--info)' },
  { tab: 'scans', icon: <Images size={17} />, label: 'المستودع البصري', color: 'var(--warning)' },
]

export default function CurriculumSidebar({
  open, onClose, databases, activeDb, onSelectDb, aggregates, pageBounds, onPageJump, curriculumAvailable,
}: Props) {
  const { theme, toggleTheme } = useTheme()
  const { activeTab, switchTab, trimFilter, setTrimFilter, searchQuery, setSearch } = useCurriculumBridge()

  const [dbMenuOpen, setDbMenuOpen] = useState(false)
  const [trimMenuOpen, setTrimMenuOpen] = useState(false)
  const [pageInput, setPageInput] = useState('')

  // Recherche locale avec debounce 150ms → propagée au contexte.
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const debounceRef = useRef<number | null>(null)
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => setSearch(localSearch), 150)
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current) }
  }, [localSearch, setSearch])

  // Compteurs de badges par onglet, dérivés des agrégats globaux (jamais en dur).
  const badgeCounts = useMemo<Record<TabKey, number>>(() => {
    const g = aggregates?.global
    return {
      matrix: g?.chapters ?? 0,
      programme: g?.programs ?? 0,
      cours: g?.courses ?? 0,
      exercices: g?.exercises ?? 0,
      evaluations: g?.assessments ?? 0,
      scans: g?.page_scans ?? 0,
    }
  }, [aggregates])

  const activeTrimLabel = TRIM_OPTIONS.find(o => o.value === trimFilter)?.label ?? TRIM_OPTIONS[0].label

  const submitPageJump = () => {
    const n = Number(pageInput)
    if (!Number.isFinite(n) || n <= 0) return
    if (pageBounds && (n < pageBounds.min || n > pageBounds.max)) return
    onPageJump(n)
  }

  return (
    <aside className={`app-sidebar ${open ? 'show-sidebar' : ''}`} dir="rtl">
      {/* Header */}
      <div style={{ padding: 20, borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--engine-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
          <Atom size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: '#fff' }}>RAGDom Hub</div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>المنظومة البيداغوجية الشاملة</div>
        </div>
        <button className="modal-close" style={{ color: '#94a3b8' }} onClick={onClose} aria-label="close">
          <X size={18} />
        </button>
      </div>

      <div style={{ padding: 16, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Dropdown Bases (bordure dorée) */}
        <div style={{ position: 'relative' }}>
          <button
            className="btn btn-sm"
            style={{ width: '100%', justifyContent: 'space-between', background: 'var(--sidebar-bg-secondary)', color: '#fff', border: '1px solid var(--warning)' }}
            onClick={() => { setDbMenuOpen(o => !o); setTrimMenuOpen(false) }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <Database size={15} /> {activeDb ?? 'اختر قاعدة'}
            </span>
            <ChevronDown size={15} />
          </button>
          {dbMenuOpen && (
            <div className="dropdown-menu" style={{ position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, marginTop: 6, maxHeight: 320, overflowY: 'auto' }}>
              {databases.length === 0 && <div className="dropdown-item" style={{ color: 'var(--text-muted)' }}>لا توجد قواعد</div>}
              {databases.map(d => {
                const m = d.metrics
                const built = (m?.indexed_page_count ?? 0) > 0
                return (
                  <button
                    key={d.filename}
                    className={`dropdown-item ${d.filename === activeDb ? 'active' : ''}`}
                    onClick={() => { onSelectDb(d.filename); setDbMenuOpen(false) }}
                    dir="auto"
                  >
                    <span style={{ flex: 1, textAlign: 'start', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</span>
                    <span className={`badge ${built ? 'badge-success' : 'badge-secondary'} font-num`}>
                      {built ? `${m.indexed_page_count} ص` : 'قريباً'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Dropdown Trimestre 360° (bordure verte) — désactivé sans curriculum (tooltip) */}
        <div style={{ position: 'relative' }}>
          <button
            className="btn btn-sm"
            style={{ width: '100%', justifyContent: 'space-between', background: 'var(--sidebar-bg-secondary)', color: '#fff', border: '1px solid var(--success)', opacity: curriculumAvailable ? 1 : 0.5, cursor: curriculumAvailable ? 'pointer' : 'not-allowed' }}
            onClick={() => { if (!curriculumAvailable) return; setTrimMenuOpen(o => !o); setDbMenuOpen(false) }}
            disabled={!curriculumAvailable}
            title={curriculumAvailable ? undefined : 'التصفية حسب الفصل تتطلب بناء المنهاج لهذه القاعدة'}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><CalendarRange size={15} /> {activeTrimLabel}</span>
            <ChevronDown size={15} />
          </button>
          {curriculumAvailable && trimMenuOpen && (
            <div className="dropdown-menu" style={{ position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, marginTop: 6 }}>
              {TRIM_OPTIONS.map(o => (
                <button
                  key={o.value}
                  className={`dropdown-item ${o.value === trimFilter ? 'active' : ''}`}
                  onClick={() => { setTrimFilter(o.value); setTrimMenuOpen(false) }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Master Search (debounce 150ms + clear) */}
        <div style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
          <input
            className="form-input"
            style={{ background: 'var(--sidebar-bg-secondary)', color: '#fff', borderColor: 'rgba(255,255,255,0.15)', paddingInlineStart: 36, paddingInlineEnd: localSearch ? 36 : 14 }}
            placeholder="بحث في كل الأقسام…"
            value={localSearch}
            onChange={e => setLocalSearch(e.target.value)}
            aria-label="master search"
          />
          {localSearch && (
            <button
              onClick={() => setLocalSearch('')}
              aria-label="clear search"
              style={{ position: 'absolute', insetInlineEnd: 10, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Page Jumper (préfixe ص, bornes = manifeste scans) */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: '#94a3b8', fontWeight: 800, fontSize: '0.9rem' }}>ص</span>
          <input
            type="number"
            className="form-input font-num"
            style={{ background: 'var(--sidebar-bg-secondary)', color: '#fff', borderColor: 'rgba(255,255,255,0.15)', flex: 1 }}
            placeholder={pageBounds ? `${pageBounds.min}–${pageBounds.max}` : '—'}
            min={pageBounds?.min}
            max={pageBounds?.max}
            value={pageInput}
            onChange={e => setPageInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitPageJump() }}
            aria-label="page jumper"
          />
          <button className="btn btn-primary btn-sm" onClick={submitPageJump} aria-label="jump to page"><ArrowRight size={15} /></button>
        </div>

        {/* Navigation vers les 6 onglets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.tab}
              className={`sidebar-nav-btn ${activeTab === item.tab ? 'active' : ''}`}
              onClick={() => switchTab(item.tab)}
              aria-current={activeTab === item.tab}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: activeTab === item.tab ? '#fff' : item.color, display: 'inline-flex' }}>{item.icon}</span>
                {item.label}
              </span>
              <span className="badge badge-subtle font-num">{badgeCounts[item.tab]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Accès direct aux studios Recherche / Sondage (Mode Repli) */}
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/library?classic=1&tab=search" className="btn btn-outline-primary btn-sm rounded-pill" style={{ flex: 1, justifyContent: 'center' }}>
            <Search size={14} /> بحث
          </Link>
          <Link to="/library?classic=1&tab=ask" className="btn btn-outline-info btn-sm rounded-pill" style={{ flex: 1, justifyContent: 'center' }}>
            <MessageSquare size={14} /> استفسار
          </Link>
        </div>
        <button className="btn btn-sm" style={{ background: 'var(--sidebar-bg-secondary)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', justifyContent: 'center' }} onClick={toggleTheme}>
          {theme === 'dark' ? <><Sun size={15} /> الوضع النهاري</> : <><Moon size={15} /> الوضع الليلي</>}
        </button>
        <Link to="/automation" className="btn btn-outline-success btn-sm rounded-pill">مركز الأتمتة</Link>
        <Link to="/" className="btn btn-primary btn-sm rounded-pill">لوحة القيادة</Link>
      </div>
    </aside>
  )
}
