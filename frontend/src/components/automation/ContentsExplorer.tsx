import { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, FileText, ListTree, Layers, RefreshCw, Trash2, UserPen, Image as ImageIcon, Search, Activity, Pencil } from 'lucide-react'
import { api } from '@/lib/api'
import type { Chunk, Document, TocNode, DatabaseInfo, PurgePayload, PurgeResult, PurgeScope } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import Modal from '@/components/common/Modal'
import ImageModal from '@/components/library/curriculum/ImageModal'
// Le composant d'édition est IMPORTÉ tel quel (Markdown+KaTeX+lint+PUT). Jamais modifié ici.
import ChunkEditor from '@/components/library/ChunkEditor'

interface Props {
  /** Bases exposées par le contexte (jamais de liste en dur — cf. api.system.getDatabases). */
  databases: DatabaseInfo[]
  /** Base active du hub (sélecteur global) — sert de valeur initiale de la cascade. */
  activeDb: string | null
  /** Un batch tourne (état exposé par AutomationView) → bandeau live discret. */
  running: boolean
  /** Basculer vers l'onglet Suivi (lien du bandeau live). */
  onGoMonitoring: () => void
  /** Une purge/ré-exécution modifie la base → rafraîchit les métriques du hub. */
  onChanged: () => void
  /** Une ré-exécution démarre un batch → informe le hub (compteur/onglet Suivi). */
  onBatchStarted: (pagesTotal: number) => void
  /** Remonte l'état « une édition est ouverte non sauvée » pour la pastille de l'onglet. */
  onDirtyChange: (dirty: boolean) => void
}

/** Aplatit l'arbre TOC en liste indentée (ordre de lecture) pour un SELECT chapitre. */
function flattenToc(nodes: TocNode[], depth = 0, out: Array<{ node: TocNode; depth: number }> = []) {
  for (const n of nodes) {
    out.push({ node: n, depth })
    if (n.children && n.children.length) flattenToc(n.children, depth + 1, out)
  }
  return out
}

/** Portées de purge/ré-exécution proposées selon le périmètre courant. */
type ScopeKind = 'document' | 'chapter' | 'page'

/**
 * §7.x « Contenus » — explorateur-éditeur multi-niveaux des données ingérées.
 * Cascade BASE → DOCUMENT → (CHAPITRE et/ou PAGE) → liste des CHUNKS,
 * édition fine (ChunkEditor), scan de page, ré-exécution & purge scopées.
 */
export default function ContentsExplorer({
  databases, activeDb, running, onGoMonitoring, onChanged, onBatchStarted, onDirtyChange,
}: Props) {
  const { t } = useLanguage()
  const toast = useToast()

  // ── Cascade de sélection ──
  const [db, setDb] = useState<string>(activeDb ?? '')
  const [documents, setDocuments] = useState<Document[]>([])
  const [documentId, setDocumentId] = useState<string>('')
  const [toc, setToc] = useState<TocNode[]>([])
  const [tocId, setTocId] = useState<string>('')          // chapitre sélectionné ('' = tout le document)
  const [pageNumber, setPageNumber] = useState<string>('') // page précise ('' = toutes)

  // ── Chunks du périmètre + pagination serveur ──
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)

  // ── Filtres ──
  const [pedFilter, setPedFilter] = useState<string>('')  // type pédagogique ('' = tous)
  const [textFilter, setTextFilter] = useState<string>('') // recherche plein-texte LOCALE (page affichée)

  // ── Édition & scan ──
  const [editing, setEditing] = useState<Chunk | null>(null)
  const [scanChunk, setScanChunk] = useState<Chunk | null>(null)

  // ── Purge scopée (dry_run → impact → confirmation) ──
  const [purgeImpact, setPurgeImpact] = useState<PurgeResult | null>(null)
  const [purgeScope, setPurgeScope] = useState<ScopeKind | null>(null)
  const [purgeConfirm, setPurgeConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  // La base active du hub pilote la valeur initiale ; l'utilisateur peut ensuite en changer localement.
  useEffect(() => { if (activeDb && !db) setDb(activeDb) }, [activeDb, db])

  // ── Chargement des documents de la base choisie ──
  useEffect(() => {
    if (!db) { setDocuments([]); return }
    let cancelled = false
    api.library.getDocuments(db, 1, 200)
      .then(res => { if (!cancelled) setDocuments(res.data ?? []) })
      .catch(() => { if (!cancelled) setDocuments([]) })
    return () => { cancelled = true }
  }, [db])

  // Changer de base réinitialise le périmètre en aval.
  const onSelectDb = (value: string) => {
    setDb(value); setDocumentId(''); setToc([]); setTocId(''); setPageNumber('')
    setChunks([]); setPage(1); setTotalPages(1); setPedFilter('')
  }

  // Changer de document → recharge la TOC et réinitialise chapitre/page.
  const onSelectDocument = (value: string) => {
    setDocumentId(value); setTocId(''); setPageNumber(''); setPage(1); setPedFilter('')
    setChunks([]); setToc([])
    if (!value || !db) return
    api.library.getToc(db, value)
      .then(res => setToc(res.toc ?? []))
      .catch(() => setToc([]))
  }

  // ── Chargement des chunks du périmètre ──
  const loadChunks = useCallback(() => {
    if (!db || !documentId) { setChunks([]); setTotalPages(1); return }
    setLoading(true)
    const parsedPage = pageNumber.trim() ? Number(pageNumber) : undefined
    api.library.getChunks(db, documentId, page, {
      ...(pedFilter ? { pedagogical_type: pedFilter } : {}),
      ...(tocId ? { toc_id: tocId } : {}),
      // Une page précise se traduit en intervalle [n, n] (le backend expose page_start/page_end).
      ...(parsedPage != null && !Number.isNaN(parsedPage) ? { page_start: parsedPage, page_end: parsedPage } : {}),
    })
      .then(res => { setChunks(res.chunks); setTotalPages(res.total_pages) })
      .catch(() => { setChunks([]); setTotalPages(1) })
      .finally(() => setLoading(false))
  }, [db, documentId, page, pedFilter, tocId, pageNumber])

  useEffect(loadChunks, [loadChunks])

  // Repli page 1 quand le périmètre/filtre change (évite une page hors bornes).
  useEffect(() => { setPage(1) }, [documentId, tocId, pageNumber, pedFilter])

  // Édition ouverte non sauvée → pastille de l'onglet.
  useEffect(() => { onDirtyChange(editing !== null) }, [editing, onDirtyChange])

  const flatToc = useMemo(() => flattenToc(toc), [toc])

  // SELECT des types pédagogiques : uniquement les valeurs PRÉSENTES dans la page chargée (zéro liste en dur).
  const pedValues = useMemo(() => {
    const set = new Set<string>()
    for (const c of chunks) if (c.pedagogical_type) set.add(c.pedagogical_type)
    return Array.from(set).sort()
  }, [chunks])

  // Recherche plein-texte LOCALE dans la page affichée (contenu + titre de section).
  const visibleChunks = useMemo(() => {
    const q = textFilter.trim().toLowerCase()
    if (!q) return chunks
    return chunks.filter(c =>
      c.content_markdown.toLowerCase().includes(q) ||
      (c.section_title ?? '').toLowerCase().includes(q))
  }, [chunks, textFilter])

  const selectedDoc = documents.find(d => d.id === documentId) ?? null
  const selectedTocTitle = flatToc.find(x => x.node.id === tocId)?.node.title ?? null

  // Libellé humain du périmètre courant (utilisé dans les modales/toasts).
  const scopeLabel = useMemo(() => {
    if (!selectedDoc) return ''
    const docName = selectedDoc.title || selectedDoc.filename
    if (pageNumber.trim()) return `${docName} · ${t('library.page')} ${pageNumber}`
    if (tocId) return `${docName} · ${selectedTocTitle ?? tocId}`
    return docName
  }, [selectedDoc, pageNumber, tocId, selectedTocTitle, t])

  // ── Ré-exécution scopée (document / chapitre / page) ──
  const reprocess = async (kind: ScopeKind) => {
    if (!db || !documentId) return
    setBusy(true)
    try {
      const payload = kind === 'document'
        ? { db, scope: 'document' as const, document_id: documentId, preserve_human_edits: true }
        : kind === 'chapter'
          ? { db, scope: 'chapter' as const, document_id: documentId, toc_id: tocId, preserve_human_edits: true }
          : { db, scope: 'page_range' as const, document_id: documentId, page_start: Number(pageNumber), page_end: Number(pageNumber), preserve_human_edits: true }
      const res = await api.pipeline.reprocess(payload)
      onBatchStarted(res.pages_total ?? 0)
      toast.success(t('automation.contents.reprocess_started'))
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error_generic'))
    } finally { setBusy(false) }
  }

  // ── Purge scopée : dry_run d'abord (affiche le compte), puis confirmation ──
  const buildPurge = (kind: ScopeKind, dryRun: boolean): PurgePayload => {
    const scope: PurgeScope = kind === 'document' ? 'document' : kind === 'chapter' ? 'chapter' : 'page'
    return {
      db, scope, dry_run: dryRun, preserve_human_edits: true, document_id: documentId,
      ...(kind === 'chapter' ? { toc_id: tocId } : {}),
      ...(kind === 'page' ? { page_start: Number(pageNumber) } : {}),
    }
  }

  const previewPurge = async (kind: ScopeKind) => {
    if (!db || !documentId) return
    setBusy(true)
    try {
      const res = await api.pipeline.purge(buildPurge(kind, true))
      setPurgeImpact(res); setPurgeScope(kind); setPurgeConfirm('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error_generic'))
    } finally { setBusy(false) }
  }

  const executePurge = async () => {
    if (!purgeScope) return
    setBusy(true)
    try {
      const res = await api.pipeline.purge(buildPurge(purgeScope, false))
      toast.success(res.message || t('automation.contents.purged'))
      setPurgeImpact(null); setPurgeScope(null)
      onChanged(); loadChunks()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error_generic'))
    } finally { setBusy(false) }
  }

  const canReprocessPage = pageNumber.trim() !== '' && !Number.isNaN(Number(pageNumber))
  const noDb = databases.length === 0

  return (
    <div className="workspace-tab">
      {/* Bandeau live discret : un batch tourne → lien vers Suivi */}
      {running && (
        <div className="auto-card" style={{ display: 'flex', alignItems: 'center', gap: 10, borderColor: 'var(--accent)', borderStyle: 'dashed', padding: '10px 14px' }}>
          <Activity size={16} />
          <span style={{ flex: 1 }}>{t('automation.contents.live_running')}</span>
          <button className="btn btn-sm btn-outline-primary" onClick={onGoMonitoring}>
            {t('automation.tabs.monitoring')}
          </button>
        </div>
      )}

      {/* ── Cascade de sélection ── */}
      <div className="auto-card">
        <h3 style={{ marginBottom: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Layers size={18} /> {t('automation.contents.selection')}
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          {/* BASE */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Database size={13} /> {t('db.select')}
            </span>
            <select className="form-select" style={{ minWidth: 200 }} value={db} onChange={e => onSelectDb(e.target.value)} disabled={noDb}>
              {noDb && <option value="">—</option>}
              {databases.map(d => <option key={d.filename} value={d.filename}>{d.filename}</option>)}
            </select>
          </label>

          {/* DOCUMENT */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <FileText size={13} /> {t('library.documents')}
            </span>
            <select className="form-select" style={{ minWidth: 240 }} value={documentId} onChange={e => onSelectDocument(e.target.value)} disabled={!db}>
              <option value="">{t('library.select_document')}</option>
              {documents.map(d => <option key={d.id} value={d.id}>{d.title || d.filename}</option>)}
            </select>
          </label>

          {/* CHAPITRE (TOC) */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <ListTree size={13} /> {t('library.toc')}
            </span>
            <select className="form-select" style={{ minWidth: 240 }} value={tocId} onChange={e => { setTocId(e.target.value); setPageNumber('') }} disabled={!documentId || flatToc.length === 0}>
              <option value="">{t('automation.contents.all_chapters')}</option>
              {flatToc.map(({ node, depth }) => (
                <option key={node.id} value={node.id}>
                  {' '.repeat(depth * 2)}{node.title} (p.{node.page_start}{node.page_end ? `–${node.page_end}` : ''})
                </option>
              ))}
            </select>
          </label>

          {/* PAGE précise */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <ImageIcon size={13} /> {t('library.page')}
            </span>
            <input className="form-input" style={{ maxWidth: 110 }} type="number" min={1}
              placeholder={t('automation.contents.all_pages')}
              value={pageNumber} onChange={e => { setPageNumber(e.target.value); if (e.target.value) setTocId('') }}
              disabled={!documentId} />
          </label>
        </div>

        {/* Actions par PÉRIMÈTRE (multi-scopes, contextuelles) */}
        {documentId && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            {/* Document entier */}
            <button className="btn btn-sm btn-outline-primary" onClick={() => reprocess('document')} disabled={busy || running}>
              <RefreshCw size={14} /> {t('automation.contents.reprocess_document')}
            </button>
            <button className="btn btn-sm btn-outline-danger" onClick={() => previewPurge('document')} disabled={busy}>
              <Trash2 size={14} /> {t('automation.contents.purge_document')}
            </button>
            {/* Chapitre sélectionné */}
            {tocId && (
              <>
                <button className="btn btn-sm btn-outline-primary" onClick={() => reprocess('chapter')} disabled={busy || running}>
                  <RefreshCw size={14} /> {t('automation.contents.reprocess_chapter')}
                </button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => previewPurge('chapter')} disabled={busy}>
                  <Trash2 size={14} /> {t('automation.contents.purge_chapter')}
                </button>
              </>
            )}
            {/* Page précise */}
            {canReprocessPage && (
              <>
                <button className="btn btn-sm btn-outline-primary" onClick={() => reprocess('page')} disabled={busy || running}>
                  <RefreshCw size={14} /> {t('automation.contents.reprocess_page')}
                </button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => previewPurge('page')} disabled={busy}>
                  <Trash2 size={14} /> {t('automation.contents.purge_page')}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Filtres + liste des chunks ── */}
      {documentId && (
        <div className="auto-card">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, flex: 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Layers size={18} /> {t('library.chunks')}
              {scopeLabel && <span className="badge badge-subtle" style={{ fontWeight: 500 }}>{scopeLabel}</span>}
            </h3>
            {/* Filtre par type pédagogique (valeurs présentes uniquement) */}
            <select className="form-select" style={{ maxWidth: 220 }} value={pedFilter} onChange={e => setPedFilter(e.target.value)}>
              <option value="">{t('automation.contents.all_types')}</option>
              {pedValues.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            {/* Recherche plein-texte locale */}
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="form-input" style={{ paddingLeft: 30, maxWidth: 240 }}
                placeholder={t('automation.contents.search_local')}
                value={textFilter} onChange={e => setTextFilter(e.target.value)} />
            </div>
          </div>

          {loading ? (
            <p style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
          ) : visibleChunks.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>{t('automation.contents.no_chunks')}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('library.page')}</th>
                  <th>{t('automation.contents.col_type')}</th>
                  <th>#</th>
                  <th>{t('automation.contents.col_preview')}</th>
                  <th style={{ textAlign: 'right' }}>{t('automation.contents.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleChunks.map(c => (
                  <tr key={c.id}>
                    <td className="font-num">{c.page_number}</td>
                    <td>
                      <span className="badge badge-subtle">
                        {c.pedagogical_type ?? t('automation.contents.type_none')}
                      </span>
                      {c.is_human_edited === 1 && (
                        <span className="badge badge-human-edited" title={t('library.human_edited')} style={{ marginInlineStart: 6 }}>
                          <UserPen size={11} /> {t('library.human_edited')}
                        </span>
                      )}
                    </td>
                    <td className="font-num">{c.pedagogical_index ?? c.chunk_index}</td>
                    <td style={{ maxWidth: 420 }}>
                      <div className="contents-chunk-preview">{c.content_markdown}</div>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => setEditing(c)} title={t('automation.contents.edit')}>
                        <Pencil size={13} /> {t('automation.contents.edit')}
                      </button>
                      <button className="btn btn-sm btn-outline-secondary" style={{ marginInlineStart: 6 }} onClick={() => setScanChunk(c)} title={t('library.scan')}>
                        <ImageIcon size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Pagination serveur */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 14 }}>
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
                {t('library.prev_page')}
              </button>
              <span className="font-num" style={{ color: 'var(--text-muted)' }}>{page} / {totalPages}</span>
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                {t('library.next_page')}
              </button>
            </div>
          )}
        </div>
      )}

      {!documentId && (
        <div className="auto-card" style={{ color: 'var(--text-muted)' }}>
          {t('library.no_document_selected')}
        </div>
      )}

      {/* Éditeur de chunk (composant existant, importé tel quel) */}
      {editing && (
        <ChunkEditor
          chunk={editing}
          activeDb={db}
          documentId={documentId}
          open={true}
          onClose={() => setEditing(null)}
          onSaved={updated => {
            setChunks(prev => prev.map(c => (c.id === updated.id ? updated : c)))
            setEditing(null)
            onChanged()
          }}
        />
      )}

      {/* Scan de la page du chunk (vignette cliquable → modale HD) */}
      {scanChunk && (
        <ImageModal
          open={true}
          title={`${t('library.scan')} — ${t('library.page')} ${scanChunk.page_number}`}
          src={api.library.getPageScanUrl(db, documentId, scanChunk.page_number, false)}
          fallbackSrc={api.library.getPageScanUrl(db, documentId, scanChunk.page_number, true)}
          onClose={() => setScanChunk(null)}
        />
      )}

      {/* Impact de la purge (dry_run) → confirmation */}
      <Modal
        open={purgeImpact !== null}
        title={<><Trash2 size={16} style={{ color: 'var(--danger)' }} /> {t('automation.contents.purge_impact_title')}</>}
        onClose={() => { setPurgeImpact(null); setPurgeScope(null) }}
        footer={
          <>
            <button className="btn btn-outline-secondary" onClick={() => { setPurgeImpact(null); setPurgeScope(null) }} disabled={busy}>
              {t('buttons.cancel')}
            </button>
            <button className="btn btn-danger" onClick={executePurge} disabled={busy || purgeConfirm.trim().toUpperCase() !== 'OK'}>
              <Trash2 size={14} /> {t('automation.contents.purge_confirm_btn')}
            </button>
          </>
        }
      >
        {purgeImpact && (
          <div>
            <p style={{ marginBottom: 10 }}>{t('automation.contents.purge_scope')} : <strong>{scopeLabel}</strong></p>
            <table className="data-table" style={{ marginBottom: 14 }}>
              <tbody>
                {Object.entries(purgeImpact.deleted).map(([k, v]) => (
                  <tr key={k}><td style={{ fontWeight: 700 }}>{k}</td><td className="font-num">{v}</td></tr>
                ))}
                <tr><td style={{ fontWeight: 700 }}>{t('purge.preserved')}</td><td className="font-num">{purgeImpact.preserved_human_edited}</td></tr>
              </tbody>
            </table>
            <p style={{ color: 'var(--text-muted)', marginBottom: 10 }}>{purgeImpact.message}</p>
            <label style={{ fontWeight: 700, display: 'block', marginBottom: 6 }}>{t('automation.contents.purge_type_ok')}</label>
            <input className="form-input form-mono" value={purgeConfirm} onChange={e => setPurgeConfirm(e.target.value)} placeholder="OK" />
          </div>
        )}
      </Modal>
    </div>
  )
}
