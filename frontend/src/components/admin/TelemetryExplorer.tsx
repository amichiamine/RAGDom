import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import type { BenchmarkRow, BenchmarkAggregates, Document } from '@/types'
import { useToast } from '@/components/common/Toast'
import { Spinner, ErrorBanner, EmptyState } from '@/components/common/Feedback'
import { formatDate } from '@/lib/utils'

interface Props {
  db: string
  documents: Document[]
}

const PAGE_SIZE = 25

/** Compteur animé (countUp) — anime de 0 → value sur ~600ms, ease-out. */
function CountUp({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef<number | null>(null)
  const fromRef = useRef(0)

  useEffect(() => {
    const from = fromRef.current
    const to = Number.isFinite(value) ? value : 0
    const duration = 600
    const start = performance.now()
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
      setDisplay(from + (to - from) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [value])

  return <span className="font-num">{display.toFixed(decimals)}{suffix}</span>
}

function KpiTile({ label, value, decimals, suffix }: { label: string; value: number; decimals?: number; suffix?: string }) {
  return (
    <div className="telemetry-kpi">
      <div className="telemetry-kpi-value"><CountUp value={value} decimals={decimals} suffix={suffix} /></div>
      <div className="telemetry-kpi-label">{label}</div>
    </div>
  )
}

/** Graphe en barres SVG pur (latence par page) — aucune dépendance externe. */
function LatencyBars({ rows }: { rows: BenchmarkRow[] }) {
  const data = useMemo(
    () => [...rows].sort((a, b) => a.page_number - b.page_number).slice(0, 60),
    [rows],
  )
  if (data.length === 0) return null

  const W = 640, H = 180, PAD_B = 24, PAD_L = 4, PAD_T = 8
  const max = Math.max(...data.map(d => d.execution_time_ms), 1)
  const barGap = 2
  const barW = Math.max(2, (W - PAD_L * 2) / data.length - barGap)

  return (
    <div className="telemetry-chart" role="img" aria-label="Latence par page (ms)">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 180 }}>
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_L} y2={H - PAD_B} stroke="var(--border-color)" strokeWidth={1} />
        {data.map((d, i) => {
          const h = ((H - PAD_B - PAD_T) * d.execution_time_ms) / max
          const x = PAD_L + i * (barW + barGap)
          const y = H - PAD_B - h
          return (
            <rect key={d.id} x={x} y={y} width={barW} height={h} rx={1.5} fill="var(--engine-accent)">
              <title>{`page ${d.page_number} — ${d.execution_time_ms} ms`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="telemetry-chart-caption">Latence par page (ms) — {data.length} pages · max {max} ms</div>
    </div>
  )
}

/** §7.9 TelemetryExplorer — KPIs agrégés animés + table paginée + graphe SVG. */
export default function TelemetryExplorer({ db, documents }: Props) {
  const toast = useToast()
  const [rows, setRows] = useState<BenchmarkRow[]>([])
  const [aggregates, setAggregates] = useState<BenchmarkAggregates | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [documentId, setDocumentId] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    if (!db) return
    setLoading(true); setError(null)
    api.library.getBenchmarks(db, documentId || undefined, page, PAGE_SIZE)
      .then(res => {
        setRows(res.data ?? [])
        setAggregates(res.aggregates ?? null)
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : 'Erreur de chargement')
        toast.error(e instanceof Error ? e.message : 'Erreur télémétrie')
      })
      .finally(() => setLoading(false))
  }, [db, documentId, page, toast])

  useEffect(() => { load() }, [load])

  // Reset de page au changement de filtre document.
  useEffect(() => { setPage(1) }, [documentId, db])

  const a = aggregates

  return (
    <div className="auto-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <BarChart3 size={20} /> 📊 Télémétrie
        </h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="form-select" style={{ maxWidth: 240 }} value={documentId} onChange={e => setDocumentId(e.target.value)}>
            <option value="">Tous les documents</option>
            {documents.map(d => <option key={d.id} value={d.id}>{d.title || d.filename}</option>)}
          </select>
          <button className="btn btn-sm btn-outline-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> Actualiser
          </button>
        </div>
      </div>

      {/* Tuiles agrégats (compteurs animés) */}
      {a && (
        <div className="telemetry-kpi-grid">
          <KpiTile label="Latence moyenne" value={a.avg_latency_ms} suffix=" ms" />
          <KpiTile label="Confiance moyenne" value={a.avg_confidence * 100} decimals={1} suffix="%" />
          <KpiTile label="RAM pic moyen" value={a.avg_ram_peak_mb} decimals={0} suffix=" Mo" />
          <KpiTile label="Taux VLM" value={a.vlm_usage_rate * 100} decimals={1} suffix="%" />
          <KpiTile label="Taux fallback" value={a.fallback_rate * 100} decimals={1} suffix="%" />
        </div>
      )}

      {error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : loading ? (
        <Spinner label="Chargement…" />
      ) : rows.length === 0 ? (
        <EmptyState icon="fa-chart-simple" title="Aucun benchmark" />
      ) : (
        <>
          <LatencyBars rows={rows} />

          <div style={{ overflowX: 'auto', marginTop: 16 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Page</th><th>Moteur</th><th>VLM</th><th>Fallback</th>
                  <th>Latence (ms)</th><th>RAM (Mo)</th><th>Confiance</th><th>Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="font-num">{r.page_number}</td>
                    <td>{r.engine_used}</td>
                    <td>{r.vlm_provider_used ?? '—'}</td>
                    <td>{r.fallback_triggered ? <span className="badge badge-warning">oui</span> : <span className="badge badge-subtle">non</span>}</td>
                    <td className="font-num">{r.execution_time_ms}</td>
                    <td className="font-num">{r.ram_peak_mb ?? '—'}</td>
                    <td className="font-num">{r.confidence_score != null ? (r.confidence_score * 100).toFixed(1) + '%' : '—'}</td>
                    <td>{formatDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft size={14} /> Précédent
            </button>
            <span className="badge badge-subtle">Page {page}</span>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setPage(p => p + 1)} disabled={rows.length < PAGE_SIZE}>
              Suivant <ChevronRight size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
