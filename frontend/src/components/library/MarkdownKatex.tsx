import { useEffect, useMemo, useRef, useState } from 'react'
import {
  renderMarkdownWithKaTeX, splitMarkdownOnArtifactAnchors, hasArtifactAnchors,
  type RenderOptions,
} from '@/lib/markdownKatex'
import type { Artifact } from '@/types'
import ArtifactRenderer from '@/components/library/ArtifactRenderer'

interface Props {
  /** Markdown brut (avec LaTeX $…$/$$…$$, rubriques 2G et ancres asset://). */
  raw: string
  /** Rendu paresseux via IntersectionObserver (placeholder avant visibilité). */
  lazy?: boolean
  /** Saut vers le scan d'une page (déclenché par clic sur un élément [data-page]). */
  onPageJump?: (page: number) => void
  /** Résolution des `asset://figures/…` (URL binaire de la base active). */
  resolveAsset?: RenderOptions['resolveAsset']
  /**
   * Résout `asset://artifacts/{id}` → métadonnées de l'artefact (cache par page).
   * Si fourni ET que le markdown contient des ancres artefact, le rendu bascule
   * en mode « segments texte + <ArtifactRenderer> intercalés » (rendu fidèle).
   */
  artifactResolver?: (id: string) => Artifact | undefined
  /** URL binaire d'un artefact (repli image / comparateur). */
  artifactBinaryUrl?: (id: string) => string
  /** Agrandissement (clic sur un artefact rendu) — remonté au parent (ImageModal). */
  onEnlarge?: (src: string, title: string) => void
  className?: string
}

/**
 * Rendu Markdown + KaTeX (moteur monopasse §5.2.6).
 *
 * Deux chemins :
 *  1. Chemin HTML monobloc (défaut) : renderMarkdownWithKaTeX → dangerouslySetInnerHTML.
 *     Les `asset://figures/…` (et le repli `asset://artifacts/{id}`) y sont résolus en <img>.
 *  2. Chemin « intercalé » : quand `artifactResolver` est fourni ET que le markdown
 *     contient des ancres `asset://artifacts/{id}`, on découpe le brut sur ces ancres
 *     et on intercale un <ArtifactRenderer> React par ancre (rendu natif + comparateur),
 *     les segments texte restant rendus par le pipeline HTML.
 */
export default function MarkdownKatex({
  raw, lazy = false, onPageJump, resolveAsset, artifactResolver, artifactBinaryUrl, onEnlarge, className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(!lazy)

  // Mode intercalé actif uniquement si un résolveur d'artefacts est fourni ET
  // que le markdown porte réellement des ancres artefact.
  const interleaved = useMemo(
    () => !!artifactResolver && hasArtifactAnchors(raw),
    [artifactResolver, raw],
  )

  // Chemin 1 — HTML monobloc mémoïsé.
  const html = useMemo(
    () => (interleaved ? '' : renderMarkdownWithKaTeX(raw, resolveAsset ? { resolveAsset } : undefined)),
    [raw, resolveAsset, interleaved],
  )

  // Chemin 2 — segments (texte / artefact) mémoïsés.
  const segments = useMemo(
    () => (interleaved ? splitMarkdownOnArtifactAnchors(raw) : []),
    [raw, interleaved],
  )

  // Rendu paresseux : n'injecte le contenu qu'une fois la carte visible.
  useEffect(() => {
    if (!lazy || visible) return
    const el = containerRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const obs = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [lazy, visible])

  // Délégation de clic : tout descendant portant data-page déclenche onPageJump.
  useEffect(() => {
    if (!visible) return
    const el = containerRef.current
    if (!el || !onPageJump) return
    const handler = (ev: MouseEvent) => {
      const target = (ev.target as HTMLElement | null)?.closest('[data-page]') as HTMLElement | null
      if (!target) return
      const page = Number(target.getAttribute('data-page'))
      if (Number.isFinite(page) && page > 0) {
        ev.preventDefault()
        onPageJump(page)
      }
    }
    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  }, [visible, onPageJump, html, interleaved])

  if (lazy && !visible) {
    return <div ref={containerRef} className={className} style={{ minHeight: 120 }} aria-busy="true" />
  }

  // Chemin intercalé : segments texte (HTML) + <ArtifactRenderer> par ancre.
  if (interleaved) {
    return (
      <div ref={containerRef} className={className}>
        {segments.map((seg, i) => {
          if (seg.kind === 'markdown') {
            if (!seg.text.trim()) return null
            return (
              <div
                key={`md-${i}`}
                className="rendered-html-container"
                dangerouslySetInnerHTML={{ __html: renderMarkdownWithKaTeX(seg.text, resolveAsset ? { resolveAsset } : undefined) }}
              />
            )
          }
          const art = artifactResolver?.(seg.id)
          if (!art) {
            // Métadonnées absentes : repli image binaire par id, sinon rien.
            const url = artifactBinaryUrl?.(seg.id)
            if (!url) return null
            return (
              <div key={`art-${i}`} className="svg-figure-wrapper" style={{ margin: '12px 0' }}>
                <img
                  src={url}
                  alt={seg.caption}
                  loading="lazy"
                  onClick={onEnlarge ? () => onEnlarge(url, seg.caption) : undefined}
                  style={{ maxWidth: '100%', borderRadius: 8, display: 'block', margin: '0 auto', cursor: onEnlarge ? 'zoom-in' : 'default' }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
                {seg.caption && <div style={{ textAlign: 'center' }}><small>🖼️ {seg.caption}</small></div>}
              </div>
            )
          }
          // Caption de l'ancre prioritaire sur celle stockée si présente.
          const artForRender: Artifact = seg.caption ? { ...art, caption: art.caption ?? seg.caption } : art
          return (
            <div key={`art-${i}`} style={{ margin: '14px 0' }}>
              <ArtifactRenderer
                artifact={artForRender}
                fallbackImageUrl={art.has_binary && artifactBinaryUrl ? artifactBinaryUrl(seg.id) : undefined}
                onEnlarge={onEnlarge}
              />
              {seg.caption && (
                <div dir="auto" style={{ marginTop: 6, fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  {seg.caption}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`rendered-html-container${className ? ' ' + className : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
