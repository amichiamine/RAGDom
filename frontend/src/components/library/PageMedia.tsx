import { useEffect, useMemo, useState } from 'react'
import { ImageIcon, Maximize2 } from 'lucide-react'
import type { Artifact } from '@/types'
import { api } from '@/lib/api'
import { useLanguage } from '@/contexts/LanguageContext'
import ArtifactRenderer from '@/components/library/ArtifactRenderer'
import ImageModal from '@/components/library/curriculum/ImageModal'

interface Props {
  db: string
  documentId: string
  page: number
  /**
   * IDs d'artefacts déjà ancrés (`asset://artifacts/{id}`) dans le texte de la page :
   * ils sont marqués « مضمّنة في النص » et ne sont PAS rendus une seconde fois ici
   * (galerie de contrôle sans doublon avec le corps de lecture).
   */
  embeddedIds?: ReadonlySet<string> | string[]
  /** Callback quand les artefacts d'une page sont chargés (remonte le cache au parent). */
  onLoaded?: (page: number, artifacts: Artifact[]) => void
  compact?: boolean
}

/** Badge arabe court par type d'artefact (galerie de contrôle). */
const TYPE_BADGE: Record<string, string> = {
  dense_illustration: 'رسم',
  data_table: 'جدول',
  latex_formula: 'صيغة',
  geometry_vector: 'شكل',
  flowchart: 'مخطط',
  signal_waveform: 'إشارة',
  smiles_chem: 'صيغة كيميائية',
  code_snippet: 'شيفرة',
}

function arabicTypeBadge(type: string): string {
  if (TYPE_BADGE[type]) return TYPE_BADGE[type]
  const t = type.toLowerCase()
  if (t.includes('table')) return 'جدول'
  if (t.includes('geometry') || t.includes('svg') || t.includes('vector')) return 'شكل'
  if (t.includes('matrix') || t.includes('latex') || t.includes('formula') || t.includes('equation')) return 'صيغة'
  if (t.includes('flow') || t.includes('mermaid')) return 'مخطط'
  if (t.includes('signal') || t.includes('waveform') || t.includes('plot') || t.includes('chart')) return 'إشارة'
  if (t.includes('smiles') || t.includes('chem') || t.includes('mol')) return 'صيغة كيميائية'
  if (t.includes('code') || t.includes('snippet')) return 'شيفرة'
  return type
}

/** Seuil au-delà duquel un artefact est un re-cadrage quasi-pleine-page (doublon du scan). */
const FULLPAGE_RATIO = 0.7

/**
 * Galerie de CONTRÔLE en pied de page : rend chaque artefact via <ArtifactRenderer>
 * (rendu par type, badges sémantiques, comparateur intégré). Filtre les cadres
 * quasi-pleine-page (area_ratio > 0.7 → masqués derrière un lien togglable) et évite
 * tout doublon avec les artefacts déjà ancrés dans le texte (embeddedIds).
 */
export default function PageMedia({ db, documentId, page, embeddedIds, onLoaded }: Props) {
  const { t } = useLanguage()
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null)
  const [modal, setModal] = useState<{ src: string; title: string } | null>(null)
  const [showFullpage, setShowFullpage] = useState(false)

  const embedded = useMemo<ReadonlySet<string>>(
    () => (embeddedIds instanceof Set ? embeddedIds : new Set(embeddedIds ?? [])),
    [embeddedIds],
  )

  useEffect(() => {
    let alive = true
    setArtifacts(null)
    setShowFullpage(false)
    if (!documentId || !page) { setArtifacts([]); return }
    api.library.getArtifacts(db, { document_id: documentId, page_number: page })
      .then(r => {
        if (!alive) return
        const list = r.artifacts ?? []
        setArtifacts(list)
        onLoaded?.(page, list)
      })
      .catch(() => { if (alive) setArtifacts([]) })
    return () => { alive = false }
    // onLoaded volontairement hors deps (callback stable côté parent attendu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, documentId, page])

  // Ne conserve que les médias réellement rendables.
  const hasRaw = (a: Artifact) => typeof a.raw_data === 'string' && a.raw_data.trim().length > 0
  const renderable = (artifacts ?? []).filter(a => {
    const type = (a.artifact_type || '').toLowerCase()
    if (type.includes('illustration') || type.includes('image') || type.includes('figure')) return true
    if (type.includes('table')) return true
    if (type.includes('geometry') || type.includes('svg') || type.includes('vector')) return a.has_binary === true || hasRaw(a)
    // F8 — Formule : rendue si binaire image OU raw_data structuré (KaTeX via
    // ArtifactRenderer). Une formule structurée sans image doit être VISIBLE.
    if (type.includes('formula') || type.includes('latex') || type.includes('equation') || type.includes('matrix')) return a.has_binary === true || hasRaw(a)
    // Autres types (source structurée / Tier 3) : rendus s'ils ont un binaire OU une source structurée.
    return a.has_binary === true || hasRaw(a)
  })

  // Cadres quasi-pleine-page (area_ratio > 0.7) : re-cadrages de la page → masqués par défaut.
  const isFullpage = (a: Artifact) => typeof a.area_ratio === 'number' && a.area_ratio > FULLPAGE_RATIO
  const fullpage = renderable.filter(isFullpage)
  const primary = renderable.filter(a => !isFullpage(a))
  const visible = showFullpage ? [...primary, ...fullpage] : primary

  if (artifacts === null) {
    return (
      <div className="page-media" aria-busy="true" style={{ minHeight: 24, color: 'var(--text-muted)', fontSize: '0.82rem', padding: '8px 0' }} dir="auto">
        {t('library.media_loading')}
      </div>
    )
  }
  if (renderable.length === 0) return null
  // Que des cadres pleine page → section réduite au seul lien de révélation.
  if (primary.length === 0 && !showFullpage && fullpage.length === renderable.length) {
    return (
      <div className="page-media" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border-color)' }}>
        <button
          type="button"
          className="btn btn-sm btn-link"
          onClick={() => setShowFullpage(true)}
          style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: 0 }}
          dir="auto"
        >
          {t('library.media_fullpage_toggle').replace('{n}', String(fullpage.length))}
        </button>
      </div>
    )
  }

  return (
    <div className="page-media" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ImageIcon size={13} /> {t('library.media_section')}
        </span>
        <span className="badge badge-subtle font-num">{primary.length} {t('library.media_count_unit')}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {visible.map(a => {
          const badge = arabicTypeBadge(a.artifact_type)
          const binaryUrl = a.has_binary ? api.library.getArtifactBinaryUrl(db, a.id) : undefined
          const isEmbedded = embedded.has(a.id)

          return (
            <figure key={a.id} className="page-media-item" style={{ margin: 0, background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                {/* Badge de TYPE de la galerie affiché uniquement pour l'entrée « intégrée
                    au texte » (ArtifactRenderer n'est pas monté ici) ; sinon le badge
                    type + état de rendu est porté in-situ par ArtifactRenderer (F4). */}
                {isEmbedded ? (
                  <span className="badge badge-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} dir="auto">
                    <ImageIcon size={12} /> {badge}
                  </span>
                ) : <span />}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {isEmbedded && (
                    <span className="badge badge-subtle" dir="auto" title={t('library.media_embedded_in_text')}>
                      {t('library.media_embedded_in_text')}
                    </span>
                  )}
                  {binaryUrl && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setModal({ src: binaryUrl, title: a.caption ?? badge })}
                      title={t('library.media_zoom')}
                    >
                      <Maximize2 size={12} /> {t('library.media_zoom')}
                    </button>
                  )}
                </span>
              </div>

              {isEmbedded ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '6px 0' }} dir="auto">
                  {t('library.media_embedded_in_text')}
                </div>
              ) : (
                <ArtifactRenderer
                  artifact={a}
                  fallbackImageUrl={binaryUrl}
                  onEnlarge={(src, title) => setModal({ src, title })}
                />
              )}

              {!isEmbedded && a.caption && (
                <figcaption dir="auto" style={{ marginTop: 8, fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  {a.caption}
                </figcaption>
              )}
            </figure>
          )
        })}
      </div>

      {fullpage.length > 0 && !showFullpage && (
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <button
            type="button"
            className="btn btn-sm btn-link"
            onClick={() => setShowFullpage(true)}
            style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: 0 }}
            dir="auto"
          >
            {t('library.media_fullpage_toggle').replace('{n}', String(fullpage.length))}
          </button>
        </div>
      )}

      <ImageModal
        open={modal !== null}
        title={modal?.title ?? ''}
        src={modal?.src ?? ''}
        onClose={() => setModal(null)}
      />
    </div>
  )
}
