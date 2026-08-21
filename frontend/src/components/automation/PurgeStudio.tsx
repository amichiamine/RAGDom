import { useState } from 'react'
import { api } from '@/lib/api'
import type { PurgeScope, PurgePayload, PurgeResult, Document } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'
import Modal from '@/components/common/Modal'

interface Props {
  db: string
  documents: Document[]
  onPurged: () => void
}

const SCOPES: Array<{ scope: PurgeScope; labelKey: string }> = [
  { scope: 'page', labelKey: 'purge.scope_page' },
  { scope: 'page_range', labelKey: 'purge.scope_page_range' },
  { scope: 'chapter', labelKey: 'purge.scope_chapter' },
  { scope: 'document', labelKey: 'purge.scope_document' },
  { scope: 'database', labelKey: 'purge.scope_database' },
  { scope: 'artifacts_only', labelKey: 'purge.scope_artifacts_only' },
  { scope: 'curriculum_only', labelKey: 'purge.scope_curriculum_only' },
]

/** §7.4 PurgeStudio — 7 portées + dry_run → modale d'impact → exécution (double saisie si scope=database). */
export default function PurgeStudio({ db, documents, onPurged }: Props) {
  const { t } = useLanguage()
  const toast = useToast()
  const [scope, setScope] = useState<PurgeScope>('page')
  const [documentId, setDocumentId] = useState('')
  const [pageStart, setPageStart] = useState('')
  const [pageEnd, setPageEnd] = useState('')
  const [tocId, setTocId] = useState('')
  const [preserveHuman, setPreserveHuman] = useState(true)
  const [impact, setImpact] = useState<PurgeResult | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)

  const needsDoc = scope === 'document' || scope === 'chapter' || scope === 'page' || scope === 'page_range'
  const isDbScope = scope === 'database'

  const buildPayload = (dryRun: boolean): PurgePayload => ({
    db,
    scope,
    dry_run: dryRun,
    preserve_human_edits: isDbScope ? false : preserveHuman,
    ...(needsDoc && documentId ? { document_id: documentId } : {}),
    ...((scope === 'page' || scope === 'page_range') && pageStart ? { page_start: Number(pageStart) } : {}),
    ...(scope === 'page_range' && pageEnd ? { page_end: Number(pageEnd) } : {}),
    ...(scope === 'chapter' && tocId ? { toc_id: tocId } : {}),
    ...(isDbScope ? { confirm: confirmName } : {}),
  })

  const preview = async () => {
    setBusy(true)
    try {
      const res = await api.pipeline.purge(buildPayload(true))
      setImpact(res)
      setConfirmName('')
      setModalOpen(true)
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
    finally { setBusy(false) }
  }

  const execute = async () => {
    setBusy(true)
    try {
      const res = await api.pipeline.purge(buildPayload(false))
      toast.success(res.message || t('buttons.execute_purge'))
      setModalOpen(false)
      onPurged()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('common.error_generic')) }
    finally { setBusy(false) }
  }

  const executeDisabled = busy || (isDbScope && confirmName.trim() !== db)

  return (
    <div className="auto-card">
      <h3 style={{ marginBottom: 14 }}>🧹 {t('purge.title')}</h3>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {SCOPES.map(s => (
          <button
            key={s.scope}
            className={`btn btn-sm rounded-pill ${scope === s.scope ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setScope(s.scope)}
          >
            {t(s.labelKey)}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        {needsDoc && (
          <select className="form-select" style={{ maxWidth: 260 }} value={documentId} onChange={e => setDocumentId(e.target.value)}>
            <option value="">{t('library.select_document')}</option>
            {documents.map(d => <option key={d.id} value={d.id}>{d.title || d.filename}</option>)}
          </select>
        )}
        {(scope === 'page' || scope === 'page_range') && (
          <input className="form-input" style={{ maxWidth: 120 }} type="number" placeholder={t('purge.scope_page')} value={pageStart} onChange={e => setPageStart(e.target.value)} />
        )}
        {scope === 'page_range' && (
          <input className="form-input" style={{ maxWidth: 120 }} type="number" placeholder="→" value={pageEnd} onChange={e => setPageEnd(e.target.value)} />
        )}
        {scope === 'chapter' && (
          <input className="form-input" style={{ maxWidth: 200 }} placeholder="toc_id" value={tocId} onChange={e => setTocId(e.target.value)} />
        )}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, opacity: isDbScope ? 0.5 : 1 }}>
        <span className="switch">
          <input type="checkbox" checked={isDbScope ? false : preserveHuman} disabled={isDbScope} onChange={e => setPreserveHuman(e.target.checked)} />
          <span className="slider-track" /><span className="slider-thumb" />
        </span>
        <span>{t('purge.preserve_human')}</span>
      </label>

      <button className="btn btn-outline-warning" onClick={preview} disabled={busy}>
        <i className="fa-solid fa-magnifying-glass-chart" /> {t('buttons.preview_impact')}
      </button>

      <Modal
        open={modalOpen}
        title={<><i className="fa-solid fa-triangle-exclamation" style={{ color: 'var(--warning)' }} /> {t('purge.impact_title')}</>}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button className="btn btn-outline-secondary" onClick={() => setModalOpen(false)}>{t('buttons.cancel')}</button>
            <button className="btn btn-danger" onClick={execute} disabled={executeDisabled}>
              <i className="fa-solid fa-trash" /> {t('buttons.execute_purge')}
            </button>
          </>
        }
      >
        {impact && (
          <div>
            <table className="data-table" style={{ marginBottom: 14 }}>
              <tbody>
                {Object.entries(impact.deleted).map(([k, v]) => (
                  <tr key={k}><td style={{ fontWeight: 700 }}>{k}</td><td className="font-num">{v}</td></tr>
                ))}
                <tr><td style={{ fontWeight: 700 }}>{t('purge.preserved')}</td><td className="font-num">{impact.preserved_human_edited}</td></tr>
              </tbody>
            </table>
            <p style={{ color: 'var(--text-muted)' }}>{impact.message}</p>
            {isDbScope && (
              <div style={{ marginTop: 12 }}>
                <label style={{ fontWeight: 700, display: 'block', marginBottom: 6 }}>{t('purge.type_db_name')}</label>
                <input className="form-input form-mono" value={confirmName} onChange={e => setConfirmName(e.target.value)} placeholder={db} />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
