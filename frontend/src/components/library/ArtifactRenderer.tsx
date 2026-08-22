import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import katex from 'katex'
import DOMPurify from 'dompurify'
import { Copy, Check, Layers, Image as ImageIcon, GitCompare, ChevronDown } from 'lucide-react'
import type { Artifact } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import MarkdownKatex from '@/components/library/MarkdownKatex'

interface Props {
  artifact: Artifact
  /** URL blob/image de secours (crop WebP original) servie par le backend, si disponible. */
  fallbackImageUrl?: string
  /** Callback d'agrandissement (clic sur le rendu) — piloté par le parent (→ ImageModal). */
  onEnlarge?: (src: string, title: string) => void
}

/**
 * Familles d'artefacts §12.
 *  - Rendues NATIVEMENT : geometry_vector (SVG), matrix (LaTeX), data_table (markdown).
 *  - « source structurée » : flowchart / signal_waveform / smiles_chem / code_snippet
 *    → binaire WebP original en visuel principal + panneau repliable de la source.
 *  - dense_illustration / autres → image binaire.
 */
type Family =
  | 'geometry_vector' | 'matrix' | 'data_table'
  | 'flowchart' | 'signal_waveform' | 'smiles_chem' | 'code_snippet'
  | 'dense_illustration' | 'other'

/** Familles rendues nativement (éligibles au comparateur structuré/original). */
const NATIVE: ReadonlySet<Family> = new Set<Family>(['geometry_vector', 'matrix', 'data_table'])

/** Familles à « source structurée » (WebP principal + panneau source repliable). */
const SOURCE_PANEL: ReadonlySet<Family> = new Set<Family>(['flowchart', 'signal_waveform', 'smiles_chem', 'code_snippet'])

function detectFamily(type: string): Family {
  const t = type.toLowerCase()
  if (t.includes('geometry') || t.includes('svg') || t.includes('vector')) return 'geometry_vector'
  if (t.includes('matrix') || t.includes('latex') || t.includes('formula') || t.includes('equation') || t.includes('math')) return 'matrix'
  if (t.includes('table')) return 'data_table'
  if (t.includes('flow') || t.includes('mermaid')) return 'flowchart'
  if (t.includes('signal') || t.includes('waveform') || t.includes('plot') || t.includes('chart')) return 'signal_waveform'
  if (t.includes('smiles') || t.includes('chem') || t.includes('mol')) return 'smiles_chem'
  if (t.includes('code') || t.includes('snippet')) return 'code_snippet'
  if (t.includes('illustration') || t.includes('image') || t.includes('figure') || t.includes('photo')) return 'dense_illustration'
  return 'other'
}

/** Lit render_config_json.semantic → clé i18n du badge sémantique, ou null. */
function readSemantic(raw: string | null | undefined): 'demonstration' | 'illustration' | 'exercise_support' | null {
  if (!raw) return null
  try {
    const cfg = JSON.parse(raw) as { semantic?: string }
    const s = cfg?.semantic
    if (s === 'demonstration' || s === 'illustration' || s === 'exercise_support') return s
    return null
  } catch {
    return null
  }
}

/** Langage lisible du bloc <pre> selon la famille de « source structurée ». */
function sourceLangHint(family: Family): string {
  switch (family) {
    case 'flowchart': return 'mermaid'
    case 'signal_waveform': return 'json'
    case 'smiles_chem': return 'smiles'
    default: return ''
  }
}

/**
 * ArtifactRenderer (§12) — rend un artefact selon sa famille, avec :
 *  - badge sémantique (برهان / توضيح / سند تمرين) si render_config_json.semantic ;
 *  - rendu natif SVG / LaTeX / tableau, ou WebP + panneau source repliable, ou image ;
 *  - comparateur (العرض المهيكل / الأصل / مقارنة) pour les familles natives + has_binary ;
 *  - repli universel : raw_data invalide + has_binary → image.
 */
export default function ArtifactRenderer({ artifact, fallbackImageUrl, onEnlarge }: Props) {
  const { t } = useLanguage()
  const type = (artifact.artifact_type || '').toLowerCase()
  const family = detectFamily(type)
  const caption = artifact.caption ?? artifact.artifact_type
  const hasBinary = artifact.has_binary === true && !!fallbackImageUrl
  const semantic = useMemo(() => readSemantic(artifact.render_config_json), [artifact.render_config_json])

  // matrix → LaTeX displayMode
  const katexHtml = useMemo(() => {
    if (family !== 'matrix') return null
    const tex = artifact.raw_data ?? ''
    if (!tex.trim()) return null
    try {
      return katex.renderToString(tex, { throwOnError: false, strict: 'ignore', output: 'html', displayMode: true })
    } catch {
      return null
    }
  }, [family, artifact.raw_data])

  // geometry_vector → SVG autonome sanitisé (profil SVG DOMPurify)
  const svgHtml = useMemo(() => {
    if (family !== 'geometry_vector') return null
    const raw = artifact.raw_data ?? ''
    if (!raw.trim() || !raw.trimStart().startsWith('<svg')) return null
    const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } })
    return clean.includes('<svg') ? clean : null
  }, [family, artifact.raw_data])

  const hasTable = family === 'data_table' && !!artifact.raw_data && artifact.raw_data.trim().length > 0
  // L'artefact est-il RENDABLE nativement (source structurée valide) ?
  const nativeOk =
    (family === 'matrix' && !!katexHtml) ||
    (family === 'geometry_vector' && !!svgHtml) ||
    hasTable

  // Comparateur : uniquement pour les familles natives valides possédant un binaire.
  const canCompare = NATIVE.has(family) && nativeOk && hasBinary
  // Modes : 'structured' (rendu natif) · 'original' (WebP) · 'compare' (côte à côte)
  const [view, setView] = useState<'structured' | 'original' | 'compare'>('structured')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const wrapStyle: CSSProperties = {
    background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)',
    borderRadius: 12, padding: 14, margin: 0,
  }

  const copySource = () => {
    const src = artifact.raw_data ?? ''
    if (!src) return
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(src).then(done, done)
      else done()
    } catch { done() }
  }

  // ── Rendu natif (structuré) réutilisable ─────────────────────────────────
  const renderNative = (): ReactNode => {
    if (family === 'matrix' && katexHtml) {
      return <div className="bidi-isolate" style={{ overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: katexHtml }} />
    }
    if (family === 'geometry_vector' && svgHtml) {
      return (
        <div
          className="bidi-isolate artifact-svg"
          role={onEnlarge && fallbackImageUrl ? 'button' : undefined}
          tabIndex={onEnlarge && fallbackImageUrl ? 0 : undefined}
          onClick={onEnlarge && fallbackImageUrl ? () => onEnlarge(fallbackImageUrl, caption) : undefined}
          style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: onEnlarge && fallbackImageUrl ? 'zoom-in' : 'default' }}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      )
    }
    if (hasTable) {
      return <div className="page-media-table"><MarkdownKatex lazy raw={artifact.raw_data as string} /></div>
    }
    return null
  }

  // ── Image binaire (original / repli universel) ────────────────────────────
  const renderImage = (): ReactNode => {
    if (!fallbackImageUrl) return null
    return (
      <img
        src={fallbackImageUrl}
        alt={caption}
        loading="lazy"
        onClick={onEnlarge ? () => onEnlarge(fallbackImageUrl, caption) : undefined}
        style={{ maxWidth: '100%', borderRadius: 8, display: 'block', margin: '0 auto', cursor: onEnlarge ? 'zoom-in' : 'default' }}
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
    )
  }

  // ── Composition du corps selon la famille ────────────────────────────────
  let body: ReactNode

  if (canCompare) {
    // Familles natives + binaire : bascule structuré / original / comparaison.
    body = (
      <>
        {view === 'structured' && renderNative()}
        {view === 'original' && renderImage()}
        {view === 'compare' && (
          <div className="artifact-compare-grid" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, textAlign: 'center' }} dir="auto">{t('library.media_rendered')}</div>
              {renderNative()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, textAlign: 'center' }} dir="auto">{t('library.media_original')}</div>
              {renderImage()}
            </div>
          </div>
        )}
      </>
    )
  } else if (nativeOk) {
    body = renderNative()
  } else if (SOURCE_PANEL.has(family) && hasBinary) {
    // flowchart / signal_waveform / smiles_chem / code_snippet :
    // WebP original en visuel principal + panneau repliable « المصدر المهيكل ».
    body = (
      <>
        {renderImage()}
        {artifact.raw_data && artifact.raw_data.trim() && (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => setSourceOpen(o => !o)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              dir="auto"
            >
              <ChevronDown size={13} className={`matrix-chevron${sourceOpen ? ' open' : ''}`} />
              {t('library.media_structured_source')}
            </button>
            {sourceOpen && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={copySource}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    dir="auto"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('library.media_copied') : t('library.media_copy_source')}
                  </button>
                </div>
                <pre
                  className="bidi-isolate"
                  data-lang={sourceLangHint(family)}
                  style={{ direction: 'ltr', textAlign: 'left', overflowX: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 12, fontSize: '0.82rem', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >{artifact.raw_data}</pre>
              </div>
            )}
          </div>
        )}
      </>
    )
  } else if (fallbackImageUrl) {
    // dense_illustration / autres, ou structuré invalide + has_binary → image.
    body = renderImage()
  } else if (SOURCE_PANEL.has(family) && artifact.raw_data && artifact.raw_data.trim()) {
    // Source structurée SANS binaire : afficher au moins la source dans <pre>.
    body = (
      <pre
        className="bidi-isolate"
        data-lang={sourceLangHint(family)}
        style={{ direction: 'ltr', textAlign: 'left', overflowX: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 12, fontSize: '0.82rem', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >{artifact.raw_data}</pre>
    )
  } else {
    body = (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)' }} dir="auto">
        {t('library.media_empty')}
      </div>
    )
  }

  const semanticLabel = semantic ? t(`library.semantic_${semantic}`) : null

  return (
    <div style={wrapStyle}>
      {(semanticLabel || canCompare) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          {semanticLabel ? (
            <span className={`badge artifact-semantic-badge artifact-semantic-${semantic}`} dir="auto">
              {semanticLabel}
            </span>
          ) : <span />}
          {canCompare && (
            <div className="artifact-view-toggle" role="group" style={{ display: 'inline-flex', gap: 4 }}>
              <button
                type="button"
                className={`btn btn-sm ${view === 'structured' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setView('structured')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                dir="auto"
              >
                <Layers size={12} /> {t('library.media_structured')}
              </button>
              <button
                type="button"
                className={`btn btn-sm ${view === 'original' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setView('original')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                dir="auto"
              >
                <ImageIcon size={12} /> {t('library.media_original')}
              </button>
              <button
                type="button"
                className={`btn btn-sm ${view === 'compare' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setView('compare')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                dir="auto"
              >
                <GitCompare size={12} /> {t('library.media_compare')}
              </button>
            </div>
          )}
        </div>
      )}
      {body}
    </div>
  )
}
