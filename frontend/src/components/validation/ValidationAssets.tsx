import { useEffect, useState } from 'react'
import ArtifactRenderer from '@/components/library/ArtifactRenderer'
import { api } from '@/lib/api'
import type { Artifact } from '@/types'

type Version = 'baseline' | 'working'

interface Coordinates {
  runId: string
  db: string
  documentId: string
  pageNumber: number
  version: Version
}

function useValidationAsset(loader: () => Promise<Blob>, dependencies: readonly unknown[], enabled = true) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setUrl(null)
    setFailed(false)
    if (!enabled) return () => { active = false }
    loader()
      .then(blob => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => { if (active) setFailed(true) })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // The caller supplies primitive request coordinates as dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)

  return { url, failed }
}

export function ValidationScan({ runId, db, documentId, pageNumber, version, alt }: Coordinates & { alt: string }) {
  const { url, failed } = useValidationAsset(
    () => api.validation.getPageScan(runId, pageNumber, db, documentId, version),
    [runId, db, documentId, pageNumber, version],
  )
  if (failed) return null
  if (!url) return <div className="validation-asset-loading" aria-busy="true" />
  return <img className="validation-scan" src={url} alt={alt} loading="lazy" />
}

export function ValidationArtifact({ artifact, runId, db, documentId, pageNumber, version }: Coordinates & { artifact: Artifact }) {
  const { url } = useValidationAsset(
    () => api.validation.getArtifactBinary(runId, pageNumber, artifact.id, db, documentId, version),
    [runId, db, documentId, pageNumber, artifact.id, version, artifact.has_binary],
    Boolean(artifact.has_binary),
  )
  return <ArtifactRenderer artifact={artifact} fallbackImageUrl={artifact.has_binary ? url ?? undefined : undefined} />
}
