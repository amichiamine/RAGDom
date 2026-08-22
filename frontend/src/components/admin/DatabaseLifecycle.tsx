import { useState } from 'react'
import { Database, Download, Copy, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { DatabaseInfo } from '@/types'
import { useToast } from '@/components/common/Toast'
import Modal from '@/components/common/Modal'
import { formatBytes, formatDate } from '@/lib/utils'

interface Props {
  databases: DatabaseInfo[]
  /** Rafraîchit le DatabaseContext après duplication/suppression. */
  onChanged: () => void
}

/** §7.8 DatabaseLifecycle — Exporter / Dupliquer / Supprimer (double saisie). */
export default function DatabaseLifecycle({ databases, onChanged }: Props) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const [dupTarget, setDupTarget] = useState<DatabaseInfo | null>(null)
  const [dupName, setDupName] = useState('')

  const [delTarget, setDelTarget] = useState<DatabaseInfo | null>(null)
  const [delConfirm, setDelConfirm] = useState('')

  const doExport = async (filename: string) => {
    setBusy(true)
    try {
      await api.system.downloadDatabaseExport(filename)
      toast.success(`Export téléchargé : ${filename}`)
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec de l'export") }
    finally { setBusy(false) }
  }

  const doDuplicate = async () => {
    if (!dupTarget) return
    const name = dupName.trim()
    if (!name) { toast.error('Nom requis'); return }
    setBusy(true)
    try {
      await api.system.duplicateDatabase(dupTarget.filename, name)
      toast.success(`Base dupliquée → ${name}`)
      setDupTarget(null); setDupName('')
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Échec de la duplication') }
    finally { setBusy(false) }
  }

  const doDelete = async () => {
    if (!delTarget) return
    setBusy(true)
    try {
      await api.system.deleteDatabase(delTarget.filename)
      toast.success(`Base supprimée : ${delTarget.filename}`)
      setDelTarget(null); setDelConfirm('')
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Échec de la suppression') }
    finally { setBusy(false) }
  }

  return (
    <div className="auto-card">
      <h3 style={{ marginBottom: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Database size={20} /> 🗄️ Cycle de vie des bases
      </h3>

      {databases.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>Aucune base disponible.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Base</th><th>Taille</th><th>Modifiée</th><th>Chunks</th><th style={{ width: 260 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {databases.map(d => (
                <tr key={d.filename}>
                  <td dir="ltr" style={{ fontWeight: 600 }}>{d.filename}</td>
                  <td className="font-num">{formatBytes(d.size_bytes)}</td>
                  <td>{formatDate(d.last_modified)}</td>
                  <td className="font-num">{d.metrics?.chunk_count ?? 0}</td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => void doExport(d.filename)}
                        disabled={busy}
                      >
                        <Download size={14} /> Exporter
                      </button>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => { setDupTarget(d); setDupName(`${d.filename.replace(/\.sqlite$/i, '')}_copy.sqlite`) }}>
                        <Copy size={14} /> Dupliquer
                      </button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => { setDelTarget(d); setDelConfirm('') }}>
                        <Trash2 size={14} /> Supprimer
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modale duplication */}
      <Modal
        open={!!dupTarget}
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Copy size={18} /> Dupliquer la base</span>}
        onClose={() => setDupTarget(null)}
        footer={
          <>
            <button className="btn btn-outline-secondary" onClick={() => setDupTarget(null)} disabled={busy}>Annuler</button>
            <button className="btn btn-primary" onClick={doDuplicate} disabled={busy || !dupName.trim()}><Copy size={15} /> Dupliquer</button>
          </>
        }
      >
        <p>Copie de <strong dir="ltr">{dupTarget?.filename}</strong> sous un nouveau nom :</p>
        <input className="form-input form-mono" dir="ltr" value={dupName} onChange={e => setDupName(e.target.value)} placeholder="nouvelle_base.sqlite" />
      </Modal>

      {/* Modale suppression (double saisie) */}
      <Modal
        open={!!delTarget}
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--danger)' }}><Trash2 size={18} /> Supprimer la base</span>}
        onClose={() => setDelTarget(null)}
        footer={
          <>
            <button className="btn btn-outline-secondary" onClick={() => setDelTarget(null)} disabled={busy}>Annuler</button>
            <button className="btn btn-danger" onClick={doDelete} disabled={busy || delConfirm.trim() !== delTarget?.filename}>
              <Trash2 size={15} /> Supprimer définitivement
            </button>
          </>
        }
      >
        <p style={{ color: 'var(--danger)', fontWeight: 700 }}>Action irréversible.</p>
        <p>Retapez le nom exact de la base pour confirmer :</p>
        <p className="form-mono" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }} dir="ltr">{delTarget?.filename}</p>
        <input className="form-input form-mono" dir="ltr" value={delConfirm} onChange={e => setDelConfirm(e.target.value)} placeholder={delTarget?.filename} />
      </Modal>
    </div>
  )
}
