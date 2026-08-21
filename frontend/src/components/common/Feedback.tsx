import { ReactNode } from 'react'

export function Spinner({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', padding: '20px 0' }}>
      <i className="fa-solid fa-spinner fa-spin fa-spin-load" />
      {label && <span>{label}</span>}
    </div>
  )
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      style={{
        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
        color: '#ef4444', borderRadius: 12, padding: '12px 16px', margin: '12px 0',
        display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <i className="fa-solid fa-triangle-exclamation" />
        {message}
      </span>
      {onRetry && (
        <button className="btn btn-sm btn-outline-danger" onClick={onRetry}>
          <i className="fa-solid fa-rotate-right" />
        </button>
      )}
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
      <i className={`fa-solid ${icon}`} style={{ fontSize: '2.4rem', marginBottom: 14, opacity: 0.6 }} />
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      {children}
    </div>
  )
}

export function SkeletonRows({ count = 5, height = 42 }: { count?: number; height?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 6, height = 160 }: { count?: number; height?: number }) {
  return (
    <div className="grid-cards">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  )
}
