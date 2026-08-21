import { useEffect, useState, useRef } from 'react'
import { api } from '@/lib/api'
import type { SourceNode } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import { Spinner, ErrorBanner, EmptyState } from '@/components/common/Feedback'
import { formatBytes } from '@/lib/utils'

/** §7.6 SourcesManager (simple) — arbre getSources + upload input. */
export default function SourcesManager({ onChanged }: { onChanged?: () => void }) {
  const { t } = useLanguage()
  const toast = useToast()
  const [tree, setTree] = useState<SourceNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => {
    setLoading(true); setError(null)
    api.system.getSources()
      .then(res => setTree(res.tree))
      .catch(e => setError(e instanceof Error ? e.message : t('common.error_generic')))
      .finally(() => setLoading(false))
  }

  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        await api.system.uploadSource(fd)
      }
      toast.success(t('buttons.upload'))
      load()
      onChanged?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div className="auto-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}>📁 {t('sources.title')}</h3>
        <div>
          <input ref={fileRef} type="file" accept="application/pdf" multiple style={{ display: 'none' }} onChange={e => upload(e.target.files)} />
          <button className="btn btn-sm btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-upload" />} {t('buttons.upload')}
          </button>
        </div>
      </div>

      {loading ? <Spinner /> : error ? <ErrorBanner message={error} onRetry={load} /> : tree.length === 0 ? (
        <EmptyState icon="fa-folder-open" title={t('sources.empty')}>
          <p style={{ color: 'var(--text-muted)' }}>{t('sources.drop_hint')}</p>
        </EmptyState>
      ) : (
        <div>{tree.map(n => <SourceTreeNode key={n.rel_path} node={n} depth={0} />)}</div>
      )}
    </div>
  )
}

function SourceTreeNode({ node, depth }: { node: SourceNode; depth: number }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(depth === 0)
  const name = node.rel_path.split('/').filter(Boolean).pop() || node.rel_path || '/'
  return (
    <div style={{ paddingInlineStart: depth * 14 }}>
      <button className="dropdown-item" style={{ fontWeight: 700 }} onClick={() => setOpen(o => !o)}>
        <i className={`fa-solid ${open ? 'fa-folder-open' : 'fa-folder'}`} style={{ color: 'var(--warning)' }} />
        <span style={{ flex: 1, textAlign: 'start' }}>{name}</span>
      </button>
      {open && (
        <div>
          {node.files.map(f => (
            <div key={f.name} className="db-badge-row" style={{ marginBottom: 6, marginInlineStart: 14 }}>
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                <i className="fa-solid fa-file-pdf" style={{ color: 'var(--danger)' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
              </span>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className="badge badge-subtle">{formatBytes(f.size_bytes)}</span>
                {f.ingested && <span className="badge badge-success">{t('sources.ingested')}</span>}
                {f.target_db && <span className="badge badge-info">{f.target_db}</span>}
              </span>
            </div>
          ))}
          {node.folders.map(sf => <SourceTreeNode key={sf.rel_path} node={sf} depth={depth + 1} />)}
        </div>
      )}
    </div>
  )
}
