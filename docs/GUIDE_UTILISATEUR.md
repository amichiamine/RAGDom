# RAGDom — Guide Utilisateur

**Version 3.5 · 2026-08-21** — Bibliothèque numérique scientifique locale.
Public : l'utilisateur final (enseignant, élève, documentaliste). Pour l'installation, voir `README.md` §0 ; pour la validation technique, `frontend/VALIDATION.md`.

---

## 1. Démarrer

1. Lancer le backend : `cd backend && .venv\Scripts\python -m uvicorn main:app --port 8000`
2. Lancer le frontend : `cd frontend && npm run dev` puis ouvrir http://localhost:5173
3. Au premier lancement, l'écran d'accueil (Dashboard) est vide : c'est normal — RAGDom n'affiche QUE le contenu réellement présent dans vos bases `.sqlite`. Aucune donnée d'exemple n'est simulée.

## 2. Les 3 vues

### Vue 1 — Dashboard (accueil)
Cartes de vos bases documentaires (une base = un niveau × une matière, ex. `Maths_1AM.sqlite`) avec leurs métriques réelles : documents, chunks, artefacts, pages indexées. Un clic sur une base l'active pour tout le reste de l'application.

### Vue 2 — Bibliothèque
- **Base sans curriculum** (Mode Repli Générique) : exploration par table des matières (arbre), lecture côte-à-côte texte reconstruit ↔ scan original du livre, recherche hybride, et chat Ask.
- **Base avec curriculum** (rempli via le Curriculum Studio, Vue 3) : le workspace complet à 6 onglets s'active — Matrice 360°, Programme officiel, Cours (KaTeX + scans), Banque d'exercices avec corrigés liés, Évaluations (sujet ↔ corrigé côte à côte), Galerie des scans. Les « ponts » (boutons colorés) naviguent d'un onglet à l'autre en illuminant la cible (halo doré).
- **Recherche** : la barre latérale filtre tous les onglets en direct ; le sélecteur de trimestre filtre l'ensemble du workspace ; le saut de page ouvre directement le cours ou le scan de la page demandée.
- **Ask (chat de la bibliothèque)** : posez une question en français ou en arabe ; la réponse est générée UNIQUEMENT à partir de vos documents, avec les sources citées (document, page, section). Si rien de pertinent n'existe, RAGDom vous le dit — il n'invente jamais. Sans clé LLM configurée, il présente directement les extraits les plus pertinents.

### Vue 3 — Automation Hub
- **Sources** : téléversez vos PDF (glisser-déposer, ≤ 1 Go) dans l'arborescence `/sources/{Matière}/{Niveau}/` — le nom de la base cible est déduit automatiquement.
- **Ingestion** : bouton Lancer sur un fichier, un dossier, ou une plage de pages. La console SSE affiche chaque étape en temps réel (restauration visuelle → triage → extraction → qualification → lint → VLM → benchmark → persistance) avec carte ETA et débit.
- **Quarantaine** : les pages en échec après 3 tentatives y sont isolées SANS bloquer le reste ; bouton Réessayer après correction.
- **Purge scopée** : suppression chirurgicale à 7 niveaux (page, plage, chapitre, document, base, artefacts seuls, curriculum seul). TOUJOURS précédée d'une prévisualisation d'impact (dry-run) ; la purge d'une base entière exige la re-saisie exacte de son nom ; l'option « préserver les éditions humaines » est activée par défaut.
- **Clés LLM** : ajoutez vos clés (Gemini, Groq, OpenAI, Anthropic, Ollama local). Rotation automatique en cas de quota, bascule de fournisseur en cas de panne, fallback Ollama. Les clés sont masquées à l'affichage.
- **Curriculum Studio** : c'est ici que vous passez une base du Mode Repli aux 6 onglets — créez les trimestres, séquences (مقاطع), évaluations et liaisons, ou importez un JSON complet.
- **Réglages** : seuils de pertinence de la recherche (cosinus ≤ 0.45, BM25 ≤ -0.3 par défaut — calibrés sur corpus réel), mode strict du moteur vectoriel.

## 3. Corriger un contenu

Chaque chunk (texte) et artefact (formule, tableau, figure) est éditable dans la Vue 2. Une correction humaine : est re-vérifiée par le linter, re-vectorisée pour la recherche, marquée `is_human_edited` — et **jamais écrasée** par une ré-ingestion ni par une purge avec préservation activée.

## 4. Sauvegarder / partager une bibliothèque

Une base `.sqlite` est AUTONOME : elle contient textes, formules, tableaux, curriculum ET les scans du livre. Vue 3 → Bases → Exporter produit un fichier unique copiable sur clé USB ou envoyable — la personne qui le place dans son dossier `/databases/` retrouve 100 % du contenu, scans compris.

## 5. Résolution de problèmes

| Symptôme | Cause probable | Solution |
|---|---|---|
| Bandeau « Recherche sémantique désactivée » | sqlite-vec non chargé | La recherche BM25 reste opérationnelle ; Vue 3 → Réglages → Tester le moteur vectoriel |
| Ask répond « Je ne trouve pas d'informations pertinentes » | Rien d'assez proche dans les bases sélectionnées | Reformuler, élargir les bases interrogées — c'est une protection anti-hallucination, pas une panne |
| Page en quarantaine | PDF corrompu/protégé sur cette page | Vue 3 → Quarantaine → motif détaillé → corriger le PDF source puis Réessayer |
| Ingestion lente | Mode OCR (livre scanné) | Normal : Tier 2. La carte ETA affiche la projection réelle ; l'application reste utilisable pendant l'ingestion |
| L'interface ne montre aucune base | Backend arrêté ou dossier /databases/ vide | Vérifier le backend (http://localhost:8000/api/system/health) puis ingérer un premier PDF |

## 6. Raccourcis

- `Ctrl/Cmd + B` : ouvrir/fermer la barre latérale (Vue 2 curriculum)
- `Ctrl/Cmd + K` : palette de commandes (navigation rapide)
- `Échap` : fermer modale / quitter le plein écran
