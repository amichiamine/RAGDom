import { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '@/lib/api'
import type { SourceNode } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import { Spinner, ErrorBanner, EmptyState } from '@/components/common/Feedback'
import { formatBytes } from '@/lib/utils'

// Caractères sûrs pour un nom de dossier (miroir du garde-fou back _REL_RE : lettres/chiffres/_-.espace).
const FOLDER_NAME_RE = /^[\w\- .]{1,60}$/

const ROOT_REL = '' // racine de /sources/

function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

/**
 * §7.6 SourcesManager (V3.8) — arbre NAVIGABLE + sélection de dossier cible,
 * création de sous-dossiers (imbrication illimitée) et upload DANS le dossier
 * sélectionné (rel_path transmis). Le nommage des bases dépend du chemin.
 */
export default function SourcesManager({ onChanged }: { onChanged?: () => void }) {
  const { t } = useLanguage()
  const toast = useToast()
  const [tree, setTree] = useState<SourceNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // Dossier cible sélectionné (rel_path ; '' = racine).
  const [selectedRel, setSelectedRel] = useState<string>(ROOT_REL)
  // Saisie inline « nouveau dossier ».
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    api.system.getSources()
      .then(res => setTree(res.tree))
      .catch(e => setError(e instanceof Error ? e.message : t('common.error_generic')))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(() => { load() }, [load])

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('rel_path', selectedRel) // dossier cible (vide = racine)
        await api.system.uploadSource(fd)
      }
      toast.success(t('buttons.upload'))
      load()
      onChanged?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const createFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    if (!FOLDER_NAME_RE.test(name)) { toast.error(t('sources.folder_name_invalid')); return }
    setCreatingFolder(true)
    try {
      const rel = joinRel(selectedRel, name)
      await api.system.createSourceFolder(rel)
      toast.success(t('buttons.new_folder'))
      setNewFolderName(''); setNewFolderOpen(false)
      setSelectedRel(rel) // on bascule la cible sur le dossier fraîchement créé
      load()
      onChanged?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
    finally { setCreatingFolder(false) }
  }

  const deleteFile = async (relPath: string) => {
    if (!window.confirm(t('sources.confirm_delete_file'))) return
    try {
      await api.system.deleteSource(relPath)
      toast.success(t('buttons.delete'))
      load()
      onChanged?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
  }

  // Fil d'Ariane : segments cliquables jusqu'à la racine.
  const crumbs = selectedRel ? selectedRel.split('/') : []
  const uploadLabel = selectedRel
    ? `${t('sources.upload_into')} ${selectedRel}`
    : `${t('sources.upload_into')} ${t('sources.root')}`

  return (
    <div className="auto-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}>📁 {t('sources.title')}</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-outline-secondary" onClick={() => setNewFolderOpen(o => !o)} disabled={creatingFolder}>
            <i className="fa-solid fa-folder-plus" /> {t('buttons.new_folder')}
          </button>
          <input ref={fileRef} type="file" accept="application/pdf" multiple style={{ display: 'none' }} onChange={e => upload(e.target.files)} />
          <button className="btn btn-sm btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading} title={uploadLabel}>
            {uploading ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-upload" />} {uploadLabel}
          </button>
        </div>
      </div>

      {/* Fil d'Ariane du dossier cible */}
      <div className="db-badge-row" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 4 }}>
        <span className="provider-mini-label" style={{ marginInlineEnd: 6 }}>{t('sources.target_folder')} :</span>
        <button
          className={`btn btn-sm ${selectedRel === ROOT_REL ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => setSelectedRel(ROOT_REL)}
        >
          <i className="fa-solid fa-house" /> {t('sources.root')}
        </button>
        {crumbs.map((seg, i) => {
          const rel = crumbs.slice(0, i + 1).join('/')
          return (
            <span key={rel} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--text-muted)' }}>/</span>
              <button
                className={`btn btn-sm ${rel === selectedRel ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setSelectedRel(rel)}
              >
                {seg}
              </button>
            </span>
          )
        })}
      </div>

      {/* Saisie inline « nouveau dossier » */}
      {newFolderOpen && (
        <div className="provider-addkey" style={{ marginBottom: 12 }}>
          <input
            className="form-input"
            placeholder={t('sources.new_folder_placeholder')}
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void createFolder() }}
            disabled={creatingFolder}
            autoFocus
          />
          <button className="btn btn-primary btn-sm" disabled={creatingFolder || !newFolderName.trim()} onClick={createFolder}>
            {creatingFolder ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-check" />} {t('buttons.confirm')}
          </button>
          <button className="btn btn-sm btn-outline-secondary" disabled={creatingFolder} onClick={() => { setNewFolderOpen(false); setNewFolderName('') }}>
            {t('buttons.cancel')}
          </button>
        </div>
      )}

      {loading ? <Spinner /> : error ? <ErrorBanner message={error} onRetry={load} /> : tree.length === 0 ? (
        <EmptyState icon="fa-folder-open" title={t('sources.empty')}>
          <p style={{ color: 'var(--text-muted)' }}>{t('sources.drop_hint')}</p>
        </EmptyState>
      ) : (
        <div>{tree.map(n => (
          <SourceTreeNode
            key={n.rel_path}
            node={n}
            depth={0}
            selectedRel={selectedRel}
            onSelectFolder={setSelectedRel}
            onDeleteFile={deleteFile}
          />
        ))}</div>
      )}

      {/* Aide : le nommage des bases dépend du chemin. */}
      <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>{t('sources.db_naming_hint')}</p>
    </div>
  )
}

interface NodeProps {
  node: SourceNode
  depth: number
  selectedRel: string
  onSelectFolder: (rel: string) => void
  onDeleteFile: (relPath: string) => void
}

function SourceTreeNode({ node, depth, selectedRel, onSelectFolder, onDeleteFile }: NodeProps) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(depth === 0)
  // rel_path racine = '.' côté back → on le normalise en '' pour la sélection.
  const nodeRel = node.rel_path === '.' ? '' : node.rel_path
  const name = nodeRel.split('/').filter(Boolean).pop() || t('sources.root')
  const isSelected = nodeRel === selectedRel
  return (
    <div style={{ paddingInlineStart: depth * 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          className="btn btn-sm"
          style={{ padding: '2px 6px', background: 'transparent', border: 'none' }}
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'collapse' : 'expand'}
        >
          <i className={`fa-solid fa-chevron-${open ? 'down' : 'right'}`} style={{ color: 'var(--text-muted)' }} />
        </button>
        <button
          className={`dropdown-item ${isSelected ? 'is-active' : ''}`}
          style={{ fontWeight: 700, flex: 1, ...(isSelected ? { background: 'var(--bg-card-inner)', borderRadius: 8 } : {}) }}
          onClick={() => onSelectFolder(nodeRel)}
          title={t('sources.select_folder_target')}
        >
          <i className={`fa-solid ${open ? 'fa-folder-open' : 'fa-folder'}`} style={{ color: isSelected ? 'var(--primary)' : 'var(--warning)' }} />
          <span style={{ flex: 1, textAlign: 'start' }}>{name}</span>
          {isSelected && <span className="badge badge-primary">{t('sources.selected')}</span>}
        </button>
      </div>
      {open && (
        <div>
          {node.files.map(f => {
            const fileRel = joinRel(nodeRel, f.name)
            return (
              <div key={f.name} className="db-badge-row" style={{ marginBottom: 6, marginInlineStart: 28 }}>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                  <i className="fa-solid fa-file-pdf" style={{ color: 'var(--danger)' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                </span>
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <span className="badge badge-subtle">{formatBytes(f.size_bytes)}</span>
                  {f.ingested && <span className="badge badge-success">{t('sources.ingested')}</span>}
                  {f.target_db && <span className="badge badge-info">{f.target_db}</span>}
                  {!f.ingested && (
                    <button className="btn btn-sm btn-outline-danger" onClick={() => onDeleteFile(fileRel)} title={t('buttons.delete')}>
                      <i className="fa-solid fa-trash" />
                    </button>
                  )}
                </span>
              </div>
            )
          })}
          {node.folders.map(sf => (
            <SourceTreeNode
              key={sf.rel_path}
              node={sf}
              depth={depth + 1}
              selectedRel={selectedRel}
              onSelectFolder={onSelectFolder}
              onDeleteFile={onDeleteFile}
            />
          ))}
        </div>
      )}
    </div>
  )
}
