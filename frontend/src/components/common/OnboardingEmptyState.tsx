import { Link } from 'react-router-dom'
import { useLanguage } from '@/contexts/LanguageContext'

/** §7.12 — guide 3 étapes affiché quand databases.length === 0. */
export default function OnboardingEmptyState() {
  const { t } = useLanguage()
  const steps = [
    { icon: 'fa-file-arrow-up', title: t('onboarding.step1_title'), desc: t('onboarding.step1_desc') },
    { icon: 'fa-gears', title: t('onboarding.step2_title'), desc: t('onboarding.step2_desc') },
    { icon: 'fa-book-open', title: t('onboarding.step3_title'), desc: t('onboarding.step3_desc') },
  ]
  return (
    <div className="portal-card" style={{ maxWidth: 900, margin: '40px auto', textAlign: 'center' }}>
      <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>📚</div>
      <h2 style={{ marginBottom: 24 }}>{t('onboarding.title')}</h2>
      <div className="grid-cards" style={{ marginBottom: 28 }}>
        {steps.map((s, i) => (
          <div key={i} className="content-box" style={{ textAlign: 'center' }}>
            <i className={`fa-solid ${s.icon}`} style={{ fontSize: '1.8rem', color: 'var(--engine-accent)', marginBottom: 12 }} />
            <h4 style={{ marginBottom: 8 }}>{s.title}</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem' }}>{s.desc}</p>
          </div>
        ))}
      </div>
      <Link to="/automation" className="btn btn-primary rounded-pill btn-lg">
        <i className="fa-solid fa-arrow-right-to-bracket" /> {t('onboarding.cta')}
      </Link>
    </div>
  )
}
