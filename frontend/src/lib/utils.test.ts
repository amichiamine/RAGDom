import { describe, expect, it } from 'vitest'
import { domainBadgeStyle, domainHue, formatBytes, formatDate, formatNumber } from './utils'

describe('formatting helpers', () => {
  it('formats byte sizes at stable binary boundaries', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB')
    expect(formatBytes(128 * 1024 * 1024)).toBe('128 MB')
  })

  it('formats counts with the application locale contract', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(1234567)).toBe('1,234,567')
  })

  it('keeps missing and invalid dates readable', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})

describe('domain color helpers', () => {
  it('derives deterministic theme variants from a domain name', () => {
    expect(domainHue('algebra')).toBe(domainHue('algebra'))
    expect(domainHue('algebra')).not.toBe(domainHue('chemistry'))

    const dark = domainBadgeStyle('algebra', 'dark')
    const light = domainBadgeStyle('algebra', 'light')
    expect(dark.color).toContain(`hsl(${domainHue('algebra')},`)
    expect(light.color).toContain(`hsl(${domainHue('algebra')},`)
    expect(dark.background).not.toBe(light.background)
  })
})
