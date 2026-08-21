import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BookOpen, Image as ImageIcon, Eye, Maximize2, PenLine, ChevronDown } from 'lucide-react'
import type { Chunk, CurriculumPayload } from '@/types'
import { api } from '@/lib/api'
import { useCurriculumBridge, HighlightTarget } from '@/contexts/CurriculumBridgeContext'
import { useLanguage } from '@/contexts/LanguageContext'
import MarkdownKatex from '@/components/library/MarkdownKatex'
import BridgeButton from '@/components/library/BridgeButton'
import ImageModal from '../ImageModal'
import {
  fetchExerciseBank, resolveSolutionFor, resolveCourseFor, buildExerciseTermResolver,
} from './curriculumData'

interface Props {
  curriculum: CurriculumPayload
  activeDb: string
  documentId: string
}

/** Exercice enrichi (corrigé lié, cours lié, trimestre déduit) prêt à afficher. */
interface ExoRow {
  chunk: Chunk
  solution: Chunk | null
  courseId: string | null
  termIndex: number | null
}

const CARD_ESTIMATE = 380 // px — hauteur estimée d'une rangée de 2 cartes (mesure dynamique ensuite)

export default function ExercicesTab({ curriculum, activeDb, documentId }: Props) {
  const bridge = useCurriculumBridge()
  const { t } = useLanguage()
  const { trimFilter, searchQuery, exoFilter, expandedIds } = bridge

  const [rows, setRows] = useState<ExoRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ src: string; fallback?: string; title: string } | null>(null)

  const termResolver = useMemo(() => buildExerciseTermResolver(curriculum), [curriculum])
  const links = useMemo(() => curriculum.links ?? [], [curriculum.links])

  // Chargement de la banque d'exercices + liaison corrigés (SolutionLinker).
  useEffect(() => {
    let alive = true
    setRows(null)
    setError(null)
    if (!documentId) { setRows([]); return }
    fetchExerciseBank(activeDb, documentId)
      .then(({ exercises, solutionsByIndex, solutionsById }) => {
        if (!alive) return
        const built: ExoRow[] = exercises.map(chunk => ({
          chunk,
          // has_solution est un indice ; la liaison réelle passe par le SolutionLinker
          // (course_exercise) puis, à défaut, par pedagogical_index — null si rien.
          solution: resolveSolutionFor(chunk, links, solutionsByIndex, solutionsById),
          courseId: resolveCourseFor(chunk, links),
          termIndex: termResolver(chunk),
        }))
        setRows(built)
      })
      .catch(e => { if (alive) { setError(String(e?.message ?? e)); setRows([]) } })
    return () => { alive = false }
  }, [activeDb, documentId, links, termResolver])

  // Filtres croisés : exoFilter (cours/page) + trimestre + recherche.
  const filtered = useMemo(() => {
    if (!rows) return []
    const q = searchQuery.trim().toLowerCase()
    return rows.filter(r => {
      if (exoFilter?.coursId && r.courseId !== exoFilter.coursId) return false
      if (exoFilter?.page != null && r.chunk.page_number !== exoFilter.page) return false
      if (trimFilter !== 0 && r.termIndex !== trimFilter) return false
      if (q) {
        const hay = `${r.chunk.content_markdown} ${r.chunk.section_title ?? ''} ${r.chunk.pedagogical_index ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, exoFilter, trimFilter, searchQuery])

  // Statut de filtre dynamique (#exoFilterStatus — aria-live).
  const totalAggregate = curriculum.aggregates?.global?.exercises ?? (rows?.length ?? 0)
  const statusText = useMemo(() => {
    if (rows === null) return 'جارٍ تحميل بنك التمارين…'
    if (exoFilter?.coursId) return `🔍 تم تصفية ${filtered.length} تمريناً حسب الدرس المحدد`
    if (exoFilter?.page != null) return `🔍 تم تصفية ${filtered.length} تمريناً في الصفحة ${exoFilter.page}`
    if (trimFilter !== 0 && searchQuery.trim()) return `🔍 تم تصفية ${filtered.length} تمريناً (الفصل ${trimFilter} + بحث)`
    if (trimFilter !== 0) return `🔍 تم تصفية ${filtered.length} تمريناً في الفصل ${trimFilter}`
    if (searchQuery.trim()) return `🔍 تم تصفية ${filtered.length} تمريناً حسب البحث`
    return 'عرض كامل التمارين والأنشطة الموثقة بصفحة الكتاب المدرسي والحلول المعيارية'
  }, [rows, exoFilter, trimFilter, searchQuery, filtered.length])

  // Regroupement 2 par 2 (grille col-xl-6 → rangées virtualisées).
  const pairs = useMemo(() => {
    const out: ExoRow[][] = []
    for (let i = 0; i < filtered.length; i += 2) out.push(filtered.slice(i, i + 2))
    return out
  }, [filtered])

  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: pairs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_ESTIMATE,
    overscan: 4,
  })

  // Ouverture/fermeture globale des corrigés (فتح/طي الحلول).
  const solutionIds = useMemo(() => filtered.filter(r => r.solution).map(r => `exo_sol_${r.chunk.id}`), [filtered])
  const openAllSolutions = (open: boolean) => bridge.expandAll('exo_sol_', solutionIds, open)

  const trimBtn = (trim: number, label: string, cls: string) => (
    <button
      type="button"
      className={`btn btn-sm ${cls} ${trimFilter === trim ? 'active' : ''}`}
      onClick={() => bridge.setTrimFilter(trim)}
      aria-pressed={trimFilter === trim}
    >
      {label}
    </button>
  )

  return (
    <div>
      {/* Header : titre + compteur agrégat + statut filtre + filtres trimestre + فتح/طي الحلول */}
      <div className="d-flex-header">
        <div>
          <h4 className="tab-title"><PenLine size={20} style={{ color: 'var(--danger)' }} /> بنك التمارين والأنشطة المحلولة ({totalAggregate} تمريناً)</h4>
          <small className="text-muted" id="exoFilterStatus" role="status" aria-live="polite" dir="auto">{statusText}</small>
        </div>
        <div className="d-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="btn-group-c">
            {trimBtn(0, `الكل (${totalAggregate})`, 'btn-outline-secondary')}
            {trimBtn(1, 'ف 1', 'btn-outline-primary')}
            {trimBtn(2, 'ف 2', 'btn-outline-info')}
            {trimBtn(3, 'ف 3', 'btn-outline-success')}
          </div>
          <button type="button" className="btn btn-sm btn-outline-secondary rounded-pill" onClick={() => openAllSolutions(true)}>▾ فتح الحلول</button>
          <button type="button" className="btn btn-sm btn-outline-secondary rounded-pill" onClick={() => openAllSolutions(false)}>▴ طي الحلول</button>
        </div>
      </div>

      {error && <div className="content-box" style={{ color: 'var(--danger)' }} dir="auto">تعذّر تحميل التمارين : {error}</div>}
      {rows !== null && filtered.length === 0 && !error && (
        <div className="content-box" style={{ textAlign: 'center', color: 'var(--text-muted)' }} dir="auto">
          {rows.length === 0
            ? t('library.no_exercises_typed')
            : 'لا توجد تمارين مطابقة للمعايير الحالية.'}
        </div>
      )}

      {/* Grille virtualisée (rangées de 2 cartes) */}
      <div ref={parentRef} className="exo-virtual-scroll" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
        <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map(vItem => {
            const pair = pairs[vItem.index]
            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={rowVirtualizer.measureElement}
                className="exo-virtual-row"
                style={{ position: 'absolute', top: 0, insetInlineStart: 0, width: '100%', transform: `translateY(${vItem.start}px)` }}
              >
                <div className="exo-grid-row">
                  {pair.map(row => (
                    <ExerciceCard
                      key={row.chunk.id}
                      row={row}
                      activeDb={activeDb}
                      solutionOpen={expandedIds.has(`exo_sol_${row.chunk.id}`)}
                      onToggleSolution={() => bridge.toggleExpanded(`exo_sol_${row.chunk.id}`)}
                      onOpenScan={(page) => setModal({
                        src: api.library.getPageScanUrl(activeDb, documentId, page, false),
                        title: `📖 صفحة الكتاب المدرسي رقم ${page}`,
                      })}
                      documentId={documentId}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <ImageModal
        open={modal !== null}
        title={modal?.title ?? ''}
        src={modal?.src ?? ''}
        fallbackSrc={modal?.fallback}
        onClose={() => setModal(null)}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function ExerciceCard({
  row, activeDb, documentId, solutionOpen, onToggleSolution, onOpenScan,
}: {
  row: ExoRow
  activeDb: string
  documentId: string
  solutionOpen: boolean
  onToggleSolution: () => void
  onOpenScan: (page: number) => void
}) {
  const bridge = useCurriculumBridge()
  const { chunk, solution, courseId, termIndex } = row
  const [scanOpen, setScanOpen] = useState(false)
  // Rendu KaTeX du corrigé UNIQUEMENT à la première ouverture (renderedOnce).
  const [solutionRenderedOnce, setSolutionRenderedOnce] = useState(false)
  useEffect(() => { if (solutionOpen && !solutionRenderedOnce) setSolutionRenderedOnce(true) }, [solutionOpen, solutionRenderedOnce])

  const page = chunk.page_number
  const exoNo = chunk.pedagogical_index ?? '—'
  const thumbUrl = api.library.getPageScanUrl(activeDb, documentId, page, true)

  return (
    <HighlightTarget id={`exo_${chunk.id}`} className="content-box exo-card">
      {/* Header : badges + ponts + œil */}
      <div className="exo-card-head">
        <div className="d-flex" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="badge badge-danger">تمرين {exoNo}</span>
          <span className="badge badge-secondary">📄 ص {page}</span>
          {termIndex != null && <span className="badge badge-info">الفصل {termIndex}</span>}
        </div>
        <div className="d-flex" style={{ gap: 4, flexWrap: 'wrap' }}>
          {courseId && (
            <BridgeButton
              variant="cours"
              icon={<BookOpen size={13} />}
              label="الدرس"
              onClick={() => bridge.jumpTo('cours', `cours_${courseId}`)}
            />
          )}
          <BridgeButton
            variant="scan"
            icon={<ImageIcon size={13} />}
            label={`مسح ص ${page}`}
            onClick={() => bridge.jumpTo('scans', `scan_${page}`)}
          />
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setScanOpen(o => !o)}
            title="معاينة الصفحة الأصلية المباشرة"
            aria-expanded={scanOpen}
          >
            <Eye size={14} />
          </button>
        </div>
      </div>

      {/* Aperçu du scan de page (collapse) */}
      {scanOpen && (
        <div className="exo-scan-preview">
          <div className="exo-scan-preview-bar">
            <span>📖 صفحة الكتاب المدرسي رقم {page}</span>
            <button type="button" className="exo-scan-fullscreen" onClick={() => onOpenScan(page)}>
              تكبير كامل الشاشة <Maximize2 size={12} />
            </button>
          </div>
          <img src={thumbUrl} loading="lazy" className="exo-scan-img" alt={`صفحة ${page}`} />
        </div>
      )}

      {/* Énoncé */}
      <div className="exo-section">
        <h6 className="exo-section-title">❔ نص التمرين / النشاط :</h6>
        <div className="exo-enonce">
          <MarkdownKatex lazy raw={chunk.content_markdown} />
        </div>
      </div>

      {/* Corrigé (repliable + rendu KaTeX lazy à la première ouverture) */}
      {solution && (
        <div className="exo-section">
          <div className="exo-corrige-head">
            <h6 className="exo-section-title" style={{ color: 'var(--success)', margin: 0 }}>✅ الحل النموذجي :</h6>
            <button
              type="button"
              className="btn btn-sm btn-outline-success"
              onClick={onToggleSolution}
              aria-expanded={solutionOpen}
            >
              <ChevronDown size={13} /> إظهار الحل
            </button>
          </div>
          {solutionOpen && (
            <div className="exo-corrige-body">
              {solutionRenderedOnce
                ? <MarkdownKatex raw={solution.content_markdown} />
                : <div style={{ minHeight: 40 }} aria-busy="true" />}
            </div>
          )}
        </div>
      )}
    </HighlightTarget>
  )
}
