import { useState } from 'react'
import { api } from '@/lib/api'
import { useDatabase } from '@/contexts/DatabaseContext'
import { useLanguage } from '@/contexts/LanguageContext'
import type { SearchResult } from '@/types'
import { Spinner, ErrorBanner, EmptyState } from '@/components/common/Feedback'
import MarkdownContent from '@/components/common/MarkdownContent'

interface Props {
  activeDb: string
  onSelectResult: (r: SearchResult) => void
}

export default function SearchStudio({ activeDb, onSelectResult }: Props) {
  const { databases } = useDatabase()
  const { t } = useLanguage()
  const [selected, setSelected] = useState<string[]>([activeDb])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleDb = (fn: string) => {
    setSelected(prev => prev.includes(fn) ? prev.filter(x => x !== fn) : [...prev, fn])
  }

  const run = async () => {
    const q = query.trim()
    if (!q) return
    const bases = selected.length ? selected : [activeDb]
    setLoading(true); setError(null)
    try {
      const res = bases.length === 1
        ? await api.search.hybrid(bases[0], q, 8)
        : await api.search.hybridMulti(bases, q, 8)
      setResults(res.results)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error_generic'))
      setResults(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', alignSelf: 'center' }}>{t('search.select_bases')}:</span>
        {databases.map(db => (
          <label key={db.filename} className="badge badge-subtle" style={{ cursor: 'pointer', gap: 6 }}>
            <input type="checkbox" checked={selected.includes(db.filename)} onChange={() => toggleDb(db.filename)} />
            {db.filename}
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          className="form-input"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run() }}
          aria-label={t('search.placeholder')}
        />
        <button className="btn btn-primary" onClick={run} disabled={loading || !query.trim()}>
          <i className="fa-solid fa-magnifying-glass" /> {t('search.run')}
        </button>
      </div>

      {loading && <Spinner label={t('common.loading')} />}
      {error && <ErrorBanner message={error} onRetry={run} />}
      {results && results.length === 0 && !loading && <EmptyState icon="fa-magnifying-glass" title={t('search.no_results')} />}

      {results && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {results.map(r => (
            <button
              key={`${r.database_filename ?? activeDb}-${r.chunk_id}`}
              className="content-box"
              style={{ textAlign: 'start', cursor: 'pointer', border: '1px solid var(--border-color)' }}
              onClick={() => onSelectResult(r)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <strong dir="auto">{r.document_title}</strong>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  {r.database_filename && <span className="badge badge-subtle">{r.database_filename}</span>}
                  <span className="badge badge-info">{t('library.page')} {r.page_number}</span>
                  <span className="badge badge-secondary">{t('search.score')}: {r.rrf_score.toFixed(3)}</span>
                </span>
              </div>
              <div style={{ maxHeight: 120, overflow: 'hidden' }}>
                <MarkdownContent source={r.content_markdown.slice(0, 400)} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
