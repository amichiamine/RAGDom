# Phase 7 — Déploiement Web (Consultation & Full Web)

**Version :** 1.0 — 2026-08-21 · **Statut :** documentée, non implémentée
**Positionnement :** extension POST-v1, additive — ne modifie AUCUN principe du corpus V3.5. Le Local-First reste le mode nominal ; le web est une projection de la même architecture. L'intégration au corpus fondateur (Blueprint/README) constituerait une opération documentaire V3.6.

---

## 1. Principe directeur

RAGDom est déjà client-serveur HTTP : le frontend ne connaît le backend que par `VITE_API_URL`, le backend ne connaît le frontend que par le CORS (`FRONTEND_URL`). Rien n'attache le système à localhost hors configuration. L'arbitrage V3.5 « Base Autonome » fait du `.sqlite` une **unité de publication portable** : un fichier = une bibliothèque complète (textes, artefacts, scans WebP, curriculum).

**Répartition des rôles :**
- **Atelier (Local-First, inchangé)** : ingestion, sci-engine, corrections humaines, purges — sur la machine de l'utilisateur.
- **Vitrine (Web, nouveau)** : consultation de la Library, recherche hybride, Ask RAG — sur serveur.

**Contrainte non négociable :** le backend (FastAPI + sqlite-vec + rapid-* + fastembed) exige un **serveur** (VPS/dédié, Linux ou Windows). Il est INCOMPATIBLE avec le serverless/edge (Cloudflare Workers, Lambda…) : dépendances natives, filesystem persistant, batchs longs. Porter vers D1/Vectorize serait une réécriture hors périmètre.

## 2. Les 3 paliers

### Palier 1 — Tunnel (effort ~1 h, zéro code)
La machine locale reste le serveur ; un tunnel sortant (ex. `cloudflared tunnel --url http://localhost:8000`) publie l'API en HTTPS sans ouvrir de port. Frontend statique hébergé (Pages/Netlify/autre) avec `VITE_API_URL` = URL du tunnel.
- ✅ Consultation web immédiate, données jamais copiées hors de la machine.
- ⚠️ Disponibilité = disponibilité de la machine locale. À réserver à un usage personnel/démo.
- 🔒 OBLIGATOIRE : activer le mode consultation (§4) avant d'exposer le tunnel.

### Palier 2 — Publication de bases (RECOMMANDÉ)
Ingestion locale (atelier) → export des `.sqlite` finis (`GET /api/system/databases/{f}/export`, wal_checkpoint TRUNCATE inclus) → dépôt sur un VPS qui exécute le même backend en **mode consultation** + frontend statique servi par le reverse-proxy.
- ✅ Découplage total : l'atelier peut être éteint ; le VPS ne porte aucun secret d'ingestion ; mise à jour = re-upload d'un fichier.
- ✅ Dimensionnement minimal : lecture SQLite WAL = excellent en concurrence de lecture ; 2 vCPU / 2 Go suffisent (fastembed chargé uniquement pour vectoriser les REQUÊTES).
- Procédure type : venv + whitelist §8 (swap opencv-headless), `RAGDOM_READONLY=true`, uvicorn derrière Caddy/Nginx (HTTPS auto), frontend `vite build` copié dans le vhost.

### Palier 3 — Full Web (atelier distant)
Tout le stack sur VPS : upload des PDF sources via `/api/system/sources/upload`, ingestion à distance (SSE de suivi déjà en place), consultation au même endroit.
- ✅ Fonctionne sans modification du pipeline (CPU-first par conception : la whitelist tourne sur VPS standard ; MAX_RAM_MB=2048 respecté).
- ⚠️ EXIGE le Lot Auth complet (§4) : les routes d'administration deviennent accessibles au réseau.
- Dimensionnement : 4 vCPU / 4-8 Go recommandés pour l'ingestion (pics OCR) ; file séquentielle D4-A inchangée.

## 3. Matrice route × palier

| Router | Palier 1-2 (consultation) | Palier 3 (full web) |
|---|---|---|
| `/api/library/*` (GET) | ✅ public | ✅ public ou authentifié |
| `/api/search/*` (hybrid, multi, ask) | ✅ public + rate-limit sur /ask | ✅ idem |
| `/api/system/health`, `/engines`, `/databases` (GET) | ✅ public (lecture) | ✅ |
| `/api/library` PUT/POST (corrections, import) | ❌ absent | 🔒 auth |
| `/api/pipeline/*` (start, purge, quarantine, SSE) | ❌ absent | 🔒 auth |
| `/api/system/sources*`, `/databases` (export/duplicate/DELETE), `/settings` | ❌ absent | 🔒 auth (export : à décider par déploiement) |
| `/api/llm/*` (clés !) | ❌ absent | 🔒 auth + ne JAMAIS exposer /reveal hors localhost |
| `/api/curriculum/*` (CRUD) | ❌ absent | 🔒 auth |

## 4. Lot technique préalable (« Lot Web-Ready », ~1-2 sessions)

Le seul vrai blocant est l'absence d'authentification (postulat local assumé du corpus V3.5). Travaux, par ordre :

1. **`RAGDOM_READONLY=true`** (env) : `main.py` ne monte que library + search + system-lecture (health/engines/databases GET). Les routers admin ne sont PAS montés (absents ≠ 403 : surface d'attaque nulle). Test pytest : readonly → 46 routes réduites à ~20, toute route admin → 404.
2. **Auth par jeton** (palier 3) : `RAGDOM_AUTH_TOKEN` (env) → dépendance FastAPI `Authorization: Bearer` sur les routers admin ; le frontend le stocke en session (jamais dans le bundle). Suffisant pour un mono-utilisateur distant ; OAuth/multi-utilisateurs = hors périmètre v1.
3. **Rate-limiting `/ask`** : quota simple en mémoire (N requêtes/min/IP) — protège les clés LLM contre l'épuisement.
4. **Chiffrement des clés LLM au repos** (palier 3 uniquement) : clé de chiffrement en env, valeurs `llm_keys.api_key` chiffrées ; `/reveal` conditionné à `RAGDOM_ALLOW_REVEAL=true` (défaut false hors localhost).
5. **CORS** : `FRONTEND_URL` accepte une liste (domaine public + localhost dev).
6. **Frontend** : `VITE_API_URL` par environnement ; le ConnectionGuard existant couvre déjà le cas backend absent ; masquer la Vue 3 (Automation) quand `/api/system/health` annonce `readonly: true` (nouveau champ).

## 5. Anti-cibles (à ne pas faire)

- ❌ Cloudflare Workers/D1/Vectorize pour le backend (réécriture, perte sqlite-vec/FTS5 custom).
- ❌ Exposer le stack complet sans le Lot Web-Ready « juste pour tester ».
- ❌ Multi-tenancy (plusieurs utilisateurs isolés) — hors périmètre : RAGDom web reste mono-bibliothécaire.
- ❌ Dupliquer le frontend : le MÊME build sert les deux mondes, seule `VITE_API_URL` change.
