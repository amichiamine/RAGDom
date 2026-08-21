import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useDatabase } from '@/contexts/DatabaseContext'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import type { SystemHealth, Document, PipelineSSEEvent, PipelineStatus } from '@/types'
import TopNav from '@/components/layout/TopNav'
import VectorEngineAlert from '@/components/automation/VectorEngineAlert'
import PipelineSteps from '@/components/automation/PipelineSteps'
import LiveConsole from '@/components/automation/LiveConsole'
import KeyManager from '@/components/automation/KeyManager'
import ProvidersPanel from '@/components/automation/ProvidersPanel'
import SettingsPanel from '@/components/automation/SettingsPanel'
import QuarantineManager from '@/components/automation/QuarantineManager'
import PurgeStudio from '@/components/automation/PurgeStudio'
import SourcesManager from '@/components/automation/SourcesManager'
import SourceDocumentsTable from '@/components/automation/SourceDocumentsTable'
import CurriculumStudio from '@/components/admin/CurriculumStudio'
import TelemetryExplorer from '@/components/admin/TelemetryExplorer'
import DatabaseLifecycle from '@/components/admin/DatabaseLifecycle'
import ArtifactImportModal from '@/components/admin/ArtifactImportModal'
import { FilePlus2 } from 'lucide-react'
import { formatBytes, formatNumber } from '@/lib/utils'

export default function AutomationView() {
  const { databases, activeDb, setActiveDb, isLoading: dbLoading, refresh } = useDatabase()
  const { t } = useLanguage()
  const toast = useToast()
  const navigate = useNavigate()

  // ── Garde d'authentification (V3.6) : au montage, si l'atelier exige une
  // session et qu'aucune n'est active → /login. Seule cette vue est protégée. ──
  useEffect(() => {
    let cancelled = false
    api.auth.me()
      .then(me => { if (!cancelled && me.auth_required && !me.authenticated) navigate('/login', { replace: true }) })
      .catch(() => { /* /auth/me injoignable : ne pas bloquer l'atelier */ })
    return () => { cancelled = true }
  }, [navigate])

  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [quarantineCount, setQuarantineCount] = useState(0)
  const [artifactModalOpen, setArtifactModalOpen] = useState(false)

  const [lines, setLines] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [currentStatus, setCurrentStatus] = useState<PipelineStatus | null>(null)
  const [latencies, setLatencies] = useState<number[]>([])
  const [pagesDone, setPagesDone] = useState(0)
  const [pagesTotal, setPagesTotal] = useState(0)
  const esRef = useRef<EventSource | null>(null)

  // ── Health (polling 5s) ──
  const loadHealth = useCallback(() => {
    api.system.getHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  useEffect(() => {
    loadHealth()
    const id = window.setInterval(loadHealth, 5000)
    return () => window.clearInterval(id)
  }, [loadHealth])

  // ── Documents de la base active ──
  const loadDocs = useCallback(() => {
    if (!activeDb) return
    api.library.getDocuments(activeDb, 1, 100)
      .then(res => setDocuments(res.data ?? []))
      .catch(() => setDocuments([]))
  }, [activeDb])

  useEffect(loadDocs, [loadDocs])

  // ── SSE : une seule connexion, fermée au démontage ──
  useEffect(() => {
    const es = api.pipeline.createStream()
    esRef.current = es
    const onMsg = (ev: MessageEvent) => {
      let data: PipelineSSEEvent
      try { data = JSON.parse(ev.data) } catch { return }
      switch (data.type) {
        case 'page_update': {
          setRunning(true)
          if (data.status) setCurrentStatus(data.status)
          if (typeof data.latency_ms === 'number') setLatencies(prev => [...prev.slice(-9), data.latency_ms as number])
          if (data.line) setLines(prev => [...prev.slice(-999), data.line as string])
          else if (data.page_number) setLines(prev => [...prev.slice(-999), `[page ${data.page_number}] ${data.status ?? ''}`])
          setPagesDone(prev => prev + (data.status === 'READY' || data.status === 'INDEXED' ? 1 : 0))
          break
        }
        case 'queue_update':
          if (typeof data.queue_length === 'number') setLines(prev => [...prev.slice(-999), `[queue] ${data.queue_length}`])
          break
        case 'job_complete':
          setRunning(false)
          setLines(prev => [...prev.slice(-999), `[done] pages=${data.pages_indexed ?? 0} artifacts=${data.artifacts_extracted ?? 0}`])
          if (data.success !== false) toast.success('job_complete')
          loadDocs(); refresh()
          break
        case 'error':
          setLines(prev => [...prev.slice(-999), `[error] ${data.error ?? ''} ${data.details ?? ''}`])
          toast.error(data.error ?? t('common.error_generic'))
          break
      }
    }
    es.addEventListener('message', onMsg)
    es.onerror = () => { /* EventSource retente automatiquement ; on garde l'UI vivante */ }
    return () => { es.removeEventListener('message', onMsg); es.close(); esRef.current = null }
  }, [loadDocs, refresh, toast, t])

  const stop = async () => {
    try {
      const res = await api.pipeline.stop()
      setRunning(false)
      toast.success(`stop @ page ${res.last_completed_page}`)
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
  }

  // ── ETA & Débit (moyenne mobile des latences page_update) ──
  const eta = useMemo(() => {
    if (latencies.length === 0) return null
    const avgMs = latencies.reduce((a, b) => a + b, 0) / latencies.length
    const pagesPerHour = avgMs > 0 ? Math.round(3_600_000 / avgMs) : 0
    const remaining = Math.max(0, pagesTotal - pagesDone)
    const finishMs = remaining * avgMs
    const finishAt = new Date(Date.now() + finishMs)
    return { avgMs, pagesPerHour, remaining, finishAt }
  }, [latencies, pagesTotal, pagesDone])

  const activeDbInfo = databases.find(d => d.filename === activeDb)

  // Zéro base ≠ écran bloquant : le hub DOIT rester accessible pour déposer
  // le premier PDF (la base est créée automatiquement à l'ingestion, §13).
  const noDatabases = !dbLoading && databases.length === 0

  return (
    <div>
      <TopNav variant="automation" />
      <main className="container-app" style={{ paddingTop: 24, paddingBottom: 40 }}>
        {noDatabases && (
          <div className="auto-card" style={{ borderColor: 'var(--warning)', borderStyle: 'dashed' }}>
            <strong>🚀 Première utilisation :</strong> aucune base pour l'instant — déposez un PDF
            dans la carte <em>Sources</em> ci-dessous puis lancez l'ingestion : la base
            <code> Matière_Niveau.sqlite</code> sera créée automatiquement.
          </div>
        )}
        {/* Sélecteur de base + Status live */}
        <div className="auto-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ fontWeight: 700 }}>{t('db.select')}</label>
              <select className="form-select" style={{ maxWidth: 260 }} value={activeDb ?? ''} onChange={e => setActiveDb(e.target.value)}>
                {databases.map(d => <option key={d.filename} value={d.filename}>{d.filename}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {activeDbInfo ? (
                <span className="badge badge-success">
                  🟢 {activeDbInfo.filename} · {formatNumber(activeDbInfo.metrics.chunk_count)} chunks · {formatBytes(activeDbInfo.size_bytes)}
                </span>
              ) : (
                <span className="badge badge-danger">🔴 {t('db.not_built')}</span>
              )}
              {quarantineCount > 0 && <span className="badge badge-warning"><i className="fa-solid fa-triangle-exclamation" /> {quarantineCount}</span>}
              {health && <span className="badge badge-subtle">v{health.version} · queue {health.queue_length}</span>}
            </div>
          </div>
        </div>

        {/* Bandeau moteur vectoriel */}
        <VectorEngineAlert health={health} onRefresh={loadHealth} />

        {/* ETA & Débit (pendant un batch) */}
        {eta && (
          <div className="auto-card">
            <h3 style={{ marginBottom: 12 }}><i className="fa-solid fa-gauge-high" /> {t('automation.eta')}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
              <EtaMetric label={t('automation.throughput')} value={`${eta.pagesPerHour} ${t('pipeline.pages_per_hour')}`} />
              <EtaMetric label={t('automation.pages_remaining')} value={String(eta.remaining)} />
              <EtaMetric label={t('automation.eta_finish')} value={eta.finishAt.toLocaleTimeString()} />
              {health && <EtaMetric label={t('automation.resident_engine')} value={health.vector_engine} />}
            </div>
          </div>
        )}

        {/* Sources + upload */}
        <SourcesManager onChanged={refresh} />

        {/* Documents sources */}
        {activeDb && <SourceDocumentsTable db={activeDb} documents={documents} onIngested={loadDocs}
          onBatchStarted={total => { setPagesTotal(prev => prev + total); setRunning(true) }} />}

        {/* Steps (5/12) + Console (7/12) */}
        <div className="row">
          <div className="col-4 col-lg-6" style={{ minWidth: 280 }}>
            <div className="auto-card">
              <h3 style={{ marginBottom: 12 }}><i className="fa-solid fa-layer-group" /> {t('automation.steps')}</h3>
              <PipelineSteps currentStatus={currentStatus} running={running} />
            </div>
          </div>
          <div className="col-6 col-lg-6" style={{ minWidth: 280, flex: 1 }}>
            <div className="auto-card">
              <LiveConsole lines={lines} running={running} onStop={stop} />
            </div>
          </div>
        </div>

        {/* Import d'actif Tier 3 (§7.11) */}
        {activeDb && (
          <div className="auto-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <FilePlus2 size={20} /> Actifs Tier 3
            </h3>
            <button className="btn btn-outline-primary" onClick={() => setArtifactModalOpen(true)} disabled={documents.length === 0}>
              <FilePlus2 size={16} /> ➕ Importer un actif
            </button>
          </div>
        )}

        {/* Curriculum Studio (§7.10) — clé de sortie du Mode Repli */}
        {activeDb && <CurriculumStudio db={activeDb} onChanged={refresh} />}

        {/* Télémétrie (§7.9) + Cycle de vie des bases (§7.8) */}
        {activeDb && <TelemetryExplorer db={activeDb} documents={documents} />}
        <DatabaseLifecycle databases={databases} onChanged={refresh} />

        {/* Purge + Settings */}
        {activeDb && <PurgeStudio db={activeDb} documents={documents} onPurged={refresh} />}
        <SettingsPanel />

        {/* Quarantaine */}
        {activeDb && <QuarantineManager db={activeDb} onCount={setQuarantineCount} />}

        {/* Clés LLM + Fournisseurs LLM (côte à côte) */}
        <div className="row">
          <div className="col-6 col-lg-6" style={{ minWidth: 320, flex: 1 }}>
            <KeyManager />
          </div>
          <div className="col-6 col-lg-6" style={{ minWidth: 320, flex: 1 }}>
            <ProvidersPanel />
          </div>
        </div>
      </main>

      {activeDb && (
        <ArtifactImportModal
          db={activeDb}
          documents={documents}
          open={artifactModalOpen}
          onClose={() => setArtifactModalOpen(false)}
          onImported={() => { setArtifactModalOpen(false); refresh() }}
        />
      )}

      <footer>
        <div className="container-app">
          <div>{t('footer.line1')}</div>
          <div style={{ marginTop: 6 }}>{t('footer.line2')}</div>
        </div>
      </footer>
    </div>
  )
}

function EtaMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-card-inner)', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div className="font-num" style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-heading)' }}>{value}</div>
    </div>
  )
}
