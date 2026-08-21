import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Images, BookMarked, Maximize2, FileSignature, PenLine } from 'lucide-react'
import type { Artifact, CurriculumPayload, PageScanManifestEntry } from '@/types'
import { api } from '@/lib/api'
import { useCurriculumBridge, HighlightTarget } from '@/contexts/CurriculumBridgeContext'
import BridgeButton from '@/components/library/BridgeButton'
import ImageModal from '../ImageModal'

interface Props {
  curriculum: CurriculumPayload
  activeDb: string
  documentId: string
  manifest: PageScanManifestEntry[]
}

type ScanCategory = 'all' | 'textbook' | 'eval'

/** Vignette d'examen déduite des assessments (chunks pointant une image/page). */
interface EvalScan {
  key: string
  assessmentId: string
  title: string
  type: 'sujet' | 'corrige'
  termIndex: number | null
  artifactId: string
}

/** Nombre de colonnes selon le breakpoint (parité col-6/md-4/lg-3/xl-2 → 2/3/4/6). */
function useColumnCount(): number {
  return useSyncExternalStore(
    cb => {
      if (typeof window === 'undefined') return () => {}
      const mqls = [
        window.matchMedia('(min-width: 768px)'),
        window.matchMedia('(min-width: 992px)'),
        window.matchMedia('(min-width: 1200px)'),
      ]
      mqls.forEach(m => m.addEventListener('change', cb))
      return () => mqls.forEach(m => m.removeEventListener('change', cb))
    },
    () => {
      if (typeof window === 'undefined') return 4
      const w = window.innerWidth
      if (w >= 1200) return 6
      if (w >= 992) return 4
      if (w >= 768) return 3
      return 2
    },
    () => 4,
  )
}

export default function ScansTab({ curriculum, activeDb, documentId, manifest }: Props) {
  const bridge = useCurriculumBridge()
  const { trimFilter } = bridge
  const [category, setCategory] = useState<ScanCategory>('all')
  const [modal, setModal] = useState<{ src: string; fallback?: string; title: string } | null>(null)

  const termIndexById = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of curriculum.terms ?? []) m.set(t.id, t.term_index)
    return m
  }, [curriculum.terms])

  // ── Vignettes d'examens : artefacts des chunks sujet/corrigé des assessments ──
  const [evalScans, setEvalScans] = useState<EvalScan[]>([])
  useEffect(() => {
    let alive = true
    const assessments = curriculum.assessments ?? []
    if (assessments.length === 0) { setEvalScans([]); return }
    const jobs: Promise<EvalScan[]>[] = []
    for (const a of assessments) {
      const ti = a.term_id ? termIndexById.get(a.term_id) ?? null : null
      if (a.subject_chunk_id) {
        jobs.push(api.library.getArtifacts(activeDb, a.subject_chunk_id)
          .then(r => (r.artifacts ?? []).map((art: Artifact) => ({
            key: `eval_sujet_${a.id}_${art.id}`, assessmentId: a.id, title: a.title,
            type: 'sujet' as const, termIndex: ti, artifactId: art.id,
          }))).catch(() => []))
      }
      if (a.correction_chunk_id) {
        jobs.push(api.library.getArtifacts(activeDb, a.correction_chunk_id)
          .then(r => (r.artifacts ?? []).map((art: Artifact) => ({
            key: `eval_corrige_${a.id}_${art.id}`, assessmentId: a.id, title: a.title,
            type: 'corrige' as const, termIndex: ti, artifactId: art.id,
          }))).catch(() => []))
      }
    }
    Promise.all(jobs).then(res => { if (alive) setEvalScans(res.flat()) })
    return () => { alive = false }
  }, [activeDb, curriculum.assessments, termIndexById])

  // Écart assumé : `PageScanManifestEntry` ne porte pas de `term_index` ; le filtre
  // trimestre ne peut donc pas cibler les pages de livre (elles restent visibles).
  // Il s'applique pleinement aux vignettes d'examens (dérivé de `assessment.term_id`).

  // ── Éléments combinés (livre + examens) filtrés par catégorie + trimestre ──
  type Item =
    | { kind: 'page'; entry: PageScanManifestEntry }
    | { kind: 'eval'; scan: EvalScan }

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    if (category === 'all' || category === 'textbook') {
      for (const p of manifest) out.push({ kind: 'page', entry: p })
    }
    if (category === 'all' || category === 'eval') {
      for (const s of evalScans) out.push({ kind: 'eval', scan: s })
    }
    if (trimFilter !== 0) {
      return out.filter(it => it.kind === 'eval' ? it.scan.termIndex === trimFilter : true)
      // NB : les pages livre restent visibles (pas de term_index fiable au manifeste — écart assumé).
    }
    return out
  }, [manifest, evalScans, category, trimFilter])

  // Compteurs de filtres = agrégats/longueurs réelles (jamais en dur).
  const textbookCount = manifest.length
  const evalCount = evalScans.length
  const totalCount = textbookCount + evalCount

  // ── Grille virtualisée par rangées (colonnes selon breakpoint) ──
  const cols = useColumnCount()
  const rows = useMemo(() => {
    const out: Item[][] = []
    for (let i = 0; i < items.length; i += cols) out.push(items.slice(i, i + cols))
    return out
  }, [items, cols])

  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 330,
    overscan: 4,
  })
  // Re-mesure quand le nombre de colonnes change.
  useEffect(() => { rowVirtualizer.measure() }, [cols, rowVirtualizer])

  const catBtn = (cat: ScanCategory, label: string, cls: string) => (
    <button
      type="button"
      className={`btn btn-sm rounded-pill ${cls} ${category === cat ? 'active' : ''}`}
      onClick={() => setCategory(cat)}
      aria-pressed={category === cat}
    >
      {label}
    </button>
  )
  const trimBtn = (trim: number, label: string, cls: string) => (
    <button
      type="button"
      className={`btn btn-sm rounded-pill ${cls} ${trimFilter === trim ? 'active' : ''}`}
      onClick={() => bridge.setTrimFilter(trim)}
      aria-pressed={trimFilter === trim}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div className="d-flex-header">
        <div>
          <h4 className="tab-title"><Images size={20} style={{ color: 'var(--warning)' }} /> المستودع البصري الشامل للوثائق والمسوح الرسمية ({totalCount} وثيقة)</h4>
          <small className="text-muted" dir="auto">معاينة صفحات الكتاب المدرسي ({textbookCount} ص) + مسوح ووثائق الفروض والامتحانات الرسمية ({evalCount} وثيقة)</small>
        </div>
        <div className="d-flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {catBtn('all', `الكل (${totalCount})`, 'btn-outline-secondary')}
          {catBtn('textbook', `📚 صفحات الكتاب (${textbookCount})`, 'btn-outline-warning')}
          {catBtn('eval', `📑 وثائق الاختبارات (${evalCount})`, 'btn-outline-info')}
          <span className="scan-vr" aria-hidden="true" />
          {trimBtn(1, 'ف 1', 'btn-outline-primary')}
          {trimBtn(2, 'ف 2', 'btn-outline-info')}
          {trimBtn(3, 'ف 3', 'btn-outline-success')}
        </div>
      </div>

      {items.length === 0 && (
        <div className="content-box" style={{ textAlign: 'center', color: 'var(--text-muted)' }} dir="auto">
          لا توجد وثائق مطابقة للمعايير الحالية.
        </div>
      )}

      <div ref={parentRef} className="scan-virtual-scroll" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
        <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map(vItem => {
            const row = rows[vItem.index]
            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={rowVirtualizer.measureElement}
                style={{ position: 'absolute', top: 0, insetInlineStart: 0, width: '100%', transform: `translateY(${vItem.start}px)` }}
              >
                <div className="scan-grid-row" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                  {row.map(it => it.kind === 'page' ? (
                    <ScanPageCard
                      key={`page_${it.entry.page_number}`}
                      entry={it.entry}
                      activeDb={activeDb}
                      documentId={documentId}
                      onOpenScan={(page, w, h) => setModal({
                        src: api.library.getPageScanUrl(activeDb, documentId, page, false),
                        title: `📖 صفحة الكتاب المدرسي رقم ${page}${w && h ? ` (${w}×${h})` : ''}`,
                      })}
                    />
                  ) : (
                    <ScanEvalCard
                      key={it.scan.key}
                      scan={it.scan}
                      activeDb={activeDb}
                      onOpenImage={(src, title) => setModal({ src, title })}
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

function ScanPageCard({
  entry, activeDb, documentId, onOpenScan,
}: {
  entry: PageScanManifestEntry
  activeDb: string
  documentId: string
  onOpenScan: (page: number, width?: number, height?: number) => void
}) {
  const bridge = useCurriculumBridge()
  const page = entry.page_number
  // Grille virtualisée : toujours la vignette (thumb=true) — jamais l'image pleine (Lot 1/9).
  const thumbUrl = api.library.getPageScanUrl(activeDb, documentId, page, true)

  return (
    <HighlightTarget id={`scan_${page}`} className="scan-grid-card scan-card-flex">
      <div className="scan-thumb-wrap" onClick={() => onOpenScan(page, entry.width, entry.height)}>
        <img src={thumbUrl} loading="lazy" alt={`الصفحة ${page}`} />
        <span
          className="badge badge-primary scan-badge-page font-num"
          onClick={e => { e.stopPropagation(); onOpenScan(page, entry.width, entry.height) }}
          title="انقر لتكبير الوثيقة"
        >
          ص {page}
        </span>
        {/* Terme de la page indéterminé au manifeste (écart assumé) → badge « كتاب » seul. */}
        <span className="badge scan-badge-trim" title="كتاب مدرسي">كتاب</span>
      </div>
      <div className="scan-card-body">
        <div>
          <small className="scan-chapter-title" title={entry.chapter_title ?? ''} dir="auto">
            <BookMarked size={12} style={{ color: 'var(--primary)' }} /> {entry.chapter_title ?? 'صفحة كتاب'}
          </small>
          <span
            className="badge scan-badge-exos"
            onClick={() => bridge.filterExercicesByPage(page)}
            title="عرض تمارين هذه الصفحة في بنك التمارين"
          >
            <PenLine size={11} /> {entry.exercises_count} تمارين
          </span>
        </div>
        <div className="scan-card-actions">
          {entry.chapter_toc_id && (
            <BridgeButton
              variant="cours"
              label="الدرس"
              onClick={() => bridge.jumpTo('cours', `cours_${entry.chapter_toc_id}`)}
            />
          )}
          <BridgeButton
            variant="scan"
            icon={<Maximize2 size={12} />}
            label="تكبير"
            title="تكبير الوثيقة"
            onClick={() => onOpenScan(page, entry.width, entry.height)}
          />
        </div>
      </div>
    </HighlightTarget>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function ScanEvalCard({
  scan, activeDb, onOpenImage,
}: {
  scan: EvalScan
  activeDb: string
  onOpenImage: (src: string, title: string) => void
}) {
  const bridge = useCurriculumBridge()
  const src = api.library.getArtifactBinaryUrl(activeDb, scan.artifactId)
  const label = scan.type === 'sujet' ? 'موضوع امتحان' : 'حل وسلّم تنقيط'
  const pageLabel = scan.type === 'sujet' ? 'موضوع' : 'تصحيح'

  return (
    <div className="scan-grid-card scan-card-flex scan-card-eval">
      <div className="scan-thumb-wrap" onClick={() => onOpenImage(src, `${scan.title} — ${pageLabel}`)}>
        <img src={src} loading="lazy" alt={scan.title} />
        <span
          className={`badge ${scan.type === 'sujet' ? 'badge-info' : 'badge-success'} scan-badge-page font-num`}
          onClick={e => { e.stopPropagation(); bridge.jumpTo('evaluations', `eval_${scan.assessmentId}`) }}
          title="انقر للانتقال المباشر للنموذج"
        >
          {pageLabel}
        </span>
        {scan.termIndex != null && (
          <span
            className="badge scan-badge-trim"
            onClick={e => { e.stopPropagation(); bridge.setTrimFilter(scan.termIndex as number) }}
            title={`انقر لتصفية الفصل ${scan.termIndex}`}
          >
            ف {scan.termIndex}
          </span>
        )}
      </div>
      <div className="scan-card-body">
        <div>
          <small className="scan-chapter-title" title={scan.title} dir="auto" style={{ fontWeight: 700 }}>
            <FileSignature size={12} style={{ color: 'var(--info)' }} /> {scan.title}
          </small>
          <span
            className={`badge ${scan.type === 'sujet' ? 'badge-info' : 'badge-success'} scan-badge-exos`}
            onClick={() => bridge.jumpTo('evaluations', `eval_${scan.assessmentId}`)}
            title="عرض في بنك الاختبارات"
          >
            {label}
          </span>
        </div>
        <div className="scan-card-actions">
          <BridgeButton
            variant="eval"
            label="النموذج"
            onClick={() => bridge.jumpTo('evaluations', `eval_${scan.assessmentId}`)}
          />
          <BridgeButton
            variant="scan"
            icon={<Maximize2 size={12} />}
            label="تكبير"
            title="تكبير الوثيقة"
            onClick={() => onOpenImage(src, `${scan.title} — ${pageLabel}`)}
          />
        </div>
      </div>
    </div>
  )
}
