import { api } from '@/lib/api'
import type { Chunk, ContentLink, CurriculumPayload, PedagogicalType } from '@/types'

/**
 * Helpers de données partagés par les onglets de la VAGUE C (exercices,
 * évaluations, scans). Aucune donnée simulée : tout est dérivé des chunks
 * paginés (`api.library.getChunks`) et du payload curriculum (agrégats + liens).
 *
 * Écart assumé vs contrat : `api.library.getChunks` ne propose pas de « GET par
 * id » ; on pagine donc l'intégralité du document (pages successives) et on
 * indexe les chunks par id, puis par `pedagogical_index`. Sur un corpus « 1 base
 * = 1 niveau×matière » cela reste borné (quelques centaines de chunks) et se
 * fait une seule fois, mémoïsé côté onglet.
 */

/** Garde-fou anti-boucle infinie sur une pagination hypothétique non bornée. */
const MAX_CHUNK_PAGES = 40

/** Récupère TOUS les chunks d'un document (toutes pages), éventuellement filtrés. */
export async function fetchAllChunks(
  db: string,
  documentId: string,
  filters?: { pedagogical_type?: string; page_start?: number; page_end?: number; toc_id?: string; term_index?: number },
): Promise<Chunk[]> {
  const out: Chunk[] = []
  let page = 1
  let totalPages = 1
  do {
    const res = await api.library.getChunks(db, documentId, page, filters)
    out.push(...res.chunks)
    totalPages = res.total_pages || 1
    page += 1
  } while (page <= totalPages && page <= MAX_CHUNK_PAGES)
  return out
}

/**
 * Charge la banque d'exercices : chunks `exercise_solved` + `exercise_unsolved`,
 * plus les chunks `solution_only` indexés par `pedagogical_index` pour la liaison
 * énoncé ↔ corrigé (SolutionLinker : même `pedagogical_index`, `link_type`
 * `course_exercise`, champ `has_solution`).
 */
export async function fetchExerciseBank(db: string, documentIds: string | string[]): Promise<{
  exercises: Chunk[]
  solutionsByIndex: Map<number, Chunk>
  solutionsById: Map<string, Chunk>
  /** document_id d'origine de chaque chunk (liaison corrigé par document — repli sans curriculum). */
  docByChunkId: Map<string, string>
}> {
  // Cause D (repli sans curriculum) : les chunks typés se répartissent sur PLUSIEURS
  // documents (base sources/examens) ; on agrège donc TOUS les documents, pas seulement
  // le premier — sinon un exercice typé n'apparaît jamais s'il est dans un autre document.
  const ids = Array.isArray(documentIds) ? documentIds : [documentIds]
  const docByChunkId = new Map<string, string>()
  const collect = async (type: string): Promise<Chunk[]> => {
    const out: Chunk[] = []
    for (const docId of ids) {
      const list = await fetchAllChunks(db, docId, { pedagogical_type: type })
      for (const c of list) docByChunkId.set(c.id, docId)
      out.push(...list)
    }
    return out
  }
  const [solved, unsolved, solutions] = await Promise.all([
    collect('exercise_solved'),
    collect('exercise_unsolved'),
    collect('solution_only'),
  ])
  const exercises = [...solved, ...unsolved].sort((a, b) => {
    const ai = a.pedagogical_index ?? Number.MAX_SAFE_INTEGER
    const bi = b.pedagogical_index ?? Number.MAX_SAFE_INTEGER
    if (ai !== bi) return ai - bi
    return a.page_number - b.page_number
  })
  const solutionsByIndex = new Map<number, Chunk>()
  const solutionsById = new Map<string, Chunk>()
  for (const s of solutions) {
    solutionsById.set(s.id, s)
    if (s.pedagogical_index != null) solutionsByIndex.set(s.pedagogical_index, s)
  }
  return { exercises, solutionsByIndex, solutionsById, docByChunkId }
}

/**
 * Corrigé de repli PAR DOCUMENT quand ni lien `course_exercise` ni
 * `pedagogical_index` ne matchent : première solution `solution_only` du MÊME
 * document que l'exercice. Garantit un corrigé lié même sans curriculum.
 */
export function resolveSolutionByDocument(
  exo: Chunk,
  docByChunkId: Map<string, string>,
  solutions: Chunk[],
): Chunk | null {
  const exoDoc = docByChunkId.get(exo.id)
  if (!exoDoc) return null
  for (const s of solutions) if (docByChunkId.get(s.id) === exoDoc) return s
  return null
}

/** Un modèle d'évaluation de repli (sans table `assessments`), dérivé des chunks. */
export interface EvaluationGroup {
  documentId: string
  /** Sujet (evaluation_exam) du document, s'il existe. */
  subject: Chunk | null
  /** Corrigé(s) (solution_only) du document. */
  corrections: Chunk[]
}

/**
 * Repli §5.2 pour l'onglet Évaluations quand la table `assessments` est vide :
 * agrège les chunks `evaluation_exam` (sujets) et `solution_only` (corrigés) de
 * TOUS les documents, groupés PAR DOCUMENT (vis-à-vis sujet/corrigé quand les deux
 * existent). Aucune donnée en dur — tout vient des chunks typés.
 */
export async function fetchEvaluationGroups(db: string, documentIds: string[]): Promise<EvaluationGroup[]> {
  const groups: EvaluationGroup[] = []
  for (const docId of documentIds) {
    const [exams, solutions] = await Promise.all([
      fetchAllChunks(db, docId, { pedagogical_type: 'evaluation_exam' }),
      fetchAllChunks(db, docId, { pedagogical_type: 'solution_only' }),
    ])
    if (exams.length === 0 && solutions.length === 0) continue
    // Un groupe par sujet ; si plusieurs sujets, chacun récupère les corrigés du document.
    if (exams.length > 0) {
      exams.forEach((subject, i) => {
        groups.push({ documentId: docId, subject, corrections: i === 0 ? solutions : [] })
      })
    } else {
      // Corrigés seuls (sujet absent) — restent lisibles.
      groups.push({ documentId: docId, subject: null, corrections: solutions })
    }
  }
  return groups
}

/**
 * Champ RELATIONNEL exercice→corrigé exposé par le backend sur le chunk
 * (`document_chunks.linked_solution_chunk_id`). Il n'est PAS encore dans le type
 * `Chunk` (schéma géré hors périmètre) ; on le lit défensivement : si le payload
 * ne le porte pas (état actuel du live), on renvoie null et les replis prennent
 * le relais (pedagogical_index / document). Aucun crash si le champ est absent.
 */
export function linkedSolutionId(chunk: Chunk): string | null {
  const v = (chunk as unknown as { linked_solution_chunk_id?: unknown }).linked_solution_chunk_id
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Corrigé lié à un exercice, par ordre de fiabilité DÉCROISSANTE :
 *  1. lien relationnel direct porté par le chunk (`linked_solution_chunk_id`, backend) ;
 *  2. lien explicite `course_exercise` (SolutionLinker) dans le graphe content_links ;
 *  3. repli `pedagogical_index` identique.
 * Chaque étape est défensive : un champ/lien absent passe simplement à la suivante.
 */
export function resolveSolutionFor(
  exo: Chunk,
  links: ContentLink[],
  solutionsByIndex: Map<number, Chunk>,
  solutionsById: Map<string, Chunk>,
): Chunk | null {
  // 1. Lien relationnel direct porté par le chunk (backend, le plus fiable).
  const direct = linkedSolutionId(exo)
  if (direct && solutionsById.has(direct)) return solutionsById.get(direct) ?? null
  // 2. Lien explicite exercice → solution (course_exercise du SolutionLinker).
  for (const l of links) {
    if (l.link_type !== 'course_exercise') continue
    if (l.from_id === exo.id && solutionsById.has(l.to_id)) return solutionsById.get(l.to_id) ?? null
    if (l.to_id === exo.id && solutionsById.has(l.from_id)) return solutionsById.get(l.from_id) ?? null
  }
  // 3. Repli : même pedagogical_index.
  if (exo.pedagogical_index != null) return solutionsByIndex.get(exo.pedagogical_index) ?? null
  return null
}

/**
 * Index INVERSE corrigé→exercice (navigation bidirectionnelle) construit à partir
 * de la même chaîne de fiabilité que `resolveSolutionFor`. Permet, depuis un chunk
 * `solution_only` affiché seul (onglet Cours / Scans / Évaluations de repli),
 * d'offrir un pont « → التمرين » vers l'énoncé lié. Toutes les sources sont
 * défensives : un champ/lien manquant est simplement ignoré.
 */
export function buildSolutionToExerciseIndex(
  exercises: Chunk[],
  links: ContentLink[],
): Map<string, string> {
  const solToExo = new Map<string, string>()
  const setOnce = (solId: string, exoId: string) => { if (!solToExo.has(solId)) solToExo.set(solId, exoId) }
  // 1. Champ relationnel direct sur l'exercice.
  for (const exo of exercises) {
    const direct = linkedSolutionId(exo)
    if (direct) setOnce(direct, exo.id)
  }
  // 2. Liens course_exercise (bidirectionnels) — on ne connaît le rôle exact qu'en
  //    croisant avec l'ensemble des ids d'exercices.
  const exoIds = new Set(exercises.map(e => e.id))
  for (const l of links) {
    if (l.link_type !== 'course_exercise') continue
    if (exoIds.has(l.from_id)) setOnce(l.to_id, l.from_id)
    else if (exoIds.has(l.to_id)) setOnce(l.from_id, l.to_id)
  }
  // 3. Repli pedagogical_index : côté appelant (ExercicesTab connaît solutionsByIndex).
  return solToExo
}

/**
 * Résolveur de terme (trimestre 1/2/3) d'un exercice.
 *
 * Écart assumé : `Chunk` ne porte pas `toc_id` ; on emprunte donc le graphe
 * `content_links`. Chaîne : exercice --course_exercise--> cours(toc_id)
 * --course_program--> programme --> `term_id` --> `term_index`. Toute rupture de
 * chaîne renvoie `null` (carte affichée sans badge trimestre, cf. brief).
 */
export function buildExerciseTermResolver(curriculum: CurriculumPayload): (exo: Chunk) => number | null {
  const links = curriculum.links ?? []
  const termIndexById = new Map<string, number>()
  for (const t of curriculum.terms ?? []) termIndexById.set(t.id, t.term_index)

  const programTermIndex = new Map<string, number>()
  for (const p of curriculum.programs ?? []) {
    if (p.term_id != null) {
      const ti = termIndexById.get(p.term_id)
      if (ti != null) programTermIndex.set(p.id, ti)
    }
  }

  // cours(toc_id) → term_index via les liens course_program.
  const courseTermIndex = new Map<string, number>()
  for (const l of links) {
    if (l.link_type !== 'course_program') continue
    const ti = programTermIndex.get(l.to_id) ?? programTermIndex.get(l.from_id)
    if (ti == null) continue
    // from_id = cours, to_id = programme (sens attendu) — on couvre les deux.
    if (programTermIndex.has(l.to_id)) courseTermIndex.set(l.from_id, ti)
    else courseTermIndex.set(l.to_id, ti)
  }

  return (exo: Chunk): number | null => {
    for (const l of links) {
      if (l.link_type !== 'course_exercise') continue
      const courseId = l.from_id === exo.id ? l.to_id : l.to_id === exo.id ? l.from_id : null
      if (!courseId) continue
      const ti = courseTermIndex.get(courseId)
      if (ti != null) return ti
    }
    return null
  }
}

/** Cours (toc_id) lié à un exercice, pour le pont « الدرس » (course_exercise). */
export function resolveCourseFor(exo: Chunk, links: ContentLink[]): string | null {
  for (const l of links) {
    if (l.link_type !== 'course_exercise') continue
    if (l.from_id === exo.id) return l.to_id
    if (l.to_id === exo.id) return l.from_id
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification pédagogique EFFECTIVE (correctif « des exercices dans l'onglet
// Cours ») — DÉGRADATION GRACIEUSE (leçon V3.11 : jamais de sur-filtrage).
//
// Sur les corpus réels, la majorité des chunks ont `pedagogical_type = NULL`
// (base live : 234/255). Certains sont en réalité des énoncés d'exercices/activités
// ou des corrigés noyés dans le flux « cours ». On NE SUPPRIME RIEN : on calcule
// un TYPE EFFECTIF pour poser le bon badge et proposer un pont vers l'onglet dédié,
// tout en laissant le contenu visible dans l'onglet Cours.
// ─────────────────────────────────────────────────────────────────────────────

/** Familles de marqueurs arabes d'exercices/activités/corrigés (in-texte, tolérant OCR). */
const EXERCISE_MARKERS = ['تمرين', 'تمارين', 'التمرين', 'نشاط', 'أنشطة', 'النشاط', 'تطبيق']
const SOLUTION_MARKERS = ['الحل', 'الحلول', 'التصحيح', 'حل التمرين', 'الإجابة النموذجية', 'عناصر الإجابة']
const EVAL_MARKERS = ['الفرض', 'الاختبار', 'الامتحان', 'التقويم', 'المراقبة المستمرة', 'الوضعية الإدماجية']

/** Cherche un marqueur uniquement dans l'AMORCE du markdown (titre/1re ligne),
 *  après avoir retiré le bruit markdown de tête (#, >, *, images) — évite les faux
 *  positifs d'un mot cité en plein corps de leçon. */
function headContainsMarker(markdown: string | null | undefined, markers: string[]): boolean {
  if (!markdown) return false
  // On isole l'amorce : première ligne non vide + un petit horizon de sécurité.
  const stripped = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')   // images markdown
    .replace(/[#>*_`~-]+/g, ' ')             // ponctuation markdown de tête
    .trim()
  const head = stripped.slice(0, 40)
  return markers.some(m => head.includes(m))
}

/**
 * Type EFFECTIF d'un chunk pour l'affichage dans l'onglet Cours :
 *  - priorité ABSOLUE au `pedagogical_type` explicite quand il existe ;
 *  - sinon, heuristique conservatrice sur l'amorce markdown (marqueurs arabes) ;
 *  - `null` (= درس / contenu de cours) par défaut → aucune reclassification abusive.
 *
 * Retourne aussi si le type a été DÉDUIT (heuristique) vs déclaré (API), pour
 * nuancer le badge (« تمرين؟ » déduit vs « تمرين » déclaré) sans jamais masquer.
 */
export interface EffectiveType {
  type: PedagogicalType | null
  inferred: boolean
}

export function effectivePedagogicalType(chunk: Chunk): EffectiveType {
  if (chunk.pedagogical_type) return { type: chunk.pedagogical_type, inferred: false }
  const md = chunk.content_markdown
  // Ordre : évaluation > solution > exercice (les corrigés citent souvent « تمرين »).
  if (headContainsMarker(md, EVAL_MARKERS)) return { type: 'evaluation_exam', inferred: true }
  if (headContainsMarker(md, SOLUTION_MARKERS)) return { type: 'solution_only', inferred: true }
  if (headContainsMarker(md, EXERCISE_MARKERS)) return { type: 'exercise_unsolved', inferred: true }
  return { type: null, inferred: false }
}

/** Types « hors cours » : appartiennent en propre aux onglets Exercices/Évaluations. */
const NON_COURSE_TYPES: ReadonlySet<PedagogicalType> = new Set<PedagogicalType>([
  'exercise_unsolved', 'exercise_solved', 'solution_only', 'evaluation_exam',
])

/** Vrai si le type effectif relève d'un autre onglet (→ pont proposé, jamais masqué). */
export function isNonCourseType(type: PedagogicalType | null): boolean {
  return type != null && NON_COURSE_TYPES.has(type)
}
