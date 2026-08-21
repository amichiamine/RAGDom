import { useEffect, useMemo } from 'react'
import {
  Network, ChevronsDown, ChevronsUp, BookOpen, FileSignature, ChevronDown,
  Compass, BookOpenText, PenTool, GraduationCap, Image as ImageIcon, Eye,
} from 'lucide-react'
import type { CurriculumPayload, TocNode } from '@/types'
import { useCurriculumBridge, HighlightTarget } from '@/contexts/CurriculumBridgeContext'
import BridgeButton from '@/components/library/BridgeButton'
import {
  buildCurriculumModel, coursForTerm, assessmentsForTerm,
  TERM_EMOJI, TERM_BADGE_CLASS, type CoursNode, type CurriculumModel,
} from './curriculumModel'

interface Props {
  curriculum: CurriculumPayload
  toc: TocNode[]
  documentId: string | null
  activeDb: string
}

/** Préfixe d'expansion des cartes de trimestre (accordéons du contexte). */
const TRIM_PREFIX = 'matrix_trim_'
const trimId = (termIndex: number) => `${TRIM_PREFIX}${termIndex}`

/**
 * Onglet 1 — المصفوفة الشاملة 360° (Lot 5). 3 cartes de trimestre repliables,
 * colonne 8/12 de nœuds relationnels (cours + 4 ponts) et colonne 4/12 des
 * évaluations du terme. Respecte trimFilter (masque + force l'expansion) et
 * searchQuery (filtre par titre). Aucun compteur en dur — tout via aggregates.
 */
export default function MatrixTab({ curriculum, toc }: Props) {
  const { trimFilter, searchQuery, expandedIds, toggleExpanded, expandAll, jumpTo, filterExercicesByCours } = useCurriculumBridge()

  const model = useMemo<CurriculumModel>(() => buildCurriculumModel(curriculum, toc), [curriculum, toc])

  // Termes visibles (1/2/3) présents dans le corpus, dans l'ordre.
  const termIndexes = useMemo(() => model.terms.map(t => t.term_index), [model])

  // Filtre trimestre 360° : force l'ouverture du trimestre choisi.
  useEffect(() => {
    if (trimFilter > 0) expandAll(TRIM_PREFIX, [trimId(trimFilter)], true)
  }, [trimFilter, expandAll])

  const allTrimIds = useMemo(() => termIndexes.map(trimId), [termIndexes])
  const openAll = () => expandAll(TRIM_PREFIX, allTrimIds, true)
  const collapseAll = () => expandAll(TRIM_PREFIX, allTrimIds, false)

  const q = searchQuery.trim().toLowerCase()
  const matchesSearch = (c: CoursNode) => !q || c.title.toLowerCase().includes(q)

  return (
    <div dir="rtl">
      {/* Header + boutons globaux */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Network size={20} style={{ color: 'var(--warning)' }} /> المصفوفة البيداغوجية المترابطة
        </h4>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-outline-secondary rounded-pill" onClick={openAll}>
            <ChevronsDown size={15} /> فتح الفصول
          </button>
          <button className="btn btn-sm btn-outline-secondary rounded-pill" onClick={collapseAll}>
            <ChevronsUp size={15} /> طي الكل
          </button>
        </div>
      </div>

      {termIndexes.map(termIndex => {
        // Masquage des cartes non concernées par le filtre 360°.
        if (trimFilter > 0 && trimFilter !== termIndex) return null

        const term = model.terms.find(t => t.term_index === termIndex)!
        const cours = coursForTerm(model, termIndex)
        const evals = assessmentsForTerm(model, termIndex)
        const agg = curriculum.aggregates?.per_term?.find(a => a.term_index === termIndex)

        const filteredCours = cours.filter(matchesSearch)
        // Sous recherche active, on masque un terme sans cours correspondant.
        if (q && filteredCours.length === 0 && evals.length === 0) return null

        const isOpen = expandedIds.has(trimId(termIndex))

        return (
          <div key={termIndex} className="matrix-trim-card" data-trim={termIndex}>
            {/* Header cliquable */}
            <button
              type="button"
              className="matrix-trim-header"
              onClick={() => toggleExpanded(trimId(termIndex))}
              aria-expanded={isOpen}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ fontSize: '1.6rem' }}>{TERM_EMOJI[termIndex] ?? '📚'}</span>
                <div style={{ textAlign: 'start' }}>
                  <h5 style={{ margin: 0 }}>{term.label}</h5>
                  <small style={{ color: 'var(--text-muted)' }} className="font-num">
                    {(agg?.programs ?? 0)} مقاطع • {(agg?.courses ?? 0)} دروس • {(agg?.exercises ?? 0)} تمارين • {(agg?.assessments ?? 0)} اختبارات
                  </small>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`badge ${TERM_BADGE_CLASS[termIndex] ?? 'badge-primary'} font-num`}>{agg?.courses ?? 0} دروس</span>
                <span className="badge badge-danger font-num">{agg?.exercises ?? 0} تمرين</span>
                <span className="badge badge-info font-num">{agg?.assessments ?? 0} اختبار</span>
                <ChevronDown size={18} className={`matrix-chevron${isOpen ? ' open' : ''}`} style={{ color: 'var(--text-muted)' }} />
              </div>
            </button>

            {isOpen && (
              <div className="matrix-trim-collapse">
                <div className="row" style={{ gap: 0 }}>
                  {/* Colonne 8/12 — nœuds relationnels des cours */}
                  <div className="col-12 col-lg-8">
                    <h6 className="matrix-col-title">
                      <BookOpen size={15} style={{ color: 'var(--primary)' }} /> الوحدات التعليمية والتمارين الموثقة بصفحاتها :
                    </h6>
                    {filteredCours.length === 0 && (
                      <div className="alert-secondary-box">لا توجد دروس مطابقة.</div>
                    )}
                    {filteredCours.map(c => (
                      <HighlightTarget key={c.tocId} id={`matrix_node_${c.tocId}`} className="relational-node">
                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                          <div>
                            <span className="badge badge-warning font-num" style={{ marginInlineEnd: 6 }}>الدرس {c.lessonNumber}</span>
                            <h6 style={{ display: 'inline-block', margin: 0 }}>{c.title}</h6>
                          </div>
                          <span className="badge badge-secondary font-num">📄 ص {c.pageStart} إلى ص {c.pageEnd}</span>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Compass size={14} /> {programTitle(model, c.programId) ?? 'المقطع غير محدد'}
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border-color)' }}>
                          <BridgeButton
                            variant="cours" icon={<BookOpenText size={14} />} label="قراءة نص الدرس"
                            onClick={() => jumpTo('cours', `cours_${c.tocId}`)}
                          />
                          <BridgeButton
                            variant="exo" icon={<PenTool size={14} />} label={`${c.exercisesCount} تمارين مرتبطة`}
                            onClick={() => filterExercicesByCours(c.tocId)}
                          />
                          {c.programId && (
                            <BridgeButton
                              variant="prog" icon={<GraduationCap size={14} />} label="المقطع الوزاري"
                              onClick={() => jumpTo('programme', `programme_${c.programId}`)}
                            />
                          )}
                          <BridgeButton
                            variant="scan" icon={<ImageIcon size={14} />} label={`مسح الكتاب (ص ${c.pageStart})`}
                            onClick={() => jumpTo('scans', `scan_${c.pageStart}`)}
                          />
                        </div>
                      </HighlightTarget>
                    ))}
                  </div>

                  {/* Colonne 4/12 — évaluations du terme */}
                  <div className="col-12 col-lg-4">
                    <h6 className="matrix-col-title">
                      <FileSignature size={15} style={{ color: 'var(--info)' }} /> بنك الفروض والاختبارات المطابقة ({evals.length}) :
                    </h6>
                    {evals.length === 0 ? (
                      <div className="alert-secondary-box">لا توجد نماذج مسجلة لهذا الفصل.</div>
                    ) : (
                      evals.map(ev => (
                        <div key={ev.id} className="matrix-eval-box">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <span className="badge badge-primary">نموذج</span>
                            <h6 style={{ margin: 0, fontSize: '0.85rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ev.title}>
                              {ev.title}
                            </h6>
                          </div>
                          <BridgeButton
                            variant="eval" icon={<Eye size={14} />} label="معاينة الموضوع والحل"
                            onClick={() => jumpTo('evaluations', `eval_${ev.id}`)}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Titre du programme (مقطع) rattaché — sert de « séquence liée » au nœud. */
function programTitle(model: CurriculumModel, programId: string | null): string | null {
  if (!programId) return null
  return model.programs.find(p => p.id === programId)?.title ?? null
}
