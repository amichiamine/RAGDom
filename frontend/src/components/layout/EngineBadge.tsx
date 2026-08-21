import { useEngine } from '@/contexts/EngineContext'

/** Badge moteur actif, teinté --engine-accent (PARTIE 8.4). Présent dans les 3 topbars. */
export default function EngineBadge() {
  const { activeEngine } = useEngine()
  if (!activeEngine) return null
  return (
    <span className="engine-badge" title={`${activeEngine.label} v${activeEngine.version}`}>
      <i className="fa-solid fa-microchip" />
      <span>{activeEngine.label}</span>
    </span>
  )
}
