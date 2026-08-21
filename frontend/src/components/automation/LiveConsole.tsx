import { useEffect, useRef } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'
import { useToast } from '@/components/common/Toast'

interface Props {
  lines: string[]
  running: boolean
  onStop: () => void
}

/** §5.3 LiveConsole — fond #050811 texte #10b981, auto-scroll, AUCUNE animation (§8.1). */
export default function LiveConsole({ lines, running, onStop }: Props) {
  const { t } = useLanguage()
  const toast = useToast()
  const consoleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = consoleRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const copy = () => {
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => toast.success(t('buttons.copy')),
      () => toast.error(t('common.error_generic')),
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}><i className="fa-solid fa-terminal" /> {t('automation.console')}</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-outline-secondary" onClick={copy}><i className="fa-solid fa-copy" /> {t('buttons.copy')}</button>
          {running && (
            <button className="btn btn-sm btn-danger" onClick={onStop}><i className="fa-solid fa-stop" /> {t('buttons.stop')}</button>
          )}
        </div>
      </div>
      <div ref={consoleRef} className="console-terminal" aria-live="polite" aria-atomic="false">
        {lines.length === 0 ? '— idle —' : lines.join('\n')}
      </div>
    </div>
  )
}
