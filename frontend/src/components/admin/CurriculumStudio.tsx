import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  GraduationCap, Plus, Pencil, Trash2, Check, X, Upload, RefreshCw,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useToast } from '@/components/common/Toast'
import Modal from '@/components/common/Modal'
import { Spinner, ErrorBanner, EmptyState } from '@/components/common/Feedback'

type Kind = 'terms' | 'programs' | 'assessments' | 'links'

interface FieldSpec {
  key: string
  label: string
  type?: 'text' | 'number'
  required?: boolean
}

/** Colonnes éditables par table — alignées EXACTEMENT sur routes_curriculum._TABLES. */
const SCHEMA: Record<Kind, { label: string; fields: FieldSpec[] }> = {
  terms: {
    label: 'Trimestres',
    fields: [
      { key: 'term_index', label: 'Index', type: 'number', required: true },
      { key: 'label', label: 'Libellé', required: true },
      { key: 'metadata_json', label: 'Metadata (JSON)' },
    ],
  },
  programs: {
    label: 'Programmes / مقاطع',
    fields: [
      { key: 'term_id', label: 'Trimestre (id)' },
      { key: 'seq_index', label: 'Séq.', type: 'number' },
      { key: 'title', label: 'Titre', required: true },
      { key: 'source', label: 'Source' },
      { key: 'competencies_json', label: 'Compétences (JSON)' },
    ],
  },
  assessments: {
    label: 'Évaluations',
    fields: [
      { key: 'document_id', label: 'Document (id)' },
      { key: 'term_id', label: 'Trimestre (id)' },
      { key: 'kind', label: 'Type (devoir/composition/examen/autre)', required: true },
      { key: 'title', label: 'Titre', required: true },
      { key: 'subject_chunk_id', label: 'Sujet (chunk id)' },
      { key: 'correction_chunk_id', label: 'Correction (chunk id)' },
      { key: 'scale_json', label: 'Barème (JSON)' },
    ],
  },
  links: {
    label: 'Liaisons',
    fields: [
      { key: 'link_type', label: 'Type de liaison', required: true },
      { key: 'from_id', label: 'De (id)', required: true },
      { key: 'to_id', label: 'Vers (id)', required: true },
      { key: 'page_number', label: 'Page', type: 'number' },
      { key: 'metadata_json', label: 'Metadata (JSON)' },
    ],
  },
}

const KIND_ORDER: Kind[] = ['terms', 'programs', 'assessments', 'links']

type Row = Record<string, unknown> & { id: string }

interface Props {
  db: string
  /** Rafraîchit la Vue 2 / DatabaseContext après un changement de curriculum. */
  onChanged?: () => void
}

/** §7.10 CurriculumStudio — clé de sortie du Mode Repli de la Vue 2. */
export default function CurriculumStudio({ db, onChanged }: Props) {
  const toast = useToast()
  const [kind, setKind] = useState<Kind>('terms')
  const [rows, setRows] = useState<Record<Kind, Row[]>>({ terms: [], programs: [], assessments: [], links: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Édition inline
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [newRow, setNewRow] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null)

  // Import JSON
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [importReport, setImportReport] = useState<string | null>(null)

  const fields = SCHEMA[kind].fields

  const loadKind = useCallback((k: Kind) => {
    setLoading(true); setError(null)
    api.curriculum.list(db, k)
      .then(res => {
        const items = ((res as { items?: Row[] })?.items) ?? []
        setRows(prev => ({ ...prev, [k]: items }))
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [db])

  // Charge les 4 tables au montage (pour le bandeau d'état + compteurs), puis à chaque db.
  const loadAll = useCallback(() => {
    setLoading(true); setError(null)
    Promise.all(KIND_ORDER.map(k => api.curriculum.list(db, k).catch(() => ({ items: [] }))))
      .then(results => {
        const next = { terms: [], programs: [], assessments: [], links: [] } as Record<Kind, Row[]>
        KIND_ORDER.forEach((k, i) => { next[k] = ((results[i] as { items?: Row[] })?.items) ?? [] })
        setRows(next)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [db])

  useEffect(() => { if (db) loadAll() }, [db, loadAll])

  const currentRows = rows[kind]

  const totalRows = useMemo(
    () => KIND_ORDER.reduce((sum, k) => sum + rows[k].length, 0),
    [rows],
  )
  const isActive = totalRows > 0

  const buildPayload = (form: Record<string, string>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const f of fields) {
      const v = form[f.key]
      if (v == null || v === '') { out[f.key] = null; continue }
      out[f.key] = f.type === 'number' ? Number(v) : v
    }
    return out
  }

  const validateForm = (form: Record<string, string>): string | null => {
    for (const f of fields) {
      if (f.required && (!form[f.key] || form[f.key].trim() === '')) return `Champ requis : ${f.label}`
      if (f.type === 'number' && form[f.key] && Number.isNaN(Number(form[f.key]))) return `Nombre invalide : ${f.label}`
      if (f.key.endsWith('_json') && form[f.key]) {
        try { JSON.parse(form[f.key]) } catch { return `JSON invalide : ${f.label}` }
      }
    }
    return null
  }

  const startEdit = (row: Row) => {
    setAdding(false)
    setEditingId(row.id)
    const d: Record<string, string> = {}
    for (const f of fields) { const v = row[f.key]; d[f.key] = v == null ? '' : String(v) }
    setDraft(d)
  }

  const saveEdit = async () => {
    if (!editingId) return
    const err = validateForm(draft)
    if (err) { toast.error(err); return }
    setBusy(true)
    try {
      await api.curriculum.update(db, kind, editingId, buildPayload(draft))
      toast.success('Ligne mise à jour')
      setEditingId(null)
      loadKind(kind)
      onChanged?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Échec de la mise à jour') }
    finally { setBusy(false) }
  }

  const startAdd = () => {
    setEditingId(null)
    setAdding(true)
    const empty: Record<string, string> = {}
    for (const f of fields) empty[f.key] = ''
    setNewRow(empty)
  }

  const saveAdd = async () => {
    const err = validateForm(newRow)
    if (err) { toast.error(err); return }
    setBusy(true)
    try {
      await api.curriculum.create(db, kind, buildPayload(newRow))
      toast.success('Ligne ajoutée')
      setAdding(false)
      loadKind(kind)
      onChanged?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Échec de l’ajout') }
    finally { setBusy(false) }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await api.curriculum.remove(db, kind, deleteTarget.id)
      toast.success('Ligne supprimée')
      setDeleteTarget(null)
      loadKind(kind)
      onChanged?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Échec de la suppression') }
    finally { setBusy(false) }
  }

  const runImport = async () => {
    let parsed: unknown
    try { parsed = JSON.parse(importText) } catch { toast.error('JSON invalide (parse)'); return }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      toast.error('Le JSON doit être un objet { terms, programs, assessments, links }')
      return
    }
    const obj = parsed as Record<string, unknown>
    const allowed = ['terms', 'programs', 'assessments', 'links']
    const present = allowed.filter(k => k in obj)
    if (present.length === 0) { toast.error('Aucune section reconnue (terms/programs/assessments/links)'); return }
    for (const k of present) {
      if (!Array.isArray(obj[k])) { toast.error(`La section "${k}" doit être un tableau`); return }
    }
    setBusy(true)
    setImportReport(null)
    try {
      const body: Record<string, unknown> = {}
      for (const k of present) body[k] = obj[k]
      const res = await api.curriculum.importJson(db, body, importMode) as {
        imported?: Record<string, number>; mode?: string
      }
      const imp = res.imported ?? {}
      const summary = Object.entries(imp).map(([k, v]) => `${k}: ${v}`).join(' · ')
      setImportReport(`Import ${res.mode ?? importMode} réussi — ${summary || 'aucune ligne'}`)
      toast.success('Import curriculum terminé')
      loadAll()
      onChanged?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Échec de l’import'
      setImportReport(`Erreur : ${msg}`)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  return (
    <div className="auto-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <GraduationCap size={20} /> 🎓 Curriculum Studio
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-outline-secondary" onClick={loadAll} disabled={loading}>
            <RefreshCw size={14} /> Actualiser
          </button>
          <button className="btn btn-sm btn-outline-primary" onClick={() => { setImportOpen(true); setImportReport(null) }}>
            <Upload size={14} /> Import JSON
          </button>
        </div>
      </div>

      {/* Bandeau d'état */}
      <div className={`curriculum-status-banner ${isActive ? 'is-active' : 'is-fallback'}`}>
        {isActive
          ? `Curriculum actif — la Vue 2 affiche les 6 onglets (${totalRows} lignes)`
          : 'Tables vides — la Vue 2 est en Mode Repli Générique'}
      </div>

      {/* Sous-onglets */}
      <div role="tablist" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0' }}>
        {KIND_ORDER.map(k => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            className={`btn btn-sm rounded-pill ${kind === k ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => { setKind(k); setEditingId(null); setAdding(false) }}
          >
            {SCHEMA[k].label} <span className="badge badge-subtle" style={{ marginInlineStart: 6 }}>{rows[k].length}</span>
          </button>
        ))}
      </div>

      {error ? (
        <ErrorBanner message={error} onRetry={() => loadKind(kind)} />
      ) : loading ? (
        <Spinner label="Chargement…" />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                {fields.map(f => <th key={f.key}>{f.label}{f.required ? ' *' : ''}</th>)}
                <th style={{ width: 110 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentRows.length === 0 && !adding && (
                <tr><td colSpan={fields.length + 1}>
                  <EmptyState icon="fa-table-cells" title="Aucune ligne" />
                </td></tr>
              )}

              {currentRows.map(row => {
                const editing = editingId === row.id
                return (
                  <tr key={row.id}>
                    {fields.map(f => (
                      <td key={f.key}>
                        {editing ? (
                          <input
                            className="form-input"
                            style={{ minWidth: 120 }}
                            type={f.type === 'number' ? 'number' : 'text'}
                            dir="auto"
                            value={draft[f.key] ?? ''}
                            onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                          />
                        ) : (
                          <span dir="auto" style={{ display: 'inline-block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row[f.key] == null || row[f.key] === '' ? '—' : String(row[f.key])}
                          </span>
                        )}
                      </td>
                    ))}
                    <td>
                      {editing ? (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button className="btn btn-sm btn-success" onClick={saveEdit} disabled={busy} aria-label="enregistrer"><Check size={14} /></button>
                          <button className="btn btn-sm btn-outline-secondary" onClick={() => setEditingId(null)} disabled={busy} aria-label="annuler"><X size={14} /></button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button className="btn btn-sm btn-outline-secondary" onClick={() => startEdit(row)} aria-label="éditer"><Pencil size={14} /></button>
                          <button className="btn btn-sm btn-outline-danger" onClick={() => setDeleteTarget(row)} aria-label="supprimer"><Trash2 size={14} /></button>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}

              {adding && (
                <tr>
                  {fields.map(f => (
                    <td key={f.key}>
                      <input
                        className="form-input"
                        style={{ minWidth: 120 }}
                        type={f.type === 'number' ? 'number' : 'text'}
                        dir="auto"
                        placeholder={f.label}
                        value={newRow[f.key] ?? ''}
                        onChange={e => setNewRow(d => ({ ...d, [f.key]: e.target.value }))}
                      />
                    </td>
                  ))}
                  <td>
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <button className="btn btn-sm btn-success" onClick={saveAdd} disabled={busy} aria-label="créer"><Check size={14} /></button>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => setAdding(false)} disabled={busy} aria-label="annuler"><X size={14} /></button>
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!adding && !loading && (
        <button className="btn btn-sm btn-outline-primary" style={{ marginTop: 14 }} onClick={startAdd}>
          <Plus size={14} /> Ajouter une ligne
        </button>
      )}

      {/* Modale de suppression */}
      <Modal
        open={!!deleteTarget}
        title="Confirmer la suppression"
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <button className="btn btn-outline-secondary" onClick={() => setDeleteTarget(null)} disabled={busy}>Annuler</button>
            <button className="btn btn-danger" onClick={confirmDelete} disabled={busy}><Trash2 size={15} /> Supprimer</button>
          </>
        }
      >
        <p>Supprimer définitivement cette ligne de <strong>{SCHEMA[kind].label}</strong> ?</p>
        {deleteTarget && <p className="form-mono" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>id: {deleteTarget.id}</p>}
      </Modal>

      {/* Modale d'import JSON */}
      <Modal
        open={importOpen}
        size="xl"
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Upload size={18} /> Import structuré du curriculum</span>}
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <button className="btn btn-outline-secondary" onClick={() => setImportOpen(false)} disabled={busy}>Fermer</button>
            <button className="btn btn-primary" onClick={runImport} disabled={busy || !importText.trim()}>
              <Upload size={15} /> Importer ({importMode})
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="import-mode" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} /> Merge (fusion)
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="import-mode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /> Replace (remplace tout)
          </label>
        </div>
        <textarea
          className="form-textarea form-mono"
          dir="ltr"
          style={{ minHeight: 220 }}
          placeholder={'{\n  "terms": [{ "term_index": 1, "label": "الفصل الأول" }],\n  "programs": [],\n  "assessments": [],\n  "links": []\n}'}
          value={importText}
          onChange={e => setImportText(e.target.value)}
        />
        {importReport && (
          <div className={`curriculum-status-banner ${importReport.startsWith('Erreur') ? 'is-fallback' : 'is-active'}`} style={{ marginTop: 12 }}>
            {importReport}
          </div>
        )}
      </Modal>
    </div>
  )
}
