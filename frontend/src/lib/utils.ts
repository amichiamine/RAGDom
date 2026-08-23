import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / Math.pow(1024, i)
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 2)} ${units[i]}`
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n ?? 0)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

const LANGUAGE_LOCALES = { ar: 'ar-DZ', fr: 'fr-FR', en: 'en-GB' } as const

export function formatDateTime(iso: string | null | undefined, language: keyof typeof LANGUAGE_LOCALES): string {
  if (!iso) return '—'
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso)
    ? `${iso.replace(' ', 'T')}Z`
    : iso
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(LANGUAGE_LOCALES[language], {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

// PARTIE 8.4 — teinte de domaine dérivée du nom (Zéro Dogme, aucune couleur codée en dur)
export function domainHue(name: string): number {
  return [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360
}

export function domainBadgeStyle(name: string, theme: 'dark' | 'light'): { color: string; background: string; border: string } {
  const hue = domainHue(name)
  if (theme === 'dark') {
    return {
      color: `hsl(${hue}, 65%, 70%)`,
      background: `hsl(${hue}, 45%, 16%)`,
      border: `1px solid hsl(${hue}, 45%, 26%)`,
    }
  }
  return {
    color: `hsl(${hue}, 55%, 42%)`,
    background: `hsl(${hue}, 60%, 94%)`,
    border: `1px solid hsl(${hue}, 55%, 82%)`,
  }
}
