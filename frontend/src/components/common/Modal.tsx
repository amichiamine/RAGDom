import { ReactNode, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'default' | 'xl'
}

/** Modale custom (modal-* §Règle 12) avec focus-trap + Escape (§7.13). */
export default function Modal({ open, title, onClose, children, footer, size = 'default' }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement as HTMLElement
    const dialog = dialogRef.current
    const focusable = dialog?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    focusable?.[0]?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'Tab' && focusable && focusable.length > 0) {
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      triggerRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        ref={dialogRef}
        className={cn('modal-dialog', 'modal-dialog-centered', size === 'xl' && 'modal-xl')}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose} aria-label="close"><i className="fa-solid fa-xmark" /></button>
        </div>
        <div>{children}</div>
        {footer && <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  )
}
