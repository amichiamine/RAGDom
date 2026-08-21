import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDatabase } from '@/contexts/DatabaseContext'
import { useLanguage } from '@/contexts/LanguageContext'
import { useEngine } from '@/contexts/EngineContext'
import TopNav from '@/components/layout/TopNav'
import StatMetricCard from '@/components/index/StatMetricCard'
import OnboardingEmptyState from '@/components/common/OnboardingEmptyState'
import { SkeletonCards, ErrorBanner } from '@/components/common/Feedback'
import { formatBytes, formatNumber } from '@/lib/utils'

export default function IndexView() {
  const { databases, isLoading, refresh } = useDatabase()
  const { t } = useLanguage()
  const { engines, activeEngine } = useEngine()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const totals = useMemo(() => {
    return databases.reduce(
      (acc, db) => {
        acc.documents += db.metrics.document_count
        acc.chunks += db.metrics.chunk_count
        acc.artifacts += db.metrics.artifact_count
        acc.pages += db.metrics.page_count
        acc.indexedPages += db.metrics.indexed_page_count
        acc.size += db.size_bytes
        return acc
      },
      { documents: 0, chunks: 0, artifacts: 0, pages: 0, indexedPages: 0, size: 0 }
    )
  }, [databases])

  const kpis = [
    { icon: 'fa-file-pdf', color: 'var(--primary)', value: totals.documents, label: t('kpi.documents') },
    { icon: 'fa-layer-group', color: 'var(--info)', value: totals.chunks, label: t('kpi.chunks') },
    { icon: 'fa-atom', color: 'var(--warning)', value: totals.artifacts, label: t('kpi.artifacts') },
    { icon: 'fa-book-open', color: 'var(--success)', value: totals.pages, label: t('kpi.pages') },
    { icon: 'fa-circle-check', color: 'var(--success)', value: totals.indexedPages, label: t('kpi.indexed_pages') },
    { icon: 'fa-database', color: 'var(--text-muted)', value: databases.length, label: t('kpi.databases') },
  ]

  const goSearch = () => {
    navigate(query.trim() ? `/library?q=${encodeURIComponent(query.trim())}` : '/library')
  }

  return (
    <div>
      <TopNav variant="index" />

      <main className="container-app" style={{ paddingBottom: 40 }}>
        {/* Hero */}
        <section className="hero-banner">
          <div className="hero-badge"><i className="fa-solid fa-certificate" /> {t('hero.badge')}</div>
          <h1 className="hero-title">{t('hero.title')}</h1>
          <p className="hero-desc">{t('hero.desc')}</p>
          <div className="hero-search-box">
            <input
              className="hero-search-input"
              placeholder={t('hero.search_placeholder')}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') goSearch() }}
              aria-label={t('hero.search_placeholder')}
            />
            <i className="fa-solid fa-magnifying-glass hero-search-icon" />
          </div>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn-launch-hero" onClick={goSearch}>
              <i className="fa-solid fa-rocket" /> {t('hero.launch')}
            </button>
            <a href="#dbsSection" className="btn-viewer-hero">
              <i className="fa-solid fa-database" /> {t('hero.view_dbs')}
            </a>
          </div>
        </section>

        {/* KPIs */}
        {isLoading ? (
          <div className="grid-kpi" style={{ marginBottom: 40 }}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 130 }} />)}
          </div>
        ) : (
          <div className="grid-kpi" style={{ marginBottom: 40 }}>
            {kpis.map((k, i) => (
              <StatMetricCard key={i} icon={k.icon} colorVar={k.color} value={k.value} label={k.label} />
            ))}
          </div>
        )}

        {/* Moteurs détectés (V3.6 — badge moteur déplacé du header vers l'accueil) */}
        {engines.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ marginBottom: 18 }}>
              <i className="fa-solid fa-microchip" /> {t('engines.title')}
              <span className="badge badge-subtle" style={{ marginInlineStart: 10 }}>
                {t('engines.detected')}: {formatNumber(engines.length)}
              </span>
            </h2>
            <div className="engines-grid">
              {engines.map(e => {
                const isActive = activeEngine ? e.id === activeEngine.id : e.status === 'active'
                return (
                  <div key={e.id} className={`engine-tile${isActive ? ' is-active' : ''}`}>
                    <span className="engine-tile-dot" style={{ background: e.accent }} aria-hidden="true" />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="engine-tile-label" dir="auto">{e.label}</div>
                      <div className="engine-tile-version">v{e.version}</div>
                    </div>
                    {isActive && <span className="badge badge-success">{t('engines.active')}</span>}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {databases.length === 0 && !isLoading ? (
          <OnboardingEmptyState />
        ) : (
          <>
            {/* Bases disponibles */}
            <section style={{ marginBottom: 40 }}>
              <h2 style={{ marginBottom: 18 }}><i className="fa-solid fa-server" /> {t('sections.databases')}</h2>
              {isLoading ? <SkeletonCards /> : (
                <div className="grid-cards">
                  {databases.map(db => (
                    <div key={db.filename} className="portal-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <h3 style={{ fontSize: '1.05rem', wordBreak: 'break-all' }}>{db.filename}</h3>
                          <span className="badge badge-success"><i className="fa-solid fa-circle" style={{ fontSize: '0.5rem' }} /> {t('db.active')}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
                          <Metric label={t('kpi.documents')} value={db.metrics.document_count} />
                          <Metric label={t('kpi.chunks')} value={db.metrics.chunk_count} />
                          <Metric label={t('kpi.pages')} value={db.metrics.page_count} />
                          <Metric label={t('kpi.artifacts')} value={db.metrics.artifact_count} />
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          <i className="fa-solid fa-hard-drive" /> {formatBytes(db.size_bytes)}
                        </div>
                      </div>
                      <button
                        className="btn btn-primary rounded-pill"
                        style={{ marginTop: 16, width: '100%' }}
                        onClick={() => navigate(`/library?db=${encodeURIComponent(db.filename)}`)}
                      >
                        <i className="fa-solid fa-arrow-right-to-bracket" /> {t('db.open')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Télémétrie */}
            <section id="dbsSection" style={{ marginBottom: 40 }}>
              <h2 style={{ marginBottom: 18 }}><i className="fa-solid fa-chart-line" /> {t('sections.telemetry')}</h2>
              <div className="portal-card">
                {databases.length === 0 && <ErrorBanner message={t('common.empty')} />}
                {databases.map(db => (
                  <div key={db.filename} className="db-badge-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <i className="fa-solid fa-database" style={{ color: 'var(--primary)' }} />
                      <span style={{ fontWeight: 700, wordBreak: 'break-all' }}>{db.filename}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className="badge badge-subtle">{t('db.size')}: {formatBytes(db.size_bytes)}</span>
                      <span className="badge badge-subtle">{t('kpi.chunks')}: {formatNumber(db.metrics.chunk_count)}</span>
                      <span className="badge badge-subtle">{t('kpi.pages')}: {formatNumber(db.metrics.page_count)}</span>
                      <span className="badge badge-subtle">{t('kpi.indexed_pages')}: {formatNumber(db.metrics.indexed_page_count)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      <footer>
        <div className="container-app">
          <div>{t('footer.line1')}</div>
          <div style={{ marginTop: 6 }}>{t('footer.line2')}</div>
          <button className="btn btn-outline-secondary btn-sm" style={{ marginTop: 12 }} onClick={refresh}>
            <i className="fa-solid fa-rotate-right" /> {t('buttons.retry')}
          </button>
        </div>
      </footer>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: 'var(--bg-card-inner)', borderRadius: 10, padding: '8px 10px' }}>
      <div className="font-num" style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-heading)' }}>{formatNumber(value)}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}
