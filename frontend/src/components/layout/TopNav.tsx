import { Link } from 'react-router-dom'
import { useLanguage } from '@/contexts/LanguageContext'
import ThemeToggle from '@/components/layout/ThemeToggle'
import LanguageSelector from '@/components/layout/LanguageSelector'

interface Props {
  variant: 'index' | 'automation'
}

/** Topbar partagée des vues Dashboard & Automation (§5.1 / §5.3). */
export default function TopNav({ variant }: Props) {
  const { t } = useLanguage()
  const isIndex = variant === 'index'
  const logoIcon = isIndex ? 'fa-atom' : 'fa-gears'
  const logoBg = isIndex ? 'var(--engine-accent)' : 'var(--success)'
  const title = isIndex ? t('app.title') : t('automation.title')

  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 1020, background: 'var(--header-bg)',
        backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border-color)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <div className="container-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 14, background: logoBg, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem',
            boxShadow: '0 4px 14px rgba(37,99,235,0.3)',
          }}>
            <i className={`fa-solid ${logoIcon}`} />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-heading)' }}>{title}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('app.subtitle')}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {isIndex ? (
            <Link to="/automation" className="btn btn-outline-success rounded-pill">
              <i className="fa-solid fa-gears" /> {t('nav.automation')}
            </Link>
          ) : (
            <Link to="/" className="btn btn-outline-primary rounded-pill">
              <i className="fa-solid fa-gauge" /> {t('nav.dashboard')}
            </Link>
          )}
          <LanguageSelector />
          <ThemeToggle />
          <Link to="/library" className="btn btn-primary rounded-pill">
            <i className="fa-solid fa-book-open" /> {t('nav.library')}
          </Link>
        </div>
      </div>
    </header>
  )
}
