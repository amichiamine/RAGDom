import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { LlmProvider, LlmSetting } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import { Spinner, ErrorBanner } from '@/components/common/Feedback'

/**
 * V3.6 — ProvidersPanel (§ Fournisseurs LLM). Table des 7 providers avec
 * sauvegarde par ligne (PUT /llm/settings, payload partiel). RTL-safe.
 */
const PROVIDERS: LlmProvider[] = ['gemini', 'groq', 'openai', 'anthropic', 'lmstudio', 'make', 'ollama']

function basePlaceholder(provider: LlmProvider, defaultLabel: string): string {
  if (provider === 'lmstudio') return 'http://localhost:1234/v1'
  if (provider === 'make') return 'https://hook.eu1.make.com/…'
  return defaultLabel
}

// État par défaut pour un provider absent de la réponse serveur (jamais dur côté métier :
// la valeur affichée reste vide, on n'invente aucun modèle).
function blankSetting(provider: LlmProvider): LlmSetting {
  return { provider, active_model: null, is_enabled: false, priority: 0, base_url: null }
}

export default function ProvidersPanel() {
  const { t } = useLanguage()
  const toast = useToast()
  const [rows, setRows] = useState<Record<string, LlmSetting>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingRow, setSavingRow] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    api.llm.getSettings()
      .then(res => {
        const map: Record<string, LlmSetting> = {}
        for (const p of PROVIDERS) map[p] = blankSetting(p)
        for (const s of res.settings ?? []) map[s.provider] = { ...blankSetting(s.provider), ...s }
        setRows(map)
      })
      .catch(e => setError(e instanceof Error ? e.message : t('common.error_generic')))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(() => { load() }, [load])

  const patch = (provider: LlmProvider, next: Partial<LlmSetting>) =>
    setRows(prev => ({ ...prev, [provider]: { ...prev[provider], ...next } }))

  const save = async (provider: LlmProvider) => {
    const r = rows[provider]
    if (!r) return
    setSavingRow(provider)
    try {
      await api.llm.updateSettings(provider, {
        active_model: r.active_model && r.active_model.trim() ? r.active_model.trim() : null,
        is_enabled: r.is_enabled,
        priority: Number.isFinite(r.priority) ? r.priority : 0,
        base_url: r.base_url && r.base_url.trim() ? r.base_url.trim() : null,
      })
      toast.success(t('providers.saved'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error_generic'))
      load()
    } finally {
      setSavingRow(null)
    }
  }

  // Toggle « actif » : sauvegarde immédiate (feedback direct attendu sur un switch).
  const toggle = (provider: LlmProvider, enabled: boolean) => {
    patch(provider, { is_enabled: enabled })
    // On sauvegarde après application de l'état local.
    void (async () => {
      setSavingRow(provider)
      try {
        await api.llm.updateSettings(provider, { is_enabled: enabled })
        toast.success(t('providers.saved'))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('common.error_generic'))
        load()
      } finally { setSavingRow(null) }
    })()
  }

  return (
    <div className="auto-card">
      <h3 style={{ marginBottom: 14 }}>🔌 {t('providers.title')}</h3>

      {loading ? <Spinner /> : error ? <ErrorBanner message={error} onRetry={load} /> : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table providers-table">
              <thead>
                <tr>
                  <th>{t('providers.provider')}</th>
                  <th style={{ textAlign: 'center' }}>{t('providers.enabled')}</th>
                  <th style={{ width: 90 }}>{t('providers.priority')}</th>
                  <th>{t('providers.model')}</th>
                  <th>{t('providers.base_url')}</th>
                  <th style={{ width: 60 }}>{t('pipeline.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {PROVIDERS.map(p => {
                  const r = rows[p] ?? blankSetting(p)
                  const busy = savingRow === p
                  return (
                    <tr key={p}>
                      <td><span className="badge badge-secondary">{p}</span></td>
                      <td style={{ textAlign: 'center' }}>
                        <label className="switch">
                          <input type="checkbox" checked={r.is_enabled} disabled={busy} onChange={e => toggle(p, e.target.checked)} />
                          <span className="slider-track" /><span className="slider-thumb" />
                        </label>
                      </td>
                      <td>
                        <input
                          className="form-input providers-num" type="number" min={0} step={1}
                          value={Number.isFinite(r.priority) ? r.priority : 0}
                          onChange={e => patch(p, { priority: Number(e.target.value) })}
                          onBlur={() => save(p)}
                        />
                      </td>
                      <td>
                        <input
                          className="form-input" type="text" value={r.active_model ?? ''}
                          placeholder="—"
                          onChange={e => patch(p, { active_model: e.target.value })}
                          onBlur={() => save(p)}
                        />
                      </td>
                      <td>
                        <input
                          className="form-input form-mono" type="text" value={r.base_url ?? ''}
                          placeholder={basePlaceholder(p, t('providers.base_url_default'))}
                          onChange={e => patch(p, { base_url: e.target.value })}
                          onBlur={() => save(p)}
                        />
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-outline-success" title={t('providers.save_row')}
                          disabled={busy} onClick={() => save(p)}
                        >
                          {busy ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-check" />}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="hint providers-note" style={{ marginTop: 12 }}>{t('providers.note')}</p>
        </>
      )}
    </div>
  )
}
