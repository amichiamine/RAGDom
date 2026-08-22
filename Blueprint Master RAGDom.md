# **BLUEPRINT MAÎTRE DÉFINITIF : SYSTÈME RAGDom (Backend & Frontend)**

**Version Globale :** 3.5 (Base Autonome : le .sqlite sert 100% de l'UI — scans inclus — sans aucun fichier externe. Architecture Multi-Moteurs + Couverture Totale + Confort & Ergonomie)

**Matériel Cible :** CPU x86\_64 multi-cœurs (Intel/AMD), iGPU partagé, 8 à 16 Go RAM, Stockage SSD. Zéro dépendance GPU Nvidia/CUDA obligatoire (HP ProBook 100% compatible).

**Philosophie :** Local-First, Coût Zéro (Open Source & Free-Tiers), Résilience Totale aux Scans, Traitement Séquentiel Strict (tolérance PDFs 1+ Go sous Contrat Mémoire à Deux Paliers : plancher 250 Mo hors moteurs / pic ≤ MAX_RAM_MB), Couverture Multimodale (25 Familles d'Actifs), Reconstitution Hiérarchique, Élasticité Non-Dogmatique Totale, UI/UX Zéro Mock avec Comparaison Côte-à-Côte, Pilotage Granulaire.

---

## **PARTIE 1 : VISION, OBJECTIFS & RÈGLES FONDAMENTALES**

### **1.1 Objectif Produit**

Transformer n'importe quel fonds documentaire scientifique, technique, industriel, médical ou pédagogique (articles, thèses, polycopiés d'examens, annales, manuels) en une bibliothèque numérique locale persistée dans des fichiers **SQLite portables** (un fichier par corpus). Chaque fichier sert de base relationnelle, moteur hybride (FTS5 BM25 + sqlite-vec / RRF) et fournisseur d'actifs multimodaux haute fidélité pour une interface dynamique multi-vues.

### **1.2 Règles Fondamentales du Système**

* **RÈGLE DU ZÉRO DOGME (Noyau Agnostique / Vues Data-Driven) [V3.1 — D1-B] :** Le NOYAU de RAGDom (pipeline, schéma de base, recherche) n'impose aucun niveau scolaire, cursus ou domaine. Les VUES peuvent être spécialisées (ex: Vue 2 Library pédagogique 2G) si et seulement si 100% de leurs données proviennent de la base SQLite active par introspection. Les tables `curriculum_*` (tech_specs §1) sont OPTIONNELLES : vides, la Vue 2 se replie automatiquement sur l'exploration générique (TOCExplorer + SideBySideViewer + facettes). Aucun compteur, matière, niveau ou trimestre n'est jamais une constante dans le code React — ce sont des COUNT(*) et GROUP BY.
* **RÈGLE D'OR D'IMPLÉMENTATION (Zéro Régression) :** Interdiction de modifier les scripts de base en place si risque d'instabilité. Application stricte du principe d'extension additive (ex: création de module\_v2.py). L'évolution se fait exclusivement par add-ons.
* **ZÉRO MOCK & ZÉRO HARDCODING UI :** L'interface découvre ses menus, filtres, catégories et listes de bases de données dynamiquement par introspection via l'API Backend. Rien n'est écrit en dur dans le code React.
* **Traitement Séquentiel Strict (Queue Protection RAM) :** L'ingestion traite obligatoirement **une seule page d'un seul document à la fois**. Zéro parallélisme lourd. Les autres documents sont en file d'attente (QUEUED). Cela garantit une consommation RAM bornée et prévisible.
* **Tolérance Zéro au Crash (INVALID\_SOURCE) :** Si un PDF est corrompu ou protégé par mot de passe, l'orchestrateur le flagge avec le statut `INVALID_SOURCE`, met à jour SQLite, et passe au suivant sans arrêter le backend.
* **Streaming Mémoire (mmap) :** Les PDFs ne sont jamais chargés en bloc. Accès par pointeurs natifs OS via PyMuPDF (fitz) pour préserver la RAM.
* **Découplage Search vs Render :** L'indexation FTS5 gère la recherche ; les payloads bruts (LaTeX, SVG, SMILES) assurent le rendu client direct sans ré-encodage.
* **Portabilité Totale des Bases :** Chaque fichier .sqlite est 100% autonome — les scans de pages eux-mêmes sont encapsulés dans la table `page_scans` (image_webp + thumb_webp, V3.5) : aucun lien vers des images ou fichiers externes sur disque. Il est directement consommable par PHP, React, Electron, ou une APK Android. L'UI consomme et affiche 100% du contenu de la base, sans jamais rien simuler ni récupérer ailleurs.

---

## **PARTIE 2 : ARCHITECTURE DU SYSTÈME DE FICHIERS & ROUTAGE MULTI-BASES**

Le système est conçu pour être une bibliothèque numérique évolutive. Les bases de données générées doivent être 100% portables, "plug and play", et encapsuler l'intégralité des données (texte, blobs, index).

### **2.1 Arborescence Physique des Données (Imposée)**

```
/sources/              → Zone d'Ingestion
    ├── Maths/
    │   └── 1AM/
    │       └── manuel_algebre.pdf
    ├── Physique/
    └── Normes_ISO/

/databases/            → Zone de Stockage Portable
    ├── Maths_1AM.sqlite      ← Autonome, 100% BLOB encapsulés
    ├── Physique_Term.sqlite
    └── Normes_ISO.sqlite

/pipeline-set/         → Zone de Checkpoint & Cache Temporaire
    ├── Maths/
    │   └── 1AM/
    │       └── manuel_algebre/
    │           ├── page_001_cv.webp
    │           └── page_001_state.json
    └── (Purgé automatiquement après insertion finale dans .sqlite)

/engines/              → Moteurs Métiers (V3.4 : TOUT le code spécifique d'un moteur vit ici)
    └── sci-engine/           ← Moteur d'extraction scientifique actuel
        ├── engine.json       ← Manifeste { id, label, version, accent, families_tier1, status }
        ├── pipeline/         ← Couches 0→7 + 3bis (code métier du moteur — contrats DTO tech_specs §2)
        │   ├── layer_0_cv.py … layer_7_persist.py
        │   └── layer_3bis_link.py
        └── models/           ← Modèles ONNX propres au moteur (layout, ocr, dewarp, table, math)
    (Prêt à accueillir legal-engine, medical-engine, etc. — chacun avec son manifeste,
     son pipeline et ses modèles : ZÉRO mélange entre moteurs, zéro modification du noyau)
```

**Règle de nommage des bases SQLite :** L'arborescence sous `/sources/` détermine automatiquement le nom du fichier `.sqlite` cible. Ex: `/sources/Maths/1AM/` → `/databases/Maths_1AM.sqlite`. Cette arborescence génère également les auto-tags de domaine et de niveau.

### **2.2 Arborescence du Code Source du Projet (Imposée)**

```
/backend/              → Code Python (FastAPI — NOYAU AGNOSTIQUE, zéro code métier d'extraction)
    ├── main.py            ← Point d'entrée FastAPI (uvicorn)
    ├── requirements.txt   ← Dépendances pip (venv exclusif)
    ├── config.py          ← Chemins absolus, clés API (chargées depuis .env)
    ├── .env               ← Variables d'environnement (jamais committé)
    ├── api/
    │   ├── routes_system.py    ← Routes /api/system/*
    │   ├── routes_library.py   ← Routes /api/library/*
    │   ├── routes_search.py    ← Routes /api/search/*   (V3.1)
    │   ├── routes_pipeline.py  ← Routes /api/pipeline/*
    │   └── routes_llm.py       ← Routes /api/llm/*      (V3.1)
    ├── core/                  ← NOYAU (V3.4)
    │   ├── orchestrator.py       ← Queue séquentielle générique — invoque le moteur actif via le registre
    │   └── engine_registry.py    ← Scan de /engines/, validation des manifestes engine.json
    │   (Les couches 0→7 + 3bis vivent dans /engines/sci-engine/pipeline/ — voir §2.1 et tech_specs §4.6)
    ├── db/
    │   ├── connection.py  ← Connexion dynamique multi-bases (?db=)
    │   ├── schema_core.sql ← DDL cœur (appliqué toujours — V3.1)
    │   ├── schema_vec.sql  ← DDL vectoriel conditionnel (V3.1)
    │   └── migrations/     ← Scripts de migration numérotés
    └── llm/
        └── key_manager.py ← Orchestrateur clés API & Circuit Breaker

/frontend/             → Code React (Vite + TypeScript)
    ├── package.json       ← Dépendances npm (npm exclusif)
    ├── vite.config.ts
    ├── tailwind.config.ts
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx            ← Router (3 vues)
    │   ├── views/
    │   │   ├── IndexView.tsx      ← Vue 1 : Dashboard & Métriques
    │   │   ├── LibraryView.tsx    ← Vue 2 : Exploration & Side-by-Side
    │   │   └── AutomationView.tsx ← Vue 3 : Pipeline Studio & Settings
    │   ├── components/
    │   │   ├── TOCExplorer.tsx
    │   │   ├── SideBySideViewer.tsx
    │   │   ├── ArtifactRenderer.tsx
    │   │   ├── SearchStudio.tsx
    │   │   ├── PipelineStudio.tsx
    │   │   └── KeyManager.tsx
    │   ├── hooks/
    │   └── lib/
    │       └── api.ts         ← Client API centralisé

/docs/ragdom/          → Mémoire Physique de l'Agent (Obligatoire)
    ├── 01_tasklists/
    │   ├── master_plan.md
    │   └── current_sprint.md
    ├── 02_walkthroughs/
    │   ├── architecture_decisions.md
    │   └── pipeline_flow.md
    ├── 03_user_adjustments/
    │   └── feedback_log.md
    └── 04_state/
        ├── current_state.md
        └── changelog.md
```

### **2.3 API de Découverte Backend (Zéro Mock)**

Le Backend expose des routes de découverte qui scannent physiquement le dossier `/databases/` et renvoient au Frontend la liste des bases disponibles avec leurs métriques. Le Frontend n'a **aucune donnée hardcodée**.

### **2.4 Routage Multi-Bases (Dynamic Connection)**

Toutes les routes API Backend (recherche, arborescence, stats) acceptent un paramètre `?db={nom_de_la_base.sqlite}`. L'application se connecte dynamiquement au fichier ciblé dans `/databases/` **sans redémarrage du serveur**. Voir Partie 7 pour le contrat complet des routes API.

---

## **PARTIE 3 : ORCHESTRATEUR LLM & GESTION DES CLÉS API (MULTI-PROVIDERS)**

Le système intègre un **Key Manager / Circuit Breaker** pour piloter les inférences (Gemini, Groq, OpenAI, Anthropic, Make.com) sans interruption.

### **3.1 Fonctionnement du Key Manager**

1. **Multi-Clés & Rotation Automatique :** L'utilisateur renseigne plusieurs clés API pour un même provider ou plusieurs providers depuis l'UI (Vue 3 : Automation). Toutes les clés sont stockées dans la table `llm_keys` de la base SQLite de configuration (non dans une base documentaire).
2. **Gestion des Erreurs HTTP (Code Parsing) :**
   * **429 (Too Many Requests) ou 403 (Quota Exceeded) :** Marque la clé actuelle comme "temporairement bloquée" → Rotation immédiate sur la clé suivante sans faire échouer le job en cours.
   * **401 (Unauthorized) :** Désactive la clé définitivement.
   * **500 / 503 / 504 (Server Error) :** Déclenche un Exponential Backoff (attente 2s, puis 4s, puis 8s) avant nouvelle tentative.
3. **Détection Dynamique des Modèles :** L'orchestrateur interroge l'API du provider pour lister les modèles disponibles associés à chaque clé. Ces modèles sont sélectionnables via l'UI.
4. **Bascule Hiérarchique (Fallback Total) :** Si **toutes** les clés Cloud échouent ou sont épuisées, le système bascule automatiquement sur un serveur local (Ollama / LM Studio GGUF) sans intervention humaine.

**Modèle PAR CLÉ (MAJ 2026-08-22 — source : `backend/llm/key_manager.py`) :** le modèle est un attribut **de la clé** (`llm_keys.active_model`), pas seulement du provider (`llm_settings.active_model`). Conséquences réelles :

* **Même clé enregistrable N fois** avec N modèles/quotas distincts : chaque ligne `llm_keys` (même `api_key`, `active_model` différent) est une entrée indépendante, avec sa propre rotation et son propre blocage temporaire.
* **Priorité clé > provider :** à la génération, `effective_model = active_model DE LA CLÉ or active_model DU PROVIDER` — le modèle porté par la clé l'emporte sur le réglage provider.
* **Auto-détection LIVE (zéro modèle codé en dur) :** si aucun modèle n'est fixé (clé ni provider), `_autodetect_working_model` liste les modèles EN DIRECT via l'API du provider, relègue en fin de liste les modèles non-texte (indices `tts/image/audio/embedding/live/veo/imagen` → 400 en texte), puis **parcourt les candidats** (jusqu'à 12) avec un `ping` réel : un candidat qui répond 404 (déprécié), 400 (non-texte), 403 (interdit pour cette clé) ou 429/503 (saturé) est **ignoré sans lever**, on passe au suivant.
* **Mémorisation sur la clé :** le premier modèle qui répond réellement est écrit dans `llm_keys.active_model` (uniquement si encore `NULL`) — la détection coûteuse n'a lieu qu'une fois par clé. `test_key` applique la même logique et renvoie le modèle auto-détecté (« mémorisé sur la clé »).
* **Providers OpenAI-compatibles :** `base_url` personnalisable (`llm_settings.base_url`) — LM Studio (`http://localhost:1234/v1`, clé facultative), Groq, OpenAI ; `make` = webhook REST sans clé ni modèle.

### **3.2 Hiérarchie de Routage VLM**

```
1. API Cloud Free-Tier (Priorité 1)
   └── Gemini Flash / Groq (Rotation automatique des clés)
       └── Si 429/403 → Rotation de clé immédiate
       └── Si 401 → Désactivation + Clé suivante
       └── Si 500 → Exponential Backoff
2. Serveurs Locaux GGUF (Priorité 2, si Cloud épuisé)
   └── Ollama / LM Studio
3. Scénarios Make.com (Priorité 3, No-Code alternatif)
   └── Make AI Provider via Webhooks REST
```

---

## **PARTIE 4 : TAXONOMIE COMPLÈTE DES 25 FAMILLES D'ACTIFS**

**Note normative (V3.1 — D3-B) :** Les 25 familles sont garanties comme taxonomie de **STOCKAGE et de RENDU** (schéma `scientific_artifacts` + `render_config_json` + ArtifactRenderer). L'**EXTRACTION** est étagée en 3 tiers :

- **Tier 1 — Extraction native locale (garantie v1) :** familles 1 (LaTeX simple), 3 (tableaux), 9 (code), 10 (Mermaid/DOT), 13 (SVG natif), 21 & 25 (crops WebP), plus texte/TOC. Moteurs réels épinglés dans `requirements.txt`.
- **Tier 2 — Extraction assistée VLM (Couche 5, conditionnelle) :** familles 2, 4, 5, 7, 8, 11, 16, 18, 19, 20, 23, 24 — détection au triage, transcription VLM avec traçabilité `vlm_provider_used` (Couche 6).
- **Tier 3 — Import structuré (manuel) :** familles 6 (PDB), 12 (glTF), 14 (IFC), 15 (GeoJSON), 17 (GRIB), 22 (DICOM) — RAGDom stocke, indexe et rend ces formats importés, mais ne prétend pas les détecter dans un scan papier.

La promotion d'une famille Tier 2/3 → Tier 1 se fait exclusivement par add-on (Règle d'Or).

| N° | Famille d'Actifs | Sous-types précis (artifact\_type) | Format Source / Stockage (SQLite) | Moteur & Rendu Frontend Cible |
| :---- | :---- | :---- | :---- | :---- |
| **1** | **Maths Pures & Algèbre** | latex\_formula, matrix, tensor | LaTeX brut ($...$, \\begin{matrix}) | **KaTeX** / MathJax |
| **2** | **Géométrie 2D & Dessin** | geometry\_vector, geogebra\_xml | Code **SVG** XML pur ou GeoGebra JSON | **SVG DOMPurify** / GGB-Wasm |
| **3** | **Tableaux & Métrologie** | data\_table, hierarchical\_grid | JSON structuré / Markdown Tabulaire | **TanStack Table** / Tailwind |
| **4** | **Chimie Organique/Inorg.** | smiles\_chem, mol\_block, inchi | Chaînes **SMILES**, InChI, MDL Molfile | **Ketcher** / **RDKit.js** / Canvas |
| **5** | **Biologie & Génomique** | fasta\_sequence, genbank\_record | Séquences **FASTA**, GenBank texte | **BioJS** / Sequence Viewer |
| **6** | **Cristallographie & Bio 3D** | pdb\_protein, cif\_crystal | Formats **PDB**, mmCIF, XYZ | **3Dmol.js** / **Mol\*** (Molstar) |
| **7** | **Génie Électronique** | circuit\_schematic, logic\_gate | Code Circuitikz, Netlists SPICE, SVG | **Wokwi** / CircuitVerse / SVG |
| **8** | **Automatique & Régulation** | block\_diagram, bode\_plot | JSON de fonctions de transfert / SVG | **Plotly.js** / Canvas |
| **9** | **Informatique & Code** | code\_snippet, ast\_tree | Texte brut balisé + tag langage | **Shiki** / Prism.js |
| **10** | **Arbres, Graphes & Flux** | flowchart, state\_machine, tree | Syntaxe **DOT (Graphviz)**, **Mermaid.js** | **d3-graphviz** / Mermaid.js |
| **11** | **Réseaux & Protocoles** | network\_topology, packet\_frame | Spécifications Mermaid / Frame JSON | **Mermaid.js** / Network Canvas |
| **12** | **Mécanique & CAO 3D** | cad\_3d\_model, point\_cloud | Fichiers binaires **glTF / GLB**, STL | **Three.js** / \<model-viewer\> |
| **13** | **Dessin Industriel 2D** | technical\_blueprint, iso\_cut | SVG vectoriel avec calques de cotes | **SVG Viewer** avec zoom infini |
| **14** | **Génie Civil & BTP** | bim\_ifc\_slice, floorplan\_2d | Format **IFC** compressé, SVG haute échelle | **web-ifc-viewer** / 2D Floorplan |
| **15** | **SIG & Cartographie** | geojson\_map, topography\_layer | Données **GeoJSON**, TopoJSON, KML | **MapLibre GL** / Leaflet |
| **16** | **Géologie & Pétrophysique** | geological\_strata, well\_log | Données vectorielles SVG / Logs LAS | **Plotly.js** / Canvas de diagraphie |
| **17** | **Météo & Climatologie** | isobar\_map, wind\_rose | GRIB / GeoJSON météo / NetCDF léger | **OpenLayers** / Plotly.js |
| **18** | **Signal, Ondes & Audio** | signal\_waveform, spectrum\_fft | Séries temporelles JSON / CSV compressé | **Plotly.js** / WaveSurfer.js |
| **19** | **Optique & Photonique** | ray\_tracing, optical\_spectrum | SVG de tracé optique / Séries spectrales | **Plotly.js** / SVG interactif |
| **20** | **Physique Nucléaire** | feynman\_diagram, decay\_chain | Syntaxe TikZ-Feynman / SVG | **KaTeX** / SVG Renderer |
| **21** | **Anatomie & Histologie** | dense\_illustration, histology\_cut | Image haute résolution **WebP** + SVG Overlays | **OpenSeadragon** (Deep-Zoom) |
| **22** | **Imagerie Médicale (RX)** | dicom\_slice, xray\_image | Tranches DICOM compressées / WebP HD | **OpenSeadragon** (fallback v1) / Cornerstone.js (add-on) |
| **23** | **Musique & Acoustique** | sheet\_music, tablature | Syntaxe **MusicXML**, **ABC Notation** | **VexFlow.js** / ABCjs |
| **24** | **Linguistique & Symboles** | phonetic\_tree, hieroglyph\_vector | Unicode étendu + SVG de ligatures | **KaTeX** / Fonts Web spécialisées |
| **25** | **Imagerie Raster Micro** | microscopy\_photo, macro\_sample | Crop **WebP 300 DPI** avec échelle micro | Balise \<img\> + Loupe interactive |

---

## **PARTIE 5 : ARCHITECTURE BACKEND & PIPELINE D'INGESTION (8 COUCHES)**

### **5.1 Inventaire Technique Exhaustif (CPU-First)**

* **OS/Drivers :** PyMuPDF (fitz), ONNX Runtime CPU (onnxruntime), llama.cpp (Moteur AVX2).
* **Vision & Restauration (CV) :** OpenCV (opencv-python-headless, C++ backend), deskew, DocAligner (Light ONNX), Scikit-image (Sauvola), CLAHE, Pillow (WebP 300 DPI).
* **Segmentation & OCR (Tier 1, ONNX) :** rapid-layout (layout documentaire), RapidOCR (ONNX), PyMuPDF4LLM.
* **Moteurs Métiers Tier 1 :** rapid-latex-ocr (Maths, ONNX), rapid-table (Tableaux, ONNX), Tree-sitter (Code), RDKit (validation SMILES), Biopython (validation FASTA), music21 (validation Musique), scikit-learn (Clustering TOC DBSCAN).
* **Tier 2 (via VLM Couche 5) :** molécules, schémas électroniques, diagrammes complexes, partitions — transcription VLM tracée (`vlm_provider_used`).
* **Tier 3 (import structuré) :** PDB, glTF, IFC, GeoJSON, GRIB, DICOM.
* **Interdiction absolue :** PyTorch, TensorFlow, CUDA, Nvidia drivers, Docker/Conda.

### **5.2 L'Enchaînement du Pipeline (Les 8 Couches)**

```
[ Page N (PDF Pointeur mmap ou Scan Papier Dégradé) ]
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ COUCHE 0 : Restauration Visuelle & Traitement d'Image (CV)  │
│ 1. Extraction Pixmap (mmap) 300 DPI en mémoire tampon       │
│ 2. Évaluation du flou (Variance du Laplacien)               │
│ 3. Détection d'angle & rotation inverse (Deskew Hough)      │
│ 4. Dépliage 3D de reliure (DocAligner ONNX / PageDewarp)    │
│ 5. Suppression des bordures noires et ombres de scanner     │
│ 6. Binarisation adaptative dynamique (Sauvola) & CLAHE      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ COUCHE 1 : Triage, Analyse Géométrique & Reconstitution TOC │
│ 1. Calcul du ratio texte vectoriel natif vs image bitmap    │
│ 2. rapid-layout ONNX (Découpage instantané des BBoxes)      │
│ 3. Extraction/Reconstitution de l'Index Hiérarchique (TOC)  │
│    via clustering spatial DBSCAN des titres de section      │
│ 4. Découpage matriciel des zones d'actifs [x0, y0, x1, y1] │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ COUCHE 2 : Extraction Successive Spécialisée (Multi-Moteurs)│
│ ├─ Extraction Texte & Markdown ──► PyMuPDF4LLM (Tier 1)     │
│ ├─ OCR Haute Précision Scan ────► RapidOCR (ONNX)          │
│ ├─ Extraction Maths & Formules ──► rapid-latex-ocr (ONNX)   │
│ ├─ Extraction Tableaux ──────────► rapid-table (ONNX)       │
│ ├─ Extraction Molécules / Bio ───► VLM Tier 2 + Biopython   │
│ ├─ Extraction Code / Schémas ────► Tree-sitter + SVG natif  │
│ ├─ Extraction Cartes & SIG ──────► Tier 3 + PyMuPDF Vector │
│ └─ Extraction Musique / Rares ───► VLM Tier 2 + music21     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ COUCHE 3 : Qualification Typologique & Pédagogique Élastique│
│ 1. Détection opportuniste sans dogme (Regex FR/AR/EN)       │
│ 2. Qualification dynamique si motifs présents               │
│ 3. Établissement des liaisons (Énoncé ➔ Corrigé de fin)     │
│    → Mise à jour de has_solution et linked_solution_chunk_id│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ COUCHE 4 : Linter & Contrôle Qualité Déterministe (<5ms)    │
│ 1. Validation syntaxique LaTeX (Accolades, délimiteurs $)   │
│ 2. Validation dimensionnelle des tableaux Markdown / JSON   │
│ 3. Test de conformité XML des tracés SVG                    │
│ 4. Validation des valences chimiques & syntaxes spécialisées│
│ 5. Vérification du taux de caractères Unicode corrompus     │
│    (ratio \ufffd > seuil → flag pour VLM Recovery)          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ COUCHE 5 : Routage VLM Hiérarchisé (Orchestrateur & Clés)   │
│ - Invoqué UNIQUEMENT si ValidationResult.is_valid == false  │
│ - Réparation via API Cloud (Key Manager) → Ollama → Make.com│
│ - Gestion automatique rotation clés 429/401/500             │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ COUCHE 6 : Benchmarking, Métrologie & Télémétrie            │
│ - Calcul latence (ms), Peak RAM (psutil), Score Confiance   │
│ - Enregistrement : vlm_provider_used, fallback_triggered    │
│ - Sauvegarde blur_score, deskew_angle pour audit qualité    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ COUCHE 7 : Persistance SQLite Transactionnelle & ACID       │
│ - Écriture atomique BLOBs (chunks, artefacts, page_scans)   │
│   + Sync FTS5 (via Triggers auto)                           │
│ - Purge Mémoire : del pixmap, gc.collect(), clear_cache()   │
│ - Mise à jour statut pipeline_jobs → READY                  │
└─────────────────────────────────────────────────────────────┘
```

**Couche 3bis — SolutionLinker (V3.1, passe post-document) :** une fois toutes les pages du document au statut READY, une passe de réconciliation algorithmique lie les énoncés à leurs corrigés de fin de manuel (`linked_solution_chunk_id`, `has_solution`) et peuple `content_links` si les tables curriculum sont actives. Voir tech_specs §4.4.

**Couche 2 — variante parallèle intra-page (Phase 6 / D4-B, add-only — MAJ 2026-08-22, source : `engines/sci-engine/pipeline/layer_2_extract_v2.py`) :** activée UNIQUEMENT si `RAGDOM_INTRA_PAGE_WORKERS >= 2`, elle parallélise le traitement des **blocs** (images/formules/tableaux) via un pool borné 2-3 threads tandis que le texte/Markdown reste séquentiel, avec ordre de sortie déterministe et moteurs `rapid-*` sérialisés par verrou. **Équivalence des sorties avec la v1 séquentielle désormais stricte :** la v2 exécute la **MÊME qualification VLM séquentielle post-pool** et le **MÊME ancrage in-situ** que la v1 par réutilisation directe des helpers v1 (`_vlm_qualifier`, `_apply_qualification`, `_anchor_artifacts`, seuil `_AREA_RATIO_MAX`) — zéro duplication de logique, exclusion identique des cadres > 0,70 d'`area_ratio`, `raw_binary` jamais touché. La file séquentielle stricte (D4-A : une seule page en vol) n'est pas modifiée.

### **5.3 Schéma Base de Données SQLite (Source de Vérité)**

*Note : Le DDL complet et exhaustif, incluant tous les indexes et triggers, est défini dans `tech_specs.md` (Section 1). Ce fichier fait autorité pour l'implémentation.*

*Portabilité : le contrat plug-and-play du `.sqlite` autonome (autonomie, ancrage in-situ `asset://`, familles v1 garanties, clé `semantic`, ordre de lecture, recette de conformité 7 points) est normé dans `tech_specs.md` §12.1 « Contrat de Portabilité de la Base Autonome ».*

### **5.4 Déploiement Web (Docker Single-Origin) — (MAJ 2026-08-22)**

Source : `Dockerfile`, `backend/main.py`. Un build = un artefact = un processus : FastAPI sert l'UI compilée **et** l'API en single-origin (zéro CORS inter-origines). Hébergeurs de **conteneurs** uniquement (VPS, Fly.io, Railway, Render, Coolify) — les binaires natifs excluent Cloudflare Workers pour le backend (la vitrine Cloudflare reste un add-on séparé, `deploy/cloudflare/`).

* **Bases pré-ingérées via release GitHub :** les `.sqlite` du corpus (trop volumineux pour le dépôt) sont publiés comme **assets d'une release GitHub** et **téléchargés au build Docker** (`curl` → `databases_publiees/`). Au démarrage, le lifespan copie chaque `.sqlite` absent de `DATABASES_DIR` (seed non destructif, cf. `RAGDOM_PUBLISHED_DBS`) → la bibliothèque renaît identique à chaque réveil du disque éphémère. Échec de téléchargement = build tolérant (démarrage à vide, message d'avertissement).
* **Corpus embarqué dans l'image :** les PDF sources font partie de l'image (`COPY sources/`), `SOURCES_DIR=/app/sources` — persistants aux restarts malgré le disque éphémère ; les uploads web atterrissent au même endroit.
* **Données persistantes :** volume `/data` (`DATABASES_DIR`, `PIPELINE_SET_DIR`, `MODELS_DIR`, `CONFIG_DB_PATH`).
* **Contrainte 512 Mo (hébergements FREE) → `RAGDOM_LOW_MEMORY=true` :** l'encodeur d'embeddings ONNX (~300 Mo de pic) n'est **jamais** chargé (sinon OOM kill) ; la recherche passe en **BM25 seul** en ligne. Les bases pré-construites conservent leurs vecteurs pour un futur hébergement plus large. `llama-cpp-python` (LLM GGUF local) est exclu de l'image web (compilation longue, inutile en ligne) — fallback LLM web = Ollama/API.

---

## **PARTIE 6 : ARCHITECTURE FRONTEND, UI/UX ET DESIGN SYSTEM**

### **6.1 Design System & Charte Graphique Imposée**

* **Thème (V3.1) :** Dual-theme Dark/Light. **Dark Navy par défaut** (`data-theme="dark"`, fond `#070d1e`), bascule persistée localStorage. La charte exacte (variables CSS, ombres, animations) est définie dans Frontend_UI_Specs §2.1 qui fait autorité (Règle 0).
* **Stack Technologique Imposée :** React 19, TypeScript strict, Vite, Tailwind CSS. Les classes utilitaires de type grille (`col-*`) et boutons (`btn-*`) présentes dans les specs sont des classes CUSTOM recréées en CSS/Tailwind dans `index.css` — le framework Bootstrap lui-même (JS + CSS) reste INTERDIT. Les comportements `bootstrap.Collapse` sont réimplémentés en état React contrôlé.
* **Icônes :** Font Awesome 6 (CDN) AUTORISÉ par exception pixel-perfect (les templates en dépendent). lucide-react disponible pour les composants neufs sans équivalent FA.
* **Interdictions maintenues :** Vue.js, Angular, jQuery, Bootstrap (framework), Material UI, styled-components, Emotion.

### **6.2 L'Application à 3 Vues (React Router)**

#### **VUE 1 : INDEX (Dashboard & Présentation)**

* Présente les capacités de RAGDom sous forme de landing page interne.
* Affiche les métriques **réelles** de chaque base SQLite détectée via `GET /api/system/databases` : nombre de documents, de chunks, d'artefacts, de pages indexées.
* Inclut un sélecteur de base active (Dropdown dynamique).
* Zéro mock, zéro hardcodage.

#### **VUE 2 : LIBRARY (Exploration, Consultation & Side-by-Side)**

**Panneau Gauche — TOCExplorer.tsx :**
* Arbre de navigation hiérarchique reconstruit depuis `document_toc`.
* Filtres dynamiques par domaine (facettes `domain` depuis `scientific_artifacts`).
* Filtres par type pédagogique (facettes `pedagogical_type` depuis `document_chunks`).
* Aucun filtre statique : tout est hydraté par requêtes GROUP BY sur SQLite.

**Zone Centrale — SideBySideViewer.tsx :**
* Panneau Gauche (Scan Original HD 300 DPI) vs Panneau Droit (Rendu RAGDom).
* **Sync-Scroll :** Défilement synchronisé par ratio (Y-offset Scan / hauteur totale = Y-offset Markdown rendu / hauteur totale).
* **Overlay Diff :** Slider d'opacité CSS permettant de superposer le rendu extrait sur le scan original pour confrontation visuelle directe de la fidélité OCR.
* Surbrillance bilatérale des BBoxes au survol (coordonnées depuis `bounding_box_json`).

**Panneau Droit — ArtifactRenderer.tsx :**
* Aiguillage dynamique (< 16ms) selon `artifact_type` :
  * `latex_formula` → KaTeX
  * `geometry_vector`, `circuit_schematic` → DOMPurify (SVG)
  * `pdb_protein` → 3Dmol.js
  * `smiles_chem` → Ketcher / RDKit.js
  * `code_snippet` → Shiki
  * `flowchart` → Mermaid.js
  * `geojson_map` → MapLibre GL
  * `dense_illustration`, `dicom_slice` → OpenSeadragon

* **Application du contrat de rendu §12 (MAJ 2026-08-22 — source : `frontend/src/components/library/ArtifactRenderer.tsx`) :**
  * `render_config_json.renderer` est lu **EN PRIORITÉ** pour choisir le renderer (dictionnaire renderer → famille), avec repli sur l'heuristique de type quand le champ est absent (cf. tech_specs §12).
  * **Renderers embarqués en v1 :** `mermaid` (flowchart) et `plotly.js-dist-min` (signal_waveform) sont **installés** (imports dynamiques, chunks async) → rendu structuré natif ; `data_table` rendu via **tanstack-table** (tri par colonne) avec repli Markdown ; `latex_formula`/`matrix` rendus en **KaTeX même sans binaire** (source structurée seule → plus masquée) ; `geometry_vector` en SVG sanitisé.
  * **Visionneuses hors périmètre v1 :** `smiles_chem` (ketcher) et `code_snippet` (shiki) restent **NON installés** → WebP original + panneau source repliable + étiquette explicite « visionneuse non installée » (tech_specs §9 Note Tiering).
  * **Badge d'état de rendu** sur chaque artefact — *structuré* / *original (repli)* / *visionneuse non installée* — calculé sur le rendu **EFFECTIF** (async mermaid/plotly compris), en plus du badge de **type** affiché aussi in-situ, et du badge sémantique (`render_config_json.semantic`).
  * **Comparateur** *structuré / original / comparaison* étendu aux familles natives incluant mermaid et plotly (familles natives + binaire présent).
  * Résolution des ancres `asset://artifacts/{id}` et `asset://figures/{nom}` dans `lib/markdown.ts` (SideBySideViewer / SearchStudio / AskStudio) → plus d'images cassées.

**Structure des 6 Onglets de la Bibliothèque (Norme Pixel-Perfect issue de `library.php`) :**
1. **المصفوفة الشاملة 360° (Curriculum Matrix) :** Matrice relationnelle à 3 colonnes trimestres avec compteurs et rangée de ponts (`.bridge-cours`, `.bridge-exo`, `.bridge-prog`, `.bridge-scan`, `.bridge-eval`).
2. **المنهاج والتدرج السنوي (Programme MEN 2G) :** Référentiel des مقاطع, compétences et ressources constituantes.
3. **مستودع الدروس والمفاهيم (Cours KaTeX) :** Rendu 100% pleine largeur basculant en 50/50 avec rail latéral des scans originaux (`scans-side-rail`).
4. **بنك التمارين والأنشطة (Exercices & Activités) :** 690 exercices avec filtres trimestres/cours/pages, prévisualisation scan, et solution modèle.
5. **الفروض والاختبارات (Évaluations & Examens) :** 27 modèles d'évaluations avec mode parallèle 50/50 sujet + barème/corrigé type.
6. **المستودع البصري (Galerie des Scans) :** 272 documents scannés HD (201 livre + 71 examens) avec zoom plein écran (`#masterImageModal`).

*Note (V3.1 — D1-B) : les compteurs 690 / 27 / 272 ci-dessus sont des valeurs d'exemple du corpus 2G de référence, jamais des constantes. Ces onglets ne s'activent que si les tables curriculum de la base active sont peuplées (`GET /api/library/curriculum`) — sinon la Vue 2 bascule en Mode Repli Générique (Frontend_UI_Specs §5.2).*

*Structure & navigation des onglets curriculum (MAJ 2026-08-22 — source : `frontend/src/components/library/curriculum/tabs/`) :*
* *Capsules de plages de pages fiabilisées côté client : le `page_end` de l'API est validé (cohérent et ne débordant pas la section suivante de niveau ≤ N) puis recalculé par niveaux sinon, borné par la dernière page réellement couverte par le TOC (jamais `total_pages`) → affichage « ص X - Y » pour une vraie plage, « ص X » pour une leçon d'une seule page (fini les « ص X - 210 » aberrantes).*
* *Badges de type pédagogique **effectif** dans l'onglet Cours, avec ponts dorés (halo) vers Exercices/Évaluations/Programme/Scans — aucun contenu masqué (le contenu non-cours enfoui dans une plage de cours reste atteignable).*
* *Navigation relationnelle **bidirectionnelle** exercice↔corrigé : priorité au `linked_solution_chunk_id` exposé par le backend, puis repli sur le lien `course_exercise` du SolutionLinker, puis sur un `pedagogical_index` identique ; index inverse corrigé→énoncé construit sur la même chaîne.*
* *Pont chunk→scan de la page, et **préchargement des artefacts par plage de pages** du chapitre (fini le repli image transitoire des ancres in-situ).*

**SearchStudio & AskStudio (V3.2) :**
* **SearchStudio multi-bases :** cases à cocher des bases actives → bascule automatique `hybrid` (1 base) / `hybrid-multi` (n bases), badge `database_filename` sur chaque résultat.
* **AskStudio (Chat RAG) :** onglet de conversation avec la bibliothèque (`POST /api/search/ask`) — réponse générée avec **citations cliquables** (chunk → navigation SideBySideViewer), badge provider utilisé, affichage distinct du message anti-hallucination (`no_context: true`, style neutre, zéro invention).
* **ChunkEditor (Correction Humaine) :** bouton « ✏️ Corriger » sur chaque chunk/artefact du SideBySideViewer → éditeur Markdown/LaTeX avec aperçu KaTeX live → à l'enregistrement : re-lint affiché, re-indexation automatique, badge « corrigé manuellement » (`is_human_edited`), contenu protégé des purges par défaut.

*Note normative : L'implémentation frontend React 19 / TypeScript / Tailwind détaillée de chaque vue, composant, style CSS et animation est définie dans le document [Frontend_UI_Specs.md](file:///c:/xampp/htdocs/RAGDom/RAGDom-V3/Frontend_UI_Specs.md) qui fait autorité absolue sur l'UI/UX.*

#### **VUE 3 : AUTOMATION & SETTINGS (Pipeline Studio & Hub)**

**PipelineStudio.tsx / AutomationView :**
* Pilotage de l'ingestion par niveaux granulaires : page N, pages A à B, chapitre (via TOC), document complet, ou dossier entier (depuis `/sources/`).
* Sélecteur de matière / base SQLite cible avec live telemetry et purge sécurisée.
* **Bandeau d'Alerte Moteur Vectoriel :** Statut en direct (`sqlite-vec` vs `fts5-fallback`), bouton de test à chaud, et switch toggle pour forcer le mode strict Option A.
* Console de logs en temps réel via SSE (Server-Sent Events) verte `#10b981` sur fond `#050811` avec auto-scroll et bouton d'arrêt d'urgence (`POST /api/pipeline/stop`).
* **Carte ETA & Débit (V3.1 — D4-A) :** débit courant (pages/h, moyenne mobile 10 pages depuis `processing_benchmarks.execution_time_ms`), pages restantes, heure de fin estimée, badge du moteur ML actuellement résident (Cycle de Vie des Moteurs).
* Tableau d'inspection des documents sources officiels (`official-books` et `sources`).

**KeyManager.tsx :**
* Interface de gestion de l'Orchestrateur LLM : ajout/suppression de multiples clés API, masquage/révélation.
* Sélection des providers actifs (Gemini, Groq, OpenAI, Anthropic, Ollama local) et sélection des modèles actifs (Flash, Pro, Hybride, Gemini 2.0).
* Monitoring des quotas, codes HTTP (429, 401) et rotation automatique des clés.

**Panneaux d'Administration (V3.2 — Couverture Totale, tous dans AutomationView) :**
* **SourcesManager :** arborescence de `/sources/` (GET /api/system/sources), upload PDF par glisser-déposer, création de dossiers, suppression protégée.
* **PurgeStudio (Purge Scopée) :** sélecteur de portée (page / plage / chapitre via TOC / document / base entière / artefacts seuls / curriculum seul) → appel `dry_run` → **modale de prévisualisation d'impact** (comptes supprimés + lignes protégées `is_human_edited`) → confirmation (double saisie du nom pour la base entière) → exécution.
* **QuarantineManager :** table des pages QUARANTINE/INVALID_SOURCE avec `error_log` dépliable, bouton « Réessayer » (sélection multiple), badge d'explication pour les INVALID_SOURCE non-retryables.
* **DatabaseLifecycle :** par base — Exporter (.sqlite autonome), Dupliquer, Supprimer (double garde-fou), taille, `schema_version`.
* **SettingsPanel :** réglage à chaud des seuils anti-hallucination (sliders `vec_distance_threshold` / `bm25_score_threshold`) — complète le switch sqlite-vec existant.
* **TelemetryExplorer :** exploration paginée de `processing_benchmarks` (filtres document/page), agrégats (latence moyenne, confiance, taux VLM/fallback), mini-graphes Plotly.
* **CurriculumStudio :** CRUD complet des trimestres / مقاطع / évaluations / liaisons + import JSON structuré — c'est ici que la Vue 2 sort du Mode Repli Générique.
* **ArtifactImportModal (Tier 3) :** upload d'un actif structuré (PDB, glTF, IFC, GeoJSON, DICOM…) associé à un document/page, avec type et légende.

### **6.3 Schéma Visuel de l'Interface**

```
┌──────────────────────────────────────────────────────────────────┐
│                 RAGDom DIGITAL EXPLORER & STUDIO                 │
├──────── Vue 1: INDEX (Portal Dashboard) ───────────────────────  │
│ 📊 6 KPIs Stratégiques | 🗄️ Bases SQLite | 🎓 Cycles Scolaires   │
│ 🔍 Barre de Recherche 360° | 📡 Télémétrie Live des Tables       │
├──────── Vue 2: LIBRARY (Bibliothèque Interactive) ───────────── │
│ [SIDEBAR 360°] │ [WORKSPACE: 6 ONGLETS INTERACTIFS]             │
│ 🎓 Niveau      │ 1. 📊 المصفوفة الشاملة 360°                     │
│ 📚 Matière     │ 2. 🎓 المنهاج والتدرج السنوي (2G)               │
│ 🗓️ Trimestre   │ 3. 📖 مستودع الدروس (KaTeX + Rail Scans 50/50) │
│ 🔍 Live Search │ 4. ✏️ بنك التمارين (690 exos + Sol.)            │
│ 📄 Page Jumper │ 5. 📝 الفروض والاختبارات (27 sujets + corr.)   │
│                │ 6. 🖼️ المستودع البصري (272 scans HD + Modale)   │
│                │ 💫 Halo Flash Doré (targetFlashGlow 2.2s)       │
├──────── Vue 3: AUTOMATION (Industrial Pipeline Hub) ─────────── │
│ ⚙️ Status Live | ⚠️ Alerte Moteur Vectoriel (sqlite-vec / FTS5)  │
│ 🧠 LLM Selector (Flash/Pro/Hyb) | 8 Step Pills (0→7) + Badges        │
│ 💻 Terminal Console Live SSE (#10b981) | 🔑 Key Manager (Multi)  │
└──────────────────────────────────────────────────────────────────┘
```

### **6.4 Internationalisation Trilingue (i18n) & Support des Documents Mixtes (BiDi)**

* **Priorité et Langue par Défaut :** **Arabe (`ar`)** en standard absolu (`dir="rtl"`). L'interface prend également en charge le **Français (`fr`)** et l'**Anglais (`en`)** via `LanguageContext.tsx`.
* **Sélecteur de Langue :** Composant `LanguageSelector.tsx` présent dans la Topbar des 3 vues pour basculer dynamiquement l'UI et la direction globale de la page (RTL ↔ LTR).
* **Périmètre i18n :** Traduit l'intégralité de l'UI (menus, boutons, badges, KPIs, tooltips, modales, logs du terminal). Les documents et extraits pédagogiques restent dans leur langue source.
* **Documents Scientifiques Mixtes (BiDi Isolation) :** Pour les manuels à corpus arabe contenant des formules mathématiques, unités physiques, symboles chimiques ou fragments de code en français/anglais, le système applique une **isolation bidirectionnelle stricte** (`direction: ltr !important; unicode-bidi: isolate !important;`) sur tous les blocs KaTeX, Shiki, SVG et formules pour empêcher toute inversion de caractères.

---

### **6.5 États Système, Onboarding & Accessibilité (V3.2)**

* **Premier lancement (zéro base, zéro source) :** `OnboardingEmptyState` — écran guidé en 3 étapes (1. Déposez vos PDFs dans SourcesManager → 2. Lancez l'ingestion → 3. Explorez la bibliothèque), remplaçant les vues vides. Chaque vue définit son état vide (jamais de page blanche).
* **Backend injoignable :** `ConnectionGuard` — détection de l'échec du premier `GET /api/system/health`, écran plein « Backend RAGDom non démarré » avec la commande de lancement affichée et bouton « Réessayer » (polling 5 s).
* **Accessibilité (normative) :** navigation clavier complète (tab-order logique, `Escape` ferme les modales, focus-trap dans les modales, retour du focus à l'élément déclencheur) ; attributs ARIA sur onglets (`role="tablist"`), arbres TOC (`role="tree"`) et console (`aria-live="polite"`) ; `prefers-reduced-motion: reduce` respecté globalement (animations réduites à 0.01ms) ; contrastes AA sur les deux thèmes.

---

### **6.6 Design System Étendu — Confort, Ergonomie de Masse & Identité Multi-Moteurs (V3.3)**

* **Motion Design System normatif** : tokens durée/easing (`--dur-1..4`, `--ease-out-*`) appliqués à tout nouveau composant selon la table d'application de Frontend_UI_Specs PARTIE 8 (issue du skill `motion-design` pré-installé dans `.agents/skills/`). Animations legacy pixel-perfect conservées telles quelles. Zéro animation sur les interactions haute fréquence (console, clavier, listes virtualisées).
* **Ergonomie de masse** : virtualisation obligatoire au-delà de 100 éléments (`@tanstack/react-virtual`), toggle de densité compact/confortable, sélection en masse avec barre d'actions flottante, **Command Palette Ctrl+K**, en-têtes collants, opérations longues non-bloquantes et annulables.
* **Confort de feedback** : toasts unifiés avec Annuler (5s) sur le destructif réversible, optimistic UI mesuré, skeletons à la forme réelle, **Inspecteur de Cycle de Vie par page** (drawer chronologie couches 0→7 avec timings/RAM/confiance depuis processing_benchmarks), compteurs animés en incrément.
* **Identité multi-moteurs** : `/engines/` accueillera d'autres moteurs après `sci-engine` — token `--engine-accent` (sci-engine = Bleu Cobalt `#2563eb`) + badge moteur actif en Topbar ; retheming complet d'un futur moteur en une variable. **Couleurs de domaine dérivées algorithmiquement** (hash → teinte HSL) : cohérence visuelle inter-vues sans aucun hardcoding — Zéro Dogme préservé. Couleurs sémantiques d'état réservées aux états.

---

## **PARTIE 7 : CONTRAT COMPLET DES ROUTES API REST (BACKEND)**

*Le Backend Python est implémenté avec **FastAPI** (uvicorn). Toutes les routes retournent du JSON. Le paramètre `?db=` est obligatoire pour toute route de lecture sur une base documentaire.*

### **7.1 Routes Système (/api/system)**

#### `GET /api/system/databases`
**Description :** Scanne physiquement le dossier `/databases/` et retourne la liste des bases disponibles.

**Réponse 200 :**
```json
{
  "databases": [
    {
      "filename": "Maths_1AM.sqlite",
      "size_bytes": 45231104,
      "last_modified": "2026-08-20T22:00:00",
      "metrics": {
        "document_count": 12,
        "chunk_count": 8200,
        "artifact_count": 3450,
        "page_count": 1024,
        "indexed_page_count": 1020
      }
    }
  ]
}
```

#### `GET /api/system/health`
**Description :** Vérifie l'état général du backend, de la file d'attente et du moteur vectoriel (sqlite-vec vs mode dégradé FTS5).

**Réponse 200 :**
```json
{
  "status": "ok",
  "version": "3.5",
  "queue_length": 0,
  "vector_engine": "sqlite-vec",
  "vector_engine_status": "ready",
  "vector_engine_message": "Moteur hybride opérationnel (FTS5 + sqlite-vec 384d)",
  "force_sqlite_vec": false
}
```

#### `POST /api/system/vector-engine/toggle-strict`
**Description :** Active ou désactive le mode strict `sqlite-vec` (Option A vs Option B) à chaud.

**Corps de requête :**
```json
{ "force_sqlite_vec": true }
```

**Réponse 200 :**
```json
{ "success": true, "force_sqlite_vec": true, "message": "Mode strict sqlite-vec configuré." }
```

#### `POST /api/system/vector-engine/test`
**Description :** Teste à chaud le chargement dynamique de la DLL binaire `sqlite-vec` sur la machine hôte.

**Réponse 200 :**
```json
{ "success": true, "engine": "sqlite-vec", "message": "Extension sqlite-vec chargée avec succès." }
```

### **7.2 Routes Bibliothèque (/api/library)**

#### `GET /api/library/documents?db={nom.sqlite}&page=1&limit=50`
**Description :** Retourne la liste **paginée** (tech_specs §14) des documents de la base ciblée.

**Réponse 200 (MAJ 2026-08-22 — forme `{data, pagination}` + alias legacy) :**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Manuel d'Algèbre 1AM",
      "filename": "manuel_algebre.pdf",
      "total_pages": 320,
      "doc_type": "textbook",
      "academic_level": "1AM",
      "domain_tags_json": "[\"math\", \"algebra\"]",
      "created_at": "2026-08-19T10:00:00"
    }
  ],
  "documents": [ "…alias legacy = même tableau que data…" ],
  "pagination": { "page": 1, "limit": 50, "total": 3, "total_pages": 1 }
}
```

#### `GET /api/library/toc?db={nom.sqlite}&document_id={id}`
**Description :** Retourne l'**arbre** TOC complet d'un document. **Non paginé** (structure hiérarchique — tech_specs §14).

**Réponse 200 :**
```json
{
  "toc": [
    {
      "id": "uuid",
      "parent_id": null,
      "level": 1,
      "title": "Chapitre 1 : Algèbre",
      "page_start": 1,
      "page_end": 45,
      "children": [ ... ]
    }
  ]
}
```

#### `GET /api/library/facets?db={nom.sqlite}`
**Description :** Retourne les facettes d'agrégation pour l'UI (domaines, types pédagogiques, types d'artefacts).

**Réponse 200 :**
```json
{
  "domains": [
    { "domain": "math", "count": 412 },
    { "domain": "physics", "count": 180 }
  ],
  "pedagogical_types": [
    { "pedagogical_type": "exercise_unsolved", "count": 302 },
    { "pedagogical_type": "course_theory", "count": 1450 }
  ],
  "artifact_types": [
    { "artifact_type": "latex_formula", "count": 890 }
  ]
}
```

#### `GET /api/library/chunks?db={nom.sqlite}&document_id={id}&page=1&limit=50`
**Description :** Retourne les chunks **paginés** (tech_specs §14) d'un document. Filtres optionnels : `page_number`, `pedagogical_type` (`exercise` = raccourci solved+unsolved), `page_start`, `page_end`, `toc_id`, `has_solution` (MAJ 2026-08-22 — booléen : tri des exercices résolus/non-résolus).

**Réponse 200 (MAJ 2026-08-22 — forme `{data, pagination}` + alias legacy `chunks` ; `linked_solution_chunk_id` + `toc_id` exposés par chunk — source : `backend/api/routes_library.py`) :**
```json
{
  "data": [
    {
      "id": "uuid",
      "page_number": 12,
      "chunk_index": 0,
      "section_title": "1.2 Équations du second degré",
      "content_markdown": "## Équations du second degré\n...",
      "pedagogical_type": "course_theory",
      "pedagogical_index": null,
      "has_solution": 0,
      "is_human_edited": 0,
      "updated_at": "2026-08-19T10:00:00",
      "token_count": 412,
      "linked_solution_chunk_id": null,
      "toc_id": "uuid"
    }
  ],
  "chunks": [ "…alias legacy = même tableau que data…" ],
  "pagination": { "page": 1, "limit": 50, "total": 128, "total_pages": 3 }
}
```
*Liaisons relationnelles (MAJ 2026-08-22) : `linked_solution_chunk_id` (énoncé → corrigé, peuplé par la Couche 3bis SolutionLinker) et `toc_id` (rattachement au sommaire) rejoignent le payload pour que l'UI câble la navigation exercice↔solution et chapitre↔chunk sans requête supplémentaire ; `null` tant que la liaison n'existe pas.*

#### `GET /api/library/artifacts?db={nom.sqlite}&chunk_id={id}`
**Description :** Retourne les artefacts associés à un chunk.

**Réponse 200 :**
```json
{
  "artifacts": [
    {
      "id": "uuid",
      "domain": "math",
      "artifact_type": "latex_formula",
      "raw_data": "$E = mc^2$",
      "raw_binary": null,
      "render_config_json": "{\"renderer\": \"katex\"}",
      "caption": "Équation d'Einstein",
      "bounding_box_json": "{\"x0\": 120, \"y0\": 340, \"x1\": 280, \"y1\": 370}"
    }
  ]
}
```

#### `GET /api/library/page-scan?db={nom.sqlite}&document_id={id}&page={n}`
**Description :** Retourne le scan de la page en **image binaire WebP** (`Content-Type: image/webp`), lu depuis la table **`page_scans`** de la base (V3.5 — jamais depuis /sources/ ni /pipeline-set/ : le .sqlite est autonome). Directement utilisable dans un `<img src>`. Paramètre optionnel `&thumb=true` → renvoie la vignette `thumb_webp` (galeries virtualisées). Les en-têtes `X-Scan-Width` / `X-Scan-Height` exposent `width_px`/`height_px` pour la conversion BBox → CSS %.

**Réponse 200 :** corps binaire `image/webp` (pas de JSON) ; 404 si la page n'a pas de scan persisté.

#### `GET /api/library/curriculum?db={nom.sqlite}` *(V3.1 — D1-B)*
**Description :** Retourne le contenu des tables curriculum optionnelles. Si elles sont vides, la Vue 2 bascule en Mode Repli Générique.

**Réponse 200 :**
```json
{
  "curriculum_available": true,
  "terms": [ { "id": "uuid", "term_index": 1, "label": "الفصل الأول" } ],
  "programs": [ { "id": "uuid", "term_id": "uuid", "seq_index": 1, "title": "...", "source": "MEN 2G" } ],
  "assessments": [ { "id": "uuid", "kind": "devoir", "title": "...", "subject_chunk_id": "uuid", "correction_chunk_id": "uuid" } ],
  "links": [ { "id": "uuid", "link_type": "course_exercise", "from_id": "uuid", "to_id": "uuid" } ]
}
```

### **7.3 Routes Recherche (/api/search)**

#### `POST /api/search/hybrid?db={nom.sqlite}`
**Description :** Recherche hybride RRF (BM25 + sqlite-vec).

**Corps de la requête :**
```json
{
  "query": "exercices sans solution équations second degré",
  "filters": {
    "pedagogical_type": "exercise_unsolved",
    "domain": "math",
    "toc_id": "uuid-optionnel"
  },
  "top_k": 5
}
```

**Réponse 200 :**
```json
{
  "results": [
    {
      "chunk_id": "uuid",
      "document_id": "uuid",
      "document_title": "Manuel d'Algèbre 1AM",
      "page_number": 34,
      "section_title": "Exercices Chapitre 2",
      "content_markdown": "...",
      "pedagogical_type": "exercise_unsolved",
      "rrf_score": 0.032,
      "bm25_rank": 2,
      "vec_rank": 3
    }
  ]
}
```

#### `POST /api/search/hybrid-multi` *(V3.1)*
**Description :** Recherche hybride sur plusieurs bases : requêtes parallèles (connexions indépendantes) puis seconde passe RRF globale (tech_specs §3.5).

**Corps de la requête :**
```json
{ "query": "…", "databases": ["Maths_1AM.sqlite", "Physique_Term.sqlite"], "top_k": 5 }
```

**Réponse 200 :** même format que `/api/search/hybrid`, chaque résultat portant en plus `database_filename`.

### **7.4 Routes Pipeline (/api/pipeline)**

#### `POST /api/pipeline/start`
**Description :** Lance un **batch** d'ingestion : crée une ligne `ingestion_batches` + une ligne `pipeline_jobs` par page ciblée.

**Corps de la requête :**
```json
{
  "source_path": "/sources/Maths/1AM/manuel_algebre.pdf",
  "target_db": "Maths_1AM.sqlite",
  "mode": "document | chapter | page_range | folder",
  "page_start": 1,
  "page_end": 45,
  "toc_id": "uuid-optionnel"
}
```

**Réponse 202 :**
```json
{ "batch_id": "uuid", "status": "QUEUED", "pages_total": 45 }
```
Le mode `folder` enfile TOUS les PDF d'un dossier vers une même base et renvoie `{ "batch_id", "batch_ids": [...], "status", "pages_total", "target_db" }`.

**Reprise & chaînage (MAJ 2026-08-22 — source : `backend/api/routes_pipeline.py`, `backend/main.py`) :**
* **Reprise automatique au démarrage :** au lifespan, `resume_pending_queues()` parcourt toutes les bases de `DATABASES_DIR` ; toute base ayant des jobs `QUEUED`/`RUNNING` voit ses `RUNNING` re-mis en file (`orchestrator.recover`) puis son worker relancé — **aucun lot orphelin** après un crash ou un redéploiement.
* **Séquentiel strict multi-bases avec relance en chaîne :** UN worker draine UNE base à la fois (D2-B). Un lot enfilé sur une **autre** base pendant un run est mis en attente (`_worker["pending"]`) et son worker est **relancé en chaîne** à la fin du run courant — jamais deux moteurs lourds résidents en parallèle, jamais de lot perdu.

#### `POST /api/pipeline/reprocess` *(Ré-exécution scopée — MAJ 2026-08-22)*
**Description :** Purge scopée du périmètre **puis** ré-ingestion complète (TOUTES les couches du moteur) du même périmètre. L'unité d'exécution reste la page (D4-A). Réutilise la purge scopée réelle (`/pipeline/purge`) — jamais de code dupliqué.

**Corps :**
```json
{
  "db": "Maths_1AM.sqlite",
  "scope": "document | page_range | chapter",
  "document_id": "uuid",
  "page_start": 12, "page_end": 45,
  "toc_id": "uuid (requis si scope=chapter)",
  "preserve_human_edits": true
}
```
**Règles :** `scope` limité à `document | page_range | chapter` (400 sinon) ; `page_start` requis pour `page_range`, `toc_id` requis pour `chapter` ; PDF source absent de `/sources/` → **HTTP 409** (ré-exécution impossible) ; `preserve_human_edits=true` (défaut) exclut les lignes `is_human_edited=1` de la purge préalable.

**Réponse 202 :**
```json
{ "reprocessed_scope": "document", "purged": { "chunks": 412, "artifacts": 180, "...": "..." },
  "batch_id": "uuid", "pages_total": 45, "page_start": 1, "page_end": 45, "status": "QUEUED" }
```

#### `GET /api/pipeline/status?batch_id={uuid}`
**Description :** Retourne le statut agrégé d'un batch et de sa page courante.

**Réponse 200 :**
```json
{
  "batch_id": "uuid",
  "status": "RUNNING",
  "pages_total": 45,
  "pages_done": 11,
  "current_page": { "page_number": 12, "status": "EXTRACTING", "retry_count": 0, "error_log": null },
  "updated_at": "2026-08-21T00:10:00"
}
```

#### `GET /api/pipeline/queue`
**Description :** Retourne l'état complet de la file d'attente.

**Réponse 200 :**
```json
{
  "current_job": { "batch_id": "uuid", "job_id": "uuid", "status": "PROCESSING_CV", "page_number": 12 },
  "queued_jobs": [ ... ],
  "completed_today": 450
}
```

#### `DELETE /api/pipeline/batch/{batch_id}` *(V3.1)*
**Description :** Annule les pages encore QUEUED du batch (les pages en cours ou terminées ne sont pas affectées).

**Réponse 200 :**
```json
{ "cancelled": true }
```

#### `POST /api/pipeline/reset?db={nom.sqlite}&document_id={id}` *(DÉPRÉCIÉ en V3.2)*
**Description :** Alias rétro-compatible de `POST /api/pipeline/purge` (scope `document` si `document_id` fourni, `database` sinon — sans dry_run). **Tout nouveau code utilise `/api/pipeline/purge` (§7.6)** : purge scopée multi-niveaux avec prévisualisation d'impact.

**Réponse 200 :**
```json
{ "success": true, "deleted_chunks": 412, "deleted_artifacts": 180, "message": "Base réinitialisée." }
```

#### `POST /api/pipeline/stop` *(V3.1)*
**Description :** Arrêt d'urgence (bouton rouge de la console SSE) : termine proprement la page courante (Couche 7 ou rollback transactionnel), passe le batch en `STOPPED` et remet les pages restantes à `QUEUED`.

**Réponse 200 :**
```json
{ "stopped": true, "batch_id": "uuid", "last_completed_page": 12 }
```

#### `GET /api/pipeline/stream` (SSE)
**Description :** Flux Server-Sent Events pour la télémétrie en temps réel du Frontend (Live Terminal & Steps).

**Format des événements SSE :**
```
event: page_update
data: {"batch_id":"uuid","job_id":"uuid","page_number":12,"status":"EXTRACTING","ram_mb":142,"latency_ms":380,"line":"[STEP 3] Extraction page 12..."}

event: queue_update
data: {"queue_length":3,"batch_id":"uuid"}

event: job_complete
data: {"batch_id":"uuid","pages_indexed":45,"artifacts_extracted":230,"done":true,"success":true}

event: error
data: {"batch_id":"uuid","page_number":5,"error":"UNBALANCED_LATEX","details":"Missing \\end{matrix}"}
```

**Sémantique des états `INDEXED` vs `READY` (V3.1) :** `INDEXED` = chunks + artefacts persistés et FTS synchronisé (fin de l'écriture Couche 7) ; `READY` = benchmarks Couche 6 écrits et checkpoint `/pipeline-set/` purgé — état terminal. La transition `INDEXED → READY` est automatique, dans la même transaction de clôture.

**Sommaire de repli dérivé des titres au finalize (MAJ 2026-08-22 — source : `backend/core/orchestrator._finalize_batches` / `_build_toc_from_headings`) :** à la clôture d'un document (toutes les pages `READY`), si le document **n'a AUCUN sommaire natif** (`document_toc` vide pour ce document), un TOC de repli est **dérivé des titres Markdown** (`##/###`) des chunks — une entrée par page (granularité sommaire, pas un index exhaustif) — puis les chunks du périmètre y sont reliés (`toc_id`). Garde-fous : **jamais d'écrasement d'un TOC natif** (n'écrit rien si `document_toc` est déjà peuplé) ; idempotent (recalculé à chaque finalize complet, compatible reprocess).

**Construction incrémentale + plages fiables (MAJ 2026-08-22 — source : `backend/core/orchestrator._maybe_build_toc_incremental` / `layer_1_triage`) :** le sommaire de repli n'attend plus le finalize — il est **reconstruit AU FIL DE L'EAU pendant l'ingestion**, cadencé par la variable d'env `RAGDOM_TOC_INCREMENTAL_EVERY` (défaut **10** pages `READY` par document ; `0` = désactivé → construction au finalize uniquement, comportement historique), avec reconstruction complète finale au finalize (capte les derniers titres et répare toute dérive d'un reprocess scopé). L'état « sommaire natif ? » est mémoïsé par document (un seul `fitz.get_toc()` par passe de file), et un sommaire natif reste intouchable. Les **plages de pages sont désormais fiables** : `page_end` d'une entrée de niveau N = (page du **prochain titre de niveau ≤ N commençant STRICTEMENT plus loin**) − 1, borné au document — fini les plages aberrantes « X → dernière page » causées par des titres de même niveau co-localisés. Le **TOC natif reçoit lui aussi un `page_end` calculé** (côté `layer_1_triage`, même règle) : plus de `page_end = NULL` forçant l'UI et les agrégats SQL à un `COALESCE` à 100000 qui faisait « déborder » un chapitre sur tout le reste du document.

### **7.5 Routes LLM Key Manager (/api/llm)**

#### `GET /api/llm/providers`
**Description :** Retourne la liste des providers configurés et leurs statuts.

**Réponse 200 :**
```json
{
  "providers": [
    {
      "provider": "gemini",
      "keys": [
        { "key_id": "uuid", "masked_key": "AIzaSy...xxxx", "status": "active", "last_error": null }
      ],
      "available_models": ["gemini-1.5-flash", "gemini-2.0-flash"],
      "active_model": "gemini-1.5-flash"
    }
  ]
}
```

#### `GET /api/llm/settings`
**Description :** Récupère les profils et paramètres des modèles LLM actifs.

**Réponse 200 :**
```json
{
  "settings": [
    { "provider": "gemini", "active_model": "gemini-1.5-flash", "is_enabled": true, "priority": 1 },
    { "provider": "groq", "active_model": "llama-3.3-70b-versatile", "is_enabled": true, "priority": 2 }
  ]
}
```

#### `PUT /api/llm/settings`
**Description :** Met à jour le modèle actif ou l'état d'activation d'un provider LLM.

**Corps :**
```json
{ "provider": "gemini", "active_model": "gemini-1.5-pro", "is_enabled": true }
```

**Réponse 200 :**
```json
{ "success": true, "updated": { "provider": "gemini", "active_model": "gemini-1.5-pro" } }
```

#### `GET /api/llm/keys` *(V3.1)*
**Description :** Liste les clés **masquées**. Le champ `api_key` en clair n'est JAMAIS retourné par cette route.

**Réponse 200 :**
```json
{ "keys": [ { "id": "uuid", "provider": "gemini", "masked_key": "AIzaSy...xxxx", "status": "active", "blocked_until": null, "last_error_code": null } ] }
```

#### `POST /api/llm/keys/{key_id}/reveal` *(V3.1)*
**Description :** Seule route retournant la clé complète (usage local — bouton « Révéler » du KeyManager).

**Réponse 200 :**
```json
{ "api_key": "AIzaSy..." }
```

#### `POST /api/llm/keys`
**Description :** Ajoute une nouvelle clé API.

**Corps :**
```json
{ "provider": "gemini", "api_key": "AIzaSy..." }
```

**Réponse 201 :**
```json
{ "key_id": "uuid", "status": "active" }
```

#### `POST /api/llm/keys/{key_id}/test`
**Description :** Teste la validité immédiate d'une clé API auprès du provider sans attendre un cycle de production.

**Réponse 200 :**
```json
{ "success": true, "status": "active", "latency_ms": 280, "message": "Clé API validée avec succès." }
```

#### `DELETE /api/llm/keys/{key_id}`
**Réponse 200 :**
```json
{ "deleted": true }
```

---

### **7.6 Routes Administration, Purge Scopée & RAG (V3.2 — Couverture Totale)**

#### `POST /api/search/ask` *(Chat RAG)*
**Description :** Question en langage naturel sur la bibliothèque. Retrieval hybride (§7.3) → filtrage par seuils réels (tech_specs §3.3) → génération LLM via Key Manager avec le contexte formaté (tech_specs §3.4). **Si AUCUN chunk n'est éligible : ZÉRO appel LLM de génération** — la réponse imposée est retournée directement.

**Corps :** `{ "query": "…", "databases": ["Maths_1AM.sqlite"], "top_k": 5, "filters": { … } }`

**Réponse 200 :**
```json
{
  "answer": "…réponse générée, ou message imposé…",
  "no_context": false,
  "sources": [ { "chunk_id": "uuid", "document_id": "uuid", "document_title": "…", "page_number": 34, "database_filename": "Maths_1AM.sqlite", "rrf_score": 0.03 } ],
  "provider_used": "gemini-1.5-flash",
  "fallback_triggered": false
}
```

#### `POST /api/pipeline/purge` *(Purge Scopée Multi-Niveaux — remplace reset)*
**Description :** Purge chirurgicale par portée croissante, avec **prévisualisation d'impact obligatoire** (`dry_run: true` d'abord — la modale UI affiche les comptes avant toute exécution).

**Corps :**
```json
{
  "db": "Maths_1AM.sqlite",
  "scope": "page | page_range | chapter | document | database | artifacts_only | curriculum_only",
  "document_id": "uuid (requis sauf database/curriculum_only)",
  "page_start": 12, "page_end": 45,
  "toc_id": "uuid (requis si scope=chapter)",
  "dry_run": true,
  "preserve_human_edits": true,
  "confirm": "Maths_1AM.sqlite (OBLIGATOIRE si scope=database — nom exact de la base)"
}
```

**Réponse 200 :**
```json
{
  "dry_run": true,
  "deleted": { "chunks": 412, "artifacts": 180, "toc_entries": 12, "jobs": 45, "curriculum_links": 8, "vec_rows": 412, "page_scans": 45 },
  "preserved_human_edited": 3,
  "message": "Prévisualisation — aucune donnée modifiée."
}
```
**Règles :** les triggers DELETE (tech_specs §1) garantissent zéro entrée FTS fantôme ; `preserve_human_edits=true` exclut les lignes `is_human_edited=1` de la purge (sauf scope `database`) ; `scope=database` exige le double garde-fou `confirm` ; `curriculum_only` vide les 4 tables curriculum sans toucher aux contenus.

#### `GET /api/pipeline/quarantine?db={nom.sqlite}` *(Gestion Quarantaine)*
**Réponse 200 :** `{ "jobs": [ { "id", "document_id", "page_number", "status": "QUARANTINE | INVALID_SOURCE", "retry_count", "error_log", "updated_at" } ] }`

#### `POST /api/pipeline/retry`
**Corps :** `{ "db": "…", "job_ids": ["uuid"] }` — remet à `QUEUED` avec `retry_count = 0`. Refusé (HTTP 409) pour `INVALID_SOURCE` si le fichier source n'a pas changé (même mtime/taille).

#### `PUT /api/library/chunks/{id}?db=…` *(Correction Humaine)*
**Corps :** `{ "content_markdown"?, "section_title"?, "pedagogical_type"? }` — déclenche : re-lint Couche 4 → re-embedding (fastembed) → sync FTS (trigger UPDATE) → `is_human_edited = 1`.
**Réponse 200 :** `{ "updated": true, "lint": { …ValidationResult… }, "is_human_edited": 1 }`

#### `PUT /api/library/artifacts/{id}?db=…`
**Corps :** `{ "raw_data"?, "caption"?, "render_config_json"? }` — re-lint + resync FTS + `is_human_edited = 1`.

#### `POST /api/library/artifacts/import?db=…` *(Import Tier 3)*
**Multipart :** `file` + champs `document_id`, `page_number`, `chunk_id?`, `domain`, `artifact_type`, `caption?`. Stocke `raw_binary` (glTF/IFC/DICOM/PDB…) ou `raw_data` (GeoJSON/texte), applique le `render_config_json` du dictionnaire tech_specs §12, `searchable_text` dérivé de la caption. Extensions autorisées par `artifact_type` (whitelist), taille max 50 Mo.

#### `GET /api/system/sources` *(Gestion des Sources)*
**Réponse 200 :** arborescence de `/sources/` — `{ "tree": [ { "rel_path": "Maths/1AM", "folders": […], "files": [ { "name": "manuel.pdf", "size_bytes": N, "ingested": true, "target_db": "Maths_1AM.sqlite" } ] } ] }`

#### `POST /api/system/sources/upload`
**Multipart :** `file` (PDF uniquement, max 1 Go) + `rel_path` (sanitisé : même regex anti-traversal que `?db=`). Dépose dans `/sources/{rel_path}/`.

#### `POST /api/system/sources/folder` — **Corps :** `{ "rel_path": "Physique/Term" }`
#### `DELETE /api/system/sources?rel_path=…` — fichier uniquement, jamais récursif ; HTTP 409 si le PDF est référencé par un document déjà ingéré.

#### `GET /api/system/databases/{filename}/export` *(Cycle de Vie des Bases)*
**Description :** Téléchargement du `.sqlite` (exécute `PRAGMA wal_checkpoint(TRUNCATE)` avant copie — fichier autonome garanti). `Content-Type: application/vnd.sqlite3`.

#### `POST /api/system/databases/{filename}/duplicate` — **Corps :** `{ "new_name": "Maths_1AM_backup.sqlite" }`
#### `DELETE /api/system/databases/{filename}` — **Corps :** `{ "confirm": "{filename}" }` (double garde-fou, refus si un batch est RUNNING dessus).

#### `GET /api/system/settings` / `PUT /api/system/settings` *(Réglages à chaud)*
**GET → 200 :** `{ "settings": { "vec_distance_threshold": 0.45, "bm25_score_threshold": -0.3, "force_sqlite_vec": false } }`
**PUT Corps :** `{ "key": "vec_distance_threshold", "value": "0.5" }` — whitelist stricte de clés ; toute autre clé → HTTP 400.

#### `GET /api/library/benchmarks?db=…&document_id?&page=1&limit=50` *(Télémétrie Historique)*
**Réponse 200 (paginée §14) :** lignes `processing_benchmarks` + agrégats `{ "avg_latency_ms", "avg_confidence", "avg_ram_peak_mb", "vlm_usage_rate", "fallback_rate" }`.

#### `GET /api/system/engines` *(V3.4 — Registre des Moteurs)*
**Réponse 200 :** `{ "engines": [ { "id": "sci-engine", "label": "Moteur Scientifique", "version": "1.0.0", "accent": "#2563eb", "families_tier1": ["latex_formula", "data_table", "code_snippet", "…"], "status": "active" } ], "active_engine": "sci-engine" }` — source : manifestes `engine.json` scannés par `engine_registry`. Alimente le badge moteur de la Topbar et le token `--engine-accent` (§6.6).

#### Curriculum CRUD *(alimente D1-B)*
- `GET /api/curriculum/{terms|programs|assessments|links}?db=…`
- `POST /api/curriculum/{…}?db=…` — corps = colonnes de la table (tech_specs §1bis)
- `PUT /api/curriculum/{…}/{id}?db=…` / `DELETE /api/curriculum/{…}/{id}?db=…`
- Import structuré : `POST /api/curriculum/import?db=…` — corps JSON complet `{ terms, programs, assessments, links }` (remplace ou fusionne selon `"mode": "replace" | "merge"`).

---

## **PARTIE 8 : SYNTHÈSE & GARANTIES**

1. **Architecture Ciblée CPU :** Zéro OOM (Out Of Memory) sur les PDFs de grande taille. Queue séquentielle stricte : une page à la fois. Contrat Mémoire à Deux Paliers (plancher 250 Mo hors moteurs / pic ≤ MAX_RAM_MB, Cycle de Vie des Moteurs). Adaptée aux machines standards locales (HP ProBook 8-16 Go RAM).
2. **Contrôle Qualité Absolu :** Overlay Diff, Sync-Scroll, Validation Linters déterministes, Fallback VLM conditionnel et traçable.
3. **Agnosticisme Total :** Zéro biais académique ou domaine présupposé. L'UI s'adapte dynamiquement à ce que la base SQLite contient.
4. **Intégrité Logicielle :** Règle d'or de non-régression stricte. L'évolution se fait exclusivement par add-ons. Les bases SQLite sont versionnées via leur nom de fichier.
5. **Portabilité Maximale :** Chaque fichier .sqlite est 100% autonome et consommable par n'importe quelle plateforme (Web, Mobile, Desktop, No-Code).
6. **Résilience Opérationnelle :** Key Manager avec rotation automatique des clés API, fallback hiérarchique Cloud → Local, gestion des fichiers corrompus (INVALID_SOURCE) sans arrêt du backend.

---

## **PARTIE 9 : STUDIO DE VALIDATION FINAL (ÉTAT IMPLÉMENTÉ — 2026-08-22)**

### **9.1 Architecture et périmètres universels**

Le Studio ajoute une couche de validation isolée entre l'officiel et la décision humaine. Chaque run matérialise une baseline logique par `(document_id,page_number)` **et une copie SQLite physique** `validation_test_<run>.sqlite`, créée par `Connection.backup`, confinée à `DATABASES_DIR` et masquée des bases officielles. Le résolveur universel couvre la base entière (plusieurs livres), un document, une entrée TOC et ses alias métier `chapter/course/title`, une page, une plage ou une sélection explicite. Il valide ownership et bornes avant création du run.

Le routeur FastAPI est monté sous `/api/validation`. Il fournit prévisualisation du scope, création/liste/détail des runs, lecture et mise à jour des copies, snapshots logiques/restauration, diffs page et run, rapport auditable, rattachement des benchmarks, accept/reject/cancel au niveau run et gestion/diagnostic des profils embeddings. Pour un run multi-document, `document_id` désambiguïse les numéros de page identiques.

### **9.2 Isolation, snapshots, diff et publication**

`POST /runs/{id}/execute` résout chaque source PDF officielle, bloque explicitement si elle manque, puis purge/ré-exécute toutes les couches et persiste batches/jobs/scans/chunks/artefacts/benchmarks **dans la seule copie physique**. Après terminaison, `working_json` est rafraîchi depuis cette copie et les diffs comparent baseline/working avec empreintes SHA-256. Les états `CREATED/QUEUED/RUNNING/COMPLETED/BLOCKED/FAILED` et opération, batch(s), progression et erreur sont exposés par liste, détail et rapport.

L'acceptation est atomique et porte sur le **run entier** : verrou d'écriture, contrôle anti-concurrence par `baseline_hash`, protection des éditions humaines, contrôle de tous les propriétaires et liens cross-document, puis remplacement coordonné des pages. Le rejet est lui aussi au niveau run et ne publie rien. Il n'existe pas d'accept/reject page par page ; seule la restauration de copie peut cibler une page.

### **9.3 Schéma, curriculum et espace vectoriel**

Les migrations additives **005/006/007** apportent runs/pages/events/snapshots, provenance benchmark/artefact, profils embeddings, ownership curriculum par document, hash de baseline, unicité d'un job actif par page et cycle d'exécution physique (copie, opération, batchs, progression, erreur). Le curriculum devient sûr en multi-livres : terms, programs, assessments et links appartiennent explicitement à un document ; les données legacy ambiguës ne sont jamais backfillées au hasard.

L'espace vectoriel compatible est gelé sur le modèle FastEmbed multilingue MiniLM-L12-v2 en pooling **mean**, 384 dimensions normalisées. Le profil persistant inclut paramètres de préfixe, troncature, format, métrique et version de pipeline. Profil manquant ou incompatible, mélange de profils actifs et vecteurs de dimensions erronées sont refusés/diagnostiqués ; RAGDom ne réindexe jamais silencieusement.

### **9.4 UI, readonly et sécurité**

Le Studio est intégré à Automation : builder avec preview obligatoire, sélecteur de scope multi-base/multi-document, liste paginée, deep-link `db/run/document/page`, progression, inspecteur (chunks, artefacts, TOC, curriculum, benchmarks), diff, restauration et modale de confirmation avant acceptation. Le suivi interroge uniquement le run ouvert toutes les 5 secondes : **polling ciblé, pas de SSE Validation dédié**. Le flux SSE Pipeline reste indépendant.

En readonly, le frontend désactive les actions et le middleware masque toutes les routes `/api/validation` en 404. En mode administré, session ou Bearer est exigé. La sécurité complète inclut DTO stricts, nom de base sanitisé, validation de scope, ownership document/page, interdiction des références cross-document, protection `is_human_edited`, conflit optimiste et transaction unique de publication.

### **9.5 Limite honnête et état qualité**

La requalification mutante `POST /api/pipeline/requalify-artifacts` avec `run_id` est autorisée uniquement sur un run `COMPLETED` disposant de sa copie physique : l'API redirige alors la mutation vers `validation_test_<run>.sqlite` puis resynchronise `working_json`. Tout run non terminé ou copie absente retourne 409 ; l'officielle reste intouchable.

Preuves rejouées après exécution end-to-end : pytest **154/154** normal et **154/154** faible mémoire, Vitest **13/13**, build Vite **8.2.2**/TypeScript vert, React Router DOM **7.18.2**, `npm audit` **0 vulnérabilité**.
