import { useEffect, useState } from 'react'
import { ImageIcon, Table2, Sigma, Maximize2 } from 'lucide-react'
import type { Artifact } from '@/types'
import { api } from '@/lib/api'
import { useLanguage } from '@/contexts/LanguageContext'
import MarkdownKatex from '@/components/library/MarkdownKatex'
import ImageModal from '@/components/library/curriculum/ImageModal'

interface Props {
  db: string
  documentId: string
  page: number
  /** Titre optionnel (par défaut « الوسائط المستخرجة / Matériels extraits »). */
  compact?: boolean
}

/** Badge arabe court par type d'artefact rendu. */
const TYPE_BADGE: Record<string, string> = {
  dense_illustration: 'رسم',
  data_table: 'جدول',
  latex_formula: 'صيغة',
}

/**
 * Section « الوسائط المستخرجة / Matériels extraits » d'une page de lecture.
 * Charge `getArtifacts(db, {document_id, page_number})` et affiche :
 *  - dense_illustration → <img> (crop WebP, lazy) cliquable → ImageModal HD
 *  - data_table          → raw_data rendu en Markdown/KaTeX (tableau)
 *  - latex_formula       → UNIQUEMENT si has_binary (image) ; sinon déjà dans le texte
 * Rien affiché s'il n'y a aucune vraie média. Zéro donnée en dur.
 */
export default function PageMedia({ db, documentId, page }: Props) {
  const { t } = useLanguage()
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null)
  const [modal, setModal] = useState<{ src: string; title: string } | null>(null)

  useEffect(() => {
    let alive = true
    setArtifacts(null)
    if (!documentId || !page) { setArtifacts([]); return }
    api.library.getArtifacts(db, { document_id: documentId, page_number: page })
      .then(r => { if (alive) setArtifacts(r.artifacts ?? []) })
      .catch(() => { if (alive) setArtifacts([]) })
    return () => { alive = false }
  }, [db, documentId, page])

  // Ne conserve que les médias réellement rendables (pas les formules déjà dans le texte).
  const renderable = (artifacts ?? []).filter(a => {
    const type = (a.artifact_type || '').toLowerCase()
    if (type.includes('illustration') || type.includes('image') || type.includes('figure')) return true
    if (type.includes('table')) return true
    // Formule : seulement si un binaire image existe (sinon dupliquerait le texte).
    if (type.includes('formula') || type.includes('latex') || type.includes('equation')) return a.has_binary === true
    // Autres types Tier 3 : rendus s'ils ont un binaire.
    return a.has_binary === true
  })

  if (artifacts === null) {
    return (
      <div className="page-media" aria-busy="true" style={{ minHeight: 24, color: 'var(--text-muted)', fontSize: '0.82rem', padding: '8px 0' }} dir="auto">
        {t('library.media_loading')}
      </div>
    )
  }
  if (renderable.length === 0) return null

  return (
    <div className="page-media" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ImageIcon size={13} /> {t('library.media_section')}
        </span>
        <span className="badge badge-subtle font-num">{renderable.length} {t('library.media_count_unit')}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {renderable.map(a => {
          const type = (a.artifact_type || '').toLowerCase()
          const isImage = type.includes('illustration') || type.includes('image') || type.includes('figure') || (a.has_binary === true && !type.includes('table'))
          const isTable = type.includes('table')
          const badge = TYPE_BADGE[a.artifact_type] ?? a.artifact_type
          const badgeIcon = isTable ? <Table2 size={12} /> : type.includes('formula') ? <Sigma size={12} /> : <ImageIcon size={12} />
          const binaryUrl = api.library.getArtifactBinaryUrl(db, a.id)

          return (
            <figure key={a.id} className="page-media-item" style={{ margin: 0, background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span className="badge badge-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {badgeIcon} {badge}
                </span>
                {isImage && a.has_binary && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setModal({ src: binaryUrl, title: a.caption ?? badge })}
                    title={t('library.media_zoom')}
                  >
                    <Maximize2 size={12} /> {t('library.media_zoom')}
                  </button>
                )}
              </div>

              {isTable ? (
                <div className="page-media-table">
                  {a.raw_data
                    ? <MarkdownKatex lazy raw={a.raw_data} />
                    : <div className="text-muted" dir="auto">{t('library.media_empty')}</div>}
                </div>
              ) : a.has_binary ? (
                <img
                  src={binaryUrl}
                  loading="lazy"
                  alt={a.caption ?? badge}
                  onClick={() => setModal({ src: binaryUrl, title: a.caption ?? badge })}
                  style={{ maxWidth: '100%', display: 'block', margin: '0 auto', borderRadius: 8, cursor: 'zoom-in' }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              ) : a.raw_data ? (
                <MarkdownKatex lazy raw={a.raw_data} />
              ) : null}

              {a.caption && (
                <figcaption dir="auto" style={{ marginTop: 8, fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  {a.caption}
                </figcaption>
              )}
            </figure>
          )
        })}
      </div>

      <ImageModal
        open={modal !== null}
        title={modal?.title ?? ''}
        src={modal?.src ?? ''}
        onClose={() => setModal(null)}
      />
    </div>
  )
}
