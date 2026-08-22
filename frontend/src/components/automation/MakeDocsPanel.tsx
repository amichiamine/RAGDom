import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import { Spinner, ErrorBanner } from '@/components/common/Feedback'
import Modal from '@/components/common/Modal'
import MarkdownContent from '@/components/common/MarkdownContent'

interface Props {
  open: boolean
  onClose: () => void
}

type View = 'contract' | 'prompts'
type Docs = { contract: string; prompts: string }

interface PromptBlock {
  title: string
  body: string
}

/**
 * Découpe un markdown en blocs sur les titres de niveau 2 (## …). Chaque bloc
 * conserve son titre + son corps (source markdown brute) pour un rendu + une
 * copie fidèles. Le préambule éventuel (avant le 1er ##) devient un bloc sans titre.
 */
function splitPromptBlocks(markdown: string): PromptBlock[] {
  const lines = markdown.split('\n')
  const blocks: PromptBlock[] = []
  let title = ''
  let buffer: string[] = []
  const flush = () => {
    const body = buffer.join('\n').trim()
    if (title || body) blocks.push({ title, body })
    buffer = []
  }
  for (const line of lines) {
    // Titre de niveau 2 STRICT : "## " (pas "###").
    const m = /^##\s+(?!#)(.*)$/.exec(line)
    if (m) {
      flush()
      title = m[1].trim()
    } else {
      buffer.push(line)
    }
  }
  flush()
  return blocks
}

/**
 * Panneau (modale) de consultation de la documentation Make.com (LECTURE seule,
 * route admin GET /system/docs/make). Bascule segmentée Contrat / Prompts,
 * rendu Markdown via MarkdownContent, et copie par bloc dans la vue Prompts.
 */
export default function MakeDocsPanel({ open, onClose }: Props) {
  const { t } = useLanguage()
  const toast = useToast()

  const [view, setView] = useState<View>('contract')
  const [docs, setDocs] = useState<Docs | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    api.system.getMakeDocs()
      .then(res => setDocs({ contract: res.contract ?? '', prompts: res.prompts ?? '' }))
      .catch(e => setError(e instanceof Error ? e.message : t('automation.make_docs.error')))
      .finally(() => setLoading(false))
  }, [t])

  // Chargement à l'ouverture (une fois par ouverture).
  useEffect(() => {
    if (open && !docs && !loading && !error) load()
  }, [open, docs, loading, error, load])

  // Réinitialisation à la fermeture pour repartir propre au prochain affichage.
  useEffect(() => {
    if (!open) { setView('contract'); setCopiedIdx(null) }
  }, [open])

  const promptBlocks = useMemo(
    () => (docs ? splitPromptBlocks(docs.prompts) : []),
    [docs],
  )

  const copyBlock = useCallback(async (block: PromptBlock, idx: number) => {
    const text = block.title ? `## ${block.title}\n\n${block.body}` : block.body
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(idx)
      toast.success(t('automation.make_docs.copied'))
      window.setTimeout(() => setCopiedIdx(prev => (prev === idx ? null : prev)), 1600)
    } catch {
      toast.error(t('automation.make_docs.error'))
    }
  }, [t, toast])

  return (
    <Modal open={open} onClose={onClose} title={t('automation.make_docs.title')} size="xl">
      {/* Bascule segmentée Contrat / Prompts */}
      <div className="segmented" role="tablist" aria-label={t('automation.make_docs.title')} style={{ display: 'inline-flex', gap: 4, marginBottom: 16 }}>
        <button
          type="button" role="tab" aria-selected={view === 'contract'}
          className={`btn btn-sm ${view === 'contract' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => setView('contract')}
        >
          {t('automation.make_docs.contract')}
        </button>
        <button
          type="button" role="tab" aria-selected={view === 'prompts'}
          className={`btn btn-sm ${view === 'prompts' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => setView('prompts')}
        >
          {t('automation.make_docs.prompts')}
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : !docs ? null : view === 'contract' ? (
        <MarkdownContent source={docs.contract} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {promptBlocks.map((block, idx) => (
            <div
              key={idx}
              className="auto-card"
              style={{ padding: 16, position: 'relative' }}
            >
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${copiedIdx === idx ? 'btn-success' : 'btn-outline-primary'}`}
                  onClick={() => copyBlock(block, idx)}
                >
                  <i className={`fa-solid ${copiedIdx === idx ? 'fa-check' : 'fa-copy'}`} />{' '}
                  {copiedIdx === idx ? t('automation.make_docs.copied') : t('automation.make_docs.copy')}
                </button>
              </div>
              <MarkdownContent source={block.title ? `## ${block.title}\n\n${block.body}` : block.body} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
