import { useEffect, useState } from 'react'
import type { Document, TocNode } from '@/types'
import { api } from '@/lib/api'

/** Document actif d'une base + son TOC + TOUS les documents (chargés une fois par base). */
export interface CurriculumDoc {
  documentId: string | null
  toc: TocNode[]
  /** Tous les documents de la base — indispensable au repli « document = unité de
   *  lecture » (base examens : plusieurs docs, aucun TOC niveau 1) et à l'agrégation
   *  des chunks typés (exercices/évaluations) répartis sur PLUSIEURS documents. */
  documents: Document[]
  loading: boolean
  error: string | null
}

/**
 * Cache module-level (par base) : les onglets montent/démontent à chaque
 * commutation ; on évite ainsi de re-fetcher documents + TOC à chaque fois.
 * Le premier document de la base sert de source des chapitres TOC.
 */
const cache = new Map<string, Promise<{ documentId: string | null; toc: TocNode[]; documents: Document[] }>>()

async function loadDoc(db: string): Promise<{ documentId: string | null; toc: TocNode[]; documents: Document[] }> {
  const docs = await api.library.getDocuments(db, 1, 200)
  const documents = docs.data ?? []
  const first = documents[0]
  if (!first) return { documentId: null, toc: [], documents }
  const tocRes = await api.library.getToc(db, first.id).catch(() => ({ toc: [] as TocNode[] }))
  return { documentId: first.id, toc: tocRes.toc ?? [], documents }
}

/**
 * Hook partagé par MatrixTab / ProgrammeTab / CoursTab : renvoie le documentId
 * et le TOC de la base active, avec gestion loading/erreur sobre.
 */
export function useCurriculumDoc(db: string): CurriculumDoc {
  const [state, setState] = useState<CurriculumDoc>({ documentId: null, toc: [], documents: [], loading: true, error: null })

  useEffect(() => {
    let alive = true
    setState(s => ({ ...s, loading: true, error: null }))
    let p = cache.get(db)
    if (!p) {
      p = loadDoc(db)
      cache.set(db, p)
    }
    p.then(res => { if (alive) setState({ ...res, loading: false, error: null }) })
      .catch(err => {
        cache.delete(db) // permet un nouveau essai au prochain montage
        if (alive) setState({ documentId: null, toc: [], documents: [], loading: false, error: err instanceof Error ? err.message : 'خطأ في تحميل الوثيقة' })
      })
    return () => { alive = false }
  }, [db])

  return state
}
