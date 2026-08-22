import type {
  CurriculumPayload, CurriculumProgram, CurriculumTerm, Assessment,
  ContentLink, TocNode, Document,
} from '@/types'

/**
 * Dérivation du modèle pédagogique normatif (mapping §Blueprint, différent du PHP)
 * consommé par les onglets Matrice / Programme / Cours de la Vague B.
 *
 *  - Trimestres  = `curriculum.terms` (term_index 1/2/3)
 *  - مقاطع        = `curriculum.programs` (rattachés à un terme via term_id)
 *  - Cours        = chapitres TOC de niveau 1 (page_start/page_end) enrichis des
 *                   liens `course_program` / `course_exercise`
 *  - Compteurs    = `curriculum.aggregates` UNIQUEMENT (jamais de constante en dur ;
 *                   les décomptes locaux dérivent des `links`, pas de nombres figés)
 */

/** Emoji de saison par trimestre (1 → automne, 2 → hiver, 3 → printemps). */
export const TERM_EMOJI: Record<number, string> = { 1: '🍂', 2: '❄️', 3: '🌸' }

/** Couleur de badge « دروس » par trimestre (parité template : primary/info/success). */
export const TERM_BADGE_CLASS: Record<number, string> = {
  1: 'badge-primary',
  2: 'badge-info',
  3: 'badge-success',
}

/** Un chapitre-cours dérivé d'un nœud TOC niveau 1 + ses liaisons curriculum. */
export interface CoursNode {
  /** id du nœud TOC (clé de liaison `course_program` / `course_exercise`). */
  tocId: string
  title: string
  pageStart: number
  pageEnd: number
  /** Repli « document = unité de lecture » : id du document propre à cette carte
   *  (null pour un vrai chapitre TOC → on utilise le documentId global). */
  documentId?: string | null
  /** Numéro de leçon (pedagogical_index si connu, sinon rang 1-based du chapitre). */
  lessonNumber: number
  /** Programme (مقطع) rattaché via un lien `course_program`, s'il existe. */
  programId: string | null
  /** Nombre d'exercices liés (liens `course_exercise` de ce chapitre). */
  exercisesCount: number
  /** term_index du trimestre déduit via le programme rattaché (0 = inconnu). */
  termIndex: number
}

/** Index prêt à l'emploi construit une seule fois par payload + toc. */
export interface CurriculumModel {
  terms: CurriculumTerm[]
  programs: CurriculumProgram[]
  assessments: Assessment[]
  /** Chapitres-cours (TOC niveau 1), triés par page de début. */
  cours: CoursNode[]
  /** term_index par program_id (via le term_id du programme). */
  programTermIndex: Map<string, number>
  /** term_index par toc_id (via le programme rattaché au chapitre). */
  coursByTocId: Map<string, CoursNode>
}

/** Aplati un arbre TOC en une liste (pré-ordre). */
function flattenToc(nodes: TocNode[]): TocNode[] {
  const out: TocNode[] = []
  const walk = (list: TocNode[]) => {
    for (const n of list) {
      out.push(n)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/**
 * Construit le modèle dérivé. `lessonIndexByTocId` (optionnel) permet d'injecter
 * le `pedagogical_index` réel du premier chunk course_theory de chaque chapitre —
 * quand il est absent on retombe sur le rang 1-based du chapitre.
 */
export function buildCurriculumModel(
  curriculum: CurriculumPayload,
  toc: TocNode[],
  lessonIndexByTocId?: Map<string, number>,
  /** Repli §5.2 : documents de la base — utilisés comme unités de lecture quand
   *  aucun chapitre TOC niveau 1 n'existe (base examens, sources sans sommaire). */
  documentsFallback?: Document[],
): CurriculumModel {
  const terms = [...curriculum.terms].sort((a, b) => a.term_index - b.term_index)
  const programs = [...curriculum.programs]
  const assessments = [...curriculum.assessments]
  const links = curriculum.links

  // term_index par term_id.
  const termIndexById = new Map<string, number>()
  for (const t of terms) termIndexById.set(t.id, t.term_index)

  // term_index par program_id (via le term_id du programme).
  const programTermIndex = new Map<string, number>()
  for (const p of programs) {
    programTermIndex.set(p.id, p.term_id ? (termIndexById.get(p.term_id) ?? 0) : 0)
  }

  // Liens : chapitre → programme, et décompte des exercices par chapitre.
  const programByToc = new Map<string, string>()
  const exoCountByToc = new Map<string, number>()
  for (const l of links as ContentLink[]) {
    if (l.link_type === 'course_program') {
      if (!programByToc.has(l.from_id)) programByToc.set(l.from_id, l.to_id)
    } else if (l.link_type === 'course_exercise') {
      exoCountByToc.set(l.from_id, (exoCountByToc.get(l.from_id) ?? 0) + 1)
    }
  }

  // Chapitres de niveau 1 = les « cours ».
  const flat = flattenToc(toc)
  const chapters = flat
    .filter(n => n.level === 1)
    .sort((a, b) => a.page_start - b.page_start)

  let cours: CoursNode[] = chapters.map((ch, i) => {
    const programId = programByToc.get(ch.id) ?? null
    const termIndex = programId ? (programTermIndex.get(programId) ?? 0) : 0
    return {
      tocId: ch.id,
      title: ch.title,
      pageStart: ch.page_start,
      pageEnd: ch.page_end ?? ch.page_start,
      lessonNumber: lessonIndexByTocId?.get(ch.id) ?? (i + 1),
      programId,
      exercisesCount: exoCountByToc.get(ch.id) ?? 0,
      termIndex,
    }
  })

  // Repli §5.2 : aucun chapitre TOC niveau 1 → chaque DOCUMENT devient une unité
  // de lecture (carte par document, plage = tout le document). Rend la base examens
  // (ainsi que toute base sans sommaire) lisible dans l'onglet Cours.
  if (cours.length === 0 && documentsFallback && documentsFallback.length > 0) {
    cours = documentsFallback.map((doc, i) => ({
      tocId: `doc_${doc.id}`,
      documentId: doc.id,
      title: doc.title || doc.filename,
      pageStart: 1,
      pageEnd: Math.max(1, doc.total_pages || 1),
      lessonNumber: i + 1,
      programId: null,
      exercisesCount: 0,
      termIndex: 0,
    }))
  }

  const coursByTocId = new Map<string, CoursNode>()
  for (const c of cours) coursByTocId.set(c.tocId, c)

  return { terms, programs, assessments, cours, programTermIndex, coursByTocId }
}

/** Cours d'un terme donné (par term_index). */
export function coursForTerm(model: CurriculumModel, termIndex: number): CoursNode[] {
  return model.cours.filter(c => c.termIndex === termIndex)
}

/** Évaluations d'un terme donné (par term_index, via term_id de l'assessment). */
export function assessmentsForTerm(model: CurriculumModel, termIndex: number): Assessment[] {
  const termId = model.terms.find(t => t.term_index === termIndex)?.id ?? null
  if (!termId) return []
  return model.assessments.filter(a => a.term_id === termId)
}

/** Cours rattachés à un programme (مقطع) donné. */
export function coursForProgram(model: CurriculumModel, programId: string): CoursNode[] {
  return model.cours.filter(c => c.programId === programId)
}

/**
 * Parse les compétences/ressources d'un programme. `competencies_json` peut être
 * un JSON (tableau de chaînes, ou objet {ressources|competencies|items}) ou du
 * texte brut — on renvoie toujours du texte avec retours ligne préservés.
 */
export function parseCompetencies(raw: string | null): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map(v => (typeof v === 'string' ? v : String(v))).join('\n')
      }
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>
        const arr = obj.ressources ?? obj.competencies ?? obj.items ?? obj.values
        if (Array.isArray(arr)) return arr.map(v => String(v)).join('\n')
        return Object.values(obj).map(v => String(v)).join('\n')
      }
      return String(parsed)
    } catch {
      // JSON malformé → on retombe sur le texte brut.
      return trimmed
    }
  }
  return trimmed
}
