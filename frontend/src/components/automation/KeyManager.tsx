import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { LlmKey, LlmProvider } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import { Spinner, ErrorBanner } from '@/components/common/Feedback'

const PROVIDERS: LlmProvider[] = ['gemini', 'groq', 'openai', 'anthropic', 'ollama']

/** §5.3 KeyManager — providers/settings/keys masquées : add/test/delete/reveal. */
export default function KeyManager() {
  const { t } = useLanguage()
  const toast = useToast()
  const [keys, setKeys] = useState<LlmKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [newProvider, setNewProvider] = useState<LlmProvider>('gemini')
  const [newKey, setNewKey] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    setLoading(true); setError(null)
    api.llm.getKeys()
      .then(res => setKeys(res.keys))
      .catch(e => setError(e instanceof Error ? e.message : t('common.error_generic')))
      .finally(() => setLoading(false))
  }

  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!newKey.trim()) return
    setBusy(true)
    try {
      await api.llm.addKey(newProvider, newKey.trim())
      toast.success(t('buttons.add'))
      setNewKey('')
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
    finally { setBusy(false) }
  }

  const reveal = async (id: string) => {
    try {
      const res = await api.llm.revealKey(id)
      setRevealed(prev => ({ ...prev, [id]: res.api_key }))
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
  }

  const test = async (id: string) => {
    try {
      const res = await api.llm.testKey(id)
      toast.push(res.success ? 'success' : 'error', res.message)
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
  }

  const del = async (id: string) => {
    try {
      await api.llm.deleteKey(id)
      toast.success(t('buttons.delete'))
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
  }

  return (
    <div className="auto-card">
      <h3 style={{ marginBottom: 14 }}><i className="fa-solid fa-key" /> {t('automation.key_manager')}</h3>

      {loading ? <Spinner /> : error ? <ErrorBanner message={error} onRetry={load} /> : (
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('keys.provider')}</th><th>{t('keys.key')}</th><th>{t('keys.status')}</th><th>{t('pipeline.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr><td colSpan={4} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>{t('common.empty')}</td></tr>
              ) : keys.map(k => (
                <tr key={k.id}>
                  <td><span className="badge badge-secondary">{k.provider}</span></td>
                  <td className="form-mono">{revealed[k.id] ?? k.masked_key}</td>
                  <td>
                    <span className={`badge ${k.status === 'active' ? 'badge-success' : k.status === 'blocked' ? 'badge-danger' : 'badge-secondary'}`}>{k.status}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => reveal(k.id)}><i className="fa-solid fa-eye" /> {t('buttons.reveal')}</button>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => test(k.id)}><i className="fa-solid fa-flask" /> {t('buttons.test')}</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => del(k.id)}><i className="fa-solid fa-trash" /> {t('buttons.delete')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', paddingTop: 14, borderTop: '1px solid var(--border-color)' }}>
        <select className="form-select" style={{ maxWidth: 160 }} value={newProvider} onChange={e => setNewProvider(e.target.value as LlmProvider)}>
          {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input className="form-input" style={{ flex: 1, minWidth: 200 }} type="password" placeholder="API key" value={newKey} onChange={e => setNewKey(e.target.value)} />
        <button className="btn btn-primary" onClick={add} disabled={busy || !newKey.trim()}><i className="fa-solid fa-plus" /> {t('keys.add_key')}</button>
      </div>
    </div>
  )
}
