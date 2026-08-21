/**
 * RAGDom — Worker d'entrée pour Cloudflare Containers (déploiement complet).
 *
 * Le conteneur exécute l'image racine du dépôt : FastAPI single-origin
 * (UI compilée sur /, API sur /api/*, moteur sci-engine inclus).
 * Ce Worker ne fait que router 100 % du trafic HTTP vers l'instance unique.
 *
 * ⚠️ DISQUE ÉPHÉMÈRE (limite plateforme, avr. 2026) : à la mise en veille du
 * conteneur, le disque repart de l'image. Stratégies :
 *   1. Bases pré-chargées : COPY des .sqlite dans l'image (voir README) — la
 *      bibliothèque de consultation renaît identique à chaque réveil. ✔ recommandé
 *   2. sleepAfter long (ci-dessous) pour espacer les réveils.
 *   3. FUSE → R2 pour une vraie persistance (avancé, cf. doc Cloudflare).
 */
import { Container, getContainer } from "@cloudflare/containers";

export class RagdomContainer extends Container<Env> {
  defaultPort = 8000;
  sleepAfter = "2h"; // veille après 2 h sans requête (le disque est alors réinitialisé)

  envVars = {
    // Consultation publique par défaut — passez READONLY à "false" ET définissez
    // un RAGDOM_AUTH_TOKEN (secret Wrangler) pour l'atelier d'ingestion complet.
    RAGDOM_READONLY: "true",
    RAGDOM_ALLOW_REVEAL: "false",
    RAGDOM_ASK_RATE_PER_MIN: "6",
    RAGDOM_OFFLINE: "false", // modèles OCR/embeddings téléchargés au 1er démarrage
  };
}

interface Env {
  RAGDOM: DurableObjectNamespace<RagdomContainer>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Instance unique nommée : toutes les requêtes vont au même conteneur.
    return getContainer(env.RAGDOM, "ragdom-main").fetch(request);
  },
} satisfies ExportedHandler<Env>;
