import { useId, useMemo, type CSSProperties } from 'react'

/**
 * ParametricFigures — renderers SVG paramétriques natifs de la charte RAGDom.
 *
 * Deux figures scolaires (manuels arabes, contexte RTL) rendues SANS dépendance
 * nouvelle : SVG pur, viewBox responsive (net à toute taille), thème dual assuré
 * par `currentColor` (hérité de la couleur de texte) + classes CSS existantes.
 *
 * Les paramètres sont produits en amont par le VLM (backend) et transmis via
 * `render_config_json.renderer` = `param-number-line` / `param-decimal-grid`,
 * le JSON des paramètres arrivant dans `raw_data`. Le parse + la validation de
 * forme minimale sont faits par ArtifactRenderer (repli image si invalide).
 *
 * Convention maths : les axes/chiffres restent en LTR même en contexte RTL
 * (les nombres se lisent toujours de gauche à droite).
 */

// ──────────────────────────────────────────────────────────────────────────
// Contrats de props (partagés avec l'agent backend qui produit les paramètres)
// ──────────────────────────────────────────────────────────────────────────

export interface NumberLinePoint {
  label: string
  value: number
}

export interface NumberLineParams {
  min: number
  max: number
  step: number
  points: NumberLinePoint[]
  /** Segments à surligner, exprimés en valeurs de l'axe : [de, à]. */
  highlight_segments?: Array<[number, number]>
}

export type DecimalGridColor = 'blue' | 'red' | 'green' | 'orange' | 'purple' | 'gray'

export interface DecimalGridCell {
  count: number
  color: DecimalGridColor
  label?: string
}

export interface DecimalGridParams {
  rows: number
  cols: number
  cells: DecimalGridCell[]
}

// ──────────────────────────────────────────────────────────────────────────
// Validation de forme minimale (utilisée par ArtifactRenderer avant rendu)
// ──────────────────────────────────────────────────────────────────────────

/** Valide + normalise un JSON quelconque en NumberLineParams (null si invalide). */
export function validateNumberLine(raw: unknown): NumberLineParams | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const min = Number(o.min)
  const max = Number(o.max)
  const step = Number(o.step)
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step)) return null
  if (max <= min || step <= 0) return null
  if (!Array.isArray(o.points)) return null
  const points: NumberLinePoint[] = []
  for (const p of o.points) {
    if (!p || typeof p !== 'object') continue
    const po = p as Record<string, unknown>
    const value = Number(po.value)
    if (!Number.isFinite(value)) continue
    const label = typeof po.label === 'string' ? po.label : String(value)
    points.push({ label, value })
  }
  let highlight_segments: Array<[number, number]> | undefined
  if (Array.isArray(o.highlight_segments)) {
    const segs: Array<[number, number]> = []
    for (const s of o.highlight_segments) {
      if (!Array.isArray(s) || s.length < 2) continue
      const a = Number(s[0]); const b = Number(s[1])
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      segs.push([a, b])
    }
    if (segs.length > 0) highlight_segments = segs
  }
  // Au moins l'axe est rendable même sans points ; on exige un axe cohérent.
  return { min, max, step, points, highlight_segments }
}

/** Valide + normalise un JSON quelconque en DecimalGridParams (null si invalide). */
export function validateDecimalGrid(raw: unknown): DecimalGridParams | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const rows = Number.isFinite(Number(o.rows)) ? Math.trunc(Number(o.rows)) : 10
  const cols = Number.isFinite(Number(o.cols)) ? Math.trunc(Number(o.cols)) : 10
  if (rows <= 0 || cols <= 0 || rows > 100 || cols > 100) return null
  if (!Array.isArray(o.cells)) return null
  const allowed: ReadonlySet<string> = new Set(['blue', 'red', 'green', 'orange', 'purple', 'gray'])
  const cells: DecimalGridCell[] = []
  for (const c of o.cells) {
    if (!c || typeof c !== 'object') continue
    const co = c as Record<string, unknown>
    const count = Number(co.count)
    if (!Number.isFinite(count) || count <= 0) continue
    const color = typeof co.color === 'string' && allowed.has(co.color) ? (co.color as DecimalGridColor) : 'gray'
    const label = typeof co.label === 'string' ? co.label : undefined
    cells.push({ count: Math.trunc(count), color, label })
  }
  if (cells.length === 0) return null
  return { rows, cols, cells }
}

// ──────────────────────────────────────────────────────────────────────────
// Palettes (lisibles clair ET sombre — teintes moyennes saturées).
// ──────────────────────────────────────────────────────────────────────────

/** Palette cyclée des points de la demi-droite (distincte, lisible sur les 2 thèmes). */
const POINT_PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2'] as const

/** Palette nommée de la grille décimale (mappée sur les 6 couleurs du contrat). */
const GRID_PALETTE: Record<DecimalGridColor, string> = {
  blue: '#2563eb',
  red: '#dc2626',
  green: '#059669',
  orange: '#d97706',
  purple: '#7c3aed',
  gray: '#64748b',
}

/** Formatage LTR d'un nombre (décimales limitées, pas de zéros parasites). */
function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000
  return String(r)
}

// ──────────────────────────────────────────────────────────────────────────
// NumberLine — demi-droite graduée (axe fléché, graduations, points, segments).
// ──────────────────────────────────────────────────────────────────────────

export function NumberLine({ params }: { params: NumberLineParams }) {
  const { min, max, step } = params
  // id unique par instance (évite les collisions de <marker> si plusieurs droites).
  const rawId = useId()
  const arrowId = `rl-arrow-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`

  // Géométrie du viewBox : coordonnées en unités SVG fixes (responsive via width=100%).
  const VB_W = 720
  const PAD_L = 40
  const PAD_R = 40
  const AXIS_Y = 92
  const axisX0 = PAD_L
  const axisX1 = VB_W - PAD_R
  const axisW = axisX1 - axisX0

  const toX = (v: number): number => axisX0 + ((v - min) / (max - min)) * axisW

  // Graduations majeures (pas = step). Sous-graduations si step « fractionnaire raisonnable ».
  const majors = useMemo(() => {
    const out: number[] = []
    // Garde-fou : limite le nombre de graduations pour rester net.
    const n = Math.floor((max - min) / step + 1e-9)
    if (n > 400) return out
    for (let i = 0; i <= n; i++) {
      const v = min + i * step
      if (v <= max + 1e-9) out.push(Math.round(v * 1e6) / 1e6)
    }
    return out
  }, [min, max, step])

  // Sous-graduations : on subdivise chaque pas en 2 si le pas n'est pas entier
  // et que la densité reste raisonnable (≤ ~200 traits).
  const minors = useMemo(() => {
    const isFractional = Math.abs(step - Math.round(step)) > 1e-9
    if (!isFractional) return []
    const half = step / 2
    const n = Math.floor((max - min) / half + 1e-9)
    if (n > 200) return []
    const out: number[] = []
    for (let i = 0; i <= n; i++) {
      const v = min + i * half
      // Ne double pas les majeures.
      const onMajor = Math.abs(((v - min) / step) - Math.round((v - min) / step)) < 1e-9
      if (!onMajor && v <= max + 1e-9) out.push(Math.round(v * 1e6) / 1e6)
    }
    return out
  }, [min, max, step])

  const segments = params.highlight_segments ?? []

  return (
    <div className="artifact-param artifact-number-line" style={{ width: '100%', color: 'var(--text-heading)' }}>
      <svg
        viewBox={`0 0 ${VB_W} 140`}
        width="100%"
        role="img"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', maxWidth: '100%', overflow: 'visible' }}
      >
        {/* Segments surlignés (sous l'axe, bande translucide). */}
        {segments.map(([a, b], i) => {
          const x1 = toX(Math.max(min, Math.min(a, b)))
          const x2 = toX(Math.min(max, Math.max(a, b)))
          return (
            <rect
              key={`seg-${i}`}
              x={x1}
              y={AXIS_Y - 9}
              width={Math.max(0, x2 - x1)}
              height={18}
              rx={4}
              fill={POINT_PALETTE[(i + 2) % POINT_PALETTE.length]}
              opacity={0.18}
            />
          )
        })}

        {/* Axe principal + flèche (LTR : orientée vers max, à droite). */}
        <defs>
          <marker id={arrowId} markerWidth="10" markerHeight="10" refX="7" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="currentColor" />
          </marker>
        </defs>
        <line
          x1={axisX0}
          y1={AXIS_Y}
          x2={axisX1}
          y2={AXIS_Y}
          stroke="currentColor"
          strokeWidth={1.6}
          markerEnd={`url(#${arrowId})`}
        />

        {/* Sous-graduations (traits courts). */}
        {minors.map((v, i) => {
          const x = toX(v)
          return <line key={`min-${i}`} x1={x} y1={AXIS_Y - 5} x2={x} y2={AXIS_Y + 5} stroke="currentColor" strokeWidth={0.9} opacity={0.5} />
        })}

        {/* Graduations majeures + libellés numériques (LTR, chiffres latins). */}
        {majors.map((v, i) => {
          const x = toX(v)
          return (
            <g key={`maj-${i}`}>
              <line x1={x} y1={AXIS_Y - 8} x2={x} y2={AXIS_Y + 8} stroke="currentColor" strokeWidth={1.3} />
              <text
                x={x}
                y={AXIS_Y + 26}
                textAnchor="middle"
                fontSize={13}
                fill="var(--text-muted)"
                style={{ direction: 'ltr', fontVariantNumeric: 'tabular-nums' }}
              >
                {fmt(v)}
              </text>
            </g>
          )
        })}

        {/* Points colorés (au-dessus de l'axe) + étiquette au-dessus. */}
        {params.points.map((p, i) => {
          const x = toX(p.value)
          const color = POINT_PALETTE[i % POINT_PALETTE.length]
          return (
            <g key={`pt-${i}`}>
              <line x1={x} y1={AXIS_Y} x2={x} y2={AXIS_Y - 30} stroke={color} strokeWidth={1.4} opacity={0.6} />
              <circle cx={x} cy={AXIS_Y} r={5.5} fill={color} stroke="var(--bg-card-inner)" strokeWidth={1.5} />
              <text
                x={x}
                y={AXIS_Y - 38}
                textAnchor="middle"
                fontSize={13}
                fontWeight={700}
                fill={color}
              >
                {p.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// DecimalGrid — grille rows×cols remplie colonne par colonne (dixièmes).
// ──────────────────────────────────────────────────────────────────────────

export function DecimalGrid({ params }: { params: DecimalGridParams }) {
  const { rows, cols, cells } = params

  // Cellule carrée en unités SVG ; le SVG scale ensuite au conteneur.
  const CELL = 26
  const GAP = 0 // grille pleine (cases jointives, façon carré de 100)
  const GRID_W = cols * CELL
  const GRID_H = rows * CELL
  const total = rows * cols

  // Remplissage COLONNE PAR COLONNE (convention manuels : dixièmes = colonnes pleines).
  // On calcule pour chaque case (index colonne-major) la couleur du groupe qui l'occupe.
  const fill = useMemo(() => {
    const arr: (DecimalGridColor | null)[] = new Array(total).fill(null)
    let cursor = 0
    for (const cell of cells) {
      const n = Math.min(cell.count, total - cursor)
      for (let k = 0; k < n; k++) {
        arr[cursor + k] = cell.color
      }
      cursor += n
      if (cursor >= total) break
    }
    return arr
  }, [cells, total])

  // Index colonne-major → (row, col). idx = col*rows + row.
  const cellRect = (idx: number): { x: number; y: number } => {
    const col = Math.floor(idx / rows)
    const row = idx % rows
    return { x: col * CELL, y: row * CELL }
  }

  const cellStyle: CSSProperties = { color: 'var(--text-heading)' }

  return (
    <div className="artifact-param artifact-decimal-grid" style={{ ...cellStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <svg
        viewBox={`0 0 ${GRID_W} ${GRID_H}`}
        width="100%"
        role="img"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', maxWidth: Math.min(360, GRID_W * 2), height: 'auto' }}
      >
        {Array.from({ length: total }, (_, idx) => {
          const { x, y } = cellRect(idx)
          const c = fill[idx]
          return (
            <rect
              key={idx}
              x={x + GAP / 2}
              y={y + GAP / 2}
              width={CELL - GAP}
              height={CELL - GAP}
              fill={c ? GRID_PALETTE[c] : 'transparent'}
              fillOpacity={c ? 0.85 : 0}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeWidth={1}
            />
          )
        })}
      </svg>

      {/* Légende : carré coloré + label, uniquement pour les groupes étiquetés. */}
      {cells.some(c => c.label) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
          {cells.map((c, i) => (
            c.label ? (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-muted)' }} dir="auto">
                <span style={{ width: 12, height: 12, borderRadius: 3, background: GRID_PALETTE[c.color], display: 'inline-block', border: '1px solid var(--border-color)' }} />
                {c.label}
              </span>
            ) : null
          ))}
        </div>
      )}
    </div>
  )
}
