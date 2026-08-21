import { useMemo, type CSSProperties, type ReactNode } from 'react'
import katex from 'katex'
import DOMPurify from 'dompurify'
import type { Artifact } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'

interface Props {
  artifact: Artifact
  /** URL blob/image de secours (crop WebP) servie par le backend, si disponible. */
  fallbackImageUrl?: string
}

/**
 * ArtifactRenderer (sprint fondations) : gère katex (latex/formule), svg (DOMPurify),
 * image (dense_illustration via blob/URL). Les autres types Tier 3 (pdb_protein,
 * cif_crystal, cad_3d_model, geojson_map, dicom_slice, music…) affichent le fallback
 * « visionneuse non installée » + crop WebP de secours (tech_specs §9 Note Tiering).
 */
export default function ArtifactRenderer({ artifact, fallbackImageUrl }: Props) {
  const { t } = useLanguage()
  const type = (artifact.artifact_type || '').toLowerCase()

  const katexHtml = useMemo(() => {
    if (!(type.includes('latex') || type.includes('formula') || type.includes('equation') || type.includes('math'))) return null
    const tex = artifact.raw_data ?? ''
    if (!tex) return null
    try {
      return katex.renderToString(tex, { throwOnError: false, strict: 'ignore', output: 'html', displayMode: true })
    } catch {
      return null
    }
  }, [type, artifact.raw_data])

  const svgHtml = useMemo(() => {
    if (!(type.includes('svg') || (artifact.raw_data && artifact.raw_data.trimStart().startsWith('<svg')))) return null
    if (!artifact.raw_data) return null
    return DOMPurify.sanitize(artifact.raw_data, { USE_PROFILES: { svg: true, svgFilters: true } })
  }, [type, artifact.raw_data])

  const isImage = type.includes('image') || type.includes('illustration') || type.includes('photo') || type.includes('scan') || type.includes('figure')

  const wrapStyle: CSSProperties = {
    background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)',
    borderRadius: 12, padding: 14, margin: '10px 0',
  }

  let body: ReactNode

  if (katexHtml) {
    body = <div className="bidi-isolate" dangerouslySetInnerHTML={{ __html: katexHtml }} />
  } else if (svgHtml) {
    body = <div className="bidi-isolate" style={{ display: 'flex', justifyContent: 'center' }} dangerouslySetInnerHTML={{ __html: svgHtml }} />
  } else if (isImage && fallbackImageUrl) {
    body = <img src={fallbackImageUrl} alt={artifact.caption ?? artifact.artifact_type} style={{ maxWidth: '100%', borderRadius: 8, display: 'block', margin: '0 auto' }} />
  } else {
    // Fallback Tier 3 : visionneuse non installée + crop WebP de secours si présent
    body = (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
        {fallbackImageUrl && (
          <img src={fallbackImageUrl} alt={artifact.caption ?? artifact.artifact_type} style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 12 }} />
        )}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 20, background: 'var(--bg-surface-secondary)', border: '1px dashed var(--border-color)' }}>
          <i className="fa-solid fa-eye-slash" />
          <span>{t('artifact.viewer_not_installed')}</span>
        </div>
        <div style={{ marginTop: 8, fontSize: '0.82rem' }}>
          <span className="badge badge-secondary">{artifact.artifact_type}</span>
        </div>
      </div>
    )
  }

  return (
    <figure style={wrapStyle}>
      {body}
      {artifact.caption && <figcaption dir="auto" style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>{artifact.caption}</figcaption>}
    </figure>
  )
}
