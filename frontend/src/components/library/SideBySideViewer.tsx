import { useMemo } from 'react'
import type { Chunk } from '@/types'
import { api } from '@/lib/api'
import { useLanguage } from '@/contexts/LanguageContext'
import MarkdownContent from '@/components/common/MarkdownContent'
import { EmptyState } from '@/components/common/Feedback'

interface Props {
  db: string
  documentId: string
  page: number
  totalPages: number
  chunks: Chunk[]
  onPrev: () => void
  onNext: () => void
  highlightChunkId: string | null
}

/** SideBySideViewer : chunks de la page (Markdown+KaTeX) côte à côte avec le scan. */
export default function SideBySideViewer({ db, documentId, page, totalPages, chunks, onPrev, onNext, highlightChunkId }: Props) {
  const { t } = useLanguage()
  const scanUrl = useMemo(() => api.library.getPageScanUrl(db, documentId, page, false), [db, documentId, page])
  const thumbUrl = useMemo(() => api.library.getPageScanUrl(db, documentId, page, true), [db, documentId, page])
  const pageChunks = chunks.filter(c => c.page_number === page)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8 }}>
        <button className="btn btn-outline-secondary btn-sm" onClick={onPrev} disabled={page <= 1}>
          <i className="fa-solid fa-chevron-right" /> {t('library.prev_page')}
        </button>
        <span className="badge badge-subtle">{t('library.page')} {page}{totalPages ? ` / ${totalPages}` : ''}</span>
        <button className="btn btn-outline-secondary btn-sm" onClick={onNext} disabled={totalPages > 0 && page >= totalPages}>
          {t('library.next_page')} <i className="fa-solid fa-chevron-left" />
        </button>
      </div>

      <div className="row">
        {/* Colonne texte */}
        <div className="col-6 col-xl-6" style={{ minWidth: 280 }}>
          {pageChunks.length === 0 ? (
            <EmptyState icon="fa-file-lines" title={t('common.empty')} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {pageChunks.map(c => (
                <div
                  key={c.id}
                  id={`chunk-${c.id}`}
                  className={`content-box ${highlightChunkId === c.id ? 'target-highlight' : ''}`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                      {c.section_title && <span className="badge badge-subtle" dir="auto">{c.section_title}</span>}
                      {c.pedagogical_type && <span className="badge badge-secondary">{c.pedagogical_type}</span>}
                      {c.pedagogical_index != null && <span className="badge badge-info">#{c.pedagogical_index}</span>}
                    </span>
                    {c.is_human_edited === 1 && (
                      <span className="badge badge-human-edited" title="محمي من عمليات التطهير وإعادة الإدماج">
                        <i className="fa-solid fa-user-pen" /> {t('library.human_edited')}
                      </span>
                    )}
                  </div>
                  <MarkdownContent source={c.content_markdown} className="content-box" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Colonne scan */}
        <div className="col-6 col-xl-6" style={{ minWidth: 280 }}>
          <div className="scans-side-rail">
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              <i className="fa-solid fa-image" /> {t('library.scan')} — {t('library.page')} {page}
            </div>
            <img
              src={scanUrl}
              alt={`scan page ${page}`}
              loading="lazy"
              style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border-color)', background: '#0f172a' }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = thumbUrl }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
