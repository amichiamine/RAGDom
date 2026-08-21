import { useEffect, useState } from 'react'
import type { TocNode } from '@/types'
import { api } from '@/lib/api'

/** Document actif d'une base + son TOC (chargés une seule fois par base). */
export interface CurriculumDoc {
  documentId: string | null
  toc: TocNode[]
  loading: boolean
  error: string | null
}

/**
 * Cache module-level (par base) : les 3 onglets de la Vague B montent/démontent
 * à chaque commutation ; on évite ainsi de re-fetcher le document + TOC à chaque
 * fois. Le premier document de la base sert de source des chapitres.
 */
const cache = new Map<string, Promise<{ documentId: string | null; toc: TocNode[] }>>()

async function loadDoc(db: string): Promise<{ documentId: string | null; toc: TocNode[] }> {
  const docs = await api.library.getDocuments(db, 1, 1)
  const first = docs.data?.[0]
  if (!first) return { documentId: null, toc: [] }
  const tocRes = await api.library.getToc(db, first.id).catch(() => ({ toc: [] as TocNode[] }))
  return { documentId: first.id, toc: tocRes.toc ?? [] }
}

/**
 * Hook partagé par MatrixTab / ProgrammeTab / CoursTab : renvoie le documentId
 * et le TOC de la base active, avec gestion loading/erreur sobre.
 */
export function useCurriculumDoc(db: string): CurriculumDoc {
  const [state, setState] = useState<CurriculumDoc>({ documentId: null, toc: [], loading: true, error: null })

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
        if (alive) setState({ documentId: null, toc: [], loading: false, error: err instanceof Error ? err.message : 'خطأ في تحميل الوثيقة' })
      })
    return () => { alive = false }
  }, [db])

  return state
}
