import type { AuthState } from '@/types'

// ── Persistance de session (post-reboot) — classification pure et testable ──────
// Après un reboot Render, le compte admin (ragdom_config.sqlite éphémère) peut ne
// plus exister alors qu'un jeton env RAGDOM_AUTH_TOKEN demeure. `setup_required`
// revient `true` ; l'utilisateur doit pouvoir recréer le compte SANS perdre l'accès
// au jeton env déjà saisi/stocké. Ces helpers pilotent ce guidage.

export type SessionAction = 'none' | 'recreate_admin' | 'login' | 'capture_env_token'

export interface SessionGuidance {
  action: SessionAction
  /** Message orienté utilisateur (clé i18n) — jamais de secret. */
  messageKey: string
  /** Le jeton env (RAGDOM_AUTH_TOKEN) est encore disponible côté UI. */
  envTokenStillAvailable: boolean
}

/**
 * Classifie l'état d'authentification retourné par GET /auth/me.
 *  - already authenticated → none
 *  - setup_required (compte disparu après reboot) → recreate_admin
 *  - init_token_required → capture_env_token (le serveur exige le jeton env pour créer)
 *  - sinon (auth_required mais compte présent) → login
 */
export function classifySession(me: AuthState, hasStoredEnvToken: boolean): SessionGuidance {
  if (me.authenticated) {
    return { action: 'none', messageKey: 'auth.session_active', envTokenStillAvailable: hasStoredEnvToken }
  }
  if (me.setup_required) {
    return {
      action: 'recreate_admin',
      messageKey: 'auth.post_reboot_setup',
      envTokenStillAvailable: Boolean(me.init_token_required) && hasStoredEnvToken,
    }
  }
  if (me.init_token_required) {
    return {
      action: 'capture_env_token',
      messageKey: 'auth.init_token',
      envTokenStillAvailable: hasStoredEnvToken,
    }
  }
  return { action: 'login', messageKey: 'auth.login_title', envTokenStillAvailable: hasStoredEnvToken }
}

/** Le jeton env survit au reboot : on continue sans bloquer la (re)création. */
export function isEnvTokenStillValid(me: AuthState, hasStoredEnvToken: boolean): boolean {
  // Le jeton env reste utilisable tant que l'UI en détient un ET que le serveur
  // signale qu'un compte reste à créer (setup) — sinon il n'a plus de rôle.
  return hasStoredEnvToken && me.setup_required && !me.authenticated
}
