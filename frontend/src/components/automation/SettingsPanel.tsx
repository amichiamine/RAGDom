import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, getAdminToken, setAdminToken } from '@/lib/api'
import type { AppSettings, AuthState } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import { Spinner, ErrorBanner } from '@/components/common/Feedback'

const DEFAULTS = { vec_distance_threshold: 0.45, bm25_score_threshold: -1.5 }

/** §7.8 SettingsPanel — 2 sliders seuils via getSettings/updateSetting. */
export default function SettingsPanel() {
  const { t } = useLanguage()
  const toast = useToast()
  const navigate = useNavigate()
  const [adminToken, setTokenState] = useState<string>(() => getAdminToken() ?? '')
  const [tokenSaved, setTokenSaved] = useState<boolean>(() => Boolean(getAdminToken()))

  // ── État de session (V3.6) : affiché quand /auth/me → authenticated + username ──
  const [auth, setAuth] = useState<AuthState | null>(null)
  useEffect(() => {
    let cancelled = false
    api.auth.me().then(me => { if (!cancelled) setAuth(me) }).catch(() => { if (!cancelled) setAuth(null) })
    return () => { cancelled = true }
  }, [])

  const logout = async () => {
    try { await api.auth.logout() } catch { /* on force la déconnexion locale de toute façon */ }
    setTokenState(''); setTokenSaved(false)
    navigate('/login', { replace: true })
  }

  const saveToken = () => {
    setAdminToken(adminToken || null)
    setTokenSaved(Boolean(adminToken.trim()))
    if (adminToken.trim()) toast.success('Jeton d\'administration enregistré (session)')
    else toast.success('Jeton effacé')
  }
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true); setError(null)
    api.system.getSettings()
      .then(res => setSettings(res.settings))
      .catch(e => setError(e instanceof Error ? e.message : t('common.error_generic')))
      .finally(() => setLoading(false))
  }

  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async (key: keyof AppSettings, value: number) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev)
    try {
      await api.system.updateSetting(key, String(value))
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')); load() }
  }

  const restore = async () => {
    await commit('vec_distance_threshold', DEFAULTS.vec_distance_threshold)
    await commit('bm25_score_threshold', DEFAULTS.bm25_score_threshold)
    toast.success(t('buttons.restore_defaults'))
  }

  return (
    <div className="auto-card">
      <h3 style={{ marginBottom: 14 }}><i className="fa-solid fa-sliders" /> {t('automation.settings_panel')}</h3>
      {loading ? <Spinner /> : error ? <ErrorBanner message={error} onRetry={load} /> : settings && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Phase 7 — jeton d'administration (mode atelier web) */}
          <div className="admin-token-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <strong>🔑 Jeton d'administration (web)</strong>
              <span className={tokenSaved ? 'badge-token-on' : 'badge-token-off'}>
                {tokenSaved ? 'actif (session)' : 'non défini'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="password"
                className="admin-token-input"
                placeholder="RAGDOM_AUTH_TOKEN du serveur (atelier)"
                value={adminToken}
                onChange={e => setTokenState(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveToken() }}
                autoComplete="off"
              />
              <button className="btn btn-primary" onClick={saveToken}>Enregistrer</button>
            </div>
            <p className="hint" style={{ marginTop: 6 }}>
              Requis uniquement sur un déploiement web en mode atelier : envoyé en
              Authorization Bearer sur les actions d'administration (ingestion, purge, clés…).
              Stocké dans cet onglet seulement — jamais sur le serveur ni sur le disque.
            </p>
          </div>

          {/* État de session (V3.6) — affiché uniquement si authentifié avec username */}
          {auth?.authenticated && auth.username && (
            <div className="session-state-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <i className="fa-solid fa-user-check" style={{ color: 'var(--success)' }} />
                <span style={{ fontWeight: 700 }}>{t('auth.logged_in_as')} : </span>
                <span className="badge badge-success">{auth.username}</span>
                {auth.readonly && <span className="badge badge-warning">read-only</span>}
              </div>
              <button className="btn btn-sm btn-outline-danger" onClick={logout}>
                <i className="fa-solid fa-right-from-bracket" /> {t('auth.logout')}
              </button>
            </div>
          )}
          <SliderRow
            label={t('settings.vec_threshold')}
            hint={t('settings.vec_threshold_hint')}
            min={0.1} max={1.0} step={0.05}
            value={settings.vec_distance_threshold}
            onChange={v => commit('vec_distance_threshold', v)}
          />
          <SliderRow
            label={t('settings.bm25_threshold')}
            hint={t('settings.bm25_threshold_hint')}
            min={-10} max={0} step={0.5}
            value={settings.bm25_score_threshold}
            onChange={v => commit('bm25_score_threshold', v)}
          />
          <div>
            <button className="btn btn-outline-secondary btn-sm" onClick={restore}>
              <i className="fa-solid fa-rotate-left" /> {t('buttons.restore_defaults')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SliderRow({ label, hint, min, max, step, value, onChange }: {
  label: string; hint: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontWeight: 700 }}>{label}</span>
        <span className="badge badge-subtle font-num">{value}</span>
      </div>
      <input className="range-slider" type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{hint}</div>
    </div>
  )
}
