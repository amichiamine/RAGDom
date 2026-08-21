import { useEffect, useMemo, useRef, useState } from 'react'
import type { CurriculumPayload, DatabaseInfo, PageScanManifestEntry } from '@/types'
import { api } from '@/lib/api'
import { CurriculumBridgeProvider, useCurriculumBridge, type TabKey } from '@/contexts/CurriculumBridgeContext'
import CurriculumShell from './CurriculumShell'
import CurriculumSidebar from './CurriculumSidebar'
import WorkspaceTopbar from './WorkspaceTopbar'
import TabHost from './TabHost'
import SplashScreen, { clearPrerenderCache } from './SplashScreen'
import {
  MatrixTabConnector, ProgrammeTabConnector, CoursTabConnector,
  ExercicesTabConnector, EvaluationsTabConnector, ScansTabConnector,
} from './tabs'

interface Props {
  activeDb: string
  databases: DatabaseInfo[]
  onSelectDb: (db: string) => void
  curriculum: CurriculumPayload
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
          onPageJump={n => { bridge.jumpTo('scans', `scan_${n}`); closeSidebarOnMobile() }}
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
        matrix={<MatrixTabConnector curriculum={curriculum} activeDb={activeDb} />}
        programme={<ProgrammeTabConnector curriculum={curriculum} activeDb={activeDb} />}
        cours={<CoursTabConnector curriculum={curriculum} activeDb={activeDb} />}
        exercices={<ExercicesTabConnector curriculum={curriculum} activeDb={activeDb} />}
        evaluations={<EvaluationsTabConnector curriculum={curriculum} activeDb={activeDb} />}
        scans={<ScansTabConnector curriculum={curriculum} activeDb={activeDb} manifest={manifest} />}
      />
    </CurriculumShell>
  )
}

/**
 * Point d'assemblage de la Vue 2 pixel-perfect (Shell + Sidebar + Topbar +
 * TabHost). Fournit le CurriculumBridgeProvider et charge le manifeste des scans
 * (bornes du Page Jumper). Onglets = placeholders jusqu'aux vagues B/C.
 */
/** Markdowns bruts à pré-rendre par le Splash (§5.2.1) : titres/compétences de
 *  programmes + intitulés d'évaluations de la base — les seuls contenus riches
 *  portés par le CurriculumPayload (les chunks sont chargés paresseusement). */
function collectPreloadItems(curriculum: CurriculumPayload): string[] {
  const items: string[] = []
  for (const p of curriculum.programs ?? []) {
    if (p.title) items.push(p.title)
    if (p.competencies_json) {
      try {
        const parsed = JSON.parse(p.competencies_json)
        if (Array.isArray(parsed)) for (const c of parsed) if (typeof c === 'string') items.push(c)
        else if (typeof parsed === 'string') items.push(parsed)
      } catch { items.push(p.competencies_json) }
    }
  }
  for (const a of curriculum.assessments ?? []) if (a.title) items.push(a.title)
  return items
}

export default function CurriculumWorkspace(props: Props) {
  const [manifest, setManifest] = useState<PageScanManifestEntry[]>([])
  // Splash affiché au premier montage de CHAQUE base curriculum (une fois par base).
  const [splashDoneFor, setSplashDoneFor] = useState<string | null>(null)

  // Réinitialise le splash + purge le cache de pré-rendu au changement de base.
  const prevDb = useRef<string | null>(null)
  useEffect(() => {
    if (prevDb.current !== null && prevDb.current !== props.activeDb) {
      clearPrerenderCache()
      setSplashDoneFor(null)
    }
    prevDb.current = props.activeDb
  }, [props.activeDb])

  useEffect(() => {
    let alive = true
    api.library.getPageScansManifest(props.activeDb)
      .then(res => { if (alive) setManifest(res.pages ?? []) })
      .catch(() => { if (alive) setManifest([]) })
    return () => { alive = false }
  }, [props.activeDb])

  const preloadItems = useMemo(() => collectPreloadItems(props.curriculum), [props.curriculum])

  // Onglet initial depuis ?tab= (si valide).
  const initialTab = useMemo<TabKey>(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    const valid: TabKey[] = ['matrix', 'programme', 'cours', 'exercices', 'evaluations', 'scans']
    return (valid as string[]).includes(t ?? '') ? (t as TabKey) : 'matrix'
  }, [])

  const showSplash = splashDoneFor !== props.activeDb

  return (
    <CurriculumBridgeProvider initialTab={initialTab}>
      {showSplash && (
        <SplashScreen
          curriculum={props.curriculum}
          itemsToPreload={preloadItems}
          onDone={() => setSplashDoneFor(props.activeDb)}
        />
      )}
      <WorkspaceInner {...props} manifest={manifest} />
    </CurriculumBridgeProvider>
  )
}
