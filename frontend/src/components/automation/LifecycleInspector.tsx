import { useEffect, useMemo, useState } from 'react'
import { X, Microscope, Cpu, Timer } from 'lucide-react'
import { api } from '@/lib/api'
import type { BenchmarkRow } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { Spinner } from '@/components/common/Feedback'

interface Props {
  db: string
  documentId: string
  pageNumber: number
  onClose: () => void
}

/**
 * Inspecteur de cycle de vie par page (§8.3.4). Ouvre un drawer latéral listant
 * les relevés du moteur (table processing_benchmarks via GET /library/benchmarks)
 * pour la page sélectionnée : une passe = une ligne (moteur, latence, RAM pic,
 * confiance, provider VLM, repli). Barres proportionnelles à la latence, aucune
 * lib. Le backend ne filtre que par document_id ; on pagine puis on filtre par
 * page côté client. ZÉRO donnée en dur — si aucun relevé : empty-state 1 ligne.
 */
export default function LifecycleInspector({ db, documentId, pageNumber, onClose }: Props) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<BenchmarkRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRows(null); setError(null)
    ;(async () => {
      try {
        const collected: BenchmarkRow[] = []
        let page = 1
        // Le endpoint plafonne limit à 200 : on parcourt toutes les pages du document.
        for (;;) {
          const res = await api.library.getBenchmarks(db, documentId, page, 200)
          for (const r of res.data) if (r.page_number === pageNumber) collected.push(r)
          const pag = res.pagination as { total_pages?: number } | undefined
          const totalPages = pag?.total_pages ?? 1
          if (page >= totalPages) break
          page += 1
          if (page > 50) break // garde-fou (>10 000 relevés) : jamais atteint en pratique
        }
        if (!cancelled) setRows(collected)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('common.error_generic'))
      }
    })()
    return () => { cancelled = true }
  }, [db, documentId, pageNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  const maxLatency = useMemo(() => Math.max(1, ...(rows ?? []).map(r => r.execution_time_ms || 0)), [rows])

  return (
    <div className="lifecycle-overlay" onClick={onClose}>
      <div className="lifecycle-drawer" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="lifecycle-drawer__head">
          <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Microscope size={18} /> {t('automation.contents.lifecycle_title')} {pageNumber}
          </h3>
          <button className="btn btn-sm btn-outline-secondary" onClick={onClose} aria-label="close"><X size={16} /></button>
        </div>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.84rem' }}>
          {t('automation.contents.lifecycle_hint')}
        </p>

        {error ? (
          <p style={{ color: 'var(--danger)' }}>{error}</p>
        ) : rows === null ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('automation.contents.lifecycle_empty')}</p>
        ) : (
          rows.map(r => (
            <div key={r.id} className="lifecycle-row" style={{ gap: 8 }}>
              <div className="lifecycle-row__label">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <Cpu size={13} /> {r.engine_used}
                </span>
                <span className="font-num" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Timer size={12} /> {r.execution_time_ms} ms
                </span>
              </div>
              <div className="lifecycle-bar-track">
                <div className="lifecycle-bar-fill" style={{ width: `${Math.round(((r.execution_time_ms || 0) / maxLatency) * 100)}%` }} />
              </div>
              <div className="lifecycle-meta">
                <div className="lifecycle-meta__cell">
                  <div className="lifecycle-meta__k">{t('automation.contents.bench_ram')}</div>
                  <div className="lifecycle-meta__v font-num">{r.ram_peak_mb != null ? `${r.ram_peak_mb} MB` : t('automation.contents.bench_none')}</div>
                </div>
                <div className="lifecycle-meta__cell">
                  <div className="lifecycle-meta__k">{t('automation.contents.bench_confidence')}</div>
                  <div className="lifecycle-meta__v font-num">{r.confidence_score != null ? r.confidence_score : t('automation.contents.bench_none')}</div>
                </div>
                <div className="lifecycle-meta__cell">
                  <div className="lifecycle-meta__k">{t('automation.contents.bench_vlm')}</div>
                  <div className="lifecycle-meta__v" dir="auto">{r.vlm_provider_used ?? t('automation.contents.bench_none')}</div>
                </div>
                <div className="lifecycle-meta__cell">
                  <div className="lifecycle-meta__k">{t('automation.contents.bench_fallback')}</div>
                  <div className="lifecycle-meta__v">{r.fallback_triggered ? t('automation.contents.bench_yes') : t('automation.contents.bench_no')}</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
