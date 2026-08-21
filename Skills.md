# **RÉFÉRENTIEL DES COMPÉTENCES TECHNIQUES : PROJET RAGDom**

**Version :** 3.5 (harmonisée — stack Tier 1 réelle, cycle de vie moteurs, tokenizer arabe, seuils réels ; multi-moteurs §4.6 ; base autonome page_scans §1)

**Cible :** Agentic System (Antigravity / Gemini / tout agent LLM)

**Niveau d'Expertise Requis :** Architecte Data, Expert Computer Vision CPU, Développeur Full-Stack Sénior (Standard Archisys3.0).

Pour implémenter RAGDom selon le Blueprint validé, l'agent doit mobiliser et **restreindre** ses connaissances aux technologies et paradigmes listés ci-dessous. Toute déviation vers des stacks non listées ici (ex: MongoDB, PyTorch GPU, Vue.js, Angular, Docker, Conda) est une **erreur d'architecture sévère** qui doit être signalée à ArchiSys3.0.

---

## **1. GESTION STRICTE DES ENVIRONNEMENTS & DÉPENDANCES**

### **Backend Python**
* Gestionnaire de packages : **`pip` exclusivement**.
* Isolation : **`venv` (virtualenv natif Python) exclusivement**.
* Interdictions absolues : `Conda`, `Anaconda`, `Mamba`, `Poetry` (sauf si explicitement demandé), `Docker`.
* Fichier de référence des dépendances : `/backend/requirements.txt` (avec versions épinglées, ex: `pymupdf==1.24.0`).

### **Frontend React**
* Gestionnaire de packages : **`npm` exclusivement**.
* Interdictions : `yarn`, `pnpm`, `bun` (sauf si explicitement demandé par ArchiSys3.0).
* Fichier de référence : `/frontend/package.json`.

### **Variables d'Environnement**
* Toutes les clés API, chemins absolus sensibles et configurations de déploiement sont stockés dans `/backend/.env`.
* Ce fichier est **toujours** référencé dans `.gitignore`. Ne jamais committer de clé API dans le code source.
* Accès depuis Python via `python-dotenv` et `os.environ.get("NOM_VARIABLE")`.

---

## **2. COMPÉTENCES BACKEND & INGESTION (PYTHON CPU-FIRST)**

### **2.1 Gestion Mémoire Extrême (mmap & C-bindings)**

* **PyMuPDF (fitz) :** Ouverture de PDF volumineux via `fitz.open()` sans chargement global en RAM. Accès aux pages par pointeur (`doc.load_page(n)`) avec extraction Pixmap en mémoire tampon.
* **Nettoyage explicite agressif** après chaque page (obligatoire) :
  ```python
  del pixmap
  del page
  gc.collect()
  fitz.TOOLS.clear_cache()
  ```
* **Checkpoint `/pipeline-set/` :** Si une interruption est détectée (exception catchée), sauvegarder l'état JSON minimal (`page_id`, `status`, `page_number`) dans `/pipeline-set/` pour permettre la reprise.

### **2.2 Computer Vision (CPU-Optimized)**

* **`opencv-python-headless`** (C++ backend, sans dépendances GUI) :
  * Transformée de Hough pour la détection d'angle (deskew).
  * Binarisation adaptative Sauvola via `scikit-image`.
  * CLAHE (Contrast Limited Adaptive Histogram Equalization).
  * Calcul de variance du Laplacien pour l'évaluation du flou.
* **`onnxruntime`** (mode CPU / AVX2 uniquement) :
  * Exécution de modèles légers de vision : rapid-layout, DocAligner (PageDewarp), RapidOCR.
  * Empreinte RAM : modèles de vision légers (< 100 Mo) ; les moteurs plus lourds (ex: rapid-latex-ocr) sont bornés par le Cycle de Vie des Moteurs (§2.2bis) sous le plafond MAX_RAM_MB.
  * Initialisation : `ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])`.

### **2.2bis Cycle de Vie des Moteurs ML (V3.1 — Budget à Deux Paliers, D2-B)**

* Chargement **paresseux** : aucun modèle ONNX chargé au démarrage du backend.
* Le triage (Couche 1) détermine les types de blocs de la page ; seuls les moteurs requis sont invoqués.
* **Un seul moteur lourd résident à la fois** si `rss psutil + empreinte estimée > MAX_RAM_MB` : séquence `load → infer → unload`. Cache de moteurs chauds autorisé tant que le pic reste sous plafond.
* Après chaque page : vérification du retour au plancher (≤ 250 Mo hors moteurs résidents) — sinon WARN fuite mémoire consigné dans `processing_benchmarks`.

### **2.3 Moteurs d'Extraction Spécialisés**

* **Texte & Markdown (Tier 1) :** `PyMuPDF4LLM` (extraction native vectorielle).
* **OCR Scan (Tier 1) :** `RapidOCR` (ONNX, multilingue FR/AR/EN/ZH).
* **Layout Documentaire (Tier 1) :** `rapid-layout` (ONNX).
* **Mathématiques (Tier 1) :** `rapid-latex-ocr` (ONNX).
* **Tableaux (Tier 1) :** `rapid-table` (ONNX).
* **Code (Tier 1) :** `Tree-sitter` (parsing AST multilangage).
* **Validation Chimie (linter) :** `RDKit` (SMILES/InChI — l'extraction moléculaire depuis image est Tier 2 via VLM).
* **Validation Biologie (linter) :** `Biopython` (FASTA, GenBank — import structuré Tier 3).
* **Musique (validation) :** `music21` (MusicXML, ABC — extraction Tier 2 via VLM).
* **Cartographie :** import structuré Tier 3 (GeoJSON/KML fournis) + `PyMuPDF` vector extraction pour les tracés natifs.
* **Retirés du périmètre v1 (V3.1 — D3-B) :** Nougat, Docling, Surya, TATR, DECIMER, MolScribe, « Circuitikz parser », GDAL — moteurs PyTorch/TF ou références non installables ; familles couvertes en Tier 2 (VLM Couche 5) ou Tier 3 (import).

### **2.4 Inférence LLM/VLM Locale & Cloud (Key Manager)**

* **SDKs Cloud (via Key Manager) :**
  * `google-genai` SDK pour Gemini Flash (Free-Tier, priorité 1).
  * `groq` SDK pour Groq API.
  * `openai` SDK pour OpenAI et Anthropic (compatible).
  * Gestion algorithmique des erreurs HTTP : 429 → rotation clé, 401 → désactivation, 500 → backoff exponentiel.
* **Inférence Locale (Fallback) :**
  * `llama-cpp-python` : inférence de modèles GGUF quantifiés (Q4\_K\_M ou Q5\_K\_M) sur threads CPU via AVX2.
  * Ollama REST API (`http://localhost:11434`) pour les modèles locaux.
* **Make.com (No-Code alternatif) :**
  * Webhooks REST vers des scénarios Make.com avec le `Make AI Provider`.

### **2.5 Parsing & NLP Algorithmique**

* Expressions régulières complexes multilingues (FR/AR/EN) pour la qualification pédagogique opportuniste. Exemple : détection de `Exercice N°`, `مسألة`, `Problem N`.
* Algorithmes de clustering spatial (DBSCAN via scikit-learn) pour la reconstitution des tables des matières depuis les coordonnées de titres.
* Parsing d'arbres hiérarchiques depuis les Outlines PDF natifs (`fitz.Document.get_toc()`).

---

## **3. COMPÉTENCES BASE DE DONNÉES & RECHERCHE HYBRIDE (SQLITE)**

### **3.1 SQLite Avancé (ACID & Triggers)**

* Modélisation relationnelle stricte avec `FOREIGN KEY ... ON DELETE CASCADE` et `ON DELETE SET NULL`.
* Écriture de `TRIGGER AFTER INSERT` automatiques pour la synchronisation bidirectionnelle des tables de données vers la table virtuelle FTS5. Les triggers définis dans `tech_specs.md` (section 1) — 5 triggers FTS (2 sync INSERT + 3 cohérence DELETE/UPDATE) et 2 triggers vectoriels conditionnels (schema_vec.sql) — sont **obligatoires et immuables**.
* Utilisation de transactions explicites (`BEGIN; ... COMMIT;`) pour chaque page traitée (atomicité ACID).
* Activation des Foreign Keys à chaque connexion : `conn.execute("PRAGMA foreign_keys = ON")`.
* Mode WAL activé pour les performances en lecture concurrente : `conn.execute("PRAGMA journal_mode=WAL")`.

### **3.2 Recherche Plein Texte (FTS5)**

* Configuration du tokenizer `unicode61 remove_diacritics 2` (normalisation des diacritiques arabes et latins — le stemming `porter`, anglophone, est retiré en V3.1).
* Requêtes `MATCH` avec opérateurs booléens (AND, OR, NOT, NEAR).
* Gestion du ranking BM25 via la fonction intégrée `bm25(search_index)` — **plus petit = meilleur** : tri `ORDER BY bm25(search_index) ASC` (le rang BM25 du RRF se calcule sur ce tri ascendant).
* Utilisation de `snippet(search_index, -1, '<b>', '</b>', '...', 32)` pour les extraits de résultats.

### **3.3 Recherche Sémantique & Fusion RRF (Résilience & Mode Strict)**

* **Intégration de l'extension C native `sqlite-vec` :** `conn.enable_load_extension(True); sqlite_vec.load(conn)`.
* **Stratégie de Résilience (Option B par défaut + Option A forcée) :**
  ```python
  def init_vector_support(conn: sqlite3.Connection, force_strict: bool = False) -> str:
      try:
          conn.enable_load_extension(True)
          import sqlite_vec
          sqlite_vec.load(conn)
          return "sqlite-vec"
      except Exception as e:
          if force_strict:
              raise RuntimeError(f"Mode strict sqlite-vec forcé : échec du chargement ({e})")
          logging.warning(f"[WARN] sqlite-vec non disponible ({e}). Mode dégradé FTS5 BM25 activé.")
          return "fts5-fallback"
  ```
* **Stockage des embeddings :** `BLOB` de type `Float32Array` (little-endian, 384 dimensions, normalisés L2).
* **Requête de similarité vectorielle :** `SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH ?`.
* **Algorithme RRF adaptatif (Reciprocal Rank Fusion) :**
  ```python
  def rrf_score(rank_bm25: int, rank_vec: int | None = None, k: int = 60) -> float:
      score = 1 / (k + rank_bm25)
      if rank_vec is not None:
          score += 1 / (k + rank_vec)
      return score
  ```
* **Seuils anti-hallucination (V3.1, scores bruts) :** éligibilité si (distance cosinus ≤ 0.45) OU (`bm25()` ≤ -0.3, calibré Phase 2). Aucun chunk éligible → réponse "Je ne trouve pas d'informations pertinentes dans la bibliothèque actuelle." Seuils stockés dans `app_settings` (ragdom_config.sqlite).
* **Télémétrie & Commutation UI :** Statut exposé via `GET /api/system/health` avec bandeau d'alerte orange dans l'UI *Automation Hub* et switch toggle pour forcer le mode strict.

### **3.4 Connexion Dynamique Multi-Bases**

* Module `/backend/db/connection.py` gère la connexion dynamique :
  ```python
  import re

  DB_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]+\.sqlite$")

  def get_connection(db_name: str) -> sqlite3.Connection:
      # V3.1 — Sanitisation anti path-traversal du paramètre ?db=
      if not DB_NAME_RE.fullmatch(db_name):
          raise ValueError(f"Nom de base invalide : {db_name}")  # → HTTP 400
      db_path = os.path.realpath(os.path.join(DATABASES_DIR, db_name))
      if not db_path.startswith(os.path.realpath(DATABASES_DIR) + os.sep):
          raise ValueError("Chemin hors DATABASES_DIR interdit")  # → HTTP 400
      if not os.path.exists(db_path):
          raise FileNotFoundError(f"Base {db_name} introuvable dans /databases/")
      conn = sqlite3.connect(db_path, check_same_thread=False)
      conn.execute("PRAGMA foreign_keys = ON")
      conn.execute("PRAGMA journal_mode=WAL")
      return conn
  ```
* Chaque requête API accepte `?db={nom.sqlite}` et crée une connexion à la demande. Pas de pool de connexions persistant (chaque requête ouvre et ferme sa connexion).

---

## **4. COMPÉTENCES FRONTEND & UI/UX (REACT / ZERO-MOCK)**

### **4.1 Stack Archisys3.0 Stricte**

| Technologie | Version | Usage |
|---|---|---|
| React | 19 | Framework UI |
| TypeScript | strict mode | Typage fort, zéro `any` non justifié |
| Vite | latest | Bundler & Dev Server |
| Tailwind CSS | v3/v4 | Styling (classes utilitaires) |
| shadcn/ui | latest | Composants UI (Dialog, Dropdown, Slider...) |
| lucide-react | latest | Icônes |
| React Router | v6+ | Navigation 3 vues |

**Interdictions strictes :** Vue.js, Angular, jQuery, Bootstrap, Material UI (hors shadcn/ui), styled-components, Emotion CSS-in-JS.

### **4.2 Client API Centralisé (lib/api.ts)**

* Toutes les communications avec le Backend passent par `/frontend/src/lib/api.ts`.
* Ce module exporte des fonctions typées pour chaque endpoint du contrat API (Partie 7 du Blueprint V3).
* Le paramètre `db` est géré globalement via un contexte React (`DatabaseContext`) et injecté automatiquement dans toutes les requêtes.
* Jamais d'appels `fetch()` bruts dans les composants.

### **4.3 API de Découverte & Introspection (Zéro Mock)**

* Interroger `GET /api/system/databases` au démarrage pour lister les bases disponibles.
* Construire les sidebars, filtres et menus de navigation **uniquement** à partir de requêtes d'agrégation (`GET /api/library/facets?db=...`).
* Aucun typage statique de métier dans le code React (pas de `const DOMAINS = ["math", "chemistry", ...]`).

### **4.4 Moteurs de Rendu Polymorphiques (Les 25 Familles)**

Le composant `ArtifactRenderer.tsx` aiguille dynamiquement vers le bon renderer en fonction de `artifact_type` :

| artifact_type | Renderer |
|---|---|
| `latex_formula`, `matrix`, `tensor` | **KaTeX** (`renderToString`) |
| `feynman_diagram`, `decay_chain` | **KaTeX** + SVG Renderer |
| `geometry_vector`, `circuit_schematic`, `technical_blueprint` | **DOMPurify** (sanitize SVG) + injection DOM |
| `pdb_protein`, `cif_crystal` | **3Dmol.js** (viewer WebGL) |
| `smiles_chem`, `mol_block`, `inchi` | **Ketcher** / RDKit.js |
| `fasta_sequence`, `genbank_record` | **BioJS** / Sequence Viewer |
| `code_snippet`, `ast_tree` | **Shiki** (syntax highlighting) |
| `flowchart`, `state_machine`, `network_topology` | **Mermaid.js** |
| `cad_3d_model`, `point_cloud` | **Three.js** / `<model-viewer>` |
| `geojson_map`, `topography_layer` | **MapLibre GL** |
| `data_table`, `hierarchical_grid` | **TanStack Table** |
| `signal_waveform`, `spectrum_fft`, `bode_plot` | **Plotly.js** |
| `dense_illustration`, `histology_cut`, `dicom_slice` | **OpenSeadragon** (Deep-Zoom) |
| `sheet_music`, `tablature` | **VexFlow.js** / ABCjs |
| `microscopy_photo`, `macro_sample` | Balise `<img>` + Loupe interactive (CSS Zoom) |

**Règle de performance :** L'aiguillage et l'instanciation du renderer doivent s'effectuer en moins de **16ms** (un frame à 60 FPS).

### **4.5 UI/UX Avancée (Composants Techniques)**

* **Sync-Scroll (SideBySideViewer.tsx) :**
  ```typescript
  const syncScroll = (sourcePanel: HTMLDivElement, targetPanel: HTMLDivElement) => {
    const ratio = sourcePanel.scrollTop / (sourcePanel.scrollHeight - sourcePanel.clientHeight);
    targetPanel.scrollTop = ratio * (targetPanel.scrollHeight - targetPanel.clientHeight);
  };
  ```

* **Overlay Diff :** Superposition du rendu extrait sur le scan original via `position: absolute; opacity: sliderValue; mix-blend-mode: multiply`.

* **BBoxes Interactives :** Les coordonnées `bounding_box_json` sont converties en coordonnées CSS (%) en divisant par les dimensions du scan 300 DPI, et affichées comme `div` absolus superposés.

* **Télémétrie en temps réel (SSE) :**
  ```typescript
  const eventSource = new EventSource('/api/pipeline/stream');
  eventSource.addEventListener('page_update', (e) => {
    const data = JSON.parse(e.data);
    updateTelemetryState(data);
  });
  ```

### **4.6 Internationalisation Trilingue (i18n) & Isolation BiDi (Contenus Mixtes)**

* **Bascule Dynamique de Direction (RTL ↔ LTR) :**
  ```typescript
  document.documentElement.setAttribute('lang', currentLang); // 'ar' | 'fr' | 'en'
  document.documentElement.setAttribute('dir', currentLang === 'ar' ? 'rtl' : 'ltr');
  ```
* **Isolation BiDi Stricte des Formules et Actifs :**
  Pour tout contenu scientifique ou technique latin (formules KaTeX, symboles chimiques, code source) inséré au sein d'un texte arabe :
  - Encapsuler obligatoirement dans des conteneurs isolés :
    ```css
    .bidi-isolate, .katex, .chem-formula, .shiki-container {
      direction: ltr !important;
      unicode-bidi: isolate !important;
      text-align: left !important;
    }
    ```
  - Ne jamais laisser de texte arabe inverser l'ordre des caractères ou des parenthèses dans une formule mathématique ou un bloc de code.

---

## **5. COMPÉTENCES EN QUALITÉ & ARCHITECTURE DÉFENSIVE**

### **5.1 Lintering Déterministe (Zéro IA, < 5ms)**

L'agent doit écrire des algorithmes **purement algorithmiques** (sans LLM) pour valider :

* **LaTeX :** Comptage d'accolades `{` et `}` (égalité requise), vérification de l'appariement des délimiteurs `$...$` et `$$...$$`, présence d'un `\end{xxx}` pour chaque `\begin{xxx}`.
* **Tableaux Markdown/JSON :** Vérification que toutes les lignes ont le même nombre de colonnes.
* **SVG :** Parsing XML minimal pour vérifier la validité structurelle (balises fermées, attributs bien formés).
* **SMILES/Chimie :** Validation de la valence chimique et de la syntaxe via RDKit (pas un LLM).
* **Unicode :** Ratio de caractères `\ufffd` (replacement character) par rapport à la longueur totale. Seuil : > 5% → flag `UNICODE_NOISE`.

### **5.2 Résilience & Checkpointing**

* **Reprise sur erreur :** Au démarrage du backend, l'orchestrateur vérifie les pages avec `status IN ('PROCESSING_CV', 'SEGMENTING', 'EXTRACTING', 'LINTING', 'VLM_RECOVERY')` et les remet à `status = 'QUEUED'` pour re-traitement.
* **Pages déjà indexées :** Avant de traiter une page, vérification `SELECT id FROM pipeline_jobs WHERE document_id=? AND page_number=? AND status='READY'`. Si trouvée → skip immédiat (jamais de double-indexation).
* **Queue séquentielle stricte :** Un seul job actif à la fois. L'orchestrateur attend la fin complète (status READY ou QUARANTINE) du job actuel avant d'en démarrer un nouveau.
* **Isolation par page :** Chaque page est traitée dans un `try/except` indépendant. Une exception sur la page N ne doit jamais interrompre le traitement de la page N+1.

### **5.3 Framework API Backend (FastAPI)**

* **Framework :** **FastAPI** exclusivement (pas Flask, pas Django). Serveur ASGI : **uvicorn**.
* **Démarrage :** `cd c:\xampp\htdocs\RAGDom\backend` puis `uvicorn main:app --host 0.0.0.0 --port 8000 --reload` (conforme tech_specs §15).
* **CORS :** Configuré pour accepter les requêtes du Frontend Vite (localhost:5173) en développement.
* **SSE :** Implémenté via `fastapi.responses.StreamingResponse` avec `media_type="text/event-stream"`.
* **Validation des paramètres :** Tous les paramètres de requête sont validés avec Pydantic v2. Une valeur `db` pointant vers un fichier inexistant retourne `HTTP 404`.
