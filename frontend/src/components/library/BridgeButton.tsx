import type { ReactNode } from 'react'

export type BridgeVariant = 'cours' | 'exo' | 'eval' | 'scan' | 'prog'

interface Props {
  variant: BridgeVariant
  /** Icône optionnelle — un nœud lucide-react (ex: <BookOpen size={14} />). */
  icon?: ReactNode
  label: string
  onClick: () => void
  title?: string
}

/**
 * Pont relationnel (Bridge Button) — 5 variantes aux hex EXACTS du template
 * (l.748-757). Pill 0.8rem / padding 4px 12px / radius 20 / hover translateY(-1px)
 * définies dans index.css (.bridge-btn + .bridge-{variant}).
 */
export default function BridgeButton({ variant, icon, label, onClick, title }: Props) {
  return (
    <button
      type="button"
      className={`bridge-btn bridge-${variant}`}
      onClick={onClick}
      title={title ?? label}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
