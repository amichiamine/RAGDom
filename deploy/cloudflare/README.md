# RAGDom — Déploiement COMPLET via Cloudflare Containers

**Vérifié le 2026-08-21 :** Cloudflare Containers est **GA depuis le 13 avril 2026** — le
déploiement complet (UI + API + moteur sci-engine) via Cloudflare est donc possible.
**Prérequis : plan Workers Paid (5 $/mois — les Containers ne sont PAS inclus dans le plan Free)**
et Docker en marche sur ta machine au moment du `wrangler deploy`.

## Déployer (3 commandes)

```bash
cd deploy/cloudflare
npm install
npx wrangler deploy     # build l'image Docker (racine du dépôt), la pousse au registre
                        # Cloudflare, déploie le Worker → https://ragdom-web.<compte>.workers.dev
```

Premier déploiement : ~10 min (build de l'image) + quelques minutes de provisioning
des conteneurs sur le réseau. Vérifier : `npx wrangler containers list`.
Premier accès : démarrage à froid 1-3 s + téléchargement des modèles OCR/embeddings
(une fois par réveil, voir la limite disque ci-dessous).

## Configuration

- **Consultation publique (défaut)** : `RAGDOM_READONLY=true` dans `src/worker.ts` —
  les routes d'administration n'existent pas (404).
- **Atelier complet** : passer `RAGDOM_READONLY` à `"false"` et définir le jeton :
  `npx wrangler secret put RAGDOM_AUTH_TOKEN` puis l'injecter dans `envVars` via
  `this.env` (cf. doc @cloudflare/containers).
- **Gabarit d'instance** : `standard` (4 GiB / ½ vCPU / 4 GB disque). `basic` (1 GiB)
  suffit en consultation pure (pic RAM mesuré : 489 Mo).

## ⚠️ La limite à connaître : disque ÉPHÉMÈRE

Doc officielle : « All disk is ephemeral. When a Container instance goes to sleep,
the next time it is started, it will have a fresh disk. » Les `.sqlite` uploadés à
chaud disparaissent donc à chaque mise en veille (`sleepAfter: 2h` sans trafic).

**Stratégie recommandée — bibliothèque immortelle par l'image** : ingère localement,
puis embarque les bases finies DANS l'image. Ajouter au `Dockerfile` racine, avant le CMD :

```dockerfile
# Bases pré-chargées (Base Autonome V3.5 : un .sqlite = bibliothèque complète)
COPY databases_publiees/*.sqlite /data/databases/
```

(créer `databases_publiees/` à la racine avec tes exports). Chaque réveil du conteneur
ressert exactement cette bibliothèque — parfait pour la consultation. Redéployer pour
mettre à jour. Alternatives : snapshots (annoncés par Cloudflare), FUSE→R2 (avancé).

## Quand préférer autre chose

| Besoin | Meilleure option |
|---|---|
| 100 % gratuit | Hugging Face Spaces (même image Docker) — voir docs/GUIDE_DEPLOIEMENT_WEB.html |
| Persistance disque réelle sans redéploiement | Railway/Fly avec volume (~5 $/mois aussi) |
| Déjà sur l'écosystème Cloudflare, trafic en rafales | **Cette option** (facturation CPU actif, scale-to-zero) |
