import { useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, LayoutDashboard, BookOpen, Cog, SunMoon, Database, LayoutGrid } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useDatabase } from '@/contexts/DatabaseContext'

/** Onglets curriculum (miroir de TabKey — évité l'import du contexte pour rester tolérant). */
type CurriculumTab = 'matrix' | 'programme' | 'cours' | 'exercices' | 'evaluations' | 'scans'

/** Pont curriculum optionnel : fourni si la palette est montée dans le workspace. */
export interface CommandPaletteBridge {
  switchTab: (tab: CurriculumTab) => void
}

interface CommandItem {
  id: string
  label: string
  category: string
  icon: ReactNode
  keywords?: string
  run: () => void
}

interface Props {
  /** Pont curriculum optionnel — active la bascule des 6 onglets. */
  bridge?: CommandPaletteBridge
}

/** Normalise (minuscule + suppression des accents/diacritiques) pour un fuzzy tolérant. */
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

const CURRICULUM_TABS: { tab: CurriculumTab; label: string }[] = [
  { tab: 'matrix', label: 'Matrice 360°' },
  { tab: 'programme', label: 'Programme' },
  { tab: 'cours', label: 'Cours' },
  { tab: 'exercices', label: 'Exercices' },
  { tab: 'evaluations', label: 'Évaluations' },
  { tab: 'scans', label: 'Scans' },
]

/** PARTIE 8 · Command Palette (Ctrl/Cmd+K) — omnibox 100% clavier, fuzzy match. */
export default function CommandPalette({ bridge }: Props) {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const { databases, setActiveDb } = useDatabase()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Raccourci global Ctrl/Cmd+K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Reset + focus à l'ouverture.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const close = () => setOpen(false)

  const items = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      { id: 'nav-dashboard', label: 'Aller au Tableau de bord', category: 'Navigation', icon: <LayoutDashboard size={16} />, keywords: 'dashboard accueil index portail', run: () => { navigate('/'); close() } },
      { id: 'nav-library', label: 'Aller à la Bibliothèque', category: 'Navigation', icon: <BookOpen size={16} />, keywords: 'library vue2 curriculum', run: () => { navigate('/library'); close() } },
      { id: 'nav-automation', label: 'Aller au Hub d’automatisation', category: 'Navigation', icon: <Cog size={16} />, keywords: 'automation pipeline vue3 admin', run: () => { navigate('/automation'); close() } },
      { id: 'theme-toggle', label: `Basculer le thème (${theme === 'dark' ? 'clair' : 'sombre'})`, category: 'Apparence', icon: <SunMoon size={16} />, keywords: 'thème dark light dark mode', run: () => { toggleTheme(); close() } },
    ]

    for (const d of databases) {
      list.push({
        id: `db-${d.filename}`,
        label: `Base active : ${d.filename}`,
        category: 'Bases de données',
        icon: <Database size={16} />,
        keywords: `db base ${d.filename}`,
        run: () => { setActiveDb(d.filename); close() },
      })
    }

    if (bridge) {
      for (const ct of CURRICULUM_TABS) {
        list.push({
          id: `tab-${ct.tab}`,
          label: `Onglet curriculum : ${ct.label}`,
          category: 'Curriculum',
          icon: <LayoutGrid size={16} />,
          keywords: `onglet tab ${ct.tab} ${ct.label}`,
          run: () => { bridge.switchTab(ct.tab); close() },
        })
      }
    }

    return list
  }, [navigate, theme, toggleTheme, databases, setActiveDb, bridge])

  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return items
    return items.filter(it => {
      const hay = normalize(`${it.label} ${it.category} ${it.keywords ?? ''}`)
      return q.split(/\s+/).every(tok => hay.includes(tok))
    })
  }, [items, query])

  // Garde l'index actif dans les bornes.
  useEffect(() => { setActiveIndex(i => Math.min(i, Math.max(0, filtered.length - 1))) }, [filtered.length])

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(filtered.length - 1, i + 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(0, i - 1)); return }
    if (e.key === 'Enter') { e.preventDefault(); filtered[activeIndex]?.run(); return }
  }

  if (!open) return null

  // Groupement par catégorie (ordre d'apparition) — index global conservé pour la sélection.
  let runningIndex = -1
  const categories: { name: string; entries: { item: CommandItem; index: number }[] }[] = []
  for (const item of filtered) {
    runningIndex++
    const idx = runningIndex
    let cat = categories.find(c => c.name === item.category)
    if (!cat) { cat = { name: item.category, entries: [] }; categories.push(cat) }
    cat.entries.push({ item, index: idx })
  }

  return (
    <div className="cmd-overlay" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="cmd-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmd-input-row">
          <Search size={18} className="cmd-input-icon" />
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Rechercher une action, une base, un onglet…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="recherche de commande"
          />
          <kbd className="cmd-kbd">Esc</kbd>
        </div>

        <div className="cmd-results" role="listbox">
          {filtered.length === 0 ? (
            <div className="cmd-empty">Aucun résultat</div>
          ) : (
            categories.map(cat => (
              <div key={cat.name} className="cmd-group">
                <div className="cmd-group-title">{cat.name}</div>
                {cat.entries.map(({ item, index }) => (
                  <button
                    key={item.id}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`cmd-item ${index === activeIndex ? 'is-active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => item.run()}
                  >
                    <span className="cmd-item-icon">{item.icon}</span>
                    <span className="cmd-item-label">{item.label}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
