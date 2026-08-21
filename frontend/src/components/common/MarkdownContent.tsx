import { useMemo } from 'react'
import { renderMarkdownWithKaTeX } from '@/lib/markdown'
import { cn } from '@/lib/utils'

interface Props {
  source: string
  className?: string
}

/** Rendu Markdown + KaTeX (moteur monopasse §5.2.6) avec isolation BiDi (.content-box → unicode-bidi:plaintext). */
export default function MarkdownContent({ source, className }: Props) {
  const html = useMemo(() => renderMarkdownWithKaTeX(source), [source])
  return (
    <div
      className={cn('rendered-html-container', className)}
      dir="auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
