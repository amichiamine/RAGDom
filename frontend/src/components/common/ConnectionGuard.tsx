import { ReactNode, useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { useLanguage } from '@/contexts/LanguageContext'

type GuardState = 'checking' | 'online' | 'offline'

/**
 * §7.12 ConnectionGuard : si GET /system/health échoue, écran plein de reconnexion
 * (polling 5s). Aucune vue ne rend tant que le backend est injoignable.
 */
export default function ConnectionGuard({ children }: { children: ReactNode }) {
  const { t } = useLanguage()
  const [state, setState] = useState<GuardState>('checking')

  const check = useCallback(async () => {
    try {
      await api.system.getHealth()
      setState('online')
    } catch {
      setState('offline')
    }
  }, [])

  useEffect(() => { check() }, [check])

  useEffect(() => {
    if (state !== 'offline') return
    const id = window.setInterval(check, 5000)
    return () => window.clearInterval(id)
  }, [state, check])

  if (state === 'online') return <>{children}</>

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="portal-card" style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
        {state === 'checking' ? (
          <>
            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', color: 'var(--primary)' }} />
            <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>{t('common.loading')}</p>
          </>
        ) : (
          <>
            <div style={{ fontSize: '2.6rem', marginBottom: 12 }}>⚡</div>
            <h2 style={{ marginBottom: 10 }}>{t('connection.title')}</h2>
            <p style={{ color: 'var(--text-sub)', marginBottom: 16 }}>{t('connection.desc')}</p>
            <div style={{ textAlign: 'start', marginBottom: 8, fontWeight: 700, color: 'var(--text-muted)' }}>{t('connection.command')}</div>
            <pre className="code-block">cd backend &amp;&amp; uvicorn main:app --port 8000 --reload</pre>
            <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center' }}>
              <button className="btn btn-primary rounded-pill" onClick={check}>
                <i className="fa-solid fa-rotate-right" /> {t('buttons.reconnect')}
              </button>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('connection.polling')}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
