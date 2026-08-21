import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen, ChevronsDown, ChevronsUp, ChevronDown, FileImage, PenTool,
  GraduationCap, Image as ImageIcon, X, Expand,
} from 'lucide-react'
import type { Chunk, CurriculumPayload, TocNode } from '@/types'
import { api } from '@/lib/api'
import { useCurriculumBridge, HighlightTarget } from '@/contexts/CurriculumBridgeContext'
import BridgeButton from '@/components/library/BridgeButton'
import MarkdownKatex from '@/components/library/MarkdownKatex'
import ImageModal from '@/components/library/curriculum/ImageModal'
import {
  buildCurriculumModel, type CoursNode, type CurriculumModel,
} from './curriculumModel'

interface Props {
  curriculum: CurriculumPayload
  toc: TocNode[]
  documentId: string | null
  activeDb: string
}

const COURS_PREFIX = 'cours_'
const coursId = (tocId: string) => `${COURS_PREFIX}${tocId}`

/**
 * Onglet 3 — مستودع الدروس والمفاهيم (Lot 6). Liste de cartes de cours
 * (chapitres TOC niveau 1) repliables, contenu course_theory rendu par
 * MarkdownKatex, mode côte-à-côte fluide (texte 100% ↔ 50/50 + rail de scans).
 */
export default function CoursTab({ curriculum, toc, documentId, activeDb }: Props) {
  const { searchQuery, trimFilter, expandedIds, toggleExpanded, expandAll } = useCurriculumBridge()

  const model = useMemo<CurriculumModel>(() => buildCurriculumModel(curriculum, toc), [curriculum, toc])

  const [modal, setModal] = useState<{ page: number } | null>(null)

  const q = searchQuery.trim().toLowerCase()
  const visible = model.cours.filter(c => {
    if (trimFilter > 0 && trimFilter !== c.termIndex) return false
    if (q && !c.title.toLowerCase().includes(q)) return false
    return true
  })

  const allIds = useMemo(() => model.cours.map(c => coursId(c.tocId)), [model])
  const openAll = () => expandAll(COURS_PREFIX, allIds, true)
  const collapseAll = () => expandAll(COURS_PREFIX, allIds, false)

  const openScanModal = useCallback((page: number) => setModal({ page }), [])

  return (
    <div dir="rtl">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookOpen size={20} style={{ color: 'var(--primary)' }} /> مستودع الدروس والمفاهيم العلمية (KaTeX + وثائق الكتاب عند الطلب)
          </h4>
          <small style={{ color: 'var(--text-muted)' }}>
            محتوى كامل بعرض الشاشة مع إمكانية استدعاء صفحات الكتاب الأصلية جنباً إلى جنب
          </small>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={openAll}>
            <ChevronsDown size={15} /> فتح كل الدروس
          </button>
          <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={collapseAll}>
            <ChevronsUp size={15} /> طي الكل
          </button>
        </div>
      </div>

      {visible.length === 0 && (
        <div className="alert-secondary-box">لا توجد دروس مطابقة للتصفية الحالية.</div>
      )}

      {visible.map(c => (
        <CoursCard
          key={c.tocId}
          cours={c}
          open={expandedIds.has(coursId(c.tocId))}
          onToggle={() => toggleExpanded(coursId(c.tocId))}
          activeDb={activeDb}
          documentId={documentId}
          termIndex={c.termIndex}
          onOpenScanModal={openScanModal}
        />
      ))}

      <ImageModal
        open={modal !== null}
        title={modal ? `صفحة كتاب مدرسي رقم ${modal.page}` : ''}
        src={modal && documentId ? api.library.getPageScanUrl(activeDb, documentId, modal.page) : ''}
        onClose={() => setModal(null)}
      />
    </div>
  )
}

interface CardProps {
  cours: CoursNode
  open: boolean
  onToggle: () => void
  activeDb: string
  documentId: string | null
  termIndex: number
  onOpenScanModal: (page: number) => void
}

/**
 * Carte d'un cours (chapitre). Charge paresseusement ses chunks course_theory
 * à la première ouverture. Bascule 100% ↔ 50/50 (`.fluid-pane`) avec rail de
 * scans (page_start..page_end) sticky.
 */
function CoursCard({ cours, open, onToggle, activeDb, documentId, termIndex, onOpenScanModal }: CardProps) {
  const { jumpTo, filterExercicesByCours } = useCurriculumBridge()
  const [chunks, setChunks] = useState<Chunk[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sideBySide, setSideBySide] = useState(false)

  // Chargement paresseux des chunks du chapitre (une seule fois, à l'ouverture).
  useEffect(() => {
    if (!open || chunks !== null || loading || !documentId) return
    let alive = true
    setLoading(true); setError(null)
    ;(async () => {
      try {
        const first = await api.library.getChunks(activeDb, documentId, 1, {
          pedagogical_type: 'course_theory',
          toc_id: cours.tocId,
        })
        let all = first.chunks ?? []
        const totalPages = first.total_pages ?? 1
        for (let p = 2; p <= totalPages; p++) {
          const res = await api.library.getChunks(activeDb, documentId, p, {
            pedagogical_type: 'course_theory',
            toc_id: cours.tocId,
          })
          all = all.concat(res.chunks ?? [])
        }
        if (alive) setChunks(all)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'خطأ في تحميل الدرس')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [open, chunks, loading, documentId, activeDb, cours.tocId])

  // Résolveur d'assets mémoïsé (stabilise le memo de MarkdownKatex).
  const resolveAsset = useCallback(
    (artifactRef: string) => api.library.getArtifactBinaryUrl(activeDb, artifactRef),
    [activeDb],
  )

  // Pages du chapitre pour le rail de scans (page_start..page_end).
  const scanPages = useMemo(() => {
    const out: number[] = []
    for (let p = cours.pageStart; p <= cours.pageEnd; p++) out.push(p)
    return out
  }, [cours.pageStart, cours.pageEnd])

  // Concatène le contenu des chunks (triés par page/ordre), séparé par page.
  const sortedChunks = useMemo(() => {
    if (!chunks) return []
    return [...chunks].sort((a, b) => a.page_number - b.page_number || a.chunk_index - b.chunk_index)
  }, [chunks])

  return (
    <HighlightTarget id={`cours_${cours.tocId}`} className="content-box cours-item-card" style={{ marginBottom: 24 }}>
      {/* Barre titre repliable + actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingBottom: 8 }}>
        <button
          type="button"
          className="cours-title-toggle"
          onClick={onToggle}
          aria-expanded={open}
        >
          <span className="badge badge-primary">الدرس {cours.lessonNumber}</span>
          <h5 style={{ margin: 0 }}>{cours.title}</h5>
          {termIndex > 0 && <span className="badge badge-warning">الفصل {termIndex}</span>}
          <span className="badge badge-secondary font-num">ص {cours.pageStart} - {cours.pageEnd}</span>
        </button>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className={`btn btn-sm rounded-pill ${sideBySide ? 'btn-warning' : 'btn-outline-warning'}`}
            onClick={() => { if (!open) onToggle(); setSideBySide(s => !s) }}
          >
            <FileImage size={15} /> وثائق صفحات الكتاب (ص {cours.pageStart}-{cours.pageEnd})
          </button>
          <BridgeButton variant="exo" icon={<PenTool size={14} />} label={`${cours.exercisesCount} تمارين`} onClick={() => filterExercicesByCours(cours.tocId)} title="تمارين مرتبطة" />
          {cours.programId && (
            <BridgeButton variant="prog" icon={<GraduationCap size={14} />} label="المنهاج" onClick={() => jumpTo('programme', `programme_${cours.programId}`)} />
          )}
          <BridgeButton variant="scan" icon={<ImageIcon size={14} />} label={`مسح ص ${cours.pageStart}`} onClick={() => onOpenScanModal(cours.pageStart)} />
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onToggle} aria-label="toggle body">
            <ChevronDown size={15} className={`matrix-chevron${open ? ' open' : ''}`} />
          </button>
        </div>
      </div>

      {/* Corps replié par défaut */}
      {open && (
        <div className="cours-body" style={{ paddingTop: 12, marginTop: 8, borderTop: '1px solid var(--border-color)' }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {/* Colonne texte : 100% ou 50% en mode côte-à-côte */}
            <div className={`fluid-pane ${sideBySide ? 'col-12 col-xl-6' : 'col-12'}`}>
              <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-color)' }}>
                  <span className="badge badge-primary"><BookOpen size={14} /> النص البيداغوجي المرقمن (KaTeX)</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }} className="font-num">الصفحات {cours.pageStart} إلى {cours.pageEnd}</span>
                </div>

                {loading && <div style={{ color: 'var(--text-muted)', padding: 16 }}>… جارٍ تحميل النص البيداغوجي</div>}
                {error && <div className="alert-secondary-box">{error}</div>}
                {!loading && !error && sortedChunks.length === 0 && (
                  <div className="alert-secondary-box">لا يوجد نص مرقمن لهذا الدرس بعد.</div>
                )}
                {sortedChunks.map(ch => (
                  <MarkdownKatex
                    key={ch.id}
                    raw={ch.content_markdown}
                    lazy
                    onPageJump={onOpenScanModal}
                    resolveAsset={resolveAsset}
                  />
                ))}
              </div>
            </div>

            {/* Rail de scans (mode côte-à-côte uniquement) */}
            {sideBySide && (
              <div className="col-12 col-xl-6 fluid-pane">
                <div className="scans-side-rail">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-color)' }}>
                    <span className="badge badge-warning"><FileImage size={14} /> وثائق ورسوم الكتاب المدرسي ({scanPages.length} صفحة)</span>
                    <button type="button" className="btn btn-sm btn-outline-secondary" style={{ border: 'none', padding: '0 6px' }} onClick={() => setSideBySide(false)} title="إغلاق العرض المتوازي">
                      <X size={15} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {scanPages.map(p => (
                      <div key={p} className="cours-scan-thumb">
                        <div className="cours-scan-thumb-head">
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                            <ImageIcon size={14} style={{ color: 'var(--warning)' }} /> صفحة كتاب مدرسي رقم {p}
                          </span>
                          <button type="button" className="btn btn-sm" style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', padding: '2px 8px', fontSize: '0.75rem' }} onClick={() => onOpenScanModal(p)}>
                            <Expand size={12} /> تكبير
                          </button>
                        </div>
                        {documentId ? (
                          <img
                            src={api.library.getPageScanUrl(activeDb, documentId, p, true)}
                            loading="lazy"
                            style={{ width: '100%', display: 'block', cursor: 'pointer' }}
                            onClick={() => onOpenScanModal(p)}
                            alt={`صفحة ${p}`}
                            onError={e => { e.currentTarget.style.display = 'none' }}
                          />
                        ) : (
                          <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: '0.8rem' }}>لا وثيقة نشطة</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </HighlightTarget>
  )
}
