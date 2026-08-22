import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from '@/lib/api'
import type { DatabaseInfo } from '@/types'

interface DatabaseContextValue {
  databases: DatabaseInfo[];
  activeDb: string | null;
  setActiveDb: (db: string) => void;
  isLoading: boolean;
  refresh: () => void;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null)

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [databases, setDatabases] = useState<DatabaseInfo[]>([])
  const [activeDb, setActiveDb] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = async () => {
    setIsLoading(true)
    try {
      const res = await api.system.getDatabases()
      setDatabases(res.databases)
      setActiveDb(current => {
        if (current && res.databases.some(database => database.filename === current)) return current
        return res.databases[0]?.filename ?? null
      })
    } catch (e) { console.error('[DatabaseContext] Erreur:', e) }
    finally { setIsLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  return (
    <DatabaseContext.Provider value={{ databases, activeDb, setActiveDb, isLoading, refresh }}>
      {children}
    </DatabaseContext.Provider>
  )
}

export function useDatabase(): DatabaseContextValue {
  const ctx = useContext(DatabaseContext)
  if (!ctx) throw new Error('useDatabase must be used inside DatabaseProvider')
  return ctx
}
