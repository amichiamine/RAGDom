# Validation du Frontend RAGDom

## ✅ VALIDATION EFFECTUÉE — 2026-08-21 (sandbox, après ouverture du registre npm)

| Étape | Résultat |
|---|---|
| `npm install` | OK (dépendances du package.json résolues sans conflit) |
| `npx tsc --noEmit` (strict) | **0 erreur** (1 corrigée : compteur pages_total de la carte ETA non alimenté — câblage onBatchStarted ajouté) |
| `vite build` | **OK** — 1 647 modules, dist/ ≈ 795 kB JS (242 kB gzip) + 47 kB CSS |

Avertissement non bloquant : chunk > 500 kB (katex + marked + lucide dans le bundle principal).
Optimisation possible plus tard via `manualChunks` — sans impact fonctionnel local.

## Sur la machine cible (Windows)
```bat
cd frontend
npm install
npm run dev        &:: développement (proxy /api → localhost:8000)
npm run build      &:: production → dist/
```

## Déploiement de l'UI sur Cloudflare (vitrine — Phase 7)
Le backend ne tourne PAS sur Cloudflare. L'UI seule peut y être servie :
1. **Workers (wrangler.jsonc fourni)** : build command `npm run build`, puis `npx wrangler deploy`
   — le fichier `frontend/wrangler.jsonc` sert `dist/` en assets statiques (SPA fallback),
   sans l'auto-détection Vite qui exigeait Vite ≥ 6.
2. **Pages** : build command `npm run build`, output `frontend/dist`, root `frontend`.

Pour une UI FONCTIONNELLE, définir l'origine du backend au build :
`VITE_API_URL=https://<votre-tunnel-ou-vps> npm run build`
et côté backend : `RAGDOM_READONLY=true` (branche post-v1) + `FRONTEND_URL` incluant le domaine Cloudflare.

## Restant machine cible
- Recette visuelle pixel-perfect sur base 2G réelle (checklist Lot 11 de sprint_pixel_perfect.md)
- Tests Playwright/Jest (à écrire sur la base du build validé)
