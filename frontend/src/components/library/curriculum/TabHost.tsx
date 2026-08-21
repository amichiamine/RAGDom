import { useEffect, type ReactNode } from 'react'
import { useCurriculumBridge, type TabKey } from '@/contexts/CurriculumBridgeContext'

interface Props {
  matrix: ReactNode
  programme: ReactNode
  cours: ReactNode
  exercices: ReactNode
  evaluations: ReactNode
  scans: ReactNode
  /** Ferme la sidebar sous 992px lors d'une commutation d'onglet. */
  onTabSwitch?: () => void
}

/**
 * Hôte des 6 onglets : rend l'onglet actif avec l'animation `tabFadeSlide`
 * rejouée à chaque commutation (grâce à `key={activeTab}`), synchronise `?tab=`
 * via history.replaceState, et ferme la sidebar ≤992px au switch.
 */
export default function TabHost(props: Props) {
  const { activeTab } = useCurriculumBridge()

  // Sync de l'URL (?tab=) sans rechargement ni entrée d'historique.
  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', activeTab)
    window.history.replaceState(null, '', url.toString())
  }, [activeTab])

  // Fermeture auto de la sidebar en dessous du breakpoint 992px.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 992) {
      props.onTabSwitch?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  const slots: Record<TabKey, ReactNode> = {
    matrix: props.matrix,
    programme: props.programme,
    cours: props.cours,
    exercices: props.exercices,
    evaluations: props.evaluations,
    scans: props.scans,
  }

  return (
    <div key={activeTab} className="workspace-tab" role="tabpanel" aria-label={activeTab}>
      {slots[activeTab]}
    </div>
  )
}
