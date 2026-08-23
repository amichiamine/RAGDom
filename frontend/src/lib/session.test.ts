import { describe, expect, it } from 'vitest'
import { classifySession, isEnvTokenStillValid } from './session'
import type { AuthState } from '@/types'

const base: AuthState = {
  auth_required: false, setup_required: false, authenticated: false,
  username: null, readonly: false,
}

describe('classifySession', () => {
  it('returns none when authenticated (token env actif non bloquant)', () => {
    expect(classifySession({ ...base, authenticated: true, username: '__jeton_env__' }, true).action).toBe('none')
  })

  it('detects post-reboot missing admin account', () => {
    const g = classifySession({ ...base, setup_required: true, auth_required: true }, false)
    expect(g.action).toBe('recreate_admin')
  })

  it('keeps env token available when setup_required + init_token_required + token stored', () => {
    const me = { ...base, setup_required: true, init_token_required: true, auth_required: true }
    const g = classifySession(me, true)
    expect(g.action).toBe('recreate_admin')
    expect(g.envTokenStillAvailable).toBe(true)
  })

  it('falls back to login when a user exists but no session', () => {
    expect(classifySession({ ...base, auth_required: true }, false).action).toBe('login')
  })
})

describe('isEnvTokenStillValid', () => {
  it('is true only for an unauthenticated setup with a stored token', () => {
    const me = { ...base, setup_required: true, authenticated: false }
    expect(isEnvTokenStillValid(me, true)).toBe(true)
    expect(isEnvTokenStillValid(me, false)).toBe(false)
  })
  it('is false once authenticated or when no setup required', () => {
    expect(isEnvTokenStillValid({ ...base, setup_required: true, authenticated: true }, true)).toBe(false)
    expect(isEnvTokenStillValid({ ...base, setup_required: false, authenticated: false }, true)).toBe(false)
  })
})
