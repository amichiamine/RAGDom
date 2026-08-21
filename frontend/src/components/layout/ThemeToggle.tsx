import { useTheme } from '@/contexts/ThemeContext'
import { useLanguage } from '@/contexts/LanguageContext'

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const { t } = useLanguage()
  const isDark = theme === 'dark'
  return (
    <button
      className="theme-toggle-btn"
      onClick={toggleTheme}
      aria-label={t('theme.toggle')}
      title={t('theme.toggle')}
    >
      <i className={`fa-solid ${isDark ? 'fa-moon' : 'fa-sun'}`} />
      <span>{isDark ? t('theme.dark') : t('theme.light')}</span>
    </button>
  )
}
