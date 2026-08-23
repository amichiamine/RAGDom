import type { PipelineSSEEvent, PipelineStatus } from '@/types'

// ── Suivi monitoring (SSE) — helpers purs et testables (§ Automaton Hub) ─────────
// Le flux SSE est GLOBAL (toutes bases, tous batchs). Ces helpers servent à :
//  1. corréler un événement à un batch (ne pas compter des batchs étrangers) ;
//  2. dédupliquer les pages « terminées » (une page READY puis INDEXED compte une fois) ;
//  3. mapper l'état de la connexion EventSource → connecté / reconnexion / déconnecté.

/** États de connexion affichables de l'onglet Suivi. */
export type MonitorConnection = 'connected' | 'reconnecting' | 'disconnected'

// readState EventSource (standard API HTML) — valeurs numériques figées pour rester
// testables hors navigateur (jsdom n'expose qu'un EventSource partiel).
const SSE_CONNECTING = 0
const SSE_OPEN = 1
// const SSE_CLOSED = 2

/** Mappe un readyState EventSource (0..2) vers l'état de connexion affichable. */
export function sseConnectionState(readyState: number | undefined): MonitorConnection {
  if (readyState === SSE_OPEN) return 'connected'
  if (readyState === SSE_CONNECTING) return 'reconnecting'
  return 'disconnected'
}

/** Une page est « terminée » quand elle atteint READY ou INDEXED. */
export function isCompletionStatus(status: PipelineStatus | undefined): boolean {
  return status === 'READY' || status === 'INDEXED'
}

/**
 * Clé d'unicité d'une complétion de page : (batch_id, job_id, page_number).
 * Null si l'événement ne porte aucune info d'achèvement identifiable — on ne peut
 * alors pas dédupliquer en toute sécurité (types d'événements non-page).
 */
export function pageCompletionKey(event: PipelineSSEEvent): string | null {
  if (!isCompletionStatus(event.status)) return null
  const batch = event.batch_id ?? ''
  const job = event.job_id ?? ''
  const page = event.page_number != null ? String(event.page_number) : ''
  if (!batch && !job && !page) return null
  return `${batch}\u0000${job}\u0000${page}`
}

/**
 * Enregistre une complétion dans l'ensemble `seen` et renvoie `true` uniquement la
 * PREMIÈRE fois. Empêche qu'une même page (READY puis INDEXED, ou re-émission SSE)
 * soit comptée plusieurs fois dans `pagesDone`.
 */
export function recordPageCompletion(seen: Set<string>, event: PipelineSSEEvent): boolean {
  const key = pageCompletionKey(event)
  if (key === null) return false
  if (seen.has(key)) return false
  seen.add(key)
  return true
}

/**
 * Filtre un événement selon le(s) batch(s) actifs. Si `activeBatchIds` est vide, on
 * accepte tout (rétro-compat : lancements antérieurs sans batch_id capturé). Sinon,
 * seul un événement dont le batch_id est dans l'ensemble est conservé.
 */
export function eventBelongsToActiveBatch(
  event: PipelineSSEEvent,
  activeBatchIds: ReadonlySet<string>,
): boolean {
  if (activeBatchIds.size === 0) return true
  if (!event.batch_id) return false
  return activeBatchIds.has(event.batch_id)
}

/** Compteurs réinitialisés à chaque nouveau lancement (Suivi). */
export function freshRunCounters(): {
  pagesDone: number
  pagesTotal: number
  lines: string[]
  latencies: number[]
  currentStatus: PipelineStatus | null
  running: boolean
} {
  return { pagesDone: 0, pagesTotal: 0, lines: [], latencies: [], currentStatus: null, running: true }
}
