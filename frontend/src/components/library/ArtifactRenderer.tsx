import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import DOMPurify from 'dompurify'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  type ColumnDef, type SortingState,
} from '@tanstack/react-table'
import { Copy, Check, Layers, Image as ImageIcon, GitCompare, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import type { Artifact } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import MarkdownKatex from '@/components/library/MarkdownKatex'
import { stripMathDelimiters, renderKatexStrict } from '@/lib/markdownKatex'

// Types de `plotly.js-dist-min` (bundle sans types) : déclarés dans le shim
// ambiant `@/plotly-shim.d.ts`. Un `declare module` inline ici produirait TS2665
// (augmentation d'un module résolu mais non typé).

interface Props {
  artifact: Artifact
  /** URL blob/image de secours (crop WebP original) servie par le backend, si disponible. */
  fallbackImageUrl?: string
  /** Callback d'agrandissement (clic sur le rendu) — piloté par le parent (→ ImageModal). */
  onEnlarge?: (src: string, title: string) => void
}

/**
 * Familles d'artefacts §12.
 *  - Rendues NATIVEMENT : geometry_vector (SVG), matrix (LaTeX/KaTeX),
 *    data_table (tanstack-table), flowchart (mermaid), signal_waveform (plotly).
 *  - « visionneuse non installée » (hors périmètre v1) : smiles_chem (ketcher),
 *    code_snippet (shiki) → WebP original + panneau source repliable + étiquette ambre.
 *  - dense_illustration / autres → image binaire (original).
 */
type Family =
  | 'geometry_vector' | 'matrix' | 'data_table'
  | 'flowchart' | 'signal_waveform' | 'smiles_chem' | 'code_snippet'
  | 'dense_illustration' | 'other'

/** Familles rendues nativement (éligibles au comparateur structuré/original). */
const NATIVE: ReadonlySet<Family> = new Set<Family>([
  'geometry_vector', 'matrix', 'data_table', 'flowchart', 'signal_waveform',
])

/**
 * Familles dont la visionneuse structurée n'est PAS installée en v1
 * (tech_specs §9 Note Tiering — ketcher/shiki hors périmètre) : on affiche le
 * WebP original + un panneau source repliable + l'étiquette « visionneuse non installée ».
 */
const VIEWER_NOT_INSTALLED: ReadonlySet<Family> = new Set<Family>(['smiles_chem', 'code_snippet'])

/**
 * Dictionnaire §12 : `render_config_json.renderer` → famille de rendu.
 * Lu EN PRIORITÉ (F1) ; `detectFamily` ne sert que de repli pour les artefacts
 * sans renderer déclaré (ex. dense_illustration réelles sans render_config_json).
 */
const RENDERER_TO_FAMILY: Record<string, Family> = {
  katex: 'matrix',
  svg: 'geometry_vector',
  mermaid: 'flowchart',
  plotly: 'signal_waveform',
  'tanstack-table': 'data_table',
  shiki: 'code_snippet',
  ketcher: 'smiles_chem',
  openseadragon: 'dense_illustration',
}

/** État de rendu EFFECTIF (calculé sur le rendu réel, pas sur artifact_type — F3). */
type RenderState = 'structured' | 'original' | 'viewer_missing'

/** Lecture typée et défensive du render_config_json (renderer + semantic). */
interface RenderConfig {
  renderer?: string
  semantic?: string
}
function parseRenderConfig(raw: string | null | undefined): RenderConfig {
  if (!raw) return {}
  try {
    const cfg = JSON.parse(raw) as unknown
    if (cfg && typeof cfg === 'object') {
      const o = cfg as Record<string, unknown>
      const renderer = typeof o.renderer === 'string' ? o.renderer : undefined
      const semantic = typeof o.semantic === 'string' ? o.semantic : undefined
      return { renderer, semantic }
    }
    return {}
  } catch {
    return {}
  }
}

/** Repli : déduit la famille par sous-chaînes de artifact_type (F1 — fallback uniquement). */
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

/**
 * Résout la famille (F1) : `render_config_json.renderer` EN PRIORITÉ,
 * `detectFamily(artifact_type)` en repli.
 */
function resolveFamily(renderer: string | undefined, type: string): Family {
  if (renderer) {
    const mapped = RENDERER_TO_FAMILY[renderer.toLowerCase()]
    if (mapped) return mapped
  }
  return detectFamily(type)
}

/** Sémantique i18n (برهان / توضيح / سند تمرين) depuis render_config_json.semantic. */
function readSemantic(s: string | undefined): 'demonstration' | 'illustration' | 'exercise_support' | null {
  if (s === 'demonstration' || s === 'illustration' || s === 'exercise_support') return s
  return null
}

/**
 * Badge de TYPE arabe court par famille (F4) — porté ici depuis PageMedia pour
 * pouvoir l'afficher aussi in-situ. Calculé sur la FAMILLE (renderer prioritaire),
 * donc cohérent avec le rendu réel.
 */
function arabicTypeBadge(family: Family): string {
  switch (family) {
    case 'geometry_vector': return 'شكل'
    case 'matrix': return 'صيغة'
    case 'data_table': return 'جدول'
    case 'flowchart': return 'مخطط'
    case 'signal_waveform': return 'إشارة'
    case 'smiles_chem': return 'صيغة كيميائية'
    case 'code_snippet': return 'شيفرة'
    case 'dense_illustration': return 'رسم'
    default: return 'رسم'
  }
}

/** Langage lisible du bloc <pre> selon la famille (panneau source). */
function sourceLangHint(family: Family): string {
  switch (family) {
    case 'flowchart': return 'mermaid'
    case 'signal_waveform': return 'json'
    case 'smiles_chem': return 'smiles'
    case 'code_snippet': return 'code'
    default: return ''
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Rendu Mermaid (import dynamique — n'alourdit pas le bundle initial). F2/F5.
// ──────────────────────────────────────────────────────────────────────────
type LoadState = 'loading' | 'ok' | 'error'

interface NativeChildProps {
  raw: string
  isRtl: boolean
  /** Remonte l'état de rendu au parent (badge + comparateur). */
  onState?: (ok: boolean) => void
  onEnlarge?: () => void
}

let mermaidInitDone = false
let mermaidSeq = 0

function MermaidView({ raw, isRtl, onState, onEnlarge }: NativeChildProps) {
  const [state, setState] = useState<LoadState>('loading')
  const [svg, setSvg] = useState<string>('')

  useEffect(() => {
    let alive = true
    setState('loading')
    ;(async () => {
      try {
        const mod = await import('mermaid')
        const mermaid = mod.default
        if (!mermaidInitDone) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'dark',
          })
          mermaidInitDone = true
        }
        const id = `ragdom-mermaid-${mermaidSeq++}`
        const { svg: out } = await mermaid.render(id, raw)
        // Sanitisation défensive (profil SVG) avant injection.
        const clean = DOMPurify.sanitize(out, { USE_PROFILES: { svg: true, svgFilters: true } })
        if (!alive) return
        if (!clean.includes('<svg')) throw new Error('mermaid: sortie vide')
        setSvg(clean)
        setState('ok')
        onState?.(true)
      } catch {
        if (!alive) return
        setState('error')
        onState?.(false)
      }
    })()
    return () => { alive = false }
    // onState volontairement hors deps (callback stable attendu côté parent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw])

  if (state === 'loading') {
    return <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '10px 0' }} dir="auto" aria-busy="true">…</div>
  }
  if (state === 'error') return null // le parent bascule sur l'image de repli
  return (
    <div
      className="bidi-isolate artifact-mermaid"
      dir={isRtl ? 'rtl' : 'ltr'}
      role={onEnlarge ? 'button' : undefined}
      tabIndex={onEnlarge ? 0 : undefined}
      onClick={onEnlarge}
      style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', overflowX: 'auto', cursor: onEnlarge ? 'zoom-in' : 'default' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Rendu Plotly (import dynamique). F2/F5. Parse défensif du JSON de raw_data.
// ──────────────────────────────────────────────────────────────────────────
interface PlotlyFigure {
  data: unknown[]
  layout: Record<string, unknown>
}
function parsePlotlyFigure(raw: string): PlotlyFigure | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const o = parsed as Record<string, unknown>
    // Accepte { data, layout } OU un tableau de traces bruts.
    if (Array.isArray(o.data)) {
      return { data: o.data, layout: (o.layout && typeof o.layout === 'object' ? o.layout as Record<string, unknown> : {}) }
    }
    if (Array.isArray(parsed)) {
      return { data: parsed as unknown[], layout: {} }
    }
    return null
  } catch {
    return null
  }
}

function PlotlyView({ raw, isRtl, onState }: NativeChildProps) {
  const [state, setState] = useState<LoadState>('loading')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    let purge: ((el: HTMLElement) => void) | null = null
    const el = containerRef.current
    setState('loading')
    const fig = parsePlotlyFigure(raw)
    if (!fig || !el) {
      setState('error')
      onState?.(false)
      return
    }
    ;(async () => {
      try {
        const Plotly = await import('plotly.js-dist-min')
        purge = Plotly.purge
        const marginBase = (typeof fig.layout.margin === 'object' && fig.layout.margin) ? fig.layout.margin as Record<string, unknown> : {}
        const layout: Record<string, unknown> = {
          ...fig.layout,
          autosize: true,
          margin: { t: 24, r: 12, b: 36, l: 44, ...marginBase },
          paper_bgcolor: 'rgba(0,0,0,0)',
          plot_bgcolor: 'rgba(0,0,0,0)',
          font: { color: '#94a3b8' },
        }
        await Plotly.newPlot(el, fig.data, layout, { displayModeBar: false, responsive: true })
        if (!alive) { Plotly.purge(el); return }
        setState('ok')
        onState?.(true)
      } catch {
        if (!alive) return
        setState('error')
        onState?.(false)
      }
    })()
    return () => {
      alive = false
      if (purge && el) { try { purge(el) } catch { /* no-op */ } }
    }
    // onState hors deps (stable attendu côté parent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw])

  return (
    <>
      {state === 'loading' && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '10px 0' }} dir="auto" aria-busy="true">…</div>
      )}
      {/* Le div reste monté même en erreur (le parent masquera via son propre repli). */}
      <div
        ref={containerRef}
        className="artifact-plotly"
        dir={isRtl ? 'rtl' : 'ltr'}
        style={{ width: '100%', minHeight: state === 'ok' ? 260 : 0, display: state === 'error' ? 'none' : 'block' }}
      />
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Rendu data_table via tanstack-table (F7). Parse d'un tableau markdown GFM.
// ──────────────────────────────────────────────────────────────────────────
interface ParsedTable { headers: string[]; rows: string[][] }

/** Parse un tableau markdown GFM (| a | b |). Retourne null si non conforme. */
function parseMarkdownTable(raw: string): ParsedTable | null {
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  // Il faut au moins l'en-tête + la ligne séparatrice (---|---).
  if (lines.length < 2) return null
  const headerLine = lines[0]
  const sepLine = lines[1]
  if (!headerLine.includes('|')) return null
  // Ligne séparatrice GFM : cellules faites uniquement de - : espaces (au moins un -).
  const sepCells = splitRow(sepLine)
  if (sepCells.length === 0 || !sepCells.every(c => /^:?-+:?$/.test(c.trim()))) return null

  const headers = splitRow(headerLine)
  if (headers.length === 0) return null
  const rows: string[][] = []
  for (let i = 2; i < lines.length; i++) {
    if (!lines[i].includes('|')) continue
    const cells = splitRow(lines[i])
    if (cells.length === 0) continue
    // Normalise la largeur sur le nombre de colonnes de l'en-tête.
    const norm: string[] = []
    for (let c = 0; c < headers.length; c++) norm.push(cells[c] ?? '')
    rows.push(norm)
  }
  if (rows.length === 0) return null
  return { headers, rows }
}

/** Découpe une ligne « | a | b | » en cellules (gère les pipes de bord). */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  // Ne gère pas les pipes échappés dans le corpus actuel (tableaux simples).
  return s.split('|').map(c => c.trim())
}

function DataTableView({ parsed, isRtl }: { parsed: ParsedTable; isRtl: boolean }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const columns = useMemo<ColumnDef<string[]>[]>(
    () => parsed.headers.map((h, idx) => ({
      id: `col-${idx}`,
      header: h,
      accessorFn: (row: string[]) => row[idx] ?? '',
      sortingFn: (a, b, colId) => {
        const av = a.getValue<string>(colId)
        const bv = b.getValue<string>(colId)
        const an = Number(av.replace(/[\s٫٬]/g, m => (m === '٫' ? '.' : '')))
        const bn = Number(bv.replace(/[\s٫٬]/g, m => (m === '٫' ? '.' : '')))
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn
        return av.localeCompare(bv, isRtl ? 'ar' : undefined)
      },
    })),
    [parsed.headers, isRtl],
  )
  const table = useReactTable({
    data: parsed.rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="page-media-table artifact-tanstack-table" style={{ overflowX: 'auto' }}>
      <table dir={isRtl ? 'rtl' : 'ltr'} style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          {table.getHeaderGroups().map(hg => (
            <tr key={hg.id}>
              {hg.headers.map(header => {
                const sorted = header.column.getIsSorted()
                return (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    style={{
                      textAlign: isRtl ? 'right' : 'left', padding: '8px 10px', cursor: 'pointer',
                      background: 'var(--bg-surface-secondary)', borderBottom: '2px solid var(--border-color)',
                      color: 'var(--text-heading)', fontWeight: 700, whiteSpace: 'nowrap', userSelect: 'none',
                    }}
                    dir="auto"
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === 'asc' ? <ArrowUp size={12} /> : sorted === 'desc' ? <ArrowDown size={12} /> : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                    </span>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id}>
              {row.getVisibleCells().map(cell => (
                <td
                  key={cell.id}
                  dir="auto"
                  style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-color)', textAlign: isRtl ? 'right' : 'left' }}
                >
                  {cell.column.columnDef.cell
                    ? flexRender(cell.column.columnDef.cell, cell.getContext())
                    : cell.getValue<string>()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * ArtifactRenderer (§12) — rend un artefact selon sa famille (renderer prioritaire),
 * avec :
 *  - badge de TYPE (رسم/جدول/صيغة…) + badge d'ÉTAT de rendu (مُهيكل/أصل/عارض غير مثبت)
 *    calculé sur le rendu EFFECTIF (F3/F4) ;
 *  - badge sémantique (برهان / توضيح / سند تمرين) si render_config_json.semantic ;
 *  - rendu natif SVG / KaTeX / tanstack-table / mermaid / plotly, ou WebP + panneau
 *    source repliable, ou image ;
 *  - comparateur (المهيكل / الأصل / مقارنة) pour les familles natives + has_binary ;
 *  - dégradation gracieuse ABSOLUE : toute exception de rendu → repli image + badge « أصل ».
 */
export default function ArtifactRenderer({ artifact, fallbackImageUrl, onEnlarge }: Props) {
  const { t, isRtl } = useLanguage()
  const type = (artifact.artifact_type || '').toLowerCase()
  const cfg = useMemo(() => parseRenderConfig(artifact.render_config_json), [artifact.render_config_json])
  const family = useMemo(() => resolveFamily(cfg.renderer, type), [cfg.renderer, type])
  const caption = artifact.caption ?? artifact.artifact_type
  const hasBinary = artifact.has_binary === true && !!fallbackImageUrl
  const semantic = readSemantic(cfg.semantic)
  const rawData = artifact.raw_data ?? ''
  const hasRawData = rawData.trim().length > 0

  // Les données réelles (OCR/VLM) embarquent souvent leurs PROPRES délimiteurs
  // ($$…$$ dans raw_data) et certains tableaux réparés par la Couche 5 portent
  // du LaTeX array au lieu de markdown : on assainit et on redirige AVANT rendu.
  const mathSource = useMemo(() => stripMathDelimiters(rawData), [rawData])
  const looksLatex = /^\\begin\{|^begin\{/.test(mathSource)

  // matrix → LaTeX displayMode. Rendu STRICT + auto-réparation (V4.4) : réussit
  // proprement ou renvoie null → repli honnête (image/panneau), JAMAIS de rouge.
  const katexHtml = useMemo(() => {
    const isMathFamily = family === 'matrix' || (family === 'data_table' && looksLatex)
    if (!isMathFamily || !hasRawData) return null
    return renderKatexStrict(mathSource, true)
  }, [family, mathSource, looksLatex, hasRawData])

  // geometry_vector → SVG autonome sanitisé (profil SVG DOMPurify)
  const svgHtml = useMemo(() => {
    if (family !== 'geometry_vector' || !hasRawData || !rawData.trimStart().startsWith('<svg')) return null
    const clean = DOMPurify.sanitize(rawData, { USE_PROFILES: { svg: true, svgFilters: true } })
    return clean.includes('<svg') ? clean : null
  }, [family, rawData, hasRawData])

  // data_table → parse markdown GFM pour tanstack-table (repli markdown si échec).
  // Un data_table dont le raw_data est en réalité du LaTeX array (réparation
  // Couche 5) est redirigé vers KaTeX (katexHtml ci-dessus), jamais vers la table.
  const parsedTable = useMemo(() => {
    if (family !== 'data_table' || !hasRawData || looksLatex) return null
    return parseMarkdownTable(rawData)
  }, [family, rawData, hasRawData, looksLatex])
  const hasTable = family === 'data_table' && hasRawData && !looksLatex

  // mermaid / plotly : rendu asynchrone → état remonté par le composant enfant.
  const [mermaidOk, setMermaidOk] = useState<boolean | null>(null)
  const [plotlyOk, setPlotlyOk] = useState<boolean | null>(null)

  // Éligibilité au rendu natif « synchrone » (svg/katex/table) — connu immédiatement.
  const nativeSyncOk =
    !!katexHtml ||
    (family === 'geometry_vector' && !!svgHtml) ||
    hasTable

  // Familles à rendu asynchrone (mermaid/plotly) : tentées si raw_data présent.
  const isAsyncNative = (family === 'flowchart' || family === 'signal_waveform') && hasRawData
  const asyncOk = family === 'flowchart' ? mermaidOk : family === 'signal_waveform' ? plotlyOk : null

  // Le rendu natif est-il valide (ou en cours pour l'async) ? Détermine l'affichage.
  const nativeOk = nativeSyncOk || (isAsyncNative && asyncOk !== false)

  // Comparateur : familles natives + binaire, et rendu natif OK (async non échoué).
  const canCompare = NATIVE.has(family) && nativeOk && hasBinary && (!isAsyncNative || asyncOk === true)

  const [view, setView] = useState<'structured' | 'original' | 'compare'>('structured')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const wrapStyle: CSSProperties = {
    background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)',
    borderRadius: 12, padding: 14, margin: 0,
  }

  const copySource = () => {
    if (!rawData) return
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(rawData).then(done, done)
      else done()
    } catch { done() }
  }

  const enlarge = onEnlarge && fallbackImageUrl ? () => onEnlarge(fallbackImageUrl, caption) : undefined

  // ── Rendu natif (structuré) réutilisable ─────────────────────────────────
  const renderNative = (): ReactNode => {
    if (katexHtml) {
      return <div className="bidi-isolate" style={{ overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: katexHtml }} />
    }
    if (family === 'geometry_vector' && svgHtml) {
      return (
        <div
          className="bidi-isolate artifact-svg"
          role={enlarge ? 'button' : undefined}
          tabIndex={enlarge ? 0 : undefined}
          onClick={enlarge}
          style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: enlarge ? 'zoom-in' : 'default' }}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      )
    }
    if (family === 'data_table' && parsedTable) {
      return <DataTableView parsed={parsedTable} isRtl={isRtl} />
    }
    if (hasTable) {
      // Repli markdown si le parsing tanstack échoue (raw_data non-GFM).
      return <div className="page-media-table"><MarkdownKatex lazy raw={rawData} /></div>
    }
    if (family === 'flowchart' && hasRawData) {
      return <MermaidView raw={rawData} isRtl={isRtl} onState={setMermaidOk} onEnlarge={enlarge} />
    }
    if (family === 'signal_waveform' && hasRawData) {
      return <PlotlyView raw={rawData} isRtl={isRtl} onState={setPlotlyOk} />
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

  // ── Panneau source repliable (« المصدر المهيكل ») ─────────────────────────
  const renderSourcePanel = (): ReactNode => {
    if (!hasRawData) return null
    return (
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
            >{rawData}</pre>
          </div>
        )}
      </div>
    )
  }

  // ── Composition du corps + détermination de l'ÉTAT de rendu effectif ──────
  let body: ReactNode
  let renderState: RenderState

  if (canCompare) {
    // Familles natives + binaire : bascule structuré / original / comparaison.
    renderState = view === 'original' ? 'original' : 'structured'
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
  } else if (nativeSyncOk) {
    // Rendu natif synchrone valide, sans binaire (ou binaire absent).
    renderState = 'structured'
    body = renderNative()
  } else if (isAsyncNative && asyncOk === true) {
    // mermaid/plotly rendu OK sans binaire.
    renderState = 'structured'
    body = renderNative()
  } else if (isAsyncNative && asyncOk === null) {
    // mermaid/plotly EN COURS : on tente le natif ; si échec → repli via effet.
    // État provisoire « structuré » (le composant enfant remontera false en cas d'échec,
    // ce qui re-rendra en repli image ci-dessous au tour suivant).
    renderState = 'structured'
    body = renderNative()
  } else if (VIEWER_NOT_INSTALLED.has(family) && (hasBinary || hasRawData)) {
    // smiles_chem / code_snippet : visionneuse hors périmètre v1 (F2).
    // WebP original en visuel principal (si dispo) + panneau source + étiquette ambre.
    renderState = 'viewer_missing'
    body = (
      <>
        {hasBinary ? renderImage() : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '6px 0' }} dir="auto">
            {t('library.media_viewer_not_installed')}
          </div>
        )}
        {renderSourcePanel()}
      </>
    )
  } else if (fallbackImageUrl) {
    // dense_illustration / autres, ou structuré invalide / async échoué + has_binary → image.
    renderState = 'original'
    body = renderImage()
  } else if (hasRawData) {
    // Source structurée SANS binaire et non rendable nativement : afficher la source.
    // (ex. flowchart/plotly dont le rendu a échoué ET pas de binaire.)
    renderState = isAsyncNative && asyncOk === false ? 'original' : 'structured'
    body = (
      <pre
        className="bidi-isolate"
        data-lang={sourceLangHint(family)}
        style={{ direction: 'ltr', textAlign: 'left', overflowX: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 12, fontSize: '0.82rem', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >{rawData}</pre>
    )
  } else {
    renderState = 'original'
    body = (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)' }} dir="auto">
        {t('library.media_empty')}
      </div>
    )
  }

  const semanticLabel = semantic ? t(`library.semantic_${semantic}`) : null
  const typeBadge = arabicTypeBadge(family)

  // Badge d'ÉTAT de rendu (F3) — classe/couleur cohérente avec le design system.
  const stateBadge: { label: string; className: string } =
    renderState === 'structured'
      ? { label: t('library.render_state_structured'), className: 'badge-success' }
      : renderState === 'viewer_missing'
        ? { label: t('library.render_state_viewer_missing'), className: 'badge-warning' }
        : { label: t('library.render_state_original'), className: 'badge-subtle' }

  return (
    <div style={wrapStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {/* Groupe gauche : type + état de rendu (+ sémantique). */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="badge badge-secondary artifact-type-badge" dir="auto">
            <ImageIcon size={12} /> {typeBadge}
          </span>
          <span className={`badge ${stateBadge.className} artifact-render-state-badge`} dir="auto" title={stateBadge.label}>
            {stateBadge.label}
          </span>
          {semanticLabel && (
            <span className={`badge artifact-semantic-badge artifact-semantic-${semantic}`} dir="auto">
              {semanticLabel}
            </span>
          )}
        </span>
        {/* Groupe droite : comparateur (familles natives + binaire). */}
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
      {body}
    </div>
  )
}
