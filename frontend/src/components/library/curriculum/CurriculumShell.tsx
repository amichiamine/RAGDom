import { useEffect, type ReactNode } from 'react'
import { PanelRight } from 'lucide-react'

interface Props {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  sidebar: ReactNode
  topbar: ReactNode
  children: ReactNode
}

/**
 * Layout de la Vue 2 (§5.2.2) : sidebar fixée à droite (RTL) en translateX,
 * workspace à `margin-right` animé (0.3s cubic-bezier(0.4,0,0.2,1)) via la classe
 * `.with-sidebar`, raccourci clavier Ctrl/Cmd+B, FAB mobile 54px (masqué ≥993px).
 */
export default function CurriculumShell({ sidebarOpen, onToggleSidebar, sidebar, topbar, children }: Props) {
  // Raccourci universel Ctrl/Cmd+B (parité template l.1726-1731).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        onToggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onToggleSidebar])

  return (
    <div className="app-layout">
      {sidebar}

      <div className={`app-workspace ${sidebarOpen ? 'with-sidebar' : ''}`}>
        {topbar}
        <div style={{ padding: 24, flex: 1, minWidth: 0 }}>
          {children}
        </div>
      </div>

      <button className="floating-sidebar-toggle" onClick={onToggleSidebar} aria-label="toggle sidebar">
        <PanelRight size={22} />
      </button>
    </div>
  )
}
