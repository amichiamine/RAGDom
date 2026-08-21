import { useEffect, useMemo, useRef, useState } from 'react'
import { Save, X, UserPen, CircleCheck, TriangleAlert, CircleAlert, Image as ImageIcon, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { Chunk } from '@/types'
import { api } from '@/lib/api'
import { useToast } from '@/components/common/Toast'
import { useLanguage } from '@/contexts/LanguageContext'
import Modal from '@/components/common/Modal'
import MarkdownKatex from '@/components/library/MarkdownKatex'
import ImageModal from '@/components/library/curriculum/ImageModal'

interface Props {
  chunk: Chunk
  activeDb: string
  /** §7.3 — document du chunk : requis pour afficher le scan original de la page en rappel. */
  documentId?: string
  open: boolean
  onClose: () => void
  /** Rappelé avec le chunk fusionné après enregistrement réussi. */
  onSaved: (updated: Chunk) => void
}

type LintLevel = 'ok' | 'warning' | 'error'
interface LintNote { level: LintLevel; message: string }

/** Lint local (avant envoi) : longueur + parité des `$$` / `$`. */
function lintLocal(md: string): LintNote[] {
  const notes: LintNote[] = []
  const len = md.trim().length
  if (len === 0) notes.push({ level: 'error', message: 'Contenu vide' })
  else if (len < 12) notes.push({ level: 'warning', message: `Contenu très court (${len} caractères)` })
  else notes.push({ level: 'ok', message: `${len} caractères` })

  const displayCount = (md.match(/\$\$/g) || []).length
  if (displayCount % 2 !== 0) notes.push({ level: 'error', message: 'Blocs $$ …$$ non appariés' })

  // $ inline : on retire d'abord les $$ pour ne compter que les délimiteurs inline.
  const inlineCount = (md.replace(/\$\$/g, '').match(/\$/g) || []).length
  if (inlineCount % 2 !== 0) notes.push({ level: 'warning', message: 'Délimiteurs $ inline potentiellement non appariés' })

  return notes
}

/** Résultat de lint renvoyé par le backend (forme tolérante). */
function normalizeServerLint(lint: unknown): LintNote[] {
  if (!lint) return []
  if (Array.isArray(lint)) {
    return lint.map(item => {
      if (typeof item === 'string') return { level: 'warning' as LintLevel, message: item }
      const obj = item as Record<string, unknown>
      const lvl = String(obj.level ?? obj.severity ?? 'warning')
      const level: LintLevel = lvl === 'error' ? 'error' : lvl === 'ok' || lvl === 'success' ? 'ok' : 'warning'
      return { level, message: String(obj.message ?? obj.detail ?? JSON.stringify(item)) }
    })
  }
  if (typeof lint === 'object') {
    const obj = lint as Record<string, unknown>
    const errors = Array.isArray(obj.errors) ? obj.errors : []
    const warnings = Array.isArray(obj.warnings) ? obj.warnings : []
    const out: LintNote[] = []
    for (const e of errors) out.push({ level: 'error', message: String(e) })
    for (const w of warnings) out.push({ level: 'warning', message: String(w) })
    if (out.length === 0 && obj.status) out.push({ level: obj.status === 'ok' ? 'ok' : 'warning', message: String(obj.status) })
    return out
  }
  return [{ level: 'warning', message: String(lint) }]
}

function LintRow({ note }: { note: LintNote }) {
  const Icon = note.level === 'ok' ? CircleCheck : note.level === 'error' ? CircleAlert : TriangleAlert
  const cls = note.level === 'ok' ? 'chunk-lint-ok' : note.level === 'error' ? 'chunk-lint-error' : 'chunk-lint-warning'
  return (
    <div className={`chunk-lint-row ${cls}`}>
      <Icon size={14} />
      <span>{note.message}</span>
    </div>
  )
}

/** §7.4 ChunkEditor — édition Markdown/KaTeX d'un chunk avec aperçu live + lint. */
export default function ChunkEditor({ chunk, activeDb, documentId, open, onClose, onSaved }: Props) {
  const toast = useToast()
  const { t } = useLanguage()
  const [value, setValue] = useState(chunk.content_markdown)
  const [debounced, setDebounced] = useState(chunk.content_markdown)
  const [saving, setSaving] = useState(false)
  const [serverLint, setServerLint] = useState<LintNote[]>([])
  // §7.3 : colonne de rappel du scan original — repliée par défaut (préserve la place
  // du couple textarea/aperçu ; l'éditeur reste le focus principal).
  const [showScan, setShowScan] = useState(false)
  const [scanModalOpen, setScanModalOpen] = useState(false)

  // URLs du scan de la page du chunk (image pleine pour le rappel + la modale HD,
  // vignette en repli onError). Seulement si le document est connu (§7.3).
  const scanUrl = useMemo(
    () => (documentId ? api.library.getPageScanUrl(activeDb, documentId, chunk.page_number, false) : null),
    [activeDb, documentId, chunk.page_number],
  )
  const scanThumbUrl = useMemo(
    () => (documentId ? api.library.getPageScanUrl(activeDb, documentId, chunk.page_number, true) : null),
    [activeDb, documentId, chunk.page_number],
  )

  // Réinitialise à l'ouverture d'un nouveau chunk.
  useEffect(() => {
    if (open) {
      setValue(chunk.content_markdown)
      setDebounced(chunk.content_markdown)
      setServerLint([])
    }
  }, [open, chunk.id, chunk.content_markdown])

  // Debounce 300ms de l'aperçu.
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDebounced(value), 300)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [value])

  const localLint = useMemo(() => lintLocal(value), [value])
  const dirty = value !== chunk.content_markdown
  const hasError = localLint.some(n => n.level === 'error')

  const save = async () => {
    setSaving(true)
    try {
      const res = await api.library.updateChunk(activeDb, chunk.id, { content_markdown: value }) as {
        updated?: boolean; lint?: unknown; is_human_edited?: 0 | 1
      }
      setServerLint(normalizeServerLint(res.lint))
      const merged: Chunk = {
        ...chunk,
        content_markdown: value,
        is_human_edited: (res.is_human_edited ?? 1) as 0 | 1,
        updated_at: new Date().toISOString(),
      }
      onSaved(merged)
      toast.success('Chunk enregistré — corrigé manuellement')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec de l’enregistrement')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      size="xl"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <UserPen size={18} /> Édition du chunk · page {chunk.page_number}
          {chunk.is_human_edited === 1 && (
            <span className="badge badge-human-edited" title="محمي من عمليات التطهير وإعادة الإدماج">
              <UserPen size={12} /> مصحّح يدويًا
            </span>
          )}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            <X size={15} /> Annuler
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty || hasError}>
            <Save size={15} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <div className={`chunk-editor-grid${showScan && scanUrl ? ' with-scan' : ''}`}>
        <div className="chunk-editor-col">
          <div className="chunk-editor-label-row">
            <label className="chunk-editor-label">Markdown / LaTeX</label>
            {scanUrl && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm rounded-pill chunk-editor-scan-toggle"
                onClick={() => setShowScan(s => !s)}
                aria-pressed={showScan}
                title={showScan ? t('library.editor_hide_scan') : t('library.editor_show_scan')}
              >
                {showScan ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
                {showScan ? t('library.editor_hide_scan') : t('library.editor_show_scan')}
              </button>
            )}
          </div>
          <textarea
            className="form-textarea form-mono chunk-editor-textarea"
            dir="auto"
            value={value}
            onChange={e => setValue(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="chunk-editor-col">
          <label className="chunk-editor-label">Aperçu live</label>
          <div className="chunk-editor-preview content-box">
            <MarkdownKatex raw={debounced} />
          </div>
        </div>
        {showScan && scanUrl && (
          <div className="chunk-editor-col">
            <label className="chunk-editor-label">
              <ImageIcon size={13} /> {t('library.editor_original_scan')} · {t('library.page')} {chunk.page_number}
            </label>
            <div className="chunk-editor-scan content-box">
              <img
                src={scanUrl}
                alt={`${t('library.editor_original_scan')} — ${t('library.page')} ${chunk.page_number}`}
                loading="lazy"
                className="chunk-editor-scan-img"
                onClick={() => setScanModalOpen(true)}
                onError={e => {
                  const img = e.currentTarget
                  if (scanThumbUrl && img.src !== scanThumbUrl) img.src = scanThumbUrl
                  else { img.style.display = 'none'; img.parentElement?.setAttribute('data-broken', 'true') }
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="chunk-lint-panel">
        {localLint.map((n, i) => <LintRow key={`l${i}`} note={n} />)}
        {serverLint.length > 0 && (
          <>
            <div className="chunk-lint-divider">Résultat serveur (lint / ré-embed)</div>
            {serverLint.map((n, i) => <LintRow key={`s${i}`} note={n} />)}
          </>
        )}
      </div>

      {scanUrl && (
        <ImageModal
          open={scanModalOpen}
          title={`${t('library.editor_original_scan')} — ${t('library.page')} ${chunk.page_number}`}
          src={scanUrl}
          fallbackSrc={scanThumbUrl ?? undefined}
          onClose={() => setScanModalOpen(false)}
        />
      )}
    </Modal>
  )
}
