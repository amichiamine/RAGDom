import { api } from '@/lib/api'
import type { Chunk, ContentLink, CurriculumPayload } from '@/types'

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
export async function fetchExerciseBank(db: string, documentId: string): Promise<{
  exercises: Chunk[]
  solutionsByIndex: Map<number, Chunk>
  solutionsById: Map<string, Chunk>
}> {
  const [solved, unsolved, solutions] = await Promise.all([
    fetchAllChunks(db, documentId, { pedagogical_type: 'exercise_solved' }),
    fetchAllChunks(db, documentId, { pedagogical_type: 'exercise_unsolved' }),
    fetchAllChunks(db, documentId, { pedagogical_type: 'solution_only' }),
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
  return { exercises, solutionsByIndex, solutionsById }
}

/** Corrigé lié à un exercice : par lien `course_exercise` si possible, sinon par `pedagogical_index`. */
export function resolveSolutionFor(
  exo: Chunk,
  links: ContentLink[],
  solutionsByIndex: Map<number, Chunk>,
  solutionsById: Map<string, Chunk>,
): Chunk | null {
  // Priorité : lien explicite exercice → solution (course_exercise du SolutionLinker).
  for (const l of links) {
    if (l.link_type !== 'course_exercise') continue
    if (l.from_id === exo.id && solutionsById.has(l.to_id)) return solutionsById.get(l.to_id) ?? null
    if (l.to_id === exo.id && solutionsById.has(l.from_id)) return solutionsById.get(l.from_id) ?? null
  }
  // Repli : même pedagogical_index.
  if (exo.pedagogical_index != null) return solutionsByIndex.get(exo.pedagogical_index) ?? null
  return null
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
