import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

type ToastKind = 'success' | 'error' | 'info'
interface ToastItem { id: number; kind: ToastKind; message: string }

interface ToastContextValue {
  push: (kind: ToastKind, message: string) => void
  success: (m: string) => void
  error: (m: string) => void
  info: (m: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

// PARTIE 8.3 : toasts unifiés, pile en bas, max 3 visibles, succès auto-dismiss 4s, erreur persistante.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId++
    setToasts(prev => [...prev.slice(-2), { id, kind, message }])
    if (kind !== 'error') {
      window.setTimeout(() => remove(id), 4000)
    }
  }, [remove])

  const value: ToastContextValue = {
    push,
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.kind}`} role="status">
            <i className={`fa-solid ${t.kind === 'success' ? 'fa-circle-check' : t.kind === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info'}`} />
            <span style={{ flex: 1 }}>{t.message}</span>
            {t.kind === 'error' && (
              <button className="modal-close" style={{ color: '#fff' }} onClick={() => remove(t.id)} aria-label="close">
                <i className="fa-solid fa-xmark" />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
