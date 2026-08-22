/**
 * Déclaration ambiante minimale pour `plotly.js-dist-min` (bundle sans types).
 *
 * Placée dans un fichier `.d.ts` autonome (sans import/export de premier niveau)
 * afin d'être une *déclaration de module ambiante* valide. Un `declare module`
 * inline dans un fichier-module (`.tsx` avec des imports) produit sinon TS2665
 * « Invalid module name in augmentation … resolves to an untyped module », car
 * `plotly.js-dist-min` se résout sur disque mais ne fournit aucun type.
 *
 * On ne dépend que de `newPlot` / `purge`, tous deux en signatures larges.
 */
declare module 'plotly.js-dist-min' {
  export function newPlot(
    root: HTMLElement,
    data: unknown[],
    layout?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Promise<HTMLElement>
  export function purge(root: HTMLElement): void
}
