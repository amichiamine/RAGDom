import { useEffect, useMemo, useState } from 'react'
import { Database, FileText, ListTree, Files } from 'lucide-react'
import { api } from '@/lib/api'
import { useLanguage } from '@/contexts/LanguageContext'
import type { DatabaseInfo, Document, TocNode, ValidationScope, ValidationScopeKind } from '@/types'

interface Props {
  databases: DatabaseInfo[]
  activeDb: string | null
  value: ValidationScope
  onChange: (scope: ValidationScope) => void
  disabled?: boolean
}

function flatten(nodes: TocNode[], depth = 0, result: Array<{ node: TocNode; depth: number }> = []) {
  for (const node of nodes) {
    result.push({ node, depth })
    if (node.children?.length) flatten(node.children, depth + 1, result)
  }
  return result
}

function parseNumbers(raw: string): number[] {
  return Array.from(new Set(raw.split(/[\s,;]+/).map(Number).filter(n => Number.isInteger(n) && n > 0))).sort((a, b) => a - b)
}

export default function ScopeSelector({ databases, activeDb, value, onChange, disabled = false }: Props) {
  const { t } = useLanguage()
  const [documents, setDocuments] = useState<Document[]>([])
  const [toc, setToc] = useState<TocNode[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const flatToc = useMemo(() => flatten(toc), [toc])
  const selectedDocument = documents.find(d => d.id === value.document_id)

  useEffect(() => {
    if (!value.db && activeDb) onChange({ db: activeDb, kind: 'database' })
  }, [activeDb, onChange, value.db])

  useEffect(() => {
    if (!value.db) { setDocuments([]); setLoadError(null); return }
    let cancelled = false
    setLoadError(null)
    api.library.getDocuments(value.db, 1, 250)
      .then(r => { if (!cancelled) setDocuments(r.data ?? []) })
      .catch(cause => {
        if (!cancelled) {
          setDocuments([])
          setLoadError(cause instanceof Error ? cause.message : t('common.error_generic'))
        }
      })
    return () => { cancelled = true }
  }, [t, value.db])

  useEffect(() => {
    if (!value.db || !value.document_id) { setToc([]); return }
    let cancelled = false
    setLoadError(null)
    api.library.getToc(value.db, value.document_id)
      .then(r => { if (!cancelled) setToc(r.toc ?? []) })
      .catch(cause => {
        if (!cancelled) {
          setToc([])
          setLoadError(cause instanceof Error ? cause.message : t('common.error_generic'))
        }
      })
    return () => { cancelled = true }
  }, [t, value.db, value.document_id])

  const setDb = (db: string) => onChange({ db, kind: 'database' })
  const setDocument = (documentId: string) => onChange(documentId
    ? { db: value.db, kind: 'document', document_id: documentId }
    : { db: value.db, kind: 'database' })
  const setKind = (kind: ValidationScopeKind) => {
    const base: ValidationScope = { db: value.db, kind }
    if (kind !== 'database' && value.document_id) base.document_id = value.document_id
    onChange(base)
  }

  const pageMax = selectedDocument?.total_pages
  const needsDocument = value.kind !== 'database'
  const needsToc = ['toc', 'chapter', 'course', 'title'].includes(value.kind)
  const needsPages = ['page', 'page_range', 'selection'].includes(value.kind)

  return (
    <fieldset className="validation-fieldset" disabled={disabled}>
      <legend>{t('validation.scope.title')}</legend>
      <div className="validation-form-grid">
        <label>
          <span><Database size={14} /> {t('validation.scope.database')}</span>
          <select className="form-select" value={value.db} onChange={e => setDb(e.target.value)} required>
            <option value="">—</option>
            {databases.map(db => <option key={db.filename} value={db.filename}>{db.filename}</option>)}
          </select>
        </label>
        <label>
          <span><FileText size={14} /> {t('validation.scope.document')}</span>
          <select className="form-select" value={value.document_id ?? ''} onChange={e => setDocument(e.target.value)} disabled={!value.db}>
            <option value="">{t('validation.scope.all_documents')}</option>
            {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.title || doc.filename}</option>)}
          </select>
        </label>
        <label>
          <span><Files size={14} /> {t('validation.scope.level')}</span>
          <select className="form-select" value={value.kind} onChange={e => setKind(e.target.value as ValidationScopeKind)} disabled={!value.db}>
            <option value="database">{t('validation.scope.database')}</option>
            <option value="document" disabled={!value.document_id}>{t('validation.scope.document')}</option>
            <option value="toc" disabled={!value.document_id}>{t('validation.scope.toc_node')}</option>
            <option value="chapter" disabled={!value.document_id}>{t('validation.scope.chapter')}</option>
            <option value="course" disabled={!value.document_id}>{t('validation.scope.course')}</option>
            <option value="title" disabled={!value.document_id}>{t('validation.scope.heading')}</option>
            <option value="page" disabled={!value.document_id}>{t('validation.scope.page')}</option>
            <option value="page_range" disabled={!value.document_id}>{t('validation.scope.range')}</option>
            <option value="selection" disabled={!value.document_id}>{t('validation.scope.selection')}</option>
          </select>
        </label>
        {needsToc && (
          <label>
            <span><ListTree size={14} /> {t('validation.scope.toc_node')}</span>
            <select className="form-select" value={value.toc_id ?? ''} onChange={e => onChange({ ...value, toc_id: e.target.value || undefined })} required>
              <option value="">—</option>
              {flatToc.map(({ node, depth }) => (
                <option key={node.id} value={node.id}>{' '.repeat(depth * 2)}{node.title} · p.{node.page_start}{node.page_end ? `–${node.page_end}` : ''}</option>
              ))}
            </select>
          </label>
        )}
        {needsPages && value.kind !== 'selection' && (
          <label>
            <span>{value.kind === 'page' ? t('validation.scope.page') : t('validation.scope.page_start')}</span>
            <input className="form-input" type="number" min={1} max={pageMax} value={value.page_start ?? ''}
              onChange={e => onChange({ ...value, page_start: e.target.value ? Number(e.target.value) : undefined, ...(value.kind === 'page' ? { page_end: e.target.value ? Number(e.target.value) : undefined } : {}) })} required />
          </label>
        )}
        {value.kind === 'page_range' && (
          <label>
            <span>{t('validation.scope.page_end')}</span>
            <input className="form-input" type="number" min={value.page_start ?? 1} max={pageMax} value={value.page_end ?? ''}
              onChange={e => onChange({ ...value, page_end: e.target.value ? Number(e.target.value) : undefined })} required />
          </label>
        )}
        {value.kind === 'selection' && (
          <label>
            <span>{t('validation.scope.pages_selection')}</span>
            <input className="form-input" dir="ltr" placeholder="1, 3, 8" value={(value.page_numbers ?? []).join(', ')}
              onChange={e => onChange({ ...value, page_numbers: parseNumbers(e.target.value) })} required />
          </label>
        )}
      </div>
      {needsDocument && !value.document_id && <p className="validation-inline-error" role="alert">{t('validation.scope.document_required')}</p>}
      {loadError && <p className="validation-inline-error" role="alert">{loadError}</p>}
    </fieldset>
  )
}
