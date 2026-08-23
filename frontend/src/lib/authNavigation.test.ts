import { describe, expect, it } from 'vitest'
import { currentInternalPath, loginPathFor, safePostAuthPath } from './authNavigation'

describe('authentication deep-link navigation', () => {
  it('preserves an internal validation deep link through login', () => {
    const location = {
      pathname: '/automation',
      search: '?tab=validation&db=physics.sqlite&run=run-17&page=6&doc=document-42',
      hash: '#inspection',
    }
    const current = currentInternalPath(location)
    const login = loginPathFor(location)
    expect(new URLSearchParams(login.split('?')[1]).get('next')).toBe(current)
    expect(safePostAuthPath(new URLSearchParams(login.split('?')[1]).get('next'))).toBe(current)
  })

  it('rejects external, protocol-relative and unknown destinations', () => {
    expect(safePostAuthPath('https://evil.example/steal')).toBe('/automation')
    expect(safePostAuthPath('//evil.example/steal')).toBe('/automation')
    expect(safePostAuthPath('/\\evil.example/steal')).toBe('/automation')
    expect(safePostAuthPath('/login?next=%2Flogin')).toBe('/automation')
    expect(safePostAuthPath('/unknown')).toBe('/automation')
  })

  it('allows the public application routes and their coordinates', () => {
    expect(safePostAuthPath('/')).toBe('/')
    expect(safePostAuthPath('/library?db=chemistry.sqlite#page-3')).toBe('/library?db=chemistry.sqlite#page-3')
  })
})
