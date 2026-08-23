import { useState } from 'react'
import { api } from '@/lib/api'
import type { Document, BatchLaunch } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import { EmptyState } from '@/components/common/Feedback'
import Modal from '@/components/common/Modal'

interface Props {
  db: string
  documents: Document[]
  onIngested: () => void
  onBatchStarted?: (launch: BatchLaunch) => void
  /** Suppression d'un document isolé (DELETE /library/documents/{id}). */
  onDeleted?: () => void
}

/** §5.3 Source Documents Table — « Ingérer » (pipeline.start) + suppression d'un document isolé. */
export default function SourceDocumentsTable({ db, documents, onIngested, onBatchStarted, onDeleted }: Props) {
  const { t } = useLanguage()
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const ingest = async (doc: Document) => {
    setBusyId(doc.id)
    try {
      const res = await api.pipeline.start({ source_path: doc.filename, target_db: db, mode: 'document' })
      if (res.reused_existing_document) {
        toast.info(t('launcher.reused_existing'))
      } else {
        toast.success(`${t('buttons.ingest')} — batch ${res.batch_id} (${res.pages_total})`)
      }
      onBatchStarted?.({
        pagesTotal: res.pages_total,
        batchIds: res.batch_ids ?? (res.batch_id ? [res.batch_id] : []),
        reusedExistingDocument: res.reused_existing_document,
      })
      onIngested()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
    finally { setBusyId(null) }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    setBusyId(deleteTarget.id)
    try {
      const res = await api.library.deleteDocument(db, deleteTarget.id)
      toast.success(res.deleted ? t('library.document_deleted') : t('common.error_generic'))
      setDeleteTarget(null); setDeleteConfirm('')
      onIngested(); onDeleted?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
    finally { setBusyId(null) }
  }

  const docName = (d: Document) => d.title || d.filename

  return (
    <div className="auto-card">
      <h3 style={{ marginBottom: 14 }}><i className="fa-solid fa-file-lines" /> {t('automation.source_documents')}</h3>
      {documents.length === 0 ? (
        <EmptyState icon="fa-file-circle-question" title={t('common.empty')} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('pipeline.doc')}</th><th>{t('pipeline.pages')}</th><th>{t('quarantine.status')}</th><th>{t('pipeline.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => (
                <tr key={doc.id}>
                  <td dir="auto">{docName(doc)}</td>
                  <td className="font-num">{doc.total_pages}</td>
                  <td><span className="badge badge-secondary">{doc.doc_type}</span></td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-primary" onClick={() => ingest(doc)} disabled={busyId === doc.id}>
                        {busyId === doc.id ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-play" />} {t('buttons.ingest')}
                      </button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => { setDeleteTarget(doc); setDeleteConfirm('') }} disabled={busyId === doc.id}>
                        <i className="fa-solid fa-trash" /> {t('buttons.delete_document')}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modale suppression d'un document isolé (double saisie par précaution) */}
      <Modal
        open={!!deleteTarget}
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--danger)' }}><i className="fa-solid fa-trash" /> {t('automation.delete_document_title')}</span>}
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <button className="btn btn-outline-secondary" onClick={() => setDeleteTarget(null)} disabled={busyId !== null}>Annuler</button>
            <button className="btn btn-danger" onClick={doDelete} disabled={deleteConfirm.trim() !== docName(deleteTarget!) || busyId !== null}>
              <i className="fa-solid fa-trash" /> {t('buttons.delete_document')}
            </button>
          </>
        }
      >
        <p style={{ color: 'var(--danger)', fontWeight: 700 }}>{t('automation.delete_document_warning')}</p>
        <p>{t('automation.delete_document_confirm')}</p>
        <p className="form-mono" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }} dir="auto">{deleteTarget ? docName(deleteTarget) : ''}</p>
        <input className="form-input form-mono" dir="auto" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder={deleteTarget ? docName(deleteTarget) : ''} />
      </Modal>
    </div>
  )
}
