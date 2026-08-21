import { useState, useRef, useEffect } from 'react'
import { api } from '@/lib/api'
import { useDatabase } from '@/contexts/DatabaseContext'
import { useLanguage } from '@/contexts/LanguageContext'
import type { AskResponse, AskSource } from '@/types'
import MarkdownContent from '@/components/common/MarkdownContent'
import { ErrorBanner } from '@/components/common/Feedback'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  response?: AskResponse
}

interface Props {
  activeDb: string
  onSelectSource: (s: AskSource) => void
}

/** §7.1 AskStudio — Chat RAG : bulles, sources cliquables, cas no_context distinct. */
export default function AskStudio({ activeDb, onSelectSource }: Props) {
  const { databases } = useDatabase()
  const { t } = useLanguage()
  const [selected, setSelected] = useState<string[]>([activeDb])
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns, loading])

  const toggleDb = (fn: string) => setSelected(prev => prev.includes(fn) ? prev.filter(x => x !== fn) : [...prev, fn])

  const send = async () => {
    const q = input.trim()
    if (!q) return
    const bases = selected.length ? selected : [activeDb]
    setTurns(prev => [...prev, { role: 'user', content: q }])
    setInput(''); setLoading(true); setError(null)
    try {
      const res = await api.search.ask(bases, q, 6)
      setTurns(prev => [...prev, { role: 'assistant', content: res.answer, response: res }])
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error_generic'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', alignSelf: 'center' }}>{t('search.select_bases')}:</span>
        {databases.map(db => (
          <label key={db.filename} className="badge badge-subtle" style={{ cursor: 'pointer', gap: 6 }}>
            <input type="checkbox" checked={selected.includes(db.filename)} onChange={() => toggleDb(db.filename)} />
            {db.filename}
          </label>
        ))}
      </div>

      <div
        aria-live="polite"
        style={{ flex: 1, minHeight: 260, maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 4px', marginBottom: 12 }}
      >
        {turns.map((turn, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
            {turn.role === 'user' ? (
              <div className="chat-bubble chat-bubble-user" dir="auto">{turn.content}</div>
            ) : turn.response?.no_context ? (
              <div className="chat-bubble chat-bubble-nocontext">
                <i className="fa-solid fa-circle-info" /> {turn.response.answer || t('ask.no_context')}
              </div>
            ) : (
              <div className="chat-bubble chat-bubble-assistant">
                <MarkdownContent source={turn.content} />
                {turn.response && (
                  <div style={{ marginTop: 10, borderTop: '1px solid var(--border-color)', paddingTop: 8 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {turn.response.provider_used && <span className="badge badge-secondary">{t('ask.provider')}: {turn.response.provider_used}</span>}
                      {turn.response.fallback_triggered && <span className="badge badge-warning">{t('ask.fallback')}</span>}
                    </div>
                    {turn.response.sources.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>{t('ask.sources')}</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {turn.response.sources.map(s => (
                            <button key={s.chunk_id} className="badge badge-info" style={{ cursor: 'pointer' }} onClick={() => onSelectSource(s)}>
                              {s.document_title} · p.{s.page_number}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {loading && <div className="chat-bubble chat-bubble-assistant"><i className="fa-solid fa-spinner fa-spin" /> {t('ask.thinking')}</div>}
        <div ref={endRef} />
      </div>

      {error && <ErrorBanner message={error} onRetry={send} />}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="form-input"
          placeholder={t('ask.placeholder')}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !loading) send() }}
          aria-label={t('ask.placeholder')}
        />
        <button className="btn btn-primary" onClick={send} disabled={loading || !input.trim()}>
          <i className="fa-solid fa-paper-plane" /> {t('buttons.send')}
        </button>
      </div>
    </div>
  )
}
