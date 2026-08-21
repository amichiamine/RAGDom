import { useEffect, useMemo, useRef, useState } from 'react'
import { renderMarkdownWithKaTeX, type RenderOptions } from '@/lib/markdownKatex'

interface Props {
  /** Markdown brut (avec LaTeX $…$/$$…$$ et rubriques 2G). */
  raw: string
  /** Rendu paresseux via IntersectionObserver (placeholder avant visibilité). */
  lazy?: boolean
  /** Saut vers le scan d'une page (déclenché par clic sur un élément [data-page]). */
  onPageJump?: (page: number) => void
  /** Résolution des `asset://figures/…` (URL binaire de la base active). */
  resolveAsset?: RenderOptions['resolveAsset']
  className?: string
}

/**
 * Rendu Markdown + KaTeX (moteur monopasse §5.2.6) pour la Vue 2 pixel-perfect.
 * Mémoïse le HTML sanitisé, délègue les clics sur [data-page] vers `onPageJump`,
 * et supporte un rendu paresseux (placeholder à hauteur minimale avant visibilité).
 */
export default function MarkdownKatex({ raw, lazy = false, onPageJump, resolveAsset, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(!lazy)

  // HTML sanitisé mémoïsé (recalcul uniquement si le brut ou le résolveur change).
  const html = useMemo(
    () => renderMarkdownWithKaTeX(raw, resolveAsset ? { resolveAsset } : undefined),
    [raw, resolveAsset],
  )

  // Rendu paresseux : n'injecte le HTML qu'une fois la carte visible.
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
  }, [visible, onPageJump, html])

  if (lazy && !visible) {
    return <div ref={containerRef} className={className} style={{ minHeight: 120 }} aria-busy="true" />
  }

  return (
    <div
      ref={containerRef}
      className={`rendered-html-container${className ? ' ' + className : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
