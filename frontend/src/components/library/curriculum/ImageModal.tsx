import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  title: string
  src: string
  /** URL de repli si `src` échoue (page_00X.png, etc.). */
  fallbackSrc?: string
  onClose: () => void
}

/**
 * Modale HD universelle des scans (§5.2.7) — plein écran centrée, header dark,
 * image max-width 900px, corps max-height 85vh scrollable, fallback onError.
 */
export default function ImageModal({ open, title, src, fallbackSrc, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement as HTMLElement
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'Tab') { e.preventDefault(); closeRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      triggerRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog modal-xl modal-dialog-centered"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ padding: 0, overflow: 'hidden' }}
      >
        <div
          className="modal-header"
          style={{ background: '#0f172a', color: '#fff', margin: 0, padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}
        >
          <span id={titleId} className="modal-title" style={{ color: '#fff' }} dir="auto">{title}</span>
          <button ref={closeRef} className="modal-close" style={{ color: '#94a3b8' }} onClick={onClose} aria-label="close">
            <X size={20} />
          </button>
        </div>
        <div style={{ maxHeight: '85vh', overflowY: 'auto', padding: 20, textAlign: 'center', background: 'var(--bg-surface)' }}>
          <img
            src={src}
            alt={title}
            style={{ maxWidth: 900, width: '100%', height: 'auto', borderRadius: 12 }}
            onError={e => {
              const img = e.currentTarget
              if (fallbackSrc && img.src !== fallbackSrc) {
                img.src = fallbackSrc
              } else {
                img.style.display = 'none'
                if (img.parentElement) {
                  img.parentElement.setAttribute('data-broken', 'true')
                }
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}
