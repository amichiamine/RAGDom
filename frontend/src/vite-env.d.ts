/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origine du backend (Phase 7 — vitrine web) ; vide = même origine / proxy dev. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
