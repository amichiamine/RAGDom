import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from '@/lib/api'
import type { EngineManifest } from '@/types'

interface EngineContextValue {
  engines: EngineManifest[]
  activeEngine: EngineManifest | null
  accent: string
}

const EngineContext = createContext<EngineContextValue | null>(null)

/**
 * PARTIE 8.4 — identité multi-moteurs. Charge GET /system/engines, applique
 * --engine-accent au :root pour que logo, hero et step-pills actives se re-thèment.
 */
export function EngineProvider({ children }: { children: ReactNode }) {
  const [engines, setEngines] = useState<EngineManifest[]>([])
  const [activeEngine, setActiveEngine] = useState<EngineManifest | null>(null)

  useEffect(() => {
    let cancelled = false
    api.system.getEngines()
      .then(res => {
        if (cancelled) return
        setEngines(res.engines)
        const active = res.engines.find(e => e.id === res.active_engine) ?? res.engines.find(e => e.status === 'active') ?? null
        setActiveEngine(active)
        if (active?.accent) {
          document.documentElement.style.setProperty('--engine-accent', active.accent)
        }
      })
      .catch(() => { /* backend V3.4 optionnel — accent par défaut conservé */ })
    return () => { cancelled = true }
  }, [])

  const accent = activeEngine?.accent ?? '#2563eb'

  return (
    <EngineContext.Provider value={{ engines, activeEngine, accent }}>
      {children}
    </EngineContext.Provider>
  )
}

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext)
  if (!ctx) throw new Error('useEngine must be used inside EngineProvider')
  return ctx
}
