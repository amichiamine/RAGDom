import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

type Density = 'comfortable' | 'compact'

interface DensityContextValue { density: Density; toggleDensity: () => void; setDensity: (d: Density) => void; }

const DensityContext = createContext<DensityContextValue | null>(null)

const STORAGE_KEY = 'ragdom_density'

/**
 * Densité d'affichage (Frontend_UI_Specs §8.2) : bascule confort/compact persistée
 * dans localStorage['ragdom_density'] et appliquée dès le chargement en posant la
 * classe `density-compact` sur le conteneur racine (<html>), à l'image de ThemeProvider.
 * En compact, index.css réduit paddings et tailles (~30%) pour le travail de masse.
 */
export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensity] = useState<Density>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable' } catch { return 'comfortable' }
  })

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('density-compact', density === 'compact')
    try { localStorage.setItem(STORAGE_KEY, density) } catch { /* stockage indisponible */ }
  }, [density])

  const toggleDensity = () => setDensity(d => (d === 'compact' ? 'comfortable' : 'compact'))

  return <DensityContext.Provider value={{ density, toggleDensity, setDensity }}>{children}</DensityContext.Provider>
}

export function useDensity() {
  const ctx = useContext(DensityContext)
  if (!ctx) throw new Error('useDensity must be used inside DensityProvider')
  return ctx
}
