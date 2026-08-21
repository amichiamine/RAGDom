import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { SourceNode, SourceFile, DatabaseInfo, Document, TocNode, PipelineQueueState } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import { Spinner, ErrorBanner } from '@/components/common/Feedback'

interface Props {
  databases: DatabaseInfo[]
  activeDb: string | null
  running: boolean
  /** Ajoute des pages au suivi live existant (AutomationView) + passe running=true. */
  onBatchStarted: (pagesTotal: number) => void
  onStop: () => void
  /** Rafraîchit bases + documents après un lancement. */
  onChanged: () => void
}

type Tab = 'ingest' | 'reprocess'
type IngestMode = 'document' | 'page_range'
type ReprocessScope = 'document' | 'page_range' | 'chapter'

// Cible sélectionnée dans l'arbre : soit un dossier (mode folder), soit un PDF.
interface Selection {
  kind: 'folder' | 'file'
  relPath: string       // dossier : rel_path ; fichier : rel_path du dossier + '/' + nom
  label: string         // nom affiché
  file?: SourceFile
}

function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}
function normRel(rel: string): string {
  return rel === '.' ? '' : rel
}

/** Aplati le sous-arbre TOC (le back renvoie une liste plate, mais on tolère l'imbrication). */
function flattenToc(nodes: TocNode[]): TocNode[] {
  const out: TocNode[] = []
  const walk = (n: TocNode) => { out.push(n); (n.children ?? []).forEach(walk) }
  nodes.forEach(walk)
  return out
}

/**
 * §7.4 PipelineLauncher (V3.8) — action PRINCIPALE de l'Automation Hub.
 * Deux volets : « Lancer une ingestion » (arbre des sources → document/page_range/folder)
 * et « Ré-exécuter » (purge scopée + ré-ingestion complète, toutes couches).
 */
export default function PipelineLauncher({ databases, activeDb, running, onBatchStarted, onStop, onChanged }: Props) {
  const { t } = useLanguage()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('ingest')

  return (
    <div className="auto-card" style={{ borderColor: 'var(--primary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}><i className="fa-solid fa-rocket" /> {t('launcher.title')}</h3>
        {running && (
          <button className="btn btn-sm btn-danger" onClick={onStop}>
            <i className="fa-solid fa-stop" /> {t('launcher.stop_pipeline')}
          </button>
        )}
      </div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>{t('launcher.note')}</p>

      {/* Segmented control */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm rounded-pill ${tab === 'ingest' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab('ingest')}>
          <i className="fa-solid fa-play" /> {t('launcher.tab_ingest')}
        </button>
        <button className={`btn btn-sm rounded-pill ${tab === 'reprocess' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab('reprocess')}>
          <i className="fa-solid fa-arrows-rotate" /> {t('launcher.tab_reprocess')}
        </button>
      </div>

      {tab === 'ingest'
        ? <IngestPanel onBatchStarted={onBatchStarted} onChanged={onChanged} toast={toast} />
        : <ReprocessPanel databases={databases} activeDb={activeDb} onBatchStarted={onBatchStarted} onChanged={onChanged} toast={toast} />}

      <QueueState activeDb={activeDb} running={running} />
    </div>
  )
}

type ToastApi = ReturnType<typeof useToast>

// ═══════════════════ Volet 1 : Lancer une ingestion ═══════════════════
function IngestPanel({ onBatchStarted, onChanged, toast }: { onBatchStarted: (n: number) => void; onChanged: () => void; toast: ToastApi }) {
  const { t } = useLanguage()
  const [tree, setTree] = useState<SourceNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [mode, setMode] = useState<IngestMode>('document')
  const [pageStart, setPageStart] = useState('')
  const [pageEnd, setPageEnd] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    api.system.getSources()
      .then(res => setTree(res.tree))
      .catch(e => setError(e instanceof Error ? e.message : t('common.error_generic')))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(() => { load() }, [load])

  const launch = async () => {
    if (!selection) return
    setBusy(true)
    try {
      const payload = selection.kind === 'folder'
        ? { source_path: selection.relPath, mode: 'folder' as const }
        : {
            source_path: selection.relPath,
            mode,
            ...(mode === 'page_range' ? { page_start: Number(pageStart) || 1, page_end: Number(pageEnd) || Number(pageStart) || 1 } : {}),
          }
      const res = await api.pipeline.start(payload)
      toast.success(`${t('launcher.launched')} — batch ${res.batch_id} · ${res.pages_total} ${t('pipeline.pages')} → ${res.target_db}`)
      onBatchStarted(res.pages_total)
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
    finally { setBusy(false) }
  }

  const canLaunch = !!selection && !busy && (mode !== 'page_range' || selection.kind === 'folder' || !!pageStart)

  return (
    <div>
      <div className="provider-section-title" style={{ marginBottom: 8 }}>{t('launcher.pick_source')}</div>
      {loading ? <Spinner /> : error ? <ErrorBanner message={error} onRetry={load} /> : (
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 8, marginBottom: 12 }}>
          {tree.map(n => (
            <PickerNode key={n.rel_path} node={n} depth={0} selection={selection} onSelect={setSelection} />
          ))}
        </div>
      )}

      {selection && (
        <div style={{ marginBottom: 12 }}>
          <div className="db-badge-row" style={{ marginBottom: 10 }}>
            <span className="provider-mini-label">{t('launcher.selected')} :</span>
            <span className="badge badge-info">
              <i className={`fa-solid ${selection.kind === 'folder' ? 'fa-folder' : 'fa-file-pdf'}`} /> {selection.label}
            </span>
          </div>

          {selection.kind === 'folder' ? (
            <p className="hint" style={{ margin: 0 }}>{t('launcher.folder_mode_hint')}</p>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className={`btn btn-sm rounded-pill ${mode === 'document' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setMode('document')}>
                {t('launcher.mode_document')}
              </button>
              <button className={`btn btn-sm rounded-pill ${mode === 'page_range' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setMode('page_range')}>
                {t('launcher.mode_page_range')}
              </button>
              {mode === 'page_range' && (
                <>
                  <input className="form-input" style={{ maxWidth: 110 }} type="number" min={1} placeholder={t('launcher.page_start')} value={pageStart} onChange={e => setPageStart(e.target.value)} />
                  <span style={{ color: 'var(--text-muted)' }}>→</span>
                  <input className="form-input" style={{ maxWidth: 110 }} type="number" min={1} placeholder={t('launcher.page_end')} value={pageEnd} onChange={e => setPageEnd(e.target.value)} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      <button className="btn btn-primary" onClick={launch} disabled={!canLaunch}>
        {busy ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-play" />} {t('launcher.launch_button')}
      </button>
    </div>
  )
}

function PickerNode({ node, depth, selection, onSelect }: { node: SourceNode; depth: number; selection: Selection | null; onSelect: (s: Selection) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(depth === 0)
  const rel = normRel(node.rel_path)
  const name = rel.split('/').filter(Boolean).pop() || t('sources.root')
  const folderSelected = selection?.kind === 'folder' && selection.relPath === rel
  return (
    <div style={{ paddingInlineStart: depth * 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button className="btn btn-sm" style={{ padding: '2px 6px', background: 'transparent', border: 'none' }} onClick={() => setOpen(o => !o)}>
          <i className={`fa-solid fa-chevron-${open ? 'down' : 'right'}`} style={{ color: 'var(--text-muted)' }} />
        </button>
        <button
          className={`dropdown-item ${folderSelected ? 'is-active' : ''}`}
          style={{ fontWeight: 700, flex: 1, ...(folderSelected ? { background: 'var(--bg-card-inner)', borderRadius: 8 } : {}) }}
          onClick={() => onSelect({ kind: 'folder', relPath: rel, label: rel || name })}
          title={t('launcher.select_folder')}
        >
          <i className={`fa-solid ${open ? 'fa-folder-open' : 'fa-folder'}`} style={{ color: folderSelected ? 'var(--primary)' : 'var(--warning)' }} />
          <span style={{ flex: 1, textAlign: 'start' }}>{name}</span>
          {folderSelected && <span className="badge badge-primary">{t('sources.selected')}</span>}
        </button>
      </div>
      {open && (
        <div>
          {node.files.map(f => {
            const fileRel = joinRel(rel, f.name)
            const fileSelected = selection?.kind === 'file' && selection.relPath === fileRel
            return (
              <button
                key={f.name}
                className={`dropdown-item ${fileSelected ? 'is-active' : ''}`}
                style={{ marginInlineStart: 28, ...(fileSelected ? { background: 'var(--bg-card-inner)', borderRadius: 8 } : {}) }}
                onClick={() => onSelect({ kind: 'file', relPath: fileRel, label: f.name, file: f })}
              >
                <i className="fa-solid fa-file-pdf" style={{ color: 'var(--danger)' }} />
                <span style={{ flex: 1, textAlign: 'start', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                {f.ingested && <span className="badge badge-success">{t('sources.ingested')}</span>}
                {fileSelected && <span className="badge badge-primary">{t('sources.selected')}</span>}
              </button>
            )
          })}
          {node.folders.map(sf => (
            <PickerNode key={sf.rel_path} node={sf} depth={depth + 1} selection={selection} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

// ═══════════════════ Volet 2 : Ré-exécuter (reprocess) ═══════════════════
function ReprocessPanel({ databases, activeDb, onBatchStarted, onChanged, toast }: { databases: DatabaseInfo[]; activeDb: string | null; onBatchStarted: (n: number) => void; onChanged: () => void; toast: ToastApi }) {
  const { t } = useLanguage()
  const [db, setDb] = useState<string>(activeDb ?? databases[0]?.filename ?? '')
  const [documents, setDocuments] = useState<Document[]>([])
  const [documentId, setDocumentId] = useState('')
  const [scope, setScope] = useState<ReprocessScope>('document')
  const [pageStart, setPageStart] = useState('')
  const [pageEnd, setPageEnd] = useState('')
  const [toc, setToc] = useState<TocNode[]>([])
  const [tocId, setTocId] = useState('')
  const [preserveHuman, setPreserveHuman] = useState(true)
  const [busy, setBusy] = useState(false)

  // Documents de la base choisie.
  useEffect(() => {
    if (!db) { setDocuments([]); return }
    let cancelled = false
    api.library.getDocuments(db, 1, 200)
      .then(res => { if (!cancelled) setDocuments(res.data ?? []) })
      .catch(() => { if (!cancelled) setDocuments([]) })
    return () => { cancelled = true }
  }, [db])

  // Sommaire du document choisi (pour le scope chapter).
  useEffect(() => {
    if (!db || !documentId || scope !== 'chapter') { setToc([]); setTocId(''); return }
    let cancelled = false
    api.library.getToc(db, documentId)
      .then(res => { if (!cancelled) setToc(res.toc ?? []) })
      .catch(() => { if (!cancelled) setToc([]) })
    return () => { cancelled = true }
  }, [db, documentId, scope])

  const flatToc = useMemo(() => flattenToc(toc), [toc])

  const canRun = !!db && !!documentId && !busy
    && (scope !== 'page_range' || !!pageStart)
    && (scope !== 'chapter' || !!tocId)

  const run = async () => {
    if (!canRun) return
    setBusy(true)
    try {
      const res = await api.pipeline.reprocess({
        db,
        scope,
        document_id: documentId,
        preserve_human_edits: preserveHuman,
        ...(scope === 'page_range' ? { page_start: Number(pageStart) || 1, page_end: Number(pageEnd) || Number(pageStart) || 1 } : {}),
        ...(scope === 'chapter' ? { toc_id: tocId } : {}),
      })
      toast.success(`${t('launcher.reprocessed')} — batch ${res.batch_id} · ${t('pipeline.pages')} ${res.page_start}→${res.page_end} (${res.pages_total})`)
      onBatchStarted(res.pages_total)
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
    finally { setBusy(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <label className="provider-inline-field">
          <span className="provider-mini-label">{t('launcher.database')}</span>
          <select className="form-select" style={{ maxWidth: 240 }} value={db} onChange={e => { setDb(e.target.value); setDocumentId('') }}>
            <option value="">{t('db.select')}</option>
            {databases.map(d => <option key={d.filename} value={d.filename}>{d.filename}</option>)}
          </select>
        </label>
        <label className="provider-inline-field">
          <span className="provider-mini-label">{t('launcher.document')}</span>
          <select className="form-select" style={{ maxWidth: 260 }} value={documentId} onChange={e => setDocumentId(e.target.value)} disabled={!db}>
            <option value="">{t('library.select_document')}</option>
            {documents.map(d => <option key={d.id} value={d.id}>{d.title || d.filename}</option>)}
          </select>
        </label>
      </div>

      {/* Scope */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {(['document', 'page_range', 'chapter'] as ReprocessScope[]).map(s => (
          <button key={s} className={`btn btn-sm rounded-pill ${scope === s ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setScope(s)}>
            {t(`launcher.scope_${s}`)}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {scope === 'page_range' && (
          <>
            <input className="form-input" style={{ maxWidth: 110 }} type="number" min={1} placeholder={t('launcher.page_start')} value={pageStart} onChange={e => setPageStart(e.target.value)} />
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <input className="form-input" style={{ maxWidth: 110 }} type="number" min={1} placeholder={t('launcher.page_end')} value={pageEnd} onChange={e => setPageEnd(e.target.value)} />
          </>
        )}
        {scope === 'chapter' && (
          <select className="form-select" style={{ maxWidth: 340 }} value={tocId} onChange={e => setTocId(e.target.value)} disabled={!documentId}>
            <option value="">{t('launcher.select_chapter')}</option>
            {flatToc.map(c => (
              <option key={c.id} value={c.id}>{'— '.repeat(Math.max(0, c.level - 1))}{c.title} (p.{c.page_start}{c.page_end ? `–${c.page_end}` : ''})</option>
            ))}
          </select>
        )}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="switch">
          <input type="checkbox" checked={preserveHuman} onChange={e => setPreserveHuman(e.target.checked)} />
          <span className="slider-track" /><span className="slider-thumb" />
        </span>
        <span>{t('launcher.preserve_human')}</span>
      </label>

      <div className="auto-card" style={{ borderColor: 'var(--warning)', borderStyle: 'dashed', padding: '10px 14px', marginBottom: 12 }}>
        <i className="fa-solid fa-triangle-exclamation" style={{ color: 'var(--warning)' }} /> {t('launcher.reprocess_warning')}
      </div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>{t('launcher.all_layers_note')}</p>

      <button className="btn btn-warning" onClick={run} disabled={!canRun}>
        {busy ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-arrows-rotate" />} {t('launcher.reprocess_button')}
      </button>
    </div>
  )
}

// ═══════════════════ État de la file (GET /pipeline/queue) ═══════════════════
function QueueState({ activeDb, running }: { activeDb: string | null; running: boolean }) {
  const { t } = useLanguage()
  const [queue, setQueue] = useState<PipelineQueueState | null>(null)

  const load = useCallback(() => {
    if (!activeDb) { setQueue(null); return }
    api.pipeline.getQueue(activeDb).then(setQueue).catch(() => setQueue(null))
  }, [activeDb])

  // Rafraîchissement pendant qu'un batch tourne (le SSE gère la console ; ici on suit la file).
  useEffect(() => {
    load()
    if (!running) return
    const id = window.setInterval(load, 4000)
    return () => window.clearInterval(id)
  }, [load, running])

  if (!queue) return null
  return (
    <div className="db-badge-row" style={{ marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
      <span className="provider-mini-label">{t('launcher.queue')} :</span>
      {queue.current_job
        ? <span className="badge badge-warning"><i className="fa-solid fa-spinner fa-spin" /> {t('launcher.queue_current')} · p.{queue.current_job.page_number} · {queue.current_job.status}</span>
        : <span className="badge badge-secondary">{t('launcher.queue_idle')}</span>}
      <span className="badge badge-info">{t('launcher.queue_queued')} : {queue.queued_jobs}</span>
      <span className="badge badge-subtle">{t('launcher.queue_done_today')} : {queue.completed_today}</span>
    </div>
  )
}
