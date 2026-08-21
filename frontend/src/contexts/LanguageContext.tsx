import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type Language = 'ar' | 'fr' | 'en'

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  isRtl: boolean;
  t: (key: string) => string;
}

// Dictionnaires de base pour l'UI (locales)
import arLocale from '@/locales/ar.json'
import frLocale from '@/locales/fr.json'
import enLocale from '@/locales/en.json'

const translations: Record<Language, Record<string, any>> = {
  ar: arLocale,
  fr: frLocale,
  en: enLocale,
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    return (localStorage.getItem('ragdom_lang') as Language) || 'ar' // ARABE PAR DÉFAUT ABSOLU
  })

  const isRtl = language === 'ar'

  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem('ragdom_lang', lang)
  }

  useEffect(() => {
    // Bascule dynamique RTL ↔ LTR selon la langue active
    document.documentElement.setAttribute('lang', language)
    document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr')
  }, [language, isRtl])

  // Helper de traduction imbriqué : t('dashboard.title')
  const t = (key: string): string => {
    const keys = key.split('.')
    let current: any = translations[language] || translations.ar
    for (const k of keys) {
      if (current && typeof current === 'object' && k in current) {
        current = current[k]
      } else {
        // Fallback sur l'Arabe si la clé est manquante
        let fallback: any = translations.ar
        for (const fk of keys) {
          if (fallback && typeof fallback === 'object' && fk in fallback) fallback = fallback[fk]
          else return key
        }
        return typeof fallback === 'string' ? fallback : key
      }
    }
    return typeof current === 'string' ? current : key
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, isRtl, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider')
  return ctx
}
