# **README — PROJET RAGDom : DÉPLOIEMENT & INITIALISATION**

**Version :** 3.5 (Base Autonome)

---

## **0. DÉPLOIEMENT DU PACKAGE (À EXÉCUTER AVANT TOUT)**

Ce package (`RAGDom_V3.5_complet.zip`) est transmis tel quel à l'agent — dézippé ou non. Ce README est le **point d'entrée** : il définit le déploiement correct des fichiers et dossiers, puis fournit le prompt d'initialisation.

### **0.1 Extraction**

Extraire l'archive **directement à la racine du projet** : `c:\xampp\htdocs\RAGDom\` (pas de dossier intermédiaire — les fichiers du ZIP sont à la racine de l'archive).

**Contenu attendu après extraction :**
```
c:\xampp\htdocs\RAGDom\
├── README.md                        ← ce fichier (déploiement + prompt d'initialisation)
├── Blueprint Master RAGDom.md      ← vision, architecture, contrat API (Parties 1-8)
├── tech_specs.md                    ← DDL, DTO, RAG, whitelists (autorité SQL/DTO)
├── Frontend_UI_Specs.md             ← UI/UX normative (PARTIES 1-8)
├── Agents.md                        ← contrat comportemental de l'agent
├── Skills.md                        ← référentiel de compétences autorisées
├── changelog.md                     ← à archiver dans /docs/ragdom/04_state/ en Phase 0
└── .agents\
    └── skills\
        └── motion-design\           ← Agent Skill (découverte native Antigravity)
            ├── SKILL.md
            ├── README.md
            └── references\
```
⚠️ Windows : le dossier `.agents\` est masqué (préfixe point) — activer « Éléments masqués » dans l'Explorateur pour le voir. Antigravity le détecte dans tous les cas.

### **0.2 Instructions de déploiement pour l'agent (Phase 0, premières actions)**

1. **Vérifier** la présence des 7 fichiers `.md` ci-dessus et du dossier `.agents\skills\motion-design\` ; vérifier que l'en-tête de chaque document porte **Version 3.5**. Toute divergence → STOP + alerte à ArchiSys3.0.
2. **Créer l'arborescence physique manquante** (ne rien déplacer d'existant) :
```
/sources/              ← zone d'ingestion (PDFs déposés par ArchiSys3.0 ou via SourcesManager)
/databases/            ← bases SQLite générées
/pipeline-set/         ← checkpoints & cache temporaire
/engines/sci-engine/   ← moteur scientifique : engine.json (manifeste) + pipeline/ (couches 0→7+3bis) + models/
                          (V3.4 : le noyau /backend reste agnostique — /engines/ accueillera legal-engine,
                           medical-engine…, chacun avec son manifeste, son pipeline et ses modèles, zéro mélange)
/backend/              ← code Python (FastAPI)
/frontend/             ← code React
/docs/ragdom/          ← mémoire physique de l'agent (contenu initial : Agents.md §2)
/Template_UI-UX/       ← créer VIDE — les 3 templates PHP seront fournis par ArchiSys3.0 au checkpoint Phase 4
```
3. **Archiver** `changelog.md` vers `/docs/ragdom/04_state/changelog.md` (en conservant une copie racine tant que la Phase 0 n'est pas validée).
4. **Ne JAMAIS déplacer** les fichiers `.md` fondateurs de la racine (la Règle 1 Read-Before-Write d'Agents.md y pointe) ni le dossier `.agents\skills\`.
5. Le skill **motion-design** est pré-installé : l'utiliser pour toute animation/transition UI en Phase 4/4B (il s'active automatiquement ; sinon l'invoquer explicitement).

### **0.3 Checklist de vérification du déploiement**

| Vérification | Attendu |
|---|---|
| 7 fichiers .md à la racine | ✔ présents, en-têtes Version 3.5 |
| `.agents\skills\motion-design\SKILL.md` | ✔ présent (+ references/) |
| 8 dossiers créés (sources, databases, pipeline-set, engines/sci-engine, backend, frontend, docs/ragdom, Template_UI-UX) | ✔ créés, vides |
| `/docs/ragdom/` initialisé (Agents.md §2 : contenus initiaux complets) | ✔ 7 fichiers de mémoire |
| changelog archivé dans 04_state/ | ✔ |

Une fois cette checklist validée et affichée à ArchiSys3.0, passer au prompt d'initialisation ci-dessous.

### **0bis. DÉMARRAGE LOCAL (DÉVELOPPEMENT) & SEED DES BASES PUBLIÉES — (MAJ 2026-08-22)**

Depuis la racine : `npm install` puis `npm run dev` (lance simultanément le backend FastAPI et le frontend Vite). Le frontend s'ouvre sur `http://localhost:5173`, le backend sur `http://localhost:8000`.

⚠️ **La bibliothèque locale est VIDE tant que la base n'a pas de contenu.** RAGDom n'affiche QUE le contenu réellement présent dans les fichiers `.sqlite` de `/databases/` (Zéro Mock — aucune donnée d'exemple simulée). Au premier clonage, `/databases/` est vide → l'écran d'accueil ne montre aucune base. Deux façons d'y remédier :

1. **Ingérer un PDF** via le Automation Hub (Vue 3) — construit une base localement.
2. **Récupérer les bases PUBLIÉES du corpus** (recommandé pour explorer immédiatement) :
   ```
   npm run fetch:dbs
   ```
   Ce script (`scripts/fetch_published_dbs.mjs`, Node pur, zéro dépendance) télécharge les assets `.sqlite` de la release GitHub publique du corpus vers `databases_publiees/` à la racine. Au démarrage suivant du backend, `backend/main.py` copie chaque `.sqlite` absent de `DATABASES_DIR` vers `/databases/` (copie non destructive, jamais d'écrasement d'une base déjà présente) → la Library est alors peuplée. Le script est idempotent (il saute tout fichier déjà présent à la bonne taille).

   Réglages par variables d'environnement (valeurs par défaut, aucune obligatoire) : `RAGDOM_RELEASE_REPO` (défaut `amichiamine/RAGDom`), `RAGDOM_RELEASE_TAG` (défaut `corpus-1am-v1`), `RAGDOM_PUBLISHED_DBS` (défaut `<racine>/databases_publiees`).

### **0ter. STUDIO DE VALIDATION FINAL (MAJ 2026-08-22)**

Le Studio est disponible dans **Automation** et s'appuie sur le routeur admin `/api/validation`. Il permet de prévisualiser puis valider une base entière multi-documents, un document, une entrée TOC (`toc/chapter/course/title`), une page, une plage ou une sélection. `POST /runs` crée par `sqlite3.Connection.backup` une copie physique `validation_test_<run>.sqlite` confinée à `DATABASES_DIR`, puis `POST /runs/{id}/execute` purge et ré-exécute réellement toutes les couches du pipeline uniquement dans cette copie. La base officielle reste inchangée jusqu'à l'acceptation.

Les états d'exécution sont `CREATED → QUEUED/RUNNING → COMPLETED`, ou `BLOCKED` si un PDF source officiel manque, `FAILED` en cas d'échec et `CANCELLED` après annulation ciblée. Le détail et le rapport exposent copie, opération, batch(s), progression et erreur ; le frontend poll uniquement le run ouvert. Le rejet supprime la copie, son WAL et son SHM. L'acceptation contrôle le hash optimiste et les éditions humaines, puis promeut transactionnellement les seules pages du scope depuis la copie avant de la supprimer.

La migration additive/idempotente **007** complète 005/006 avec `working_db_filename`, opération, batchs, état/progression et erreur. Les copies `validation_test_` sont masquées de la découverte et ne peuvent être exportées/dupliquées via les routes de cycle de vie. La requalification avec `run_id` est autorisée seulement après `COMPLETED` et est automatiquement redirigée vers la copie physique ; aucune mutation officielle n'est possible par ce chemin.

Les tests end-to-end utilisent des PDF et bases temporaires, désactivent les appels VLM/LLM externes et vérifient isolation, diff réel, publication scopée, source absente, polling après reprise, annulation et suppression des copies.

**Instructions pour ArchiSys3.0 :**

Attache les **fichiers** suivants à ta session avec l'agent, puis copie-colle le bloc de texte ci-dessous comme **premier message** de la session.

```
Fichiers à attacher :
1. Blueprint Master RAGDom.md
2. tech_specs.md
3. Agents.md
4. Skills.md
5. Frontend_UI_Specs.md
6. README.md (ce fichier — contient les instructions de déploiement §0)
```

---

## **[ COPIER-COLLER LE TEXTE CI-DESSOUS DANS LE CHAT DE L'AGENT ]**

Tu interviens en tant que Tech Lead Sénior et Ingénieur Full-Stack (standard Archisys3.0). Je viens de te fournir l'ensemble documentaire fondateur pour notre projet RAGDom :

1. **Blueprint Master RAGDom.md** — La vision complète, les 8 parties de l'architecture : règles fondamentales, arborescence physique des données ET du code source, orchestrateur LLM/Key Manager, les 25 familles d'actifs, le pipeline d'ingestion en 8 couches, l'architecture Frontend (3 vues, Design System imposé), et le **contrat complet de toutes les routes API REST** (système, bibliothèque, recherche, pipeline SSE, LLM Key Manager, et **Partie 7.6 V3.2 : Administration, Purge Scopée multi-niveaux, Chat RAG, corrections humaines, sources, cycle de vie des bases, réglages, télémétrie, curriculum CRUD, import Tier 3**).

2. **tech_specs.md** — Le contrat d'interface normatif absolu : le **DDL SQLite complet** (9 tables cœur dont FTS5 et versioning, table `ingestion_batches`, 4 tables curriculum optionnelles, colonnes `is_human_edited` V3.2, 5 triggers FTS — 2 sync + 3 cohérence —, table `vec_chunks` + 2 triggers vectoriels conditionnels via `schema_vec.sql`, et base `ragdom_config.sqlite` avec `app_settings`), les **contrats de données DTO/JSON** pour chaque couche du pipeline (Couche 0 à 5 + Couche 3bis SolutionLinker), les **spécifications RAG** (chunking 512 tokens, overlap 15%, modèle paraphrase-multilingual-MiniLM-L12-v2 via fastembed ONNX (384d, vérifié), formule RRF exacte, seuils anti-hallucination réels — distance cosinus ≤ 0.45 / bm25 ≤ -1.5), la **stratégie de résilience vectorielle** (Option B fallback FTS5 BM25 + Option A stricte forçable via UI/env), le traitement des **documents mixtes multi-scripts** (Arabe + FR/EN), le **protocole des agents** (PipelineOrchestrator, VisionWorker, FallbackVLMAgent), le **D.O.D complet** (16 tests backend + 10 tests frontend), les `requirements.txt` et `package.json` complets, et la **stratégie de migration SQLite**.

3. **Frontend_UI_Specs.md** — Spécifications UI/UX pixel-perfect pour les 3 vues React (Dashboard, Bibliothèque 6 onglets, Automation Hub) : réplication exacte des templates PHP (`index.php`, `library.php`, `automation.php`), design system CSS dual-theme dark/light complet (`index.css`), configurations `vite.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `index.html`, interfaces TypeScript DTO complètes, client API centralisé (`lib/api.ts`), contextes globaux (`DatabaseContext`, `ThemeContext`, `LanguageContext`), **i18n Trilingue** (Arabe par défaut absolu, Français, Anglais) avec commutation dynamique **RTL ↔ LTR**, **isolation BiDi stricte** des formules et actifs scientifiques mixtes, composant `LanguageSelector.tsx`, bandeau `VectorEngineAlert.tsx`, détails comportementaux complets de chaque vue, **Mode Repli Générique** de la Vue 2 (D1-B), carte **ETA & Débit** de la Vue 3, et la **PARTIE 7 (V3.2) — Administration & Couverture Totale** : AskStudio (chat RAG), PurgeStudio (purge scopée avec dry-run), ChunkEditor (correction humaine), CurriculumStudio, SourcesManager, DatabaseLifecycle, QuarantineManager, SettingsPanel, TelemetryExplorer, ArtifactImportModal, OnboardingEmptyState, ConnectionGuard et règles d'accessibilité.

4. **Agents.md** — Tes directives comportementales : la Règle 0 de Préséance des Documents + 8 règles anti-hallucination (Read-Before-Write, Zéro Mock, Zéro Régression, Alerte Matérielle, Alerte Dérive Architecturale, Checkpoint Visuel Phase 4 avec relecture obligatoire de `/Template_UI-UX/`), l'arborescence complète de ta mémoire physique `/docs/ragdom/` avec le contenu initial des fichiers, et le protocole d'interaction avec moi (Plans Chirurgicaux, Format de Réponse Standard).

5. **Skills.md** — Le référentiel de tes compétences autorisées et contraintes d'environnement : pip+venv exclusif, npm exclusif, FastAPI+uvicorn, tableau des 25 renderers frontend, implémentation du Sync-Scroll, code SSE, règles SQLite (PRAGMA, WAL, triggers, `init_vector_support` résilient), Key Manager avec gestion des codes HTTP, linter déterministe < 5ms, et techniques d'isolation BiDi.

**Ta première mission est l'initialisation stricte de ton environnement de travail et de ta mémoire contextuelle. N'écris aucune ligne de code applicatif (React ou Python) pour le moment.**

---

**TÂCHES À EXÉCUTER IMMÉDIATEMENT (dans cet ordre) :**

**1. Assimilation & Confirmation**

Confirme que tu as bien assimilé les contraintes suivantes en les reformulant brièvement (1 ligne chacune) :
- La règle du "Zéro Dogme" (agnosticisme total)
- La règle d'Anti-Régression (add-only)
- La contrainte CPU-First (aucun CUDA, pip+venv exclusif)
- La Queue Séquentielle Stricte (une page à la fois)
- La Règle du Zéro Mock (API de découverte, zéro hardcoding React)
- L'i18n Trilingue & Priorité Arabe (Arabe langue par défaut absolue et layout RTL, FR et EN pour l'UI, sélecteur de langue dans la Topbar)
- L'Isolation BiDi des Contenus Mixtes (préservation stricte en LTR des formules KaTeX, molécules, codes dans les documents arabes)
- La Résilience Vectorielle (Option B résiliente avec fallback FTS5 BM25 + Option A stricte forçable + alerte Automation Hub)
- Le Checkpoint Visuel Frontend (demande de confirmation + relecture obligatoire des 3 fichiers de Template_UI-UX/ avant de coder la Phase 4)
- L'Autonomie Totale des Tests (l'agent exécute lui-même 100% des tests via CLI, Pytest, scripts et présente le rapport de résultats/logs à ArchiSys3.0 pour validation)
- Le Gating Inter-Phases & Zéro Élision (validation bloquante d'ArchiSys3.0 avant de changer de phase, zéro code tronqué)
- Le Contrat API REST (toutes les routes sont définies dans Blueprint Partie 7)
- L'Arborescence Imposée (sources/, databases/, pipeline-set/, backend/, frontend/)
- La Règle de Préséance des Documents (Règle 0 — hiérarchie d'autorité par domaine)
- Le Contrat Mémoire à Deux Paliers (plancher 250 Mo hors moteurs / pic ≤ MAX_RAM_MB + Cycle de Vie des Moteurs)
- Le Tiering d'Extraction des 25 Familles (Tier 1 natif / Tier 2 VLM / Tier 3 import — rendu garanti pour les 25)
- Le Mode Repli Générique de la Vue 2 (tables curriculum peuplées → 6 onglets ; vides → exploration générique)
- La Whitelist Gelée & Vérifiée (versions PyPI confirmées le 2026-08-21 + procédure post-install opencv-headless, tech_specs §8)
- La Couverture Totale V3.2 (chat RAG anti-hallucination, purge scopée 7 niveaux avec prévisualisation dry-run, correction humaine protégée is_human_edited, gestion sources/bases/quarantaine, Curriculum Studio, import Tier 3, onboarding & accessibilité)
- Le Design System Étendu V3.3 (tokens motion normatifs, virtualisation des masses de données, Command Palette, inspecteur de cycle de vie, couleurs de domaine algorithmiques, identité multi-moteurs --engine-accent)

**2. Setup de la Mémoire Physique (Livraison obligatoire)**

Crée physiquement l'arborescence `/docs/ragdom/` exactement comme définie dans la section 2 de `Agents.md`. Pour chaque fichier `.md`, écris le **contenu initial complet** tel que spécifié dans `Agents.md` (pas un fichier vide, le contenu initial est défini).

Affiche-moi l'arbre généré dans ta réponse.

**3. Génération du Plan Global (Livraisons attendues)**

Rédige le contenu complet et final de `/docs/ragdom/01_tasklists/master_plan.md` : un découpage macro en **5 phases de développement séquentielles** tel que défini dans `Agents.md` (section 2, "Contenu Initial de master_plan.md"), avec toutes les sous-tâches checkboxées.

**4. Initialisation de l'État Projet**

Rédige le contenu complet et final de `/docs/ragdom/04_state/current_state.md` : initialise l'état du projet à "Phase 0 — Initialisation de l'Architecture" tel que défini dans `Agents.md`.

---

**Attends mon signal "GO Phase 1" avant de commencer à écrire du code applicatif.** Je validerai les livrables de l'étape d'initialisation avant de te donner le feu vert pour la Phase 1 (Backend Pipeline).

Ne dévie pas du référentiel `Skills.md` et n'invente aucune interface, route API, ou structure de données qui ne soit pas validée par `tech_specs.md` et `Blueprint Master RAGDom.md`.
