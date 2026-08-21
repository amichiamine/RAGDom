import { useEffect, useState, useMemo, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useLanguage } from '@/contexts/LanguageContext'
import { Spinner } from '@/components/common/Feedback'

/**
 * V3.6 — LoginView (§ auth atelier web). Deux modes pilotés par GET /auth/me :
 *  - setup_required → « Créer le compte administrateur » (+ jeton d'initialisation
 *    affiché uniquement si POST /auth/setup renvoie 401 : jeton env exigé serveur).
 *  - sinon → « Connexion ».
 * Succès → navigate('/automation'). RTL-safe (flux vertical, marges logiques).
 */
const USERNAME_RE = /^[A-Za-z0-9_\-.]{3,64}$/

export default function LoginView() {
  const { t } = useLanguage()
  const navigate = useNavigate()

  const [checking, setChecking] = useState(true)
  const [setupMode, setSetupMode] = useState(false)
  const [needsInitToken, setNeedsInitToken] = useState(false)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [initToken, setInitToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // ── Mode initial via /auth/me ──
  useEffect(() => {
    let cancelled = false
    api.auth.me()
      .then(me => {
        if (cancelled) return
        // Déjà connecté : pas de raison de rester sur /login.
        if (me.authenticated) { navigate('/automation', { replace: true }); return }
        setSetupMode(me.setup_required)
      })
      .catch(() => { if (!cancelled) setSetupMode(false) })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [navigate])

  const title = setupMode ? t('auth.setup_title') : t('auth.login_title')
  const subtitle = setupMode ? t('auth.setup_subtitle') : t('auth.login_subtitle')

  const clientError = useMemo(() => {
    if (!username.trim()) return null
    if (!USERNAME_RE.test(username.trim())) return t('auth.username_invalid')
    if (setupMode) {
      if (password && password.length < 8) return t('auth.password_too_short')
      if (confirm && password !== confirm) return t('auth.password_mismatch')
    }
    return null
  }, [username, password, confirm, setupMode, t])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const u = username.trim()
    if (!USERNAME_RE.test(u)) { setError(t('auth.username_invalid')); return }
    if (setupMode) {
      if (password.length < 8) { setError(t('auth.password_too_short')); return }
      if (password !== confirm) { setError(t('auth.password_mismatch')); return }
    } else if (!password) { return }

    setBusy(true)
    try {
      if (setupMode) {
        await api.auth.setup(u, password, needsInitToken ? initToken : undefined)
      } else {
        await api.auth.login(u, password)
      }
      navigate('/automation', { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('common.error_generic')
      // Setup + 401 : le serveur exige le jeton d'initialisation → révéler le champ.
      if (setupMode && /401|unauthor|jeton|token/i.test(msg)) {
        setNeedsInitToken(true)
      }
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  if (checking) {
    return (
      <div className="auth-shell">
        <div className="auth-card"><Spinner label={t('common.loading')} /></div>
      </div>
    )
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo"><i className="fa-solid fa-shield-halved" /></div>
        <h1 className="auth-title">{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>

        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-username">{t('auth.username')}</label>
          <input
            id="auth-username" className="form-input" type="text" autoComplete="username"
            value={username} onChange={e => setUsername(e.target.value)} autoFocus
          />
          {setupMode && <span className="auth-hint">{t('auth.username_hint')}</span>}
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-password">{t('auth.password')}</label>
          <input
            id="auth-password" className="form-input" type="password"
            autoComplete={setupMode ? 'new-password' : 'current-password'}
            value={password} onChange={e => setPassword(e.target.value)}
          />
          {setupMode && <span className="auth-hint">{t('auth.password_hint')}</span>}
        </div>

        {setupMode && (
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-confirm">{t('auth.confirm_password')}</label>
            <input
              id="auth-confirm" className="form-input" type="password" autoComplete="new-password"
              value={confirm} onChange={e => setConfirm(e.target.value)}
            />
          </div>
        )}

        {setupMode && needsInitToken && (
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-init">🔑 {t('auth.init_token')}</label>
            <input
              id="auth-init" className="form-input form-mono" type="password" autoComplete="off"
              value={initToken} onChange={e => setInitToken(e.target.value)}
            />
            <span className="auth-hint">{t('auth.init_token_hint')}</span>
          </div>
        )}

        {(error || clientError) && (
          <div className="auth-error" role="alert">
            <i className="fa-solid fa-circle-exclamation" /> <span>{error ?? clientError}</span>
          </div>
        )}

        <button className="btn btn-primary auth-submit" type="submit" disabled={busy || Boolean(clientError)}>
          {busy
            ? <><i className="fa-solid fa-spinner fa-spin" /> {t('common.loading')}</>
            : <><i className="fa-solid fa-right-to-bracket" /> {setupMode ? t('auth.submit_setup') : t('auth.submit_login')}</>}
        </button>
      </form>
    </div>
  )
}
