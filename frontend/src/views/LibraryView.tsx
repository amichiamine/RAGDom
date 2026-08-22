import { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useDatabase } from '@/contexts/DatabaseContext'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Document, TocNode, Chunk, Facets, SearchResult, AskSource, CurriculumPayload, PageScanManifestEntry } from '@/types'
import CurriculumWorkspace from '@/components/library/curriculum/CurriculumWorkspace'
import ThemeToggle from '@/components/layout/ThemeToggle'
import LanguageSelector from '@/components/layout/LanguageSelector'
import EngineBadge from '@/components/layout/EngineBadge'
import TOCExplorer from '@/components/library/TOCExplorer'
import SideBySideViewer from '@/components/library/SideBySideViewer'
import ChunkEditor from '@/components/library/ChunkEditor'
import SearchStudio from '@/components/library/SearchStudio'
import AskStudio from '@/components/library/AskStudio'
import OnboardingEmptyState from '@/components/common/OnboardingEmptyState'
import { Spinner, ErrorBanner, EmptyState, SkeletonRows } from '@/components/common/Feedback'
import { formatBytes, domainBadgeStyle } from '@/lib/utils'
import { useTheme } from '@/contexts/ThemeContext'

type Tab = 'explore' | 'search' | 'ask' | 'scans'

export default function LibraryView() {
  const { databases, activeDb, setActiveDb, isLoading: dbLoading } = useDatabase()
  const { t } = useLanguage()
  const { theme } = useTheme()
  const [params, setParams] = useSearchParams()

  const [tab, setTab] = useState<Tab>('explore')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const [documents, setDocuments] = useState<Document[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [activeDoc, setActiveDoc] = useState<Document | null>(null)

  const [toc, setToc] = useState<TocNode[]>([])
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [chunksLoading, setChunksLoading] = useState(false)
  const [chunksError, setChunksError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [highlightChunkId, setHighlightChunkId] = useState<string | null>(null)

  const [facets, setFacets] = useState<Facets | null>(null)

  // ── Correction humaine (§7.4 ChunkEditor) ──
  const [editingChunk, setEditingChunk] = useState<Chunk | null>(null)

  // ── Curriculum (V3.1 D1-B) : décide Mode Repli vs 6 onglets pixel-perfect ──
  const [curriculum, setCurriculum] = useState<CurriculumPayload | null>(null)
  const [curriculumLoading, setCurriculumLoading] = useState(false)

  // ── Galerie de scans générique (Mode Repli, §5.2 préambule) ──
  const [scanManifest, setScanManifest] = useState<PageScanManifestEntry[]>([])
  const [scansLoading, setScansLoading] = useState(false)
  const [scanDocFilter, setScanDocFilter] = useState<string>('all')
  const [scanPage, setScanPage] = useState(1)

  // ── Deep-link ?db= et ?q= depuis le hero ──
  useEffect(() => {
    const qDb = params.get('db')
    if (qDb && databases.some(d => d.filename === qDb)) setActiveDb(qDb)
    if (params.get('q')) setTab('search')
    // Deep-link vers un onglet du Mode Repli (?tab=search|ask|scans|explore).
    const qTab = params.get('tab')
    if (qTab === 'search' || qTab === 'ask' || qTab === 'scans' || qTab === 'explore') setTab(qTab)
  }, [params, databases, setActiveDb])

  // Raccourci Ctrl/Cmd+B
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); setSidebarOpen(o => !o) }
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Charge documents + facets à chaque changement de base ──
  useEffect(() => {
    if (!activeDb) return
    setDocsLoading(true); setDocsError(null); setActiveDoc(null); setToc([]); setChunks([])
    Promise.all([
      api.library.getDocuments(activeDb, 1, 100),
      api.library.getFacets(activeDb).catch(() => null),
    ])
      .then(([docsRes, facetsRes]) => {
        setDocuments(docsRes.data ?? [])
        setFacets(facetsRes)
      })
      .catch(e => setDocsError(e instanceof Error ? e.message : t('common.error_generic')))
      .finally(() => setDocsLoading(false))
  }, [activeDb, t])

  // ── Charge le curriculum (aggregates) à chaque changement de base ──
  useEffect(() => {
    if (!activeDb) { setCurriculum(null); return }
    setCurriculumLoading(true)
    let alive = true
    api.library.getCurriculum(activeDb)
      .then(res => { if (alive) setCurriculum(res) })
      .catch(() => { if (alive) setCurriculum(null) })
      .finally(() => { if (alive) setCurriculumLoading(false) })
    return () => { alive = false }
  }, [activeDb])

  // ── Charge le manifeste des scans à l'ouverture de l'onglet Scans (Mode Repli) ──
  useEffect(() => {
    if (!activeDb || tab !== 'scans') return
    setScansLoading(true)
    let alive = true
    api.library.getPageScans(activeDb)
      .then(res => { if (alive) { setScanManifest(res.pages ?? []); setScanPage(1) } })
      .catch(() => { if (alive) setScanManifest([]) })
      .finally(() => { if (alive) setScansLoading(false) })
    return () => { alive = false }
  }, [activeDb, tab])

  const updateClassicUrl = useCallback((updates: { db?: string; tab?: Tab; documentId?: string | null; pdfPage?: number | null; chunkId?: string | null }) => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      if (updates.db) next.set('db', updates.db)
      if (updates.tab) next.set('tab', updates.tab)
      if (updates.documentId === null) next.delete('doc')
      else if (updates.documentId) next.set('doc', updates.documentId)
      if (updates.pdfPage === null) next.delete('page')
      else if (updates.pdfPage != null) next.set('page', String(updates.pdfPage))
      if (updates.chunkId === null) next.delete('chunk')
      else if (updates.chunkId) next.set('chunk', updates.chunkId)
      return next
    }, { replace: true })
  }, [setParams])

  const loadDocument = useCallback(async (doc: Document, pdfPage = 1, chunkId: string | null = null, dbName = activeDb) => {
    if (!dbName) return
    const safePdfPage = Math.max(1, Math.min(pdfPage, doc.total_pages || pdfPage))
    setActiveDoc(doc); setPage(safePdfPage); setHighlightChunkId(chunkId)
    setChunksLoading(true); setChunksError(null)
    updateClassicUrl({ db: dbName, tab: 'explore', documentId: doc.id, pdfPage: safePdfPage, chunkId })
    try {
      const [tocRes, chunksRes] = await Promise.all([
        api.library.getToc(dbName, doc.id).catch(() => ({ toc: [] as TocNode[] })),
        // `page` est la pagination API. La page PDF se filtre explicitement afin de
        // ne jamais confondre la Nᵉ page du document avec la Nᵉ page de résultats.
        api.library.getChunks(dbName, doc.id, 1, { page_start: safePdfPage, page_end: safePdfPage }),
      ])
      setToc(tocRes.toc ?? [])
      setChunks(chunksRes.chunks ?? [])
      setTotalPages(doc.total_pages ?? 0)
    } catch (e) {
      setChunksError(e instanceof Error ? e.message : t('common.error_generic'))
    } finally {
      setChunksLoading(false)
    }
  }, [activeDb, t, updateClassicUrl])

  const goToPage = useCallback(async (pdfPage: number) => {
    if (!activeDoc || !activeDb) return
    const safePdfPage = Math.max(1, Math.min(pdfPage, totalPages || pdfPage))
    setPage(safePdfPage)
    setHighlightChunkId(null)
    updateClassicUrl({ db: activeDb, tab: 'explore', documentId: activeDoc.id, pdfPage: safePdfPage, chunkId: null })
    if (chunks.some(chunk => chunk.page_number === safePdfPage)) return
    try {
      const response = await api.library.getChunks(activeDb, activeDoc.id, 1, { page_start: safePdfPage, page_end: safePdfPage })
      setChunks(previous => {
        const existing = new Set(previous.map(chunk => chunk.id))
        return [...previous, ...(response.chunks ?? []).filter(chunk => !existing.has(chunk.id))]
      })
    } catch { /* le scan reste navigable même sans chunk texte */ }
  }, [activeDb, activeDoc, chunks, totalPages, updateClassicUrl])

  // Restaure une navigation partageable base/onglet/document/page après chargement des documents.
  useEffect(() => {
    if (!activeDb || documents.length === 0 || tab !== 'explore') return
    const documentId = params.get('doc')
    if (!documentId || activeDoc?.id === documentId) return
    const linkedDocument = documents.find(document => document.id === documentId)
    if (!linkedDocument) return
    const linkedPage = Math.max(1, Number(params.get('page')) || 1)
    void loadDocument(linkedDocument, linkedPage, params.get('chunk'))
  }, [activeDb, activeDoc?.id, documents, loadDocument, params, tab])

  const openScanPage = (entry: PageScanManifestEntry) => {
    const doc = documents.find(d => d.id === entry.document_id)
    if (!doc) return
    setTab('explore')
    if (activeDoc?.id === doc.id) void goToPage(entry.page_number)
    else void loadDocument(doc, entry.page_number)
  }

  const onSelectResult = async (result: SearchResult) => {
    const resultDb = result.database_filename ?? activeDb
    if (!resultDb) return
    setTab('explore')
    let resultDocuments = documents
    if (resultDb !== activeDb) {
      setActiveDb(resultDb)
      try {
        resultDocuments = (await api.library.getDocuments(resultDb, 1, 100)).data ?? []
      } catch { resultDocuments = [] }
    }
    const doc = resultDocuments.find(document => document.id === result.document_id)
    if (!doc) return
    await loadDocument(doc, result.page_number, result.chunk_id, resultDb)
    window.setTimeout(() => document.getElementById(`chunk-${result.chunk_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200)
  }

  const selectTab = (nextTab: Tab) => {
    setTab(nextTab)
    updateClassicUrl({ db: activeDb ?? undefined, tab: nextTab })
  }

  const onSelectSource = (s: AskSource) => {
    void onSelectResult({
      chunk_id: s.chunk_id, document_id: s.document_id, document_title: s.document_title,
      page_number: s.page_number, section_title: null, pedagogical_type: null,
      content_markdown: '', rrf_score: s.rrf_score, bm25_rank: null, vec_rank: null,
    })
  }

  const activeDbInfo = databases.find(d => d.filename === activeDb)

  if (!dbLoading && databases.length === 0) {
    return (
      <div className="container-app" style={{ paddingTop: 24 }}>
        <TopbarLite />
        <OnboardingEmptyState />
      </div>
    )
  }

  // ── Anti-flash : attend la décision curriculum avant de choisir la vue ──
  if (activeDb && curriculumLoading && curriculum === null) {
    return (
      <div className="container-app" style={{ paddingTop: 24 }}>
        <TopbarLite />
        <Spinner label={t('common.loading')} />
      </div>
    )
  }

  // ── Coquille pixel-perfect (library.php) TOUJOURS ACTIVE dès qu'une base est
  //    chargée : avec curriculum → 6 onglets complets ; sans curriculum → onglets
  //    Cours/Exercices/Évaluations/Scans fonctionnels + empty-states élégants pour
  //    Matrice/Programme. Le « Mode Repli Générique » reste accessible via ?classic=1. ──
  const classicMode = params.get('classic') === '1'
  if (activeDb && curriculum && !classicMode) {
    return (
      <CurriculumWorkspace
        activeDb={activeDb}
        databases={databases}
        onSelectDb={db => {
          setActiveDb(db)
          updateClassicUrl({ db, documentId: null, pdfPage: null, chunkId: null })
        }}
        curriculum={curriculum}
      />
    )
  }

  // ── Mode Repli Générique (classique) — accessible via ?classic=1 (lien discret) ──
  return (
    <div className="app-layout">
      {/* Sidebar (Mode Repli Générique : sélecteur de base + navigation) */}
      <aside className={`app-sidebar ${sidebarOpen ? 'show-sidebar' : ''}`}>
        <div style={{ padding: 20, borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--engine-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            <i className="fa-solid fa-atom" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, color: '#fff' }}>{t('app.hub')}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{t('app.subtitle')}</div>
          </div>
          <button className="modal-close" style={{ color: '#94a3b8' }} onClick={() => setSidebarOpen(false)} aria-label="close">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
          <label style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 700 }}>{t('db.select')}</label>
          <select
            className="form-select"
            style={{ marginTop: 6, marginBottom: 18, background: 'var(--sidebar-bg-secondary)', color: '#fff', borderColor: 'rgba(255,255,255,0.15)' }}
            value={activeDb ?? ''}
            onChange={e => {
              const db = e.target.value
              setActiveDb(db)
              setActiveDoc(null); setPage(1); setHighlightChunkId(null)
              updateClassicUrl({ db, documentId: null, pdfPage: null, chunkId: null })
            }}
          >
            {databases.map(d => <option key={d.filename} value={d.filename}>{d.filename}</option>)}
          </select>

          <div style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 700, marginBottom: 8 }}>{t('library.documents')}</div>
          {docsLoading ? <SkeletonRows count={4} /> : docsError ? <ErrorBanner message={docsError} /> : documents.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: '0.85rem' }}>{t('common.empty')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {documents.map(doc => (
                <button
                  key={doc.id}
                  className={`sidebar-nav-btn ${activeDoc?.id === doc.id ? 'active' : ''}`}
                  onClick={() => loadDocument(doc)}
                  dir="auto"
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title || doc.filename}</span>
                  <span className="badge badge-subtle">{doc.total_pages}</span>
                </button>
              ))}
            </div>
          )}

          {toc.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 700, marginBottom: 8 }}>{t('library.toc')}</div>
              <div style={{ color: '#cbd5e1' }}>
                <TOCExplorer nodes={toc} onSelectPage={goToPage} activePage={page} />
              </div>
            </div>
          )}

          {facets && (
            <div style={{ marginTop: 20 }}>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 700, marginBottom: 8 }}>{t('library.facets')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {facets.domains.map((f, i) => (
                  <span key={i} className="badge" style={domainBadgeStyle(f.domain ?? '?', theme)}>
                    {f.domain} ({f.count})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ThemeToggle />
          <Link to="/automation" className="btn btn-outline-success btn-sm rounded-pill"><i className="fa-solid fa-gears" /> {t('nav.automation')}</Link>
          <Link to="/" className="btn btn-primary btn-sm rounded-pill"><i className="fa-solid fa-gauge" /> {t('nav.dashboard')}</Link>
        </div>
      </aside>

      {/* Workspace */}
      <div className={`app-workspace ${sidebarOpen ? 'with-sidebar' : ''}`}>
        <div className="workspace-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setSidebarOpen(o => !o)} aria-label="toggle sidebar">
              <i className="fa-solid fa-bars" />
            </button>
            <Link to="/" className="btn btn-outline-primary btn-sm rounded-pill"><i className="fa-solid fa-house" /> {t('nav.back_portal')}</Link>
            <Link to="/library" className="btn btn-outline-warning btn-sm rounded-pill" title={t('library.back_workspace')}>
              <i className="fa-solid fa-table-cells-large" /> {t('library.back_workspace')}
            </Link>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }} dir="auto">
              {activeDb} {activeDoc ? `/ ${activeDoc.title || activeDoc.filename}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <EngineBadge />
            {activeDbInfo && (
              <span className="badge badge-success">
                <i className="fa-solid fa-circle-check" /> {t('db.active')} · {formatBytes(activeDbInfo.size_bytes)}
              </span>
            )}
            <LanguageSelector />
          </div>
        </div>

        <div style={{ padding: 24, flex: 1 }}>
          {/* Onglets */}
          <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            <TabBtn active={tab === 'explore'} onClick={() => selectTab('explore')} icon="fa-book-open" label={t('library.documents')} />
            <TabBtn active={tab === 'scans'} onClick={() => selectTab('scans')} icon="fa-images" label={t('library.scans_gallery')} />
            <TabBtn active={tab === 'search'} onClick={() => selectTab('search')} icon="fa-magnifying-glass" label={t('library.search_studio')} />
            <TabBtn active={tab === 'ask'} onClick={() => selectTab('ask')} icon="fa-comments" label={t('library.ask_studio')} />
          </div>

          <div className="workspace-tab" role="tabpanel">
            {!activeDb ? <Spinner label={t('common.loading')} /> : tab === 'explore' ? (
              !activeDoc ? (
                <EmptyState icon="fa-book-open" title={t('library.no_document_selected')}>
                  <p>{t('library.select_document')}</p>
                </EmptyState>
              ) : chunksLoading ? (
                <Spinner label={t('common.loading')} />
              ) : chunksError ? (
                <ErrorBanner message={chunksError} onRetry={() => activeDoc && loadDocument(activeDoc)} />
              ) : (
                <div className="auto-card">
                  <SideBySideViewer
                    db={activeDb}
                    documentId={activeDoc.id}
                    page={page}
                    totalPages={totalPages}
                    chunks={chunks}
                    onPrev={() => goToPage(Math.max(1, page - 1))}
                    onNext={() => goToPage(page + 1)}
                    highlightChunkId={highlightChunkId}
                    onEditChunk={setEditingChunk}
                  />
                </div>
              )
            ) : tab === 'scans' ? (
              <div className="auto-card">
                <FallbackScansGallery
                  activeDb={activeDb}
                  manifest={scanManifest}
                  loading={scansLoading}
                  documents={documents}
                  docFilter={scanDocFilter}
                  onDocFilter={f => { setScanDocFilter(f); setScanPage(1) }}
                  gridPage={scanPage}
                  onGridPage={setScanPage}
                  onOpenPage={openScanPage}
                />
              </div>
            ) : tab === 'search' ? (
              <div className="auto-card"><SearchStudio activeDb={activeDb} onSelectResult={onSelectResult} /></div>
            ) : (
              <div className="auto-card" style={{ minHeight: 480 }}><AskStudio activeDb={activeDb} onSelectSource={onSelectSource} /></div>
            )}
          </div>
        </div>
      </div>

      <button className="floating-sidebar-toggle" onClick={() => setSidebarOpen(o => !o)} aria-label="toggle sidebar">
        <i className="fa-solid fa-bars" />
      </button>

      {editingChunk && activeDb && (
        <ChunkEditor
          chunk={editingChunk}
          activeDb={activeDb}
          documentId={activeDoc?.id}
          open={!!editingChunk}
          onClose={() => setEditingChunk(null)}
          onSaved={(updated) => {
            setChunks(prev => prev.map(c => (c.id === updated.id ? updated : c)))
            setEditingChunk(null)
          }}
        />
      )}
    </div>
  )
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button role="tab" aria-selected={active} className={`btn ${active ? 'btn-primary' : 'btn-outline-secondary'} rounded-pill`} onClick={onClick}>
      <i className={`fa-solid ${icon}`} /> {label}
    </button>
  )
}

function TopbarLite() {
  const { t } = useLanguage()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
      <Link to="/" className="btn btn-outline-primary btn-sm rounded-pill"><i className="fa-solid fa-house" /> {t('nav.back_portal')}</Link>
      <div style={{ display: 'flex', gap: 8 }}><LanguageSelector /><ThemeToggle /></div>
    </div>
  )
}

/**
 * §5.2 (préambule) — Galerie de scans générique du Mode Repli : grille de vignettes
 * (manifeste page_scans + thumb=true), filtre par document si plusieurs, pagination
 * client, clic → ouvre la page dans le SideBySideViewer. Aucune donnée en dur.
 */
const SCANS_PER_PAGE = 24
function FallbackScansGallery({
  activeDb, manifest, loading, documents, docFilter, onDocFilter, gridPage, onGridPage, onOpenPage,
}: {
  activeDb: string
  manifest: PageScanManifestEntry[]
  loading: boolean
  documents: Document[]
  docFilter: string
  onDocFilter: (f: string) => void
  gridPage: number
  onGridPage: (p: number) => void
  onOpenPage: (entry: PageScanManifestEntry) => void
}) {
  const { t } = useLanguage()
  const multiDoc = documents.length > 1
  const filtered = docFilter === 'all' ? manifest : manifest.filter(e => e.document_id === docFilter)
  const totalGridPages = Math.max(1, Math.ceil(filtered.length / SCANS_PER_PAGE))
  const safePage = Math.min(gridPage, totalGridPages)
  const slice = filtered.slice((safePage - 1) * SCANS_PER_PAGE, safePage * SCANS_PER_PAGE)
  const docTitle = (id: string) => documents.find(d => d.id === id)?.title || documents.find(d => d.id === id)?.filename || id

  if (loading) return <Spinner label={t('common.loading')} />
  if (manifest.length === 0) return <EmptyState icon="fa-images" title={t('library.no_scans')} />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <i className="fa-solid fa-images" style={{ color: 'var(--warning)' }} /> {t('library.scans_gallery_title')} ({filtered.length})
        </h4>
        {multiDoc && (
          <select
            className="form-select"
            style={{ maxWidth: 320 }}
            value={docFilter}
            onChange={e => onDocFilter(e.target.value)}
            dir="auto"
          >
            <option value="all">{t('library.all_documents')}</option>
            {documents.map(d => <option key={d.id} value={d.id}>{d.title || d.filename}</option>)}
          </select>
        )}
      </div>

      <div className="scan-grid-row" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {slice.map(entry => (
          <div key={`${entry.document_id}_${entry.page_number}`} className="scan-grid-card scan-card-flex">
            <div className="scan-thumb-wrap" onClick={() => onOpenPage(entry)} title={`${t('library.page')} ${entry.page_number}`}>
              <img
                src={api.library.getPageScanUrl(activeDb, entry.document_id, entry.page_number, true)}
                loading="lazy"
                alt={`${t('library.scan')} ${entry.page_number}`}
              />
              <span className="badge badge-primary scan-badge-page font-num">{t('library.page')} {entry.page_number}</span>
            </div>
            <div className="scan-card-body">
              <small className="scan-chapter-title" dir="auto" title={entry.chapter_title ?? docTitle(entry.document_id)}>
                <i className="fa-solid fa-book-bookmark" style={{ color: 'var(--primary)' }} /> {entry.chapter_title ?? docTitle(entry.document_id)}
              </small>
            </div>
          </div>
        ))}
      </div>

      {totalGridPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => onGridPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}>
            <i className="fa-solid fa-chevron-right" /> {t('library.prev_page')}
          </button>
          <span className="badge badge-subtle font-num">{safePage} / {totalGridPages}</span>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => onGridPage(Math.min(totalGridPages, safePage + 1))} disabled={safePage >= totalGridPages}>
            {t('library.next_page')} <i className="fa-solid fa-chevron-left" />
          </button>
        </div>
      )}
    </div>
  )
}
