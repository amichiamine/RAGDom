import { useMemo } from 'react'
import { renderMarkdownWithKaTeX, type RenderOptions } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useDatabase } from '@/contexts/DatabaseContext'

interface Props {
  source: string
  className?: string
  /**
   * Résout `asset://figures/…` et `asset://artifacts/{id}` → URL binaire (F6).
   * Optionnel : par défaut, MarkdownContent résout via la base ACTIVE
   * (DatabaseContext) → `/library/artifact-binary`. Fournir un resolver explicite
   * pour cibler une autre base ; passer `null` n'est pas nécessaire (l'absence
   * d'ancre `asset://` laisse le rendu inchangé).
   */
  resolveAsset?: RenderOptions['resolveAsset']
}

/** Rendu Markdown + KaTeX (moteur monopasse §5.2.6) avec isolation BiDi (.content-box → unicode-bidi:plaintext). */
export default function MarkdownContent({ source, className, resolveAsset }: Props) {
  const { activeDb } = useDatabase()

  // Résolveur par défaut basé sur la base active : figures et artefacts partagent
  // l'endpoint /library/artifact-binary (le backend accepte le nom OU l'id).
  const effectiveResolver = useMemo<RenderOptions['resolveAsset'] | undefined>(() => {
    if (resolveAsset) return resolveAsset
    if (!activeDb) return undefined
    return (assetRef: string) => api.library.getArtifactBinaryUrl(activeDb, assetRef)
  }, [resolveAsset, activeDb])

  const html = useMemo(
    () => renderMarkdownWithKaTeX(source, effectiveResolver ? { resolveAsset: effectiveResolver } : undefined),
    [source, effectiveResolver],
  )
  return (
    <div
      className={cn('rendered-html-container', className)}
      dir="auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
