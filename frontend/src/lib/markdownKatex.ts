import katex from 'katex'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

/**
 * Moteur KaTeX monopasse déterministe & rubriques didactiques 2G.
 *
 * Portage EXACT du pipeline de `Template_UI-UX/library.php` (l. 2128-2251) :
 *   auto-guérison LaTeX → nettoyage → protection des blocs math (%%%MATHBLOCK_N%%%)
 *   → marked.parse (gfm + tables) → réinjection katex.renderToString
 *   → transformations rubriques / bannières / remédiation / assets → DOMPurify.
 *
 * Ce module est PUR : il n'importe AUCUN composant React (pas de dépendance
 * circulaire). La résolution des `asset://figures/…` est déléguée à un
 * `resolveAsset` optionnel fourni par l'appelant (contexte base active).
 *
 * Sources normatives : Frontend_UI_Specs §5.2.6 · library.php l.2128-2251.
 */

// ──────────────────────────────────────────────────────────────────────────
// 1. Nettoyage des formules — port EXACT de cleanMathEquation (l.2128-2152)
// ──────────────────────────────────────────────────────────────────────────
export function cleanMathEquation(raw: string): string {
  if (!raw) return ''
  let eq = raw

  // 1. Séparateurs arabes → séparateurs mathématiques standards
  eq = eq.replace(/،/g, ',')
  eq = eq.replace(/؛/g, ';')

  // 2. Restaurer d'éventuels tokens corrompus
  eq = eq
    .replace(/\\d\s*\\frac/g, '\\dfrac')
    .replace(/\\d\s*\\dfrac/g, '\\dfrac')
    .replace(/\\\$frac/g, '\\frac')
    .replace(/\$frac/g, '\\frac')
    .replace(/(?<![a-zA-Z\\])rac\{/g, '\\frac{')
    .replace(/(?<![a-zA-Z\\])ext\{/g, '\\text{')
    .replace(/(?<![a-zA-Z\\])ight\)/g, '\\right)')
    .replace(/(?<![a-zA-Z\\])eft\(/g, '\\left(')
    .replace(/\\text\{\s*\\text\{([^{}]+)\}\s*\}/g, '\\text{$1}')
    .replace(/\\text\{\s*([,;])\s*\}/g, ' $1 ')

  // 3. Supprimer les dollars imbriqués accidentels
  eq = eq.replace(/\$/g, '')

  // 4. Encapsuler les mots arabes isolés dans \text{} sans écraser les blocs existants
  //    (port EXACT du range template : ؀-؋ ؍-ۿ)
  eq = eq.replace(/(?<!\\text\{)([؀-؋؍-ۿ]+)(?!\})/g, '\\text{$1}')

  return eq.trim()
}

// ──────────────────────────────────────────────────────────────────────────
// Auto-guérison globale du texte brut — port EXACT (l.2159-2175)
// ──────────────────────────────────────────────────────────────────────────
function selfHealRawText(raw: string): string {
  return raw
    .replace(/(?<![a-zA-Z\\])rac\{/g, '\\frac{')
    .replace(/(?<![a-zA-Z\\])ext\{/g, '\\text{')
    .replace(/(?<![a-zA-Z\\])ight\)/g, '\\right)')
    .replace(/(?<![a-zA-Z\\])eft\(/g, '\\left(')
    .replace(/_{5,}/g, ' $\\dots$ ')
    .replace(/\\\$frac/g, '\\frac')
    .replace(/\$frac/g, '\\frac')
    .replace(/\\fra\$c\$/g, '\\frac')
    .replace(/\\fr\$a\$c\$/g, '\\frac')
    .replace(/\\frac\s*([0-9]+)\s*\{([0-9]+)\}/g, '\\frac{$1}{$2}')
    .replace(/\\frac\s*\$?\{([0-9]+)\}\s*\$?\{([0-9]+)\}/g, '\\frac{$1}{$2}')
    .replace(/\\frac\{([0-9]+)\}\s*\$?\{([0-9]+)\}/g, '\\frac{$1}{$2}')
    .replace(/\\frac\{([0-9]+)\}\s*([0-9]+)/g, '\\frac{$1}{$2}')
    .replace(/\{\{([^{}]+)\}\}\{\{([^{}]+)\}\}/g, '{$1}{$2}')
    .replace(/\\underbrace\{([\s\S]+?)\}\s*\{(\s*\\text\{[^{}]+\}\s*)\}/g, '\\underbrace{$1}_{$2}')
    .replace(/\\underbrace\{([^{}]+)\}\s*\{([^{}]+)\}/g, '\\underbrace{$1}_{$2}')
    .replace(
      /(?<!\$)\\begin\{(aligned|matrix|pmatrix|bmatrix|vmatrix|array|cases)\}[\s\S]*?\\end\{\1\}(?!\$)/g,
      '$$\n$&\n$$',
    )
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Protection des blocs mathématiques — port EXACT (l.2177-2191)
// ──────────────────────────────────────────────────────────────────────────
export interface MathBlock { type: 'display' | 'inline'; math: string }
export interface ProtectedResult { text: string; blocks: MathBlock[] }

const PLACEHOLDER_PREFIX = '%%%MATHBLOCK_'

export function protectMathBlocks(md: string): ProtectedResult {
  const blocks: MathBlock[] = []

  // Blocs display $$...$$ (sans franchir ###, ---, ```)
  let text = md.replace(/\$\$((?:(?!###|---|```)[\s\S])*?)\$\$/g, (_m, math: string) => {
    const id = blocks.length
    blocks.push({ type: 'display', math: cleanMathEquation(math.trim()) })
    return '\n\n' + PLACEHOLDER_PREFIX + id + '%%%\n\n'
  })

  // Équations inline $...$ (strictement isolées, sans pipe de tableau ni retour ligne)
  text = text.replace(/\$([^$\n|]+?)\$/g, (_m, math: string) => {
    const id = blocks.length
    blocks.push({ type: 'inline', math: cleanMathEquation(math.trim()) })
    return PLACEHOLDER_PREFIX + id + '%%%'
  })

  return { text, blocks }
}

// ──────────────────────────────────────────────────────────────────────────
// Transformations HTML des composants visuels & rubriques — port (l.2193-2250)
// ──────────────────────────────────────────────────────────────────────────
export interface RenderOptions {
  /** Résout `asset://figures/NOM` → URL réelle du binaire (base active). */
  resolveAsset?: (figureFileName: string) => string
}

function transformStructuredBlocks(text: string, opts?: RenderOptions): string {
  let out = text

  // Bannières de page : ### 📄 الصفحة N من الكتاب المدرسي :
  out = out.replace(
    /###\s*📄\s*الصفحة\s*(\d+)\s*من\s*الكتاب\s*المدرسي\s*:?/g,
    (_m, pNum: string) =>
      `<div class="page-banner" data-page="${pNum}">` +
      `<div><h6>📄 الصفحة ${pNum} من الكتاب المدرسي الرسمي</h6>` +
      `<small>المفاهيم والرسوم الهندسية والمخططات التوضيحية</small></div>` +
      `<button type="button" class="page-banner-preview" data-page="${pNum}">` +
      `🖼️ معاينة الرسوم والمخططات الأصلية (ص ${pNum})</button></div>`,
  )

  // Encadrés de schémas géométriques : #### 📐 الرسم والشكل الهندسي التوضيحي :
  out = out.replace(
    /####\s*📐\s*(الرسم والشكل الهندسي التوضيحي|رسم وتوضيح هندسي)\s*:\s*([\s\S]*?)(?=\n###|\n---|<!--|\n<div|$)/g,
    (_m, _title: string, content: string) =>
      `<div class="visual-math-card">` +
      `<div class="visual-math-head"><span>📐 رسم ومخطط هندسي توضيحي معتمد</span>` +
      `<span class="badge badge-secondary">شكل توضيحي</span></div>` +
      `<div class="visual-math-body">${content.trim()}</div></div>`,
  )

  // Images Markdown & assets asset://figures/
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => {
    if (src.startsWith('asset://figures/')) {
      const figFile = src.replace('asset://figures/', '')
      const actualSrc = opts?.resolveAsset ? opts.resolveAsset(figFile) : figFile
      return (
        `<div class="svg-figure-wrapper" data-figure="${alt}">` +
        `<img src="${actualSrc}" alt="${alt}" />` +
        `<div><small>📐 ${alt}</small></div></div>`
      )
    }
    return `<div class="svg-figure-wrapper"><img src="${src}" alt="${alt}" /><br><small>🖼️ ${alt}</small></div>`
  })

  // Rubriques didactiques 2G (5) + badge remédiation
  out = out
    .replace(
      /(?:####\s*|\*\*)\s*(أكتشف)\s*(?:\*\*|)/g,
      '<div class="didactic-rubric-discover">🧭 أكتشف (أنشطة وبناء المفاهيم)</div>',
    )
    .replace(
      /(?:####\s*|\*\*)\s*(أتعلم|معارف)\s*(?:\*\*|)/g,
      '<div class="didactic-rubric-learn">📖 أتعلم (المعارف والخواص المعتمدة)</div>',
    )
    .replace(
      /(?:####\s*|\*\*)\s*(أكتسب طرائق)\s*(?:\*\*|)/g,
      '<div class="didactic-rubric-methods">💡 أكتسب طرائق (طرائق ونماذج الحل)</div>',
    )
    .replace(
      /(?:####\s*|\*\*)\s*(دوري الآن)\s*(?:\*\*|)/g,
      '<div class="didactic-rubric-now">✍️ دوري الآن (تطبيق مباشر)</div>',
    )
    .replace(
      /(?:####\s*|\*\*)\s*(أقوم تعلماتي)\s*(?:\*\*|)/g,
      '<div class="didactic-rubric-assess">🎯 أقوم تعلماتي (تقييم وبناء العلاج)</div>',
    )
    .replace(
      /أعود\s*إلى\s*الصفحة\s*(\d+)/g,
      '<a href="#page-$1" class="didactic-remediation-badge" data-page="$1">↩ أعود إلى الصفحة $1</a>',
    )

  // Garantir un saut de ligne autour des tableaux Markdown (parsing GFM)
  out = out
    .replace(/([^\n|])\n(\|)/g, '$1\n\n$2')
    .replace(/(\|\n)([^\n|])/g, '$1\n\n$2')

  return out
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Réinjection KaTeX + parsing marked — port EXACT (l.2252-2274)
// ──────────────────────────────────────────────────────────────────────────
marked.setOptions({ gfm: true, breaks: false })

function renderMathBlocks(html: string, blocks: MathBlock[]): string {
  let out = html
  blocks.forEach((item, idx) => {
    const placeholder = PLACEHOLDER_PREFIX + idx + '%%%'
    try {
      const rendered = katex.renderToString(item.math, {
        displayMode: item.type === 'display',
        throwOnError: false,
        strict: 'ignore',
        output: 'html',
      })
      out = out.split(placeholder).join(rendered)
    } catch {
      out = out.split(placeholder).join('<span class="text-danger">' + item.math + '</span>')
    }
  })
  return out
}

/**
 * Pipeline complet : retourne du HTML SANITISÉ (DOMPurify) prêt pour
 * dangerouslySetInnerHTML. Les classes/styles/MathML de KaTeX ainsi que les
 * attributs `data-page` (ponts vers les scans) sont explicitement autorisés.
 */
export function renderMarkdownWithKaTeX(raw: string, opts?: RenderOptions): string {
  if (!raw) return ''

  const healed = selfHealRawText(raw)
  const { text, blocks } = protectMathBlocks(healed)
  const structured = transformStructuredBlocks(text, opts)

  const parsed = marked.parse(structured, { async: false }) as string
  const withMath = renderMathBlocks(parsed, blocks)

  return DOMPurify.sanitize(withMath, {
    // KaTeX émet du HTML + du MathML ; on autorise les balises/attributs utiles.
    ADD_TAGS: [
      'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext',
      'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd',
      'munder', 'mover', 'munderover', 'mspace', 'mpadded', 'mphantom', 'menclose',
      'mstyle', 'mfenced', 'mglyph',
    ],
    ADD_ATTR: [
      'data-page', 'aria-hidden', 'style', 'class',
      'mathvariant', 'displaystyle', 'scriptlevel', 'encoding', 'width', 'height',
    ],
  })
}
