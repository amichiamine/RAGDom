import { useState } from 'react'
import { api } from '@/lib/api'
import type { Document } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import { EmptyState } from '@/components/common/Feedback'

interface Props {
  db: string
  documents: Document[]
  onIngested: () => void
}

/** §5.3 Source Documents Table — bouton « Ingérer » (pipeline.start). */
export default function SourceDocumentsTable({ db, documents, onIngested }: Props) {
  const { t } = useLanguage()
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const ingest = async (doc: Document) => {
    setBusyId(doc.id)
    try {
      const res = await api.pipeline.start({ source_path: doc.filename, target_db: db, mode: 'document' })
      toast.success(`${t('buttons.ingest')} — batch ${res.batch_id} (${res.pages_total})`)
      onIngested()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
    finally { setBusyId(null) }
  }

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
                  <td dir="auto">{doc.title || doc.filename}</td>
                  <td className="font-num">{doc.total_pages}</td>
                  <td><span className="badge badge-secondary">{doc.doc_type}</span></td>
                  <td>
                    <button className="btn btn-sm btn-primary" onClick={() => ingest(doc)} disabled={busyId === doc.id}>
                      {busyId === doc.id ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-play" />} {t('buttons.ingest')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
