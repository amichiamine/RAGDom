import { useEffect, useRef, useState } from 'react'
import { Atom } from 'lucide-react'
import type { CurriculumPayload } from '@/types'
import { renderMarkdownWithKaTeX, type RenderOptions } from '@/lib/markdownKatex'

/**
 * SplashScreen télémétrique (Lot 10 · §5.2.1) — overlay plein écran affiché au
 * premier montage d'une base curriculum. Pré-rend le Markdown+KaTeX de tous les
 * items par tranches de 35 via requestAnimationFrame (pipeline asynchrone du
 * template library.php l.883-919, 2277-2343) et remplit un cache mémoïsé
 * consommable par les onglets de la Vue 2 (getPrerenderCache()).
 *
 * Valeurs visuelles EXACTES portées du template (l.417-475) : voir la section
 * « Vague D » de index.css (#splash-screen, .splash-*).
 */

// ── Cache de pré-rendu partagé (raw → HTML sanitisé) ────────────────────────
const _prerenderCache = new Map<string, string>()

/** Cache exporté : les onglets réutilisent le HTML pré-rendu par le splash. */
export function getPrerenderCache(): Map<string, string> {
  return _prerenderCache
}

/** Vide le cache (changement de base) — évite d'exposer du HTML d'une autre base. */
export function clearPrerenderCache(): void {
  _prerenderCache.clear()
}

const CHUNK_SIZE = 35

interface Props {
  curriculum: CurriculumPayload
  /** Markdowns bruts à pré-rendre (contenus des chunks/évaluations de la base). */
  itemsToPreload: string[]
  /** Résolution optionnelle des `asset://figures/…` (base active). */
  resolveAsset?: RenderOptions['resolveAsset']
  onDone: () => void
}

function statusMessage(progress: number, index: number, total: number): string {
  if (progress < 25) return '📋 جاري تهيئة المنهاج والتدرج السنوي الرسمي...'
  if (progress < 50) return '📘 جاري تجميع الدروس والمخططات الهندسية...'
  if (progress < 85) return `📝 جاري معالجة وفهرسة التمارين والحلول (${index} / ${total})...`
  if (progress < 100) return '📑 جاري مطابقة الفروض والامتحانات الرسمية وسلالم التنقيط...'
  return '✅ اكتملت التهيئة بنجاح! جاري فتح المستودع...'
}

export default function SplashScreen({ curriculum, itemsToPreload, resolveAsset, onDone }: Props) {
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState(() => statusMessage(0, 0, itemsToPreload.length))
  const [leaving, setLeaving] = useState(false)

  const rafRef = useRef<number | null>(null)
  const doneRef = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const total = itemsToPreload.length
    const opts: RenderOptions | undefined = resolveAsset ? { resolveAsset } : undefined

    const beginExit = () => {
      if (doneRef.current) return
      doneRef.current = true
      // Fondu de sortie : opacity 0 (0.6s) puis démontage — 300ms d'attente + 600ms de transition.
      window.setTimeout(() => {
        setLeaving(true)
        window.setTimeout(() => onDoneRef.current(), 600)
      }, 300)
    }

    if (total === 0) {
      setProgress(100)
      setStatus(statusMessage(100, 0, 0))
      beginExit()
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    }

    let index = 0
    const step = () => {
      const limit = Math.min(index + CHUNK_SIZE, total)
      for (; index < limit; index++) {
        const raw = itemsToPreload[index] ?? ''
        if (raw && !_prerenderCache.has(raw)) {
          _prerenderCache.set(raw, renderMarkdownWithKaTeX(raw, opts))
        }
      }

      const pct = Math.min(100, Math.round((index / total) * 100))
      setProgress(pct)
      setStatus(statusMessage(pct, index, total))

      if (index < total) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        beginExit()
      }
    }

    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [itemsToPreload, resolveAsset])

  const g = curriculum.aggregates?.global
  const badges: { label: string; className: string }[] = g
    ? [
        { label: `${g.programs} مقاطع`, className: 'splash-badge-success' },
        { label: `${g.courses} دروس`, className: 'splash-badge-success' },
        { label: `${g.exercises} تمرين`, className: 'splash-badge-success' },
        { label: `${g.assessments} اختبار`, className: 'splash-badge-success' },
        { label: `${g.page_scans} صفحة كتاب`, className: 'splash-badge-warning' },
        { label: `${g.chapters} فصل`, className: 'splash-badge-info' },
      ]
    : []

  return (
    <div id="splash-screen" className={leaving ? 'splash-leaving' : undefined} role="status" aria-live="polite">
      <div className="splash-card">
        <div className="splash-icon">
          <Atom className="splash-atom" size={56} strokeWidth={1.6} />
        </div>
        <h3 className="splash-title">RAGDom Library</h3>
        <p className="splash-subtitle" dir="auto">
          المستودع الوطني الرقمي —{' '}
          <strong className="splash-accent-warning">قاعدة معتمدة</strong>
        </p>

        <div className="splash-progress-track">
          <div className="splash-progress-bar" style={{ width: `${progress}%` }} />
        </div>

        <div className="splash-status-row">
          <small className="splash-status-text" dir="auto">{status}</small>
          <span className="splash-percent font-num">{progress}%</span>
        </div>

        {badges.length > 0 && (
          <div className="splash-badges">
            {badges.map((b, i) => (
              <span key={i} className={`splash-badge ${b.className}`} dir="auto">{b.label}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
