import { useEffect, useMemo, useState } from 'react'
import { Columns2, FileText, CircleCheck, X } from 'lucide-react'
import type { Artifact, Assessment, Chunk, CurriculumPayload } from '@/types'
import { api } from '@/lib/api'
import { useCurriculumBridge, HighlightTarget } from '@/contexts/CurriculumBridgeContext'
import MarkdownKatex from '@/components/library/MarkdownKatex'
import BridgeButton from '@/components/library/BridgeButton'
import ImageModal from '../ImageModal'
import { fetchAllChunks } from './curriculumData'

interface Props {
  curriculum: CurriculumPayload
  activeDb: string
  documentId: string
}

export default function EvaluationsTab({ curriculum, activeDb, documentId }: Props) {
  const { trimFilter, searchQuery } = useCurriculumBridge()

  // Index de tous les chunks du document par id (résolution sujet/corrigé à la demande).
  // Écart assumé : pas de « GET chunk par id » dans l'API ⇒ pagination complète + index.
  const [chunksById, setChunksById] = useState<Map<string, Chunk> | null>(null)
  const [modal, setModal] = useState<{ src: string; fallback?: string; title: string } | null>(null)

  useEffect(() => {
    let alive = true
    setChunksById(null)
    if (!documentId) { setChunksById(new Map()); return }
    fetchAllChunks(activeDb, documentId)
      .then(list => { if (alive) setChunksById(new Map(list.map(c => [c.id, c]))) })
      .catch(() => { if (alive) setChunksById(new Map()) })
    return () => { alive = false }
  }, [activeDb, documentId])

  const termIndexById = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of curriculum.terms ?? []) m.set(t.id, t.term_index)
    return m
  }, [curriculum.terms])

  const assessments = curriculum.assessments ?? []

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return assessments.filter(a => {
      const ti = a.term_id ? termIndexById.get(a.term_id) ?? null : null
      if (trimFilter !== 0 && ti !== trimFilter) return false
      if (q && !`${a.title} ${a.kind}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [assessments, trimFilter, searchQuery, termIndexById])

  const totalAggregate = curriculum.aggregates?.global?.assessments ?? assessments.length

  return (
    <div>
      <div className="d-flex-header">
        <div>
          <h4 className="tab-title"><FileText size={20} style={{ color: 'var(--info)' }} /> بنك الفروض والامتحانات الرسمية الشاملة ({totalAggregate} نموذجاً)</h4>
          <small className="text-muted" dir="auto">مواضيع كاملة بعرض 100% مع ميزة المعاينة المتوازية للحل والسلّم عند الطلب</small>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="content-box" style={{ textAlign: 'center', color: 'var(--text-muted)' }} dir="auto">
          لا توجد نماذج مطابقة للمعايير الحالية.
        </div>
      )}

      {filtered.map((ev, i) => (
        <EvaluationCard
          key={ev.id}
          index={i + 1}
          assessment={ev}
          termIndex={ev.term_id ? termIndexById.get(ev.term_id) ?? null : null}
          activeDb={activeDb}
          chunksById={chunksById}
          onOpenImage={(src, title, fallback) => setModal({ src, title, fallback })}
        />
      ))}

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

function EvaluationCard({
  index, assessment, termIndex, activeDb, chunksById, onOpenImage,
}: {
  index: number
  assessment: Assessment
  termIndex: number | null
  activeDb: string
  chunksById: Map<string, Chunk> | null
  onOpenImage: (src: string, title: string, fallback?: string) => void
}) {
  const [sideBySide, setSideBySide] = useState(false)
  // Rendu KaTeX du corrigé UNIQUEMENT à la première ouverture (renderedOnce, dataset.rendered du template).
  const [renderedOnce, setRenderedOnce] = useState(false)
  useEffect(() => { if (sideBySide && !renderedOnce) setRenderedOnce(true) }, [sideBySide, renderedOnce])

  const subjectChunk = assessment.subject_chunk_id && chunksById ? chunksById.get(assessment.subject_chunk_id) ?? null : null
  const correctionChunk = assessment.correction_chunk_id && chunksById ? chunksById.get(assessment.correction_chunk_id) ?? null : null

  // Artefacts (images) des chunks sujet/corrigé — chargés à la demande.
  const [subjectArtifacts, setSubjectArtifacts] = useState<Artifact[]>([])
  const [correctionArtifacts, setCorrectionArtifacts] = useState<Artifact[]>([])
  useEffect(() => {
    let alive = true
    setSubjectArtifacts([])
    setCorrectionArtifacts([])
    if (assessment.subject_chunk_id) {
      api.library.getArtifacts(activeDb, assessment.subject_chunk_id)
        .then(r => { if (alive) setSubjectArtifacts(r.artifacts ?? []) }).catch(() => { if (alive) setSubjectArtifacts([]) })
    }
    if (assessment.correction_chunk_id) {
      api.library.getArtifacts(activeDb, assessment.correction_chunk_id)
        .then(r => { if (alive) setCorrectionArtifacts(r.artifacts ?? []) }).catch(() => { if (alive) setCorrectionArtifacts([]) })
    }
    return () => { alive = false }
  }, [activeDb, assessment.subject_chunk_id, assessment.correction_chunk_id])

  return (
    <HighlightTarget id={`eval_${assessment.id}`} className="content-box eval-item-card">
      {/* Header */}
      <div className="eval-card-head">
        <div className="d-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="badge badge-primary">نموذج {index}</span>
          <h5 className="eval-title" dir="auto">{assessment.title}</h5>
          {termIndex != null && <span className="badge badge-info">الفصل {termIndex}</span>}
        </div>
        <div className="d-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-sm rounded-pill ${sideBySide ? 'btn-success' : 'btn-outline-success'}`}
            onClick={() => setSideBySide(s => !s)}
            aria-pressed={sideBySide}
          >
            <Columns2 size={14} /> معاينة متوازية (موضوع + تصحيح)
          </button>

          {subjectArtifacts.map((art, ai) => (
            <BridgeButton
              key={art.id}
              variant="eval"
              icon={<FileText size={13} />}
              label={`وثيقة الموضوع (${ai + 1})`}
              onClick={() => onOpenImage(
                api.library.getArtifactBinaryUrl(activeDb, art.id),
                `وثيقة موضوع: ${assessment.title}`,
              )}
            />
          ))}
          {correctionArtifacts.map((art, ai) => (
            <BridgeButton
              key={art.id}
              variant="cours"
              icon={<CircleCheck size={13} />}
              label={`وثيقة الحل (${ai + 1})`}
              onClick={() => onOpenImage(
                api.library.getArtifactBinaryUrl(activeDb, art.id),
                `وثيقة حل: ${assessment.title}`,
              )}
            />
          ))}
        </div>
      </div>

      {/* Corps 100% ⇄ 50/50 */}
      <div className={`eval-panes ${sideBySide ? 'is-split' : ''}`}>
        <div className="fluid-pane eval-pane eval-pane-subject">
          <div className="eval-pane-inner eval-pane-inner-subject">
            <h6 className="eval-pane-title eval-pane-title-subject">📄 نص موضوع الاختبار الرسمي :</h6>
            {chunksById === null
              ? <div style={{ minHeight: 60 }} aria-busy="true" />
              : subjectChunk
                ? <MarkdownKatex lazy raw={subjectChunk.content_markdown} />
                : <div className="text-muted" dir="auto">لا يتوفّر نص الموضوع.</div>}
          </div>
        </div>

        {sideBySide && (
          <div className="fluid-pane eval-pane eval-pane-correction">
            <div className="eval-pane-inner eval-pane-inner-correction">
              <div className="eval-correction-head">
                <h6 className="eval-pane-title eval-pane-title-correction" style={{ margin: 0 }}>✅ عناصر الإجابة النموذجية وسلّم التنقيط :</h6>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setSideBySide(false)} title="إغلاق العرض المتوازي">
                  <X size={14} />
                </button>
              </div>
              {chunksById === null
                ? <div style={{ minHeight: 60 }} aria-busy="true" />
                : correctionChunk
                  ? (renderedOnce ? <MarkdownKatex raw={correctionChunk.content_markdown} /> : <div style={{ minHeight: 40 }} aria-busy="true" />)
                  : <div className="text-muted" dir="auto">لا يتوفّر عناصر الإجابة.</div>}
            </div>
          </div>
        )}
      </div>
    </HighlightTarget>
  )
}
