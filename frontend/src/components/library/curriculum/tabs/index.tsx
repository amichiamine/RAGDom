import type { ReactNode } from 'react'
import type { CurriculumPayload, PageScanManifestEntry } from '@/types'
import { useCurriculumDoc } from './useCurriculumDoc'
import MatrixTab from './MatrixTab'
import ProgrammeTab from './ProgrammeTab'
import CoursTab from './CoursTab'
import ExercicesTab from './ExercicesTab'
import EvaluationsTab from './EvaluationsTab'
import ScansTab from './ScansTab'

interface ConnectorProps {
  curriculum: CurriculumPayload
  activeDb: string
}

/** Cadre de chargement/erreur sobre partagé par les 3 connecteurs. */
function TabFrame({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (loading) {
    return (
      <div className="content-box" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }} dir="rtl">
        … جارٍ تحميل بنية المنهاج
      </div>
    )
  }
  if (error) {
    return (
      <div className="content-box" style={{ textAlign: 'center', color: 'var(--danger)', padding: 40 }} dir="rtl">
        تعذّر تحميل الوثيقة : {error}
      </div>
    )
  }
  return <>{children}</>
}

/**
 * Connecteurs des onglets 1-3 (Vague B) : chargent le documentId + TOC de la base
 * active via `useCurriculumDoc` (cache partagé) puis rendent l'onglet avec ses
 * props normatives {curriculum, toc, documentId, activeDb}.
 */
export function MatrixTabConnector({ curriculum, activeDb }: ConnectorProps) {
  const { documentId, toc, loading, error } = useCurriculumDoc(activeDb)
  return (
    <TabFrame loading={loading} error={error}>
      <MatrixTab curriculum={curriculum} toc={toc} documentId={documentId} activeDb={activeDb} />
    </TabFrame>
  )
}

export function ProgrammeTabConnector({ curriculum, activeDb }: ConnectorProps) {
  const { documentId, toc, loading, error } = useCurriculumDoc(activeDb)
  return (
    <TabFrame loading={loading} error={error}>
      <ProgrammeTab curriculum={curriculum} toc={toc} documentId={documentId} activeDb={activeDb} />
    </TabFrame>
  )
}

export function CoursTabConnector({ curriculum, activeDb }: ConnectorProps) {
  const { documentId, toc, documents, loading, error } = useCurriculumDoc(activeDb)
  return (
    <TabFrame loading={loading} error={error}>
      <CoursTab curriculum={curriculum} toc={toc} documentId={documentId} documents={documents} activeDb={activeDb} />
    </TabFrame>
  )
}

// ── Connecteurs des onglets 4-6 (Vague C) : mêmes conventions, props {curriculum, documentId, activeDb}. ──

export function ExercicesTabConnector({ curriculum, activeDb }: ConnectorProps) {
  const { documentId, documents, loading, error } = useCurriculumDoc(activeDb)
  return (
    <TabFrame loading={loading} error={error}>
      <ExercicesTab curriculum={curriculum} documentId={documentId ?? ''} documents={documents} activeDb={activeDb} />
    </TabFrame>
  )
}

export function EvaluationsTabConnector({ curriculum, activeDb }: ConnectorProps) {
  const { documentId, documents, loading, error } = useCurriculumDoc(activeDb)
  return (
    <TabFrame loading={loading} error={error}>
      <EvaluationsTab curriculum={curriculum} documentId={documentId ?? ''} documents={documents} activeDb={activeDb} />
    </TabFrame>
  )
}

/** Scans : le manifeste vient du parent (déjà chargé pour le Page Jumper). */
export function ScansTabConnector({ curriculum, activeDb, manifest }: ConnectorProps & { manifest: PageScanManifestEntry[] }) {
  const { documentId, loading, error } = useCurriculumDoc(activeDb)
  return (
    <TabFrame loading={loading} error={error}>
      <ScansTab curriculum={curriculum} documentId={documentId ?? ''} activeDb={activeDb} manifest={manifest} />
    </TabFrame>
  )
}
