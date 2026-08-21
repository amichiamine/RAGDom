import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Ports pilotés par l'environnement (DX) : rien n'est figé.
//   VITE_PORT        — port du dev-server (défaut 5173 ; auto-incrément si occupé)
//   VITE_BACKEND_URL — cible du proxy /api (défaut http://localhost:${BACKEND_PORT|8000})
const backendUrl = process.env.VITE_BACKEND_URL
  || `http://localhost:${process.env.BACKEND_PORT || 8000}`

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    strictPort: false, // port occupé → Vite bascule automatiquement (5174, 5175…)
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
        rewrite: (path) => path,
      },
    },
  },
})
