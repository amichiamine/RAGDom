import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { LlmKey, LlmProvider, LlmSetting } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import { Spinner, ErrorBanner } from '@/components/common/Feedback'

/**
 * V3.7 — Panneau UNIFIÉ « 🔌 Fournisseurs LLM ». Une seule carte pleine largeur,
 * une section (accordéon) par fournisseur regroupant : état + clés (add/test/delete)
 * + modèle actif (SELECT alimenté par détection LIVE) + URL de base. RTL-safe.
 * AUCUN modèle codé en dur : tout provient de GET /llm/providers/{provider}/models.
 */
const PROVIDERS: LlmProvider[] = ['gemini', 'groq', 'openai', 'anthropic', 'lmstudio', 'make', 'ollama']

// 'make' est un webhook no-code : le concept de « modèle » n'existe pas → select masqué.
const NO_MODEL_PROVIDERS: readonly LlmProvider[] = ['make']

function basePlaceholder(provider: LlmProvider, defaultLabel: string): string {
  if (provider === 'lmstudio') return 'http://localhost:1234/v1'
  if (provider === 'make') return 'https://hook.eu1.make.com/…'
  if (provider === 'ollama') return 'http://localhost:11434'
  return defaultLabel
}

// État par défaut pour un provider absent de la réponse serveur (jamais dur côté métier :
// la valeur affichée reste vide, on n'invente aucun modèle).
function blankSetting(provider: LlmProvider): LlmSetting {
  return { provider, active_model: null, is_enabled: false, priority: 0, base_url: null }
}

// Pastille d'état de la clé pour un provider donné (dérivée des clés effectives).
type KeyState = 'none' | 'active' | 'blocked' | 'invalid'
function keyStateOf(keys: LlmKey[]): KeyState {
  if (keys.length === 0) return 'none'
  if (keys.some(k => k.status === 'active')) return 'active'
  if (keys.some(k => k.status === 'blocked')) return 'blocked'
  return 'invalid'
}

interface ModelsState { models: string[]; error: string | null; loading: boolean }

export default function ProvidersPanel() {
  const { t } = useLanguage()
  const toast = useToast()

  const [rows, setRows] = useState<Record<string, LlmSetting>>({})
  const [keys, setKeys] = useState<LlmKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingRow, setSavingRow] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  // Détection de modèles par provider (chargée à la demande / au 1er dépliage).
  const [models, setModels] = useState<Record<string, ModelsState>>({})
  // Saisie inline « ajouter une clé » par provider + verrou d'action.
  const [draftKey, setDraftKey] = useState<Record<string, string>>({})
  const [busyProvider, setBusyProvider] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    Promise.all([api.llm.getSettings(), api.llm.getKeys()])
      .then(([settingsRes, keysRes]) => {
        const map: Record<string, LlmSetting> = {}
        for (const p of PROVIDERS) map[p] = blankSetting(p)
        for (const s of settingsRes.settings ?? []) map[s.provider] = { ...blankSetting(s.provider), ...s }
        setRows(map)
        setKeys(keysRes.keys ?? [])
      })
      .catch(e => setError(e instanceof Error ? e.message : t('common.error_generic')))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(() => { load() }, [load])

  const keysOf = useCallback((provider: LlmProvider) => keys.filter(k => k.provider === provider), [keys])

  const patch = (provider: LlmProvider, next: Partial<LlmSetting>) =>
    setRows(prev => ({ ...prev, [provider]: { ...prev[provider], ...next } }))

  // ── Détection LIVE des modèles chez le fournisseur ──
  const detectModels = useCallback((provider: LlmProvider) => {
    if (NO_MODEL_PROVIDERS.includes(provider)) return
    setModels(prev => ({ ...prev, [provider]: { models: prev[provider]?.models ?? [], error: null, loading: true } }))
    api.llm.getProviderModels(provider)
      .then(res => setModels(prev => ({ ...prev, [provider]: { models: res.models ?? [], error: res.error, loading: false } })))
      .catch(e => setModels(prev => ({ ...prev, [provider]: { models: [], error: e instanceof Error ? e.message : t('common.error_generic'), loading: false } })))
  }, [t])

  const toggleSection = (provider: LlmProvider) => {
    const next = open === provider ? null : provider
    setOpen(next)
    // Premier dépliage d'un provider avec modèles : détection automatique si non encore chargée.
    if (next === provider && !NO_MODEL_PROVIDERS.includes(provider) && !models[provider]) detectModels(provider)
  }

  // ── Enregistrement partiel d'un réglage ──
  const savePatch = async (provider: LlmProvider, next: Partial<LlmSetting>) => {
    patch(provider, next)
    setSavingRow(provider)
    try {
      await api.llm.updateSettings(provider, next)
      toast.success(t('providers.saved'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error_generic'))
      load()
    } finally {
      setSavingRow(null)
    }
  }

  // Priorité : sauvegarde au blur (valeur numérique normalisée).
  const savePriority = async (provider: LlmProvider) => {
    const r = rows[provider]
    if (!r) return
    await savePatch(provider, { priority: Number.isFinite(r.priority) ? r.priority : 0 })
  }

  // URL de base : sauvegarde au blur puis re-détection des modèles (l'URL change la cible).
  const saveBaseUrl = async (provider: LlmProvider) => {
    const r = rows[provider]
    if (!r) return
    await savePatch(provider, { base_url: r.base_url && r.base_url.trim() ? r.base_url.trim() : null })
    detectModels(provider)
  }

  // ── Clés : ajout inline → test auto → re-détection modèles ──
  const addKey = async (provider: LlmProvider) => {
    const value = (draftKey[provider] ?? '').trim()
    if (!value) return
    setBusyProvider(provider)
    try {
      const created = await api.llm.addKey(provider, value)
      setDraftKey(prev => ({ ...prev, [provider]: '' }))
      toast.success(t('buttons.add'))
      // Test automatique de la clé fraîchement ajoutée.
      try {
        const res = await api.llm.testKey(created.id)
        toast.push(res.success ? 'success' : 'error', res.message)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('common.error_generic'))
      }
      load()
      detectModels(provider)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error_generic'))
    } finally {
      setBusyProvider(null)
    }
  }

  const testKey = async (provider: LlmProvider, id: string) => {
    setBusyProvider(provider)
    try {
      const res = await api.llm.testKey(id)
      const latency = typeof res.latency_ms === 'number' ? ` · ${res.latency_ms} ms` : ''
      toast.push(res.success ? 'success' : 'error', `${res.message}${latency}`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error_generic'))
    } finally {
      setBusyProvider(null)
    }
  }

  const deleteKey = async (provider: LlmProvider, id: string) => {
    setBusyProvider(provider)
    try {
      await api.llm.deleteKey(id)
      toast.success(t('buttons.delete'))
      load()
      detectModels(provider)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error_generic'))
    } finally {
      setBusyProvider(null)
    }
  }

  const keyStateBadge = (state: KeyState) => {
    const map: Record<KeyState, { cls: string; label: string }> = {
      none: { cls: 'badge-secondary', label: t('providers.key_state_none') },
      active: { cls: 'badge-success', label: t('providers.key_state_active') },
      blocked: { cls: 'badge-danger', label: t('providers.key_state_blocked') },
      invalid: { cls: 'badge-warning', label: t('providers.key_state_invalid') },
    }
    const { cls, label } = map[state]
    return <span className={`badge ${cls}`}>{label}</span>
  }

  return (
    <div className="auto-card">
      <h3 style={{ marginBottom: 6 }}>🔌 {t('providers.title')}</h3>
      <p className="hint providers-note" style={{ marginTop: 0, marginBottom: 16 }}>{t('providers.note')}</p>

      {loading ? <Spinner /> : error ? <ErrorBanner message={error} onRetry={load} /> : (
        <div className="providers-accordion">
          {PROVIDERS.map(p => {
            const r = rows[p] ?? blankSetting(p)
            const pKeys = keysOf(p)
            const state = keyStateOf(pKeys)
            const isOpen = open === p
            const busy = busyProvider === p
            const saving = savingRow === p
            const ms = models[p]
            const hasModelConcept = !NO_MODEL_PROVIDERS.includes(p)
            return (
              <div key={p} className={`provider-block ${isOpen ? 'is-open' : ''}`}>
                {/* En-tête / ligne d'état */}
                <div className="provider-head">
                  <button
                    type="button" className="provider-toggle" aria-expanded={isOpen}
                    onClick={() => toggleSection(p)}
                  >
                    <i className={`fa-solid fa-chevron-${isOpen ? 'down' : 'right'} provider-chevron`} />
                    <span className="badge badge-secondary">{p}</span>
                  </button>
                  <div className="provider-head-controls">
                    {keyStateBadge(state)}
                    <label className="provider-inline-field">
                      <span className="provider-mini-label">{t('providers.priority')}</span>
                      <input
                        className="form-input providers-num" type="number" min={0} step={1}
                        value={Number.isFinite(r.priority) ? r.priority : 0}
                        onChange={e => patch(p, { priority: Number(e.target.value) })}
                        onBlur={() => savePriority(p)}
                        disabled={saving}
                      />
                    </label>
                    <label className="switch" title={t('providers.enabled')}>
                      <input type="checkbox" checked={r.is_enabled} disabled={saving}
                        onChange={e => savePatch(p, { is_enabled: e.target.checked })} />
                      <span className="slider-track" /><span className="slider-thumb" />
                    </label>
                  </div>
                </div>

                {/* Corps déplié */}
                {isOpen && (
                  <div className="provider-body">
                    {/* Clés */}
                    <div className="provider-section">
                      <div className="provider-section-title">{t('providers.keys_title')}</div>
                      {pKeys.length === 0 ? (
                        <p className="hint" style={{ margin: '4px 0 10px' }}>{t('providers.no_keys')}</p>
                      ) : (
                        <div className="provider-key-list">
                          {pKeys.map(k => (
                            <div key={k.id} className="provider-key-row">
                              <span className="form-mono provider-key-mask">{k.masked_key}</span>
                              <span className={`badge ${k.status === 'active' ? 'badge-success' : k.status === 'blocked' ? 'badge-danger' : 'badge-secondary'}`}>{k.status}</span>
                              <div className="provider-key-actions">
                                <button className="btn btn-sm btn-outline-primary" disabled={busy} onClick={() => testKey(p, k.id)}>
                                  <i className="fa-solid fa-flask" /> {t('buttons.test')}
                                </button>
                                <button className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => deleteKey(p, k.id)}>
                                  <i className="fa-solid fa-trash" /> {t('buttons.delete')}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="provider-addkey">
                        <input
                          className="form-input" type="password" autoComplete="off"
                          placeholder={t('providers.add_key_placeholder')}
                          value={draftKey[p] ?? ''}
                          onChange={e => setDraftKey(prev => ({ ...prev, [p]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') void addKey(p) }}
                          disabled={busy}
                        />
                        <button className="btn btn-primary btn-sm" disabled={busy || !(draftKey[p] ?? '').trim()} onClick={() => addKey(p)}>
                          {busy ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-plus" />} {t('keys.add_key')}
                        </button>
                      </div>
                    </div>

                    {/* Modèle actif (select alimenté par détection LIVE) — masqué pour 'make' */}
                    {hasModelConcept && (
                      <div className="provider-section">
                        <div className="provider-section-title-row">
                          <span className="provider-section-title">{t('providers.model_active')}</span>
                          <button className="btn btn-sm btn-outline-secondary" disabled={ms?.loading} onClick={() => detectModels(p)}>
                            {ms?.loading ? <i className="fa-solid fa-spinner fa-spin" /> : '🔄'} {t('providers.detect_models')}
                          </button>
                        </div>
                        {ms?.loading ? (
                          <Spinner />
                        ) : (ms?.models.length ?? 0) > 0 ? (
                          <select
                            className="form-select" value={r.active_model ?? ''}
                            onChange={e => savePatch(p, { active_model: e.target.value ? e.target.value : null })}
                          >
                            <option value="">{t('providers.model_none')}</option>
                            {ms?.models.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        ) : (
                          <p className="hint provider-models-empty" style={{ margin: '4px 0' }}>
                            {ms?.error ?? t('providers.models_empty')}
                          </p>
                        )}
                      </div>
                    )}

                    {/* URL de base */}
                    <div className="provider-section">
                      <div className="provider-section-title">{t('providers.base_url')}</div>
                      <input
                        className="form-input form-mono" type="text"
                        value={r.base_url ?? ''}
                        placeholder={basePlaceholder(p, t('providers.base_url_default'))}
                        onChange={e => patch(p, { base_url: e.target.value })}
                        onBlur={() => saveBaseUrl(p)}
                        disabled={saving}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
