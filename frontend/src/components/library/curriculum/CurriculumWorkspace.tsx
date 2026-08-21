import { useEffect, useMemo, useState } from 'react'
import type { CurriculumPayload, DatabaseInfo, PageScanManifestEntry } from '@/types'
import { api } from '@/lib/api'
import { CurriculumBridgeProvider, useCurriculumBridge, type TabKey } from '@/contexts/CurriculumBridgeContext'
import CurriculumShell from './CurriculumShell'
import CurriculumSidebar from './CurriculumSidebar'
import WorkspaceTopbar from './WorkspaceTopbar'
import TabHost from './TabHost'

interface Props {
  activeDb: string
  databases: DatabaseInfo[]
  onSelectDb: (db: string) => void
  curriculum: CurriculumPayload
}

/** Placeholder des onglets (livrés en vagues B/C). */
function ComingSoon({ label }: { label: string }) {
  return (
    <div className="content-box" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 48 }}>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }} dir="auto">{label}</div>
      <div>À venir (vague B/C)</div>
    </div>
  )
}

/** Contenu interne — a besoin du contexte de ponts pour piloter les onglets. */
function WorkspaceInner({ activeDb, databases, onSelectDb, curriculum, manifest }: Props & { manifest: PageScanManifestEntry[] }) {
  const bridge = useCurriculumBridge()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const activeDbInfo = databases.find(d => d.filename === activeDb)
  const dbApproved = (activeDbInfo?.metrics?.indexed_page_count ?? 0) > 0

  const pageBounds = useMemo(() => {
    if (manifest.length === 0) return null
    let min = Infinity, max = -Infinity
    for (const p of manifest) {
      if (p.page_number < min) min = p.page_number
      if (p.page_number > max) max = p.page_number
    }
    return Number.isFinite(min) ? { min, max } : null
  }, [manifest])

  const pagesCount = curriculum.aggregates?.global?.page_scans ?? manifest.length
  const docsCount = activeDbInfo?.metrics?.document_count ?? 0

  const closeSidebarOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 992) setSidebarOpen(false)
  }

  return (
    <CurriculumShell
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => setSidebarOpen(o => !o)}
      sidebar={
        <CurriculumSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          databases={databases}
          activeDb={activeDb}
          onSelectDb={onSelectDb}
          aggregates={curriculum.aggregates ?? null}
          pageBounds={pageBounds}
          onPageJump={n => { bridge.jumpTo('scans', `scan-page-${n}`); closeSidebarOnMobile() }}
        />
      }
      topbar={
        <WorkspaceTopbar
          dbName={activeDb}
          pagesCount={pagesCount}
          docsCount={docsCount}
          dbApproved={dbApproved}
          onToggleSidebar={() => setSidebarOpen(o => !o)}
        />
      }
    >
      <TabHost
        onTabSwitch={closeSidebarOnMobile}
        matrix={<ComingSoon label="المصفوفة الشاملة 360°" />}
        programme={<ComingSoon label="المنهاج والتدرج السنوي" />}
        cours={<ComingSoon label="مستودع الدروس والمفاهيم" />}
        exercices={<ComingSoon label="بنك التمارين والأنشطة" />}
        evaluations={<ComingSoon label="الفروض والاختبارات" />}
        scans={<ComingSoon label="المستودع البصري" />}
      />
    </CurriculumShell>
  )
}

/**
 * Point d'assemblage de la Vue 2 pixel-perfect (Shell + Sidebar + Topbar +
 * TabHost). Fournit le CurriculumBridgeProvider et charge le manifeste des scans
 * (bornes du Page Jumper). Onglets = placeholders jusqu'aux vagues B/C.
 */
export default function CurriculumWorkspace(props: Props) {
  const [manifest, setManifest] = useState<PageScanManifestEntry[]>([])

  useEffect(() => {
    let alive = true
    api.library.getPageScansManifest(props.activeDb)
      .then(res => { if (alive) setManifest(res.pages ?? []) })
      .catch(() => { if (alive) setManifest([]) })
    return () => { alive = false }
  }, [props.activeDb])

  // Onglet initial depuis ?tab= (si valide).
  const initialTab = useMemo<TabKey>(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    const valid: TabKey[] = ['matrix', 'programme', 'cours', 'exercices', 'evaluations', 'scans']
    return (valid as string[]).includes(t ?? '') ? (t as TabKey) : 'matrix'
  }, [])

  return (
    <CurriculumBridgeProvider initialTab={initialTab}>
      <WorkspaceInner {...props} manifest={manifest} />
    </CurriculumBridgeProvider>
  )
}
