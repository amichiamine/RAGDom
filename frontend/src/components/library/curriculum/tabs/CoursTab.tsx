import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, ChevronsDown, ChevronsUp, ChevronDown, FileImage, PenTool,
  GraduationCap, Image as ImageIcon, X, Expand, PenLine, FileText,
} from 'lucide-react'
import type { Artifact, Chunk, CurriculumPayload, Document, PedagogicalType, TocNode } from '@/types'
import { api } from '@/lib/api'
import { splitMarkdownOnArtifactAnchors, hasArtifactAnchors } from '@/lib/markdownKatex'
import { useCurriculumBridge, HighlightTarget } from '@/contexts/CurriculumBridgeContext'
import { useLanguage } from '@/contexts/LanguageContext'
import BridgeButton from '@/components/library/BridgeButton'
import MarkdownKatex from '@/components/library/MarkdownKatex'
import PageMedia from '@/components/library/PageMedia'
import ImageModal from '@/components/library/curriculum/ImageModal'
import {
  buildCurriculumModel, type CoursNode, type CurriculumModel,
} from './curriculumModel'
import { effectivePedagogicalType, isNonCourseType } from './curriculumData'

interface Props {
  curriculum: CurriculumPayload
  toc: TocNode[]
  documentId: string | null
  /** Tous les documents (repli « document = unité de lecture » si aucun TOC niveau 1). */
  documents?: Document[]
  activeDb: string
}

const COURS_PREFIX = 'cours_'
const coursId = (tocId: string) => `${COURS_PREFIX}${tocId}`

/** Libellés arabes des types pédagogiques (badge affiché seulement si typé). */
const PEDAGOGICAL_LABEL: Record<PedagogicalType, string> = {
  course_theory: 'درس',
  proof_demonstration: 'برهان',
  exercise_unsolved: 'تمرين',
  exercise_solved: 'تمرين محلول',
  solution_only: 'حل',
  evaluation_exam: 'تقويم',
  practical_work: 'نشاط تطبيقي',
  general_content: 'محتوى',
}

/**
 * Onglet 3 — مستودع الدروس والمفاهيم (Lot 6). Liste de cartes de cours
 * (chapitres TOC niveau 1) repliables, contenu course_theory rendu par
 * MarkdownKatex, mode côte-à-côte fluide (texte 100% ↔ 50/50 + rail de scans).
 */
export default function CoursTab({ curriculum, toc, documentId, documents, activeDb }: Props) {
  const { t } = useLanguage()
  const { searchQuery, trimFilter, expandedIds, toggleExpanded, expandAll } = useCurriculumBridge()

  const model = useMemo<CurriculumModel>(
    () => buildCurriculumModel(curriculum, toc, undefined, documents),
    [curriculum, toc, documents],
  )

  const [modal, setModal] = useState<{ page: number; documentId: string } | null>(null)

  const q = searchQuery.trim().toLowerCase()
  const visible = model.cours.filter(c => {
    if (trimFilter > 0 && trimFilter !== c.termIndex) return false
    if (q && !c.title.toLowerCase().includes(q)) return false
    return true
  })

  const allIds = useMemo(() => model.cours.map(c => coursId(c.tocId)), [model])
  const openAll = () => expandAll(COURS_PREFIX, allIds, true)
  const collapseAll = () => expandAll(COURS_PREFIX, allIds, false)

  const openScanModal = useCallback((page: number, docId: string) => setModal({ page, documentId: docId }), [])

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookOpen size={20} style={{ color: 'var(--primary)' }} /> {t('curriculum_ui.courses_heading')}
          </h4>
          <small style={{ color: 'var(--text-muted)' }}>
            {t('curriculum_ui.courses_subtitle')}
          </small>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={openAll}>
            <ChevronsDown size={15} /> {t('curriculum_ui.open_all_courses')}
          </button>
          <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={collapseAll}>
            <ChevronsUp size={15} /> {t('curriculum_ui.collapse_all')}
          </button>
        </div>
      </div>

      {visible.length === 0 && (
        <div className="alert-secondary-box">{t('curriculum_ui.no_courses')}</div>
      )}

      {visible.map(c => (
        <CoursCard
          key={c.tocId}
          cours={c}
          open={expandedIds.has(coursId(c.tocId))}
          onToggle={() => toggleExpanded(coursId(c.tocId))}
          activeDb={activeDb}
          documentId={c.documentId ?? documentId}
          termIndex={c.termIndex}
          onOpenScanModal={openScanModal}
        />
      ))}

      <ImageModal
        open={modal !== null}
        title={modal ? `صفحة كتاب مدرسي رقم ${modal.page}` : ''}
        src={modal ? api.library.getPageScanUrl(activeDb, modal.documentId, modal.page) : ''}
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
  onOpenScanModal: (page: number, documentId: string) => void
}

/**
 * Carte d'un cours (chapitre). Charge paresseusement ses chunks course_theory
 * à la première ouverture. Bascule 100% ↔ 50/50 (`.fluid-pane`) avec rail de
 * scans (page_start..page_end) sticky.
 */
function CoursCard({ cours, open, onToggle, activeDb, documentId, termIndex, onOpenScanModal }: CardProps) {
  const { jumpTo, filterExercicesByCours } = useCurriculumBridge()
  const { t } = useLanguage()
  const [chunks, setChunks] = useState<Chunk[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sideBySide, setSideBySide] = useState(false)
  // Cache des artefacts par page. Deux sources FUSIONNÉES : (1) préchargement direct
  // de la plage de pages du chapitre DANS le même effet que les chunks (correctif
  // timing F9 → le résolveur dispose des métadonnées AVANT le rendu markdown, donc
  // plus d'image de repli transitoire sur les ancres in-situ) ; (2) PageMedia.onLoaded
  // (complète/rafraîchit page par page). L'union des deux évite tout scintillement.
  const [artifactsByPage, setArtifactsByPage] = useState<Map<number, Artifact[]>>(() => new Map())
  // Vrai tant que le préchargement des artefacts de la plage n'a pas abouti : on
  // retarde le rendu des ancres in-situ jusqu'à disposition du cache (sans bloquer
  // le texte). Garde par ref pour NE PAS mettre `artifactsReady` dans les deps.
  const [artifactsReady, setArtifactsReady] = useState(false)

  const [enlarged, setEnlarged] = useState<{ src: string; title: string } | null>(null)

  // Chargement paresseux des chunks + PRÉCHARGEMENT des artefacts du chapitre
  // (une seule fois, à l'ouverture).
  // PIÈGE ÉVITÉ : ni `loading`/`chunks` ni `artifactsReady` dans les deps —
  // un setState relancerait l'effet, dont le cleanup (alive=false) JETTERAIT la
  // réponse → « chargement infini » silencieux (bug réel corrigé le 2026-08-22).
  // Le préchargement des artefacts est piloté par une garde `ref` dédiée, pas par
  // l'état, pour la même raison (leçon V3.11.1 : loading dans les deps → auto-annulation).
  const startedRef = useRef(false)
  useEffect(() => {
    if (!open || startedRef.current || !documentId) return
    startedRef.current = true
    let alive = true
    setLoading(true); setError(null)
    ;(async () => {
      try {
        // TOUT le contenu extrait des pages du chapitre (pas seulement les
        // chunks typés course_theory) : sur les corpus réels la majorité des
        // chunks ont pedagogical_type=NULL et souvent toc_id=NULL ; on cible donc
        // la plage de pages du chapitre, toujours peuplée, pour ne rien masquer.
        const range = { page_start: cours.pageStart, page_end: cours.pageEnd }
        // Préchargement artefacts (par plage {document_id, page_number}) LANCÉ EN
        // PARALLÈLE des chunks : on peuple `artifactsByPage` dès sa résolution afin
        // que le résolveur soit prêt pour le premier rendu des ancres in-situ.
        // Requêtes par page émises EN PARALLÈLE (le navigateur borne lui-même la
        // concurrence) → pas de régression de latence sur les chapitres larges.
        const artifactsPromise = (async () => {
          const pages: number[] = []
          for (let p = cours.pageStart; p <= cours.pageEnd; p++) pages.push(p)
          const results = await Promise.all(pages.map(p =>
            api.library.getArtifacts(activeDb, { document_id: documentId, page_number: p })
              .then(r => [p, r.artifacts] as const)
              .catch(() => [p, [] as Artifact[]] as const),
          ))
          const byPage = new Map<number, Artifact[]>()
          for (const [p, list] of results) if (list.length) byPage.set(p, list)
          return byPage
        })()

        const first = await api.library.getChunks(activeDb, documentId, 1, range)
        let all = first.chunks ?? []
        const totalPages = first.total_pages ?? 1
        for (let p = 2; p <= totalPages; p++) {
          const res = await api.library.getChunks(activeDb, documentId, p, range)
          all = all.concat(res.chunks ?? [])
        }
        if (alive) setChunks(all)

        // Fusion du préchargement d'artefacts (ne remplace jamais une entrée déjà
        // renseignée par PageMedia.onLoaded : union non destructive).
        const preloaded = await artifactsPromise
        if (alive) {
          setArtifactsByPage(prev => {
            const next = new Map(prev)
            for (const [pageNo, list] of preloaded) if (!next.has(pageNo)) next.set(pageNo, list)
            return next
          })
          setArtifactsReady(true)
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'خطأ في تحميل الدرس')
      } finally {
        if (alive) { setLoading(false); setArtifactsReady(true) }
      }
    })()
    return () => { alive = false }
  }, [open, documentId, activeDb, cours.pageStart, cours.pageEnd])

  // Résolveur d'assets mémoïsé (stabilise le memo de MarkdownKatex).
  const resolveAsset = useCallback(
    (artifactRef: string) => api.library.getArtifactBinaryUrl(activeDb, artifactRef),
    [activeDb],
  )

  // Index id → Artifact (toutes pages chargées) pour le rendu intercalé.
  const artifactById = useMemo(() => {
    const idx = new Map<string, Artifact>()
    for (const list of artifactsByPage.values()) for (const a of list) idx.set(a.id, a)
    return idx
  }, [artifactsByPage])

  const artifactResolver = useCallback((id: string) => artifactById.get(id), [artifactById])
  const artifactBinaryUrl = useCallback(
    (id: string) => api.library.getArtifactBinaryUrl(activeDb, id),
    [activeDb],
  )
  const onArtifactsLoaded = useCallback((pageNo: number, list: Artifact[]) => {
    setArtifactsByPage(prev => {
      const next = new Map(prev)
      next.set(pageNo, list)
      return next
    })
  }, [])

  // IDs d'artefacts ancrés (`asset://artifacts/{id}`) par page → dédup PageMedia.
  const embeddedByPage = useMemo(() => {
    const map = new Map<number, Set<string>>()
    for (const ch of chunks ?? []) {
      const ids = splitMarkdownOnArtifactAnchors(ch.content_markdown)
        .filter(s => s.kind === 'artifact')
        .map(s => (s as { id: string }).id)
      if (!ids.length) continue
      const set = map.get(ch.page_number) ?? new Set<string>()
      ids.forEach(id => set.add(id))
      map.set(ch.page_number, set)
    }
    return map
  }, [chunks])

  // Ouverture du scan liée au document propre de cette carte (repli document = unité).
  const openScan = useCallback(
    (page: number) => { if (documentId) onOpenScanModal(page, documentId) },
    [onOpenScanModal, documentId],
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

  // Groupe les chunks par page (ordre de lecture) → rendu du texte PUIS de la
  // section « الوسائط المستخرجة » de cette page (schémas, tableaux, formules-images).
  const pageGroups = useMemo(() => {
    const map = new Map<number, Chunk[]>()
    for (const ch of sortedChunks) {
      const arr = map.get(ch.page_number) ?? []
      arr.push(ch)
      map.set(ch.page_number, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [sortedChunks])

  // Capsule de plage de pages FIABLE (correctif défaut 1) : « ص X - Y » pour une
  // vraie plage, « ص X » pour une leçon d'une seule page — jamais « ص X - 210 ».
  const pageRangeLabel = cours.pageEnd > cours.pageStart
    ? t('library.range_pages').replace('{start}', String(cours.pageStart)).replace('{end}', String(cours.pageEnd))
    : t('library.range_single_page').replace('{page}', String(cours.pageStart))

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
          <span className="badge badge-secondary font-num">{pageRangeLabel}</span>
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
          <BridgeButton variant="scan" icon={<ImageIcon size={14} />} label={`مسح ص ${cours.pageStart}`} onClick={() => openScan(cours.pageStart)} />
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
                {documentId && pageGroups.map(([pageNo, pageChunks]) => (
                  <div key={pageNo} style={{ marginBottom: 16 }}>
                    {pageChunks.map(ch => (
                      <ChunkRow
                        key={ch.id}
                        chunk={ch}
                        // Readiness PAR PAGE : dès que les artefacts de la page sont en
                        // cache (préchargement ou PageMedia) on rend immédiatement ; sinon
                        // on attend la fin du préchargement global (`artifactsReady`). Évite
                        // à la fois le scintillement ET tout blocage sur chapitres larges.
                        artifactsReady={artifactsReady || artifactsByPage.has(pageNo)}
                        openScan={openScan}
                        resolveAsset={resolveAsset}
                        artifactResolver={artifactResolver}
                        artifactBinaryUrl={artifactBinaryUrl}
                        onEnlarge={(src, title) => setEnlarged({ src, title })}
                      />
                    ))}
                    {/* Matériels multimodaux extraits de cette page (schémas, tableaux, formules-images). */}
                    <PageMedia
                      db={activeDb}
                      documentId={documentId}
                      page={pageNo}
                      embeddedIds={embeddedByPage.get(pageNo)}
                      onLoaded={onArtifactsLoaded}
                    />
                  </div>
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
                          <button type="button" className="btn btn-sm" style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', padding: '2px 8px', fontSize: '0.75rem' }} onClick={() => openScan(p)}>
                            <Expand size={12} /> تكبير
                          </button>
                        </div>
                        {documentId ? (
                          <img
                            src={api.library.getPageScanUrl(activeDb, documentId, p, true)}
                            loading="lazy"
                            style={{ width: '100%', display: 'block', cursor: 'pointer' }}
                            onClick={() => openScan(p)}
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

      {/* Agrandissement d'un artefact rendu (SVG/original) dans le corps de lecture. */}
      <ImageModal
        open={enlarged !== null}
        title={enlarged?.title ?? ''}
        src={enlarged?.src ?? ''}
        onClose={() => setEnlarged(null)}
      />
    </HighlightTarget>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Ligne de chunk dans l'onglet Cours.
//
// Correctif « des exercices dans l'onglet Cours » (défaut 2) + navigation
// relationnelle (défaut 3) + timing artefacts (défaut 4), SANS sur-filtrage :
//  - badge du TYPE EFFECTIF (déclaré par l'API, ou déduit prudemment des marqueurs
//    arabes en amorce) — un exercice noyé dans le flux « cours » est ÉTIQUETÉ ;
//  - si le type effectif relève d'un autre onglet (تمرين/حل/تقويم), un PONT doré
//    mène à l'onglet dédié (le contenu RESTE affiché ici — dégradation gracieuse) ;
//  - pont « مسح ص N » vers la page scan du chunk (onglet Scans à la bonne page) ;
//  - le rendu des ancres in-situ (asset://artifacts/{id}) attend `artifactsReady`
//    pour éviter l'image de repli transitoire (F9).
// ─────────────────────────────────────────────────────────────────────────────
interface ChunkRowProps {
  chunk: Chunk
  artifactsReady: boolean
  openScan: (page: number) => void
  resolveAsset: (ref: string) => string
  artifactResolver: (id: string) => Artifact | undefined
  artifactBinaryUrl: (id: string) => string
  onEnlarge: (src: string, title: string) => void
}

function ChunkRow({
  chunk, artifactsReady, openScan, resolveAsset, artifactResolver, artifactBinaryUrl, onEnlarge,
}: ChunkRowProps) {
  const { jumpTo, switchTab, jumpToExercise, filterExercicesByPage } = useCurriculumBridge()
  const { t } = useLanguage()

  const eff = useMemo(() => effectivePedagogicalType(chunk), [chunk])
  const nonCourse = isNonCourseType(eff.type)
  // Le rendu intercalé (ancres artefacts) est retardé jusqu'à disposition du cache
  // d'artefacts, MAIS uniquement pour les chunks qui contiennent réellement des ancres :
  // le texte pur s'affiche immédiatement (aucun blocage de lecture).
  const waitingForArtifacts = useMemo(
    () => hasArtifactAnchors(chunk.content_markdown) && !artifactsReady,
    [chunk.content_markdown, artifactsReady],
  )

  const badgeLabel = eff.type ? (PEDAGOGICAL_LABEL[eff.type] ?? eff.type) : null
  // Badge distinct pour un type DÉDUIT (heuristique) : nuance « ؟ » + classe atténuée,
  // afin de ne jamais présenter une inférence comme une certitude.
  const badgeClass = eff.inferred ? 'badge badge-warning' : 'badge badge-secondary'

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Rangée de ponts TOUJOURS présente : le pont chunk → scan est universel
          (défaut 3), le badge de type et le pont de reroutage restent conditionnels. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        {badgeLabel && (
          <span className={badgeClass} style={{ display: 'inline-block' }} dir="auto">
            {badgeLabel}{eff.inferred ? ' ؟' : ''}
          </span>
        )}
        {/* Pont vers l'onglet dédié quand le contenu relève d'exercices/évaluations. */}
        {nonCourse && (eff.type === 'evaluation_exam' ? (
            /* Contenu d'évaluation → onglet Évaluations. Les cibles halo y sont
               indexées par assessment/document (pas par id de chunk) : on bascule
               simplement l'onglet (switchTab) plutôt que de poser un halo orphelin. */
            <BridgeButton
              variant="eval"
              icon={<FileText size={13} />}
              label={t('library.nav_open_in_evaluations')}
              title={t('library.nav_open_in_evaluations')}
              onClick={() => switchTab('evaluations')}
            />
          ) : eff.type === 'solution_only' ? (
            /* Corrigé noyé dans le flux cours → pont BIDIRECTIONNEL vers l'énoncé.
               `jumpToExercise` cible l'énoncé lié par id (le backend expose
               linked_solution_chunk_id ; ExercicesTab résout aussi l'id de corrigé
               vers son exercice via l'index inverse) et, à défaut de correspondance,
               retombe sur les exercices de la même page. */
            <BridgeButton
              variant="cours"
              icon={<PenLine size={13} />}
              label={t('library.nav_goto_exercise')}
              title={t('library.nav_goto_exercise')}
              onClick={() => jumpToExercise(chunk.id)}
            />
        ) : (
          <BridgeButton
            variant="exo"
            icon={<PenTool size={13} />}
            label={t('library.nav_open_in_exercices')}
            title={t('library.nav_open_in_exercices')}
            onClick={() => filterExercicesByPage(chunk.page_number)}
          />
        ))}
        {/* Pont universel chunk → page scan (onglet Scans à la bonne page). */}
        <BridgeButton
          variant="scan"
          icon={<ImageIcon size={13} />}
          label={t('library.nav_goto_scan').replace('{page}', String(chunk.page_number))}
          title={t('library.nav_goto_scan').replace('{page}', String(chunk.page_number))}
          onClick={() => jumpTo('scans', `scan_${chunk.page_number}`)}
        />
      </div>
      {waitingForArtifacts ? (
        <div style={{ minHeight: 40 }} aria-busy="true" />
      ) : (
        <MarkdownKatex
          raw={chunk.content_markdown}
          lazy
          onPageJump={openScan}
          resolveAsset={resolveAsset}
          artifactResolver={artifactResolver}
          artifactBinaryUrl={artifactBinaryUrl}
          onEnlarge={onEnlarge}
        />
      )}
    </div>
  )
}
