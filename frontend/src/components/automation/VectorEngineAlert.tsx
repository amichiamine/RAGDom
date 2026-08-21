import { useState } from 'react'
import { api } from '@/lib/api'
import type { SystemHealth } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'

interface Props {
  health: SystemHealth | null
  onRefresh: () => void
}

/** §5.3 VectorEngineAlert — bandeau + switch strict + bouton test. */
export default function VectorEngineAlert({ health, onRefresh }: Props) {
  const { t } = useLanguage()
  const toast = useToast()
  const [testing, setTesting] = useState(false)
  const [strictBusy, setStrictBusy] = useState(false)

  const isFallback = health?.vector_engine === 'fts5-fallback'

  const runTest = async () => {
    setTesting(true)
    try {
      const res = await api.system.testVectorEngine()
      toast.push(res.success ? 'success' : 'error', res.message)
      onRefresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error_generic'))
    } finally { setTesting(false) }
  }

  const toggleStrict = async (checked: boolean) => {
    setStrictBusy(true)
    try {
      const res = await api.system.toggleVectorStrict(checked)
      toast.success(res.message)
      onRefresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error_generic'))
    } finally { setStrictBusy(false) }
  }

  return (
    <div className="auto-card" style={isFallback ? { borderColor: 'rgba(245,158,11,0.5)', background: 'rgba(245,158,11,0.06)' } : undefined}>
      <h3 style={{ marginBottom: 12 }}><i className="fa-solid fa-vector-square" /> {t('automation.vector_alert')}</h3>

      {!health ? (
        <div style={{ color: 'var(--text-muted)' }}><i className="fa-solid fa-spinner fa-spin" /> {t('common.loading')}</div>
      ) : isFallback ? (
        <div>
          <div className="badge badge-warning" style={{ marginBottom: 8 }}>
            <i className="fa-solid fa-triangle-exclamation" /> FTS5 BM25 fallback
          </div>
          <p style={{ color: 'var(--warning)', marginBottom: 12 }}>⚠️ {t('automation.engine_fallback')}</p>
          <button className="btn btn-sm btn-outline-warning" onClick={runTest} disabled={testing}>
            {testing ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-flask" />} {t('automation.test_vec')}
          </button>
        </div>
      ) : (
        <div>
          <div className="badge badge-success" style={{ marginBottom: 8 }}>
            <i className="fa-solid fa-circle-check" /> 🟢 {t('automation.engine_hybrid_active')}
          </div>
          <p style={{ color: 'var(--text-sub)' }}>{t('automation.engine_hybrid_msg')}</p>
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <label className="switch">
          <input type="checkbox" checked={!!health?.force_sqlite_vec} disabled={strictBusy} onChange={e => toggleStrict(e.target.checked)} />
          <span className="slider-track" /><span className="slider-thumb" />
        </label>
        <div>
          <div style={{ fontWeight: 700 }}>{t('automation.force_strict')}</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t('automation.force_strict_hint')}</div>
        </div>
      </div>
    </div>
  )
}
