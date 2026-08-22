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
 * Plage de pages FIABLE d'une entrée TOC (correctif capsules « ص X - 210 »).
 *
 * Contexte terrain (base live 1AM_math) : 20/45 entrées `document_toc` portent
 * `page_end = 210` (dernière page du DOCUMENT) au lieu de la vraie fin de section
 * → capsules absurdes « ص 10 - 210 », « ص 27 - 210 » entremêlées de « ص 27 - 27 ».
 * L'agent backend corrige `page_end` en parallèle ; ce helper rend le FRONTEND
 * robuste quelle que soit la valeur reçue :
 *
 *  1. On fait confiance au `page_end` de l'API S'IL est cohérent :
 *     page_end >= page_start ET page_end < début de la prochaine entrée de niveau
 *     <= N (sinon il chevauche la section suivante → suspect) ET page_end <= fin
 *     réelle du chapitre parent (jamais la fin du document via un repli global).
 *  2. Sinon on RECALCULE : fin = (page_start de la prochaine entrée de niveau
 *     <= N, en ordre document) − 1, bornée par la dernière page réelle connue.
 *  3. Feuille sans successeur (dernière entrée) : sa propre `page_start` (plage
 *     d'une page) plutôt que la fin du document.
 *
 * `flat` DOIT être l'aplatissement pré-ordre du TOC (ordre document). `contentMaxPage`
 * est la dernière page réellement couverte par le TOC (max des page_start), utilisée
 * comme borne haute — jamais `total_pages` du document.
 */
export function reliablePageEnd(
  entry: TocNode,
  index: number,
  flat: TocNode[],
  contentMaxPage: number,
): number {
  const start = entry.page_start
  // Prochaine entrée de niveau <= au niveau courant, en ordre document → borne la section.
  let nextBoundaryStart: number | null = null
  for (let j = index + 1; j < flat.length; j++) {
    const nxt = flat[j]
    if (nxt.level <= entry.level && nxt.page_start >= start) {
      nextBoundaryStart = nxt.page_start
      break
    }
  }
  // Borne haute logique de cette section (avant la prochaine section de même niveau
  // ou supérieur), sans jamais déborder sur la dernière page réelle du contenu.
  const sectionCeil = nextBoundaryStart != null
    ? Math.min(nextBoundaryStart - 1, contentMaxPage)
    : contentMaxPage

  const apiEnd = entry.page_end
  // 1. `page_end` API accepté uniquement s'il est cohérent ET ne déborde pas la section.
  if (apiEnd != null && apiEnd >= start && apiEnd <= sectionCeil) {
    return apiEnd
  }
  // 2. Recalcul : fin = juste avant la prochaine frontière, bornée par le plafond section.
  if (nextBoundaryStart != null) {
    return Math.max(start, Math.min(nextBoundaryStart - 1, sectionCeil))
  }
  // 3. Dernière entrée (aucun successeur) : bornée par la dernière page réelle du contenu,
  //    à défaut plage d'une page (jamais la fin du document).
  return Math.max(start, Math.min(sectionCeil, contentMaxPage))
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

  // Chapitres de niveau 1 = les « cours ». On travaille sur l'aplatissement pré-ordre
  // (ordre document) pour calculer des plages de pages FIABLES (cf. reliablePageEnd) :
  // l'index dans `flat` — et NON dans la liste triée des chapitres — est la référence
  // pour trouver la prochaine frontière de section.
  const flat = flattenToc(toc)
  // Dernière page réellement couverte par le TOC = borne haute des plages (JAMAIS
  // total_pages du document → source des capsules « X - 210 »).
  let contentMaxPage = 0
  for (const n of flat) {
    if (n.page_start > contentMaxPage) contentMaxPage = n.page_start
    if (n.page_end != null && n.page_end > contentMaxPage && n.page_end < Number.MAX_SAFE_INTEGER) {
      // On tolère un page_end supérieur au max des starts UNIQUEMENT s'il reste plausible
      // (dernière section pouvant s'étendre) — plafonné plus bas par section, ici seule
      // la borne globale du contenu nous intéresse.
      contentMaxPage = Math.max(contentMaxPage, n.page_end)
    }
  }
  // Fin réelle « max des débuts » (ignore les page_end sentinelle = fin document) :
  // c'est cette valeur qui borne les sections, pas l'éventuel page_end gonflé ci-dessus.
  let maxStart = 0
  for (const n of flat) if (n.page_start > maxStart) maxStart = n.page_start
  const contentCeil = maxStart > 0 ? maxStart : contentMaxPage

  const chapters = flat
    .map((node, idx) => ({ node, idx }))
    .filter(({ node }) => node.level === 1)
    .sort((a, b) => a.node.page_start - b.node.page_start)

  let cours: CoursNode[] = chapters.map(({ node: ch, idx }, i) => {
    const programId = programByToc.get(ch.id) ?? null
    const termIndex = programId ? (programTermIndex.get(programId) ?? 0) : 0
    return {
      tocId: ch.id,
      title: ch.title,
      pageStart: ch.page_start,
      pageEnd: reliablePageEnd(ch, idx, flat, contentCeil),
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
