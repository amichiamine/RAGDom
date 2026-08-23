const DEFAULT_POST_AUTH_PATH = '/automation'
const INTERNAL_APP_PATHS = new Set(['/', '/library', '/automation'])

export interface BrowserLocationLike {
  pathname: string
  search: string
  hash: string
}

export function currentInternalPath(location: BrowserLocationLike): string {
  return `${location.pathname}${location.search}${location.hash}`
}

export function safePostAuthPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return DEFAULT_POST_AUTH_PATH
  }
  try {
    const parsed = new URL(raw, 'https://ragdom.internal')
    if (parsed.origin !== 'https://ragdom.internal' || !INTERNAL_APP_PATHS.has(parsed.pathname)) {
      return DEFAULT_POST_AUTH_PATH
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return DEFAULT_POST_AUTH_PATH
  }
}

export function loginPathFor(location: BrowserLocationLike): string {
  const next = safePostAuthPath(currentInternalPath(location))
  return `/login?next=${encodeURIComponent(next)}`
}
