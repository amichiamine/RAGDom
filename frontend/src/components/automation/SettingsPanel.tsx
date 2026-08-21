import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { AppSettings } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import { Spinner, ErrorBanner } from '@/components/common/Feedback'

const DEFAULTS = { vec_distance_threshold: 0.45, bm25_score_threshold: -1.5 }

/** §7.8 SettingsPanel — 2 sliders seuils via getSettings/updateSetting. */
export default function SettingsPanel() {
  const { t } = useLanguage()
  const toast = useToast()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true); setError(null)
    api.system.getSettings()
      .then(res => setSettings(res.settings))
      .catch(e => setError(e instanceof Error ? e.message : t('common.error_generic')))
      .finally(() => setLoading(false))
  }

  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async (key: keyof AppSettings, value: number) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev)
    try {
      await api.system.updateSetting(key, String(value))
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')); load() }
  }

  const restore = async () => {
    await commit('vec_distance_threshold', DEFAULTS.vec_distance_threshold)
    await commit('bm25_score_threshold', DEFAULTS.bm25_score_threshold)
    toast.success(t('buttons.restore_defaults'))
  }

  return (
    <div className="auto-card">
      <h3 style={{ marginBottom: 14 }}><i className="fa-solid fa-sliders" /> {t('automation.settings_panel')}</h3>
      {loading ? <Spinner /> : error ? <ErrorBanner message={error} onRetry={load} /> : settings && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <SliderRow
            label={t('settings.vec_threshold')}
            hint={t('settings.vec_threshold_hint')}
            min={0.1} max={1.0} step={0.05}
            value={settings.vec_distance_threshold}
            onChange={v => commit('vec_distance_threshold', v)}
          />
          <SliderRow
            label={t('settings.bm25_threshold')}
            hint={t('settings.bm25_threshold_hint')}
            min={-10} max={0} step={0.5}
            value={settings.bm25_score_threshold}
            onChange={v => commit('bm25_score_threshold', v)}
          />
          <div>
            <button className="btn btn-outline-secondary btn-sm" onClick={restore}>
              <i className="fa-solid fa-rotate-left" /> {t('buttons.restore_defaults')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SliderRow({ label, hint, min, max, step, value, onChange }: {
  label: string; hint: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontWeight: 700 }}>{label}</span>
        <span className="badge badge-subtle font-num">{value}</span>
      </div>
      <input className="range-slider" type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{hint}</div>
    </div>
  )
}
