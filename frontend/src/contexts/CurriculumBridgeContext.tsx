import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode, type CSSProperties,
} from 'react'

/** Les 6 onglets du workspace curriculum (pixel-perfect, §5.2.4). */
export type TabKey = 'matrix' | 'programme' | 'cours' | 'exercices' | 'evaluations' | 'scans'

/** Filtre croisé de la banque d'exercices (pont cours / pont galerie / pont corrigé→énoncé). */
export interface ExoFilter { coursId?: string; page?: number; chunkId?: string }

interface CurriculumBridgeState {
  activeTab: TabKey
  trimFilter: number            // 0 = tous les trimestres (filtre 360°)
  searchQuery: string
  highlightedId: string | null
  exoFilter: ExoFilter | null
  expandedIds: Set<string>
}

interface CurriculumBridgeValue extends CurriculumBridgeState {
  switchTab: (tab: TabKey) => void
  /** Pont universel : change d'onglet, déplie la cible, pose le halo (auto-clear 2300ms). */
  jumpTo: (tab: TabKey, targetId: string) => void
  filterExercicesByCours: (coursId: string) => void
  filterExercicesByPage: (page: number) => void
  /** Pont bidirectionnel corrigé/scan → énoncé précis : bascule Exercices, cible le
   *  chunk (id `exo_{chunkId}`), pose le halo doré (même moteur que `jumpTo`). */
  jumpToExercise: (chunkId: string) => void
  setTrimFilter: (trim: number) => void
  setSearch: (q: string) => void
  toggleExpanded: (id: string) => void
  /** Ouvre/ferme en masse un ensemble d'ids partageant un préfixe logique. */
  expandAll: (prefix: string, ids: string[], open: boolean) => void
  clearHighlight: () => void
}

const HIGHLIGHT_MS = 2300

const CurriculumBridgeContext = createContext<CurriculumBridgeValue | null>(null)

export function CurriculumBridgeProvider({
  children,
  initialTab = 'matrix',
}: {
  children: ReactNode
  initialTab?: TabKey
}) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab)
  const [trimFilter, setTrim] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [exoFilter, setExoFilter] = useState<ExoFilter | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  const highlightTimer = useRef<number | null>(null)

  useEffect(() => () => { if (highlightTimer.current) window.clearTimeout(highlightTimer.current) }, [])

  const switchTab = useCallback((tab: TabKey) => setActiveTab(tab), [])

  const clearHighlight = useCallback(() => setHighlightedId(null), [])

  const jumpTo = useCallback((tab: TabKey, targetId: string) => {
    setActiveTab(tab)
    setExpandedIds(prev => {
      if (prev.has(targetId)) return prev
      const next = new Set(prev)
      next.add(targetId)
      return next
    })
    setHighlightedId(targetId)
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS)
  }, [])

  const filterExercicesByCours = useCallback((coursId: string) => {
    setExoFilter({ coursId })
    setActiveTab('exercices')
  }, [])

  const filterExercicesByPage = useCallback((page: number) => {
    setExoFilter({ page })
    setActiveTab('exercices')
  }, [])

  /**
   * Pont corrigé→énoncé (navigation relationnelle bidirectionnelle) : bascule sur
   * l'onglet Exercices SANS filtre restrictif (le chunk cible pourrait ne pas
   * correspondre au filtre courant), puis pose le halo doré sur la carte de
   * l'exercice (id `exo_{chunkId}`) via le même moteur que `jumpTo`.
   */
  const jumpToExercise = useCallback((chunkId: string) => {
    setExoFilter(null)
    setActiveTab('exercices')
    const targetId = `exo_${chunkId}`
    setExpandedIds(prev => {
      if (prev.has(targetId)) return prev
      const next = new Set(prev)
      next.add(targetId)
      return next
    })
    setHighlightedId(targetId)
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS)
  }, [])

  const setTrimFilter = useCallback((trim: number) => setTrim(trim), [])
  const setSearch = useCallback((q: string) => setSearchQuery(q), [])

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandAll = useCallback((prefix: string, ids: string[], open: boolean) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      for (const id of ids) {
        if (open) next.add(id)
        else next.delete(id)
      }
      // `prefix` documente l'espace logique concerné (onglet/section) ; on retire
      // aussi les résidus du même préfixe lors d'une fermeture globale.
      if (!open) {
        for (const id of Array.from(next)) if (id.startsWith(prefix)) next.delete(id)
      }
      return next
    })
  }, [])

  const value = useMemo<CurriculumBridgeValue>(() => ({
    activeTab, trimFilter, searchQuery, highlightedId, exoFilter, expandedIds,
    switchTab, jumpTo, filterExercicesByCours, filterExercicesByPage, jumpToExercise,
    setTrimFilter, setSearch, toggleExpanded, expandAll, clearHighlight,
  }), [
    activeTab, trimFilter, searchQuery, highlightedId, exoFilter, expandedIds,
    switchTab, jumpTo, filterExercicesByCours, filterExercicesByPage, jumpToExercise,
    setTrimFilter, setSearch, toggleExpanded, expandAll, clearHighlight,
  ])

  return (
    <CurriculumBridgeContext.Provider value={value}>
      {children}
    </CurriculumBridgeContext.Provider>
  )
}

export function useCurriculumBridge(): CurriculumBridgeValue {
  const ctx = useContext(CurriculumBridgeContext)
  if (!ctx) throw new Error('useCurriculumBridge must be used inside CurriculumBridgeProvider')
  return ctx
}

/**
 * Conteneur cible d'un pont : pose la classe `.target-highlight` quand
 * `highlightedId === id` et défile doucement au centre après 120ms (parité du
 * moteur `highlightAndFocusElement` du template, l.1733-1750).
 */
export function HighlightTarget({
  id,
  className,
  style,
  children,
}: {
  id: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  const { highlightedId } = useCurriculumBridge()
  const ref = useRef<HTMLDivElement>(null)
  const isTarget = highlightedId === id

  useEffect(() => {
    if (!isTarget) return
    const el = ref.current
    if (!el) return
    const timer = window.setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [isTarget])

  const cls = [className, isTarget ? 'target-highlight' : ''].filter(Boolean).join(' ')
  return (
    <div ref={ref} id={`bridge-${id}`} className={cls || undefined} style={style}>
      {children}
    </div>
  )
}
