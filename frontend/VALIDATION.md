# Validation du build frontend (à exécuter sur la machine cible)

Le registre npm était inaccessible dans l'environnement d'implémentation (pare-feu
d'egress, HTTP 403 sur registry.npmjs.org). Le code a subi un audit statique complet
(48/48 fichiers : imports résolus, zéro import inutilisé, cohérence props/appels,
locales JSON valides) mais la compilation DOIT être rejouée avant la Phase 5 :

```bash
cd frontend
npm install
npx tsc --noEmit     # exigence D.O.D. : ZÉRO erreur
npx vite build       # build de production
npm run dev          # http://localhost:5173 (proxy /api → backend :8000)
```

Note : les renderers Tier add-on (mermaid, shiki, plotly, maplibre, 3dmol,
openseadragon, vexflow, abcjs, three) sont en commentaire dans package.json
(tech_specs §9 Note Tiering) — les activer famille par famille.
