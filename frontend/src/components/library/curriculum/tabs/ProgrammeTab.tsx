import { useMemo } from 'react'
import {
  GraduationCap, ListChecks, Waypoints, BookOpen, PenTool,
} from 'lucide-react'
import type { CurriculumPayload, TocNode } from '@/types'
import { useCurriculumBridge, HighlightTarget } from '@/contexts/CurriculumBridgeContext'
import BridgeButton from '@/components/library/BridgeButton'
import CurriculumEmptyState from '../CurriculumEmptyState'
import {
  buildCurriculumModel, coursForProgram, parseCompetencies,
  type CurriculumModel,
} from './curriculumModel'

interface Props {
  curriculum: CurriculumPayload
  toc: TocNode[]
  documentId: string | null
  activeDb: string
}

/**
 * Onglet 2 — المنهاج والتدرج السنوي (Lot 5). Grille 2 colonnes de cartes
 * `.programme-card` : badges (مقطع #seq / الفصل N / source), titre, encadré des
 * ressources (retours ligne préservés depuis competencies_json), footer de ponts
 * vers les cours liés + leurs exercices. Respecte trimFilter + searchQuery.
 */
export default function ProgrammeTab({ curriculum, toc }: Props) {
  const { trimFilter, searchQuery, jumpTo, filterExercicesByCours } = useCurriculumBridge()

  const model = useMemo<CurriculumModel>(() => buildCurriculumModel(curriculum, toc), [curriculum, toc])

  // Le programme officiel EXIGE le curriculum (مقاطع + كفاءات). Sans lui : empty-state
  // élégant + CTA vers le studio du curriculum, jamais d'écran vide/cassé.
  if (!curriculum.curriculum_available || model.programs.length === 0) {
    return (
      <CurriculumEmptyState
        title="المنهاج والتدرج السنوي غير متوفر"
        description="لم يُبنَ المخطط الوزاري الرسمي (المقاطع، الموارد والكفاءات المستهدفة) لهذه القاعدة بعد."
      />
    )
  }

  const q = searchQuery.trim().toLowerCase()

  // Programmes triés par (trimestre, seq_index).
  const programs = useMemo(() => {
    return [...model.programs].sort((a, b) => {
      const ta = model.programTermIndex.get(a.id) ?? 0
      const tb = model.programTermIndex.get(b.id) ?? 0
      if (ta !== tb) return ta - tb
      return (a.seq_index ?? 0) - (b.seq_index ?? 0)
    })
  }, [model])

  const visible = programs.filter(p => {
    const termIndex = model.programTermIndex.get(p.id) ?? 0
    if (trimFilter > 0 && trimFilter !== termIndex) return false
    if (q && !p.title.toLowerCase().includes(q)) return false
    return true
  })

  return (
    <div dir="rtl">
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <GraduationCap size={20} style={{ color: 'var(--success)' }} /> المنهاج والتدرج السنوي لبناء التعلمات (الجيل الثاني)
        </h4>
        <small style={{ color: 'var(--text-muted)' }}>
          المخطط الوزاري الرسمي — المقطع، الموارد والكفاءات المستهدفة
        </small>
      </div>

      {visible.length === 0 && (
        <div className="alert-secondary-box">لا توجد مقاطع مطابقة للتصفية الحالية.</div>
      )}

      <div className="row">
        {visible.map(p => {
          const termIndex = model.programTermIndex.get(p.id) ?? 0
          const cours = coursForProgram(model, p.id)
          const resources = parseCompetencies(p.competencies_json)
          return (
            <div key={p.id} className="col-12 col-lg-6" style={{ marginBottom: 16 }}>
              <HighlightTarget id={`programme_${p.id}`} className="programme-card content-box" style={{ height: '100%' }}>
                {/* Header badges */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span className="badge badge-success font-num">مقطع #{p.seq_index ?? '—'}</span>
                    {termIndex > 0 && <span className="badge badge-info font-num">الفصل {termIndex}</span>}
                  </div>
                  {p.source && <span className="badge badge-secondary">{p.source}</span>}
                </div>

                {/* Titre */}
                <h5 style={{ marginBottom: 8 }}>{p.title}</h5>

                {/* Encadré ressources */}
                <div className="programme-resources">
                  <h6 style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-sub)', marginBottom: 8 }}>
                    <ListChecks size={14} /> الموارد المعرفية والمفاهيم المستهدفة :
                  </h6>
                  <p style={{ fontSize: '0.85rem', margin: 0, color: 'var(--text-muted)', lineHeight: 1.8, whiteSpace: 'pre-line' }}>
                    {resources || '—'}
                  </p>
                </div>

                {/* Footer ponts */}
                <div style={{ paddingTop: 8, borderTop: '1px solid var(--border-color)' }}>
                  <h6 style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--primary)', marginBottom: 8 }}>
                    <Waypoints size={14} /> الارتباطات الميدانية المباشرة :
                  </h6>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {cours.length === 0 && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>لا دروس مرتبطة بعد.</span>
                    )}
                    {cours.map(c => (
                      <div key={c.tocId} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <BridgeButton
                          variant="cours" icon={<BookOpen size={14} />}
                          label={`الدرس ${c.lessonNumber} (ص ${c.pageStart}-${c.pageEnd})`}
                          onClick={() => jumpTo('cours', `cours_${c.tocId}`)}
                        />
                        <BridgeButton
                          variant="exo" icon={<PenTool size={14} />}
                          label={`${c.exercisesCount} تمارين المقطع`}
                          onClick={() => filterExercicesByCours(c.tocId)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </HighlightTarget>
            </div>
          )
        })}
      </div>
    </div>
  )
}
