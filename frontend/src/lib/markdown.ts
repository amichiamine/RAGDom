import { marked } from 'marked'
import katex from 'katex'
import DOMPurify from 'dompurify'

/**
 * Moteur Markdown/KaTeX monopasse déterministe (Frontend_UI_Specs §5.2.6).
 * Séquence stricte : auto-guérison LaTeX → nettoyage → protection des blocs math
 * → marked → réinjection KaTeX → rubriques didactiques → DOMPurify.
 */

// 1. Auto-guérison des tokens LaTeX altérés
function selfHealLatex(src: string): string {
  return src
    .replace(/(^|[^\\])rac\{/g, '$1\\frac{')
    .replace(/(^|[^\\])ext\{/g, '$1\\text{')
    .replace(/(^|[^\\])ight\)/g, '$1\\right)')
    .replace(/(^|[^\\])eft\(/g, '$1\\left(')
    .replace(/\\frac\s+(\d)\{/g, '\\frac{$1}{')
    .replace(/\$frac/g, '\\frac')
}

// 2. Nettoyage ciblé DANS les formules (virgules arabes → math)
function cleanFormula(tex: string): string {
  return tex.replace(/،/g, ',').replace(/؛/g, ';')
}

interface MathBlock { token: string; html: string }

// 3. Protection des blocs mathématiques ($$...$$ display, $...$ inline)
function protectMath(src: string): { text: string; blocks: MathBlock[] } {
  const blocks: MathBlock[] = []
  let idx = 0

  const push = (tex: string, displayMode: boolean): string => {
    const token = `%%%MATHBLOCK_${idx}%%%`
    let html: string
    try {
      html = katex.renderToString(cleanFormula(tex), {
        throwOnError: false,
        strict: 'ignore',
        output: 'html',
        displayMode,
      })
    } catch {
      html = `<span class="bidi-isolate">${escapeHtml(tex)}</span>`
    }
    blocks.push({ token, html })
    idx += 1
    return token
  }

  // display d'abord
  let text = src.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => push(tex, true))
  // inline ensuite (évite les $ échappés)
  text = text.replace(/(^|[^\\])\$([^$\n]+?)\$/g, (_m, pre: string, tex: string) => `${pre}${push(tex, false)}`)
  return { text, blocks }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 4. Rubriques didactiques officielles 2G
function transformDidacticRubrics(html: string): string {
  const map: Array<[RegExp, string]> = [
    [/🧭\s*أكتشف/g, '<div class="didactic-rubric-discover">🧭 أكتشف</div>'],
    [/📖\s*(أتعلم\s*\/\s*معارف|أتعلم)/g, '<div class="didactic-rubric-learn">📖 أتعلم / معارف</div>'],
    [/💡\s*أكتسب\s*طرائق/g, '<div class="didactic-rubric-methods">💡 أكتسب طرائق</div>'],
    [/✍️\s*دوري\s*الآن/g, '<div class="didactic-rubric-now">✍️ دوري الآن</div>'],
    [/🎯\s*أقوم\s*تعلماتي/g, '<div class="didactic-rubric-assess">🎯 أقوم تعلماتي</div>'],
  ]
  let out = html
  for (const [re, repl] of map) out = out.replace(re, repl)
  // Badge de remédiation « أعود إلى الصفحة N »
  out = out.replace(/أعود\s*إلى\s*الصفحة\s*(\d+)/g,
    '<span class="didactic-remediation-badge" data-remediation-page="$1"><i class="fa-solid fa-rotate-left"></i> أعود إلى الصفحة $1</span>')
  return out
}

marked.setOptions({ gfm: true, breaks: false })

export function renderMarkdownWithKaTeX(source: string): string {
  if (!source) return ''
  const healed = selfHealLatex(source)
  const { text, blocks } = protectMath(healed)

  // marked (synchrone : marked.parse renvoie string quand async=false)
  let html = marked.parse(text, { async: false }) as string

  // réinjection des blocs KaTeX (déjà rendus, non altérés par le sanitizer ci-dessous)
  for (const b of blocks) {
    html = html.split(b.token).join(b.html)
  }

  html = transformDidacticRubrics(html)

  // 5. Sanitize (DOMPurify) — on autorise les classes KaTeX + data-attrs de remédiation
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-remediation-page', 'aria-hidden', 'style'],
    ADD_TAGS: ['semantics', 'annotation', 'math', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'span'],
  })
}
