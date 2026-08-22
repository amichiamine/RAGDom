import { useRef, useState } from 'react'
import { FilePlus2, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import type { Document } from '@/types'
import { useToast } from '@/components/common/Toast'
import Modal from '@/components/common/Modal'

interface Props {
  db: string
  documents: Document[]
  open: boolean
  onClose: () => void
  onImported?: () => void
}

/** Familles d'artefacts Tier 3 — EXACTEMENT _RENDER_CONFIGS + _TEXT_TYPES de
 *  backend/api/routes_library.py (le render_config_json est appliqué serveur). */
const ARTIFACT_TYPES: string[] = [
  'pdb_protein',
  'cif_crystal',
  'cad_3d_model',
  'bim_ifc_slice',
  'geojson_map',
  'dicom_slice',
  'fasta_sequence',
  'genbank_record',
  'smiles_chem',
]

const ACCEPT_BY_TYPE: Record<string, string> = {
  pdb_protein: '.pdb',
  cif_crystal: '.cif,.mmcif',
  cad_3d_model: '.glb,.gltf',
  bim_ifc_slice: '.ifc',
  geojson_map: '.geojson,.json',
  dicom_slice: '.dcm,.dicom',
  fasta_sequence: '.fasta,.fa,.fna,.faa',
  genbank_record: '.gb,.gbk,.genbank',
  smiles_chem: '.smi,.smiles,.txt',
}
const MAX_BYTES = 50 * 1024 * 1024

/** §7.11 ArtifactImportModal — import Tier 3 (FormData → POST /library/artifacts/import). */
export default function ArtifactImportModal({ db, documents, open, onClose, onImported }: Props) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [documentId, setDocumentId] = useState('')
  const [pageNumber, setPageNumber] = useState('')
  const [artifactType, setArtifactType] = useState(ARTIFACT_TYPES[0])
  const [domain, setDomain] = useState('')
  const [chunkId, setChunkId] = useState('')
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)

  const reset = () => {
    setFile(null); setDocumentId(''); setPageNumber(''); setArtifactType(ARTIFACT_TYPES[0])
    setDomain(''); setChunkId(''); setCaption(''); setReport(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const submit = async () => {
    if (!file) { toast.error('Sélectionnez un fichier'); return }
    const acceptedExtensions = ACCEPT_BY_TYPE[artifactType].split(',')
    if (!acceptedExtensions.some(extension => file.name.toLowerCase().endsWith(extension))) {
      toast.error(`Extension incompatible avec ${artifactType} (${ACCEPT_BY_TYPE[artifactType]})`)
      return
    }
    if (file.size > MAX_BYTES) { toast.error('Fichier > 50 Mo'); return }
    if (!documentId) { toast.error('Document requis'); return }
    if (!pageNumber || Number.isNaN(Number(pageNumber))) { toast.error('Page invalide'); return }
    if (!domain.trim()) { toast.error('Domaine requis'); return }

    const fd = new FormData()
    fd.append('file', file)
    fd.append('document_id', documentId)
    fd.append('page_number', String(Number(pageNumber)))
    fd.append('domain', domain.trim())
    fd.append('artifact_type', artifactType)
    if (chunkId.trim()) fd.append('chunk_id', chunkId.trim())
    if (caption.trim()) fd.append('caption', caption.trim())

    setBusy(true); setReport(null)
    try {
      const res = await api.library.importArtifact(db, fd) as {
        imported?: boolean; artifact_type?: string; size_bytes?: number; detail?: string
      }
      if (res?.imported) {
        setReport(`Importé — ${res.artifact_type} · ${res.size_bytes ?? file.size} octets`)
        toast.success('Actif importé')
        onImported?.()
        reset()
      } else {
        const msg = res?.detail || 'Import refusé'
        setReport(`Erreur : ${msg}`)
        toast.error(msg)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Échec de l’import'
      setReport(`Erreur : ${msg}`)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  return (
    <Modal
      open={open}
      size="xl"
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><FilePlus2 size={18} /> Importer un actif (Tier 3)</span>}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline-secondary" onClick={onClose} disabled={busy}>Fermer</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !file}>
            <Upload size={15} /> {busy ? 'Import…' : 'Importer'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div>
          <label className="artifact-field-label">Fichier ({ACCEPT_BY_TYPE[artifactType]})</label>
          <input
            ref={fileRef}
            className="form-input"
            type="file"
            accept={ACCEPT_BY_TYPE[artifactType]}
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
          {file && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{file.name} · {(file.size / 1024).toFixed(0)} Ko</div>}
        </div>

        <div>
          <label className="artifact-field-label">Type d’artefact</label>
          <select className="form-select" value={artifactType} onChange={e => setArtifactType(e.target.value)}>
            {ARTIFACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label className="artifact-field-label">Document *</label>
          <select className="form-select" value={documentId} onChange={e => setDocumentId(e.target.value)}>
            <option value="">Sélectionner…</option>
            {documents.map(d => <option key={d.id} value={d.id}>{d.title || d.filename}</option>)}
          </select>
        </div>

        <div>
          <label className="artifact-field-label">Page *</label>
          <input className="form-input" type="number" min={1} value={pageNumber} onChange={e => setPageNumber(e.target.value)} placeholder="ex : 18" />
        </div>

        <div>
          <label className="artifact-field-label">Domaine *</label>
          <input className="form-input" dir="auto" value={domain} onChange={e => setDomain(e.target.value)} placeholder="ex : biology" />
        </div>

        <div>
          <label className="artifact-field-label">Chunk (id, optionnel)</label>
          <input className="form-input form-mono" dir="ltr" value={chunkId} onChange={e => setChunkId(e.target.value)} placeholder="chunk id" />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label className="artifact-field-label">Légende (optionnelle)</label>
          <input className="form-input" dir="auto" value={caption} onChange={e => setCaption(e.target.value)} placeholder="Description de l’actif" />
        </div>
      </div>

      {report && (
        <div className={`curriculum-status-banner ${report.startsWith('Erreur') ? 'is-fallback' : 'is-active'}`} style={{ marginTop: 14 }}>
          {report}
        </div>
      )}
    </Modal>
  )
}
