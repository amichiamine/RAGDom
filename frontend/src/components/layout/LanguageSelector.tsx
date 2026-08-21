import { useState, useRef, useEffect } from 'react'
import { useLanguage, type Language } from '@/contexts/LanguageContext'

const OPTIONS: Array<{ code: Language; labelKey: string; native: string }> = [
  { code: 'ar', labelKey: 'lang.ar', native: 'العربية' },
  { code: 'fr', labelKey: 'lang.fr', native: 'Français' },
  { code: 'en', labelKey: 'lang.en', native: 'English' },
]

export default function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [])

  const current = OPTIONS.find(o => o.code === language) ?? OPTIONS[0]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="theme-toggle-btn"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('lang.label')}
      >
        <i className="fa-solid fa-globe" />
        <span>{current.native}</span>
        <i className="fa-solid fa-chevron-down" style={{ fontSize: '0.7rem' }} />
      </button>
      {open && (
        <div className="dropdown-menu" role="listbox" style={{ position: 'absolute', top: 'calc(100% + 8px)', insetInlineEnd: 0 }}>
          {OPTIONS.map(o => (
            <button
              key={o.code}
              role="option"
              aria-selected={o.code === language}
              className={`dropdown-item ${o.code === language ? 'active' : ''}`}
              onClick={() => { setLanguage(o.code); setOpen(false) }}
            >
              <span style={{ flex: 1 }}>{o.native}</span>
              {o.code === language && <i className="fa-solid fa-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
