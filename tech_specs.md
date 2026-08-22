# **SPÉCIFICATIONS TECHNIQUES D'IMPLÉMENTATION : RAGDom**

**Version :** 3.5 (Base Autonome — table page_scans, dimensions BBox, pedagogical_index : le .sqlite sert 100% de l'UI)

**Statut :** Contrat d'Interface Normatif pour Agentic Workflow

**Objectif :** Verrouiller les schémas de BDD, les contrats de données inter-couches, les paramètres RAG, le protocole agentique et les critères d'acceptation pour interdire toute improvisation lors du développement autonome. Ce fichier fait **autorité absolue** sur toute autre source.

---

## **1. SCHÉMA SQLITE COMPLET (DDL & INDEXES)**

L'agent doit utiliser **exclusivement** ce schéma. Zéro modification non autorisée. Le DDL est scindé en deux fichiers : `/backend/db/schema_core.sql` (appliqué TOUJOURS) et `/backend/db/schema_vec.sql` (appliqué uniquement si sqlite-vec est chargé — voir la Règle d'Application Conditionnelle avant la Table 8). Ensemble, ils doivent contenir exactement ce DDL.

```sql
-- ============================================================
-- TABLE 1 : Pipeline State Machine (Suivi des jobs)
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    status      TEXT CHECK(status IN (
                    'QUEUED',
                    'PROCESSING_CV',
                    'SEGMENTING',
                    'EXTRACTING',
                    'LINTING',
                    'VLM_RECOVERY',
                    'INDEXED',
                    'READY',
                    'QUARANTINE',
                    'INVALID_SOURCE'
                )) DEFAULT 'QUEUED',
    batch_id    TEXT REFERENCES ingestion_batches(id),   -- V3.1
    retry_count INTEGER DEFAULT 0,
    error_log   TEXT,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_jobs_status      ON pipeline_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_document_id ON pipeline_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_jobs_batch_id    ON pipeline_jobs(batch_id);

-- ============================================================
-- TABLE 1bis : Batches d'Ingestion (V3.1 — granularité job/batch)
-- ============================================================
CREATE TABLE IF NOT EXISTS ingestion_batches (
    id           TEXT PRIMARY KEY,
    source_path  TEXT NOT NULL,
    target_db    TEXT,
    mode         TEXT CHECK(mode IN ('document','chapter','page_range','folder')) NOT NULL,
    page_start   INTEGER,
    page_end     INTEGER,
    status       TEXT CHECK(status IN ('QUEUED','RUNNING','COMPLETED','STOPPED','FAILED')) DEFAULT 'QUEUED',
    pages_total  INTEGER,
    pages_done   INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TABLE 2 : Documents Sources
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
    id               TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    filename         TEXT NOT NULL,
    source_path      TEXT NOT NULL,   -- Chemin ABSOLU du PDF source ex: /chemin/absolu/sources/Maths/1AM/manuel.pdf
    total_pages      INTEGER NOT NULL,
    file_size_bytes  INTEGER,
    doc_type         TEXT DEFAULT 'unknown',
    doc_source       TEXT DEFAULT 'unknown',  -- Chemin RELATIF depuis /sources/ ex: "Maths/1AM"
    academic_level   TEXT,
    domain_tags_json TEXT,   -- Tableau JSON auto-généré depuis l'arborescence /sources/ ex: ["Maths", "1AM"]
    metadata_json    TEXT,   -- Métadonnées complémentaires libres (auteur, ISBN, année...)
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type   ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_doc_source ON documents(doc_source);

-- ============================================================
-- TABLE 3 : Index / TOC Reconstruit
-- ============================================================
CREATE TABLE IF NOT EXISTS document_toc (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    parent_id   TEXT,
    level       INTEGER NOT NULL,   -- 1=Chapitre, 2=Section, 3=Sous-section
    title       TEXT NOT NULL,
    page_start  INTEGER NOT NULL,
    page_end    INTEGER,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id)   REFERENCES document_toc(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_toc_document_id ON document_toc(document_id);
CREATE INDEX IF NOT EXISTS idx_toc_parent_id   ON document_toc(parent_id);

-- ============================================================
-- TABLE 4 : Chunks Texte (Typage élastique)
-- ============================================================
CREATE TABLE IF NOT EXISTS document_chunks (
    id                       TEXT PRIMARY KEY,
    document_id              TEXT NOT NULL,
    toc_id                   TEXT,
    page_number              INTEGER NOT NULL,
    chunk_index              INTEGER NOT NULL,
    section_title            TEXT,
    content_markdown         TEXT NOT NULL,
    pedagogical_type         TEXT CHECK(pedagogical_type IN (
                                 'course_theory',
                                 'proof_demonstration',
                                 'exercise_unsolved',
                                 'exercise_solved',
                                 'solution_only',
                                 'evaluation_exam',
                                 'practical_work',
                                 'general_content'
                             )) DEFAULT NULL,
    has_solution             INTEGER DEFAULT 0,  -- 0 = non, 1 = oui
    linked_solution_chunk_id TEXT,               -- FK auto-référentielle
    is_human_edited          INTEGER DEFAULT 0,  -- V3.2 : corrigé manuellement — protégé des purges (preserve_human_edits) et des ré-ingestions
    pedagogical_index        INTEGER,            -- V3.5 : numéro extrait (Exercice N°, leçon N…) — affiché en badge par la Vue 2, utilisé par SolutionLinker
    updated_at               DATETIME,           -- V3.5 : dernière correction humaine (badge « corrigé le… »)
    embedding_vector         BLOB,               -- Float32Array pour sqlite-vec (dim=384)
    token_count              INTEGER,
    created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id)              REFERENCES documents(id)       ON DELETE CASCADE,
    FOREIGN KEY (toc_id)                   REFERENCES document_toc(id)    ON DELETE SET NULL,
    FOREIGN KEY (linked_solution_chunk_id) REFERENCES document_chunks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id     ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_page_number     ON document_chunks(page_number);
CREATE INDEX IF NOT EXISTS idx_chunks_pedagogical     ON document_chunks(pedagogical_type);
CREATE INDEX IF NOT EXISTS idx_chunks_has_solution    ON document_chunks(has_solution);

-- ============================================================
-- TABLE 5 : Artefacts Multimodaux (25 Familles)
-- ============================================================
CREATE TABLE IF NOT EXISTS scientific_artifacts (
    id                 TEXT PRIMARY KEY,
    document_id        TEXT NOT NULL,
    chunk_id           TEXT,
    page_number        INTEGER NOT NULL,
    domain             TEXT NOT NULL,         -- ex: "math", "chemistry", "biology"
    artifact_type      TEXT NOT NULL,         -- ex: "latex_formula", "smiles_chem"
    raw_data           TEXT,                  -- Payload textuel (LaTeX, SVG, SMILES...)
    raw_binary         BLOB,                  -- Payload binaire (WebP, glTF...)
    render_config_json TEXT,                  -- Config du renderer frontend ex: {"renderer":"katex"}
    caption            TEXT,                  -- Légende/description textuelle
    searchable_text    TEXT NOT NULL,         -- Texte indexable FTS5 (caption + raw_data simplifié)
    bounding_box_json  TEXT,                  -- {"x0":120,"y0":340,"x1":280,"y1":370} coordonnées 300 DPI
    is_human_edited    INTEGER DEFAULT 0,     -- V3.2 : corrigé/importé manuellement — protégé des purges et ré-ingestions
    updated_at         DATETIME,              -- V3.5 : dernière correction/import manuel
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(id)        ON DELETE CASCADE,
    FOREIGN KEY (chunk_id)    REFERENCES document_chunks(id)  ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_document_id  ON scientific_artifacts(document_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_domain       ON scientific_artifacts(domain);
CREATE INDEX IF NOT EXISTS idx_artifacts_type         ON scientific_artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifacts_chunk_id     ON scientific_artifacts(chunk_id);

-- ============================================================
-- TABLE 5bis : Scans de Pages (V3.5 — Base Autonome)
-- LA table qui rend le .sqlite réellement portable : l'image WebP
-- restaurée par la Couche 0 est persistée ici par la Couche 7
-- (le checkpoint /pipeline-set/ est ensuite purgé). Sans elle,
-- l'UI devrait relire /sources/ ou /pipeline-set/ — interdit.
-- ============================================================
CREATE TABLE IF NOT EXISTS page_scans (
    id           TEXT PRIMARY KEY,
    document_id  TEXT NOT NULL,
    page_number  INTEGER NOT NULL,
    width_px     INTEGER NOT NULL,       -- dimensions du scan 300 DPI
    height_px    INTEGER NOT NULL,       -- (base de la conversion BBox → CSS %)
    dpi          INTEGER DEFAULT 300,
    image_webp   BLOB NOT NULL,          -- scan pleine résolution (rendu, overlay diff, modale HD)
    thumb_webp   BLOB,                   -- vignette ~256px (galeries virtualisées, previews)
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (document_id, page_number),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scans_document_id ON page_scans(document_id);
CREATE INDEX IF NOT EXISTS idx_scans_page        ON page_scans(document_id, page_number);

-- ============================================================
-- TABLE 6 : Métrologie & Télémétrie
-- ============================================================
CREATE TABLE IF NOT EXISTS processing_benchmarks (
    id                  TEXT PRIMARY KEY,
    document_id         TEXT NOT NULL,
    page_number         INTEGER NOT NULL,
    engine_used         TEXT NOT NULL,          -- ex: "RapidOCR", "rapid-latex-ocr", "PyMuPDF4LLM"
    vlm_provider_used   TEXT,                   -- ex: "gemini-1.5-flash", "ollama/llama3", null
    fallback_triggered  INTEGER DEFAULT 0,      -- 0=non, 1=oui (fallback vers provider suivant)
    linter_errors_json  TEXT,                   -- Tableau JSON des erreurs de linter détectées
    execution_time_ms   INTEGER NOT NULL,
    ram_peak_mb         REAL,
    confidence_score    REAL,                   -- Score de confiance global (0.0 à 1.0)
    blur_score          REAL,                   -- Variance du Laplacien (qualité image)
    deskew_angle        REAL,                   -- Angle de correction appliqué en degrés
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bench_document_id ON processing_benchmarks(document_id);
CREATE INDEX IF NOT EXISTS idx_bench_page_number ON processing_benchmarks(page_number);

-- ============================================================
-- TABLE 7 : Index de Recherche Hybride (FTS5)
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    chunk_id        UNINDEXED,
    artifact_id     UNINDEXED,
    document_id     UNINDEXED,
    page_number     UNINDEXED,
    title,
    section_title,
    pedagogical_type,
    search_content,
    tokenize = 'unicode61 remove_diacritics 2'  -- V3.1 : porter (anglais) retiré ; diacritiques AR/latin normalisés
);

-- ============================================================
-- TRIGGER 1 : Synchronisation FTS5 à l'insertion de chunks
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_chunks_fts_sync
AFTER INSERT ON document_chunks
BEGIN
    INSERT INTO search_index (
        chunk_id, artifact_id, document_id, page_number,
        title, section_title, pedagogical_type, search_content
    ) VALUES (
        new.id,
        NULL,
        new.document_id,
        new.page_number,
        (SELECT title FROM documents WHERE id = new.document_id),
        new.section_title,
        COALESCE(new.pedagogical_type, 'none'),
        new.content_markdown
    );
END;

-- ============================================================
-- TRIGGER 2 : Synchronisation FTS5 à l'insertion d'artefacts
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_artifacts_fts_sync
AFTER INSERT ON scientific_artifacts
BEGIN
    INSERT INTO search_index (
        chunk_id, artifact_id, document_id, page_number,
        title, section_title, pedagogical_type, search_content
    ) VALUES (
        new.chunk_id,
        new.id,
        new.document_id,
        new.page_number,
        (SELECT title FROM documents WHERE id = new.document_id),
        new.caption,
        COALESCE(
            (SELECT pedagogical_type FROM document_chunks WHERE id = new.chunk_id),
            'none'
        ),
        new.searchable_text || ' ' || COALESCE(new.raw_data, '')
    );
END;

-- ============================================================
-- TRIGGERS 3-5 : Cohérence FTS5 — DELETE / UPDATE (V3.1)
-- (corrige les entrées fantômes après /api/pipeline/reset)
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_chunks_fts_delete
AFTER DELETE ON document_chunks
BEGIN
    DELETE FROM search_index WHERE chunk_id = old.id AND artifact_id IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS trg_artifacts_fts_delete
AFTER DELETE ON scientific_artifacts
BEGIN
    DELETE FROM search_index WHERE artifact_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_chunks_fts_update
AFTER UPDATE OF content_markdown, section_title, pedagogical_type ON document_chunks
BEGIN
    DELETE FROM search_index WHERE chunk_id = old.id AND artifact_id IS NULL;
    INSERT INTO search_index (
        chunk_id, artifact_id, document_id, page_number,
        title, section_title, pedagogical_type, search_content
    ) VALUES (
        new.id, NULL, new.document_id, new.page_number,
        (SELECT title FROM documents WHERE id = new.document_id),
        new.section_title, COALESCE(new.pedagogical_type, 'none'), new.content_markdown
    );
END;

-- ============================================================
-- ⚠️ RÈGLE D'APPLICATION CONDITIONNELLE (V3.1 — D.O.D Fallback Vectoriel)
-- Frontière schema_core.sql / schema_vec.sql :
--   • schema_core.sql = TOUTES les tables et triggers de ce DDL,
--     SAUF la Table 8 (vec_chunks) et les triggers trg_chunks_vec_*.
--     Appliqué TOUJOURS, quel que soit l'état de sqlite-vec.
--   • schema_vec.sql  = Table 8 (vec_chunks) + trg_chunks_vec_sync
--     + trg_chunks_vec_delete. Appliqué UNIQUEMENT si
--     init_vector_support() retourne "sqlite-vec".
-- En mode fallback :
--   (a) vec_chunks et ses triggers ne sont PAS créés ;
--   (b) une base créée en mode hybride puis rouverte SANS l'extension
--       déclenche à la connexion : DROP TRIGGER IF EXISTS
--       trg_chunks_vec_sync; DROP TRIGGER IF EXISTS trg_chunks_vec_delete;
--       + WARN consigné. Les embeddings BLOB restent dans document_chunks ;
--   (c) le retour au mode hybride recrée table + triggers et re-remplit
--       vec_chunks depuis embedding_vector en une passe.
-- ============================================================
-- ============================================================
-- TABLE 8 : Recherche Vectorielle (sqlite-vec)
-- ============================================================
-- PRÉREQUIS : charger l'extension sqlite-vec avant de créer cette table :
--   import sqlite_vec; sqlite_vec.load(conn)
CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
    chunk_id  TEXT PRIMARY KEY,
    embedding float[384]          -- Float32, normalisé L2, dimensions = 384
);

-- ============================================================
-- TRIGGER vec-1 : Synchronisation vec_chunks à l'insertion de chunks
-- (Ne s'active que si embedding_vector est non NULL)
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_chunks_vec_sync
AFTER INSERT ON document_chunks
WHEN new.embedding_vector IS NOT NULL
BEGIN
    INSERT INTO vec_chunks (chunk_id, embedding)
    VALUES (new.id, new.embedding_vector);
END;

-- ============================================================
-- TRIGGER vec (V3.1) : Cohérence vec_chunks à la suppression
-- (fait partie de schema_vec.sql — voir Règle Conditionnelle)
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_chunks_vec_delete
AFTER DELETE ON document_chunks
BEGIN
    DELETE FROM vec_chunks WHERE chunk_id = old.id;
END;

-- ============================================================
-- TABLES CURRICULUM (OPTIONNELLES — V3.1, D1-B)
-- Peuvent rester vides : une base non pédagogique est 100% valide.
-- Vides => la Vue 2 bascule en Mode Repli Générique.
-- ============================================================
CREATE TABLE IF NOT EXISTS curriculum_terms (
    id            TEXT PRIMARY KEY,
    term_index    INTEGER NOT NULL,        -- 1, 2, 3
    label         TEXT NOT NULL,           -- ex: 'الفصل الأول'
    metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS curriculum_programs (
    id                TEXT PRIMARY KEY,
    term_id           TEXT REFERENCES curriculum_terms(id) ON DELETE SET NULL,
    seq_index         INTEGER,             -- numéro de مقطع / séquence
    title             TEXT NOT NULL,
    source            TEXT,                -- ex: 'MEN 2G'
    competencies_json TEXT                 -- ressources & compétences visées
);

CREATE TABLE IF NOT EXISTS assessments (
    id                  TEXT PRIMARY KEY,
    document_id         TEXT REFERENCES documents(id) ON DELETE CASCADE,
    term_id             TEXT REFERENCES curriculum_terms(id) ON DELETE SET NULL,
    kind                TEXT CHECK(kind IN ('devoir','composition','examen','autre')) DEFAULT 'autre',
    title               TEXT NOT NULL,
    subject_chunk_id    TEXT REFERENCES document_chunks(id) ON DELETE SET NULL,
    correction_chunk_id TEXT REFERENCES document_chunks(id) ON DELETE SET NULL,
    scale_json          TEXT               -- barème
);

CREATE TABLE IF NOT EXISTS content_links (
    id            TEXT PRIMARY KEY,
    link_type     TEXT CHECK(link_type IN ('course_exercise','course_program','course_scan','exercise_scan','assessment_scan','program_term')) NOT NULL,
    from_id       TEXT NOT NULL,           -- id source (chunk/toc/program/assessment)
    to_id         TEXT NOT NULL,           -- id cible
    page_number   INTEGER,
    metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_links_type ON content_links(link_type);
CREATE INDEX IF NOT EXISTS idx_links_from ON content_links(from_id);
CREATE INDEX IF NOT EXISTS idx_links_to   ON content_links(to_id);

-- ============================================================
-- TABLE 9 : Versioning du Schéma (Migration)
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);
-- Insertion de la version initiale (à exécuter une seule fois à la création)
INSERT OR IGNORE INTO schema_version (version, description)
VALUES (4, 'Schema RAGDom V3.5 — page_scans (Base Autonome) + pedagogical_index + updated_at');
-- Historique migrations : migration_003_v32.sql (is_human_edited ×2),
-- migration_004_v35.sql (CREATE page_scans ; ALTER document_chunks ADD pedagogical_index, updated_at ;
--                        ALTER scientific_artifacts ADD updated_at ; backfill des scans par ré-ingestion Couche 0+7 seule).
-- Bases V3.0 existantes : appliquer /backend/db/migrations/migration_002_v31.sql
-- (ALTER pipeline_jobs ADD batch_id ; CREATE ingestion_batches + curriculum_* ;
--  triggers delete/update ; reconstruction de search_index avec le tokenizer V3.1).
```

---

## **2. CONTRATS DE DONNÉES DU PIPELINE (INPUTS/OUTPUTS)**

L'agent ne doit **pas inventer** de structures DTO/JSON. Chaque couche du pipeline interagit **exclusivement** via ces interfaces strictes en RAM (jamais de fichiers intermédiaires sauf dans `/pipeline-set/` pour les checkpoints de reprise).

### **2.1 Couche 0 → Couche 1 : RestorationResult**

```json
{
  "page_id": "uuid-de-la-page",
  "document_id": "uuid-du-document",
  "page_number": 12,
  "status": "SUCCESS | FAILED | INVALID_SOURCE",
  "blur_variance": 142.5,
  "deskew_angle": -1.2,
  "is_native_vector": true,
  "width_px": 2480,
  "height_px": 3508,
  "restored_image_ptr": "memory://0x7f3a2b1c",
  "cv_latency_ms": 110
}
```

**Règles :**
- Si `status == "INVALID_SOURCE"` → Le pipeline s'arrête pour ce document, met à jour `pipeline_jobs.status = 'INVALID_SOURCE'`, et passe au document suivant dans la queue.
- Si `status == "FAILED"` → Incrémente `retry_count`. Si `retry_count >= 3` → passe à `QUARANTINE`.
- `restored_image_ptr` est un pointeur mémoire natif (PyMuPDF Pixmap). Ne jamais le sérialiser sur disque.
- **(V3.5)** `width_px`/`height_px` sont les dimensions du scan restauré 300 DPI : la Couche 7 les persiste dans `page_scans` avec l'encodage WebP du Pixmap (`image_webp`) et sa vignette (`thumb_webp`) — c'est la source unique des dimensions pour la conversion BBox → CSS %.

### **2.2 Couche 1 → Couche 2 : TriageResult (BBoxes)**

```json
{
  "page_id": "uuid-de-la-page",
  "is_native_vector": true,
  "toc_entries": [
    {
      "level": 1,
      "title": "Chapitre 2 : Analyse",
      "page_start": 45,
      "page_end": 90
    }
  ],
  "layout_blocks": [
    {
      "block_id": "b_01",
      "type": "text | table | formula | chart | molecule | code | map | music | image",
      "bbox": [120, 340, 680, 420],
      "crop_ptr": "memory://0x7f3a2b2d",
      "confidence": 0.96
    },
    {
      "block_id": "b_02",
      "type": "formula",
      "bbox": [200, 450, 450, 490],
      "crop_ptr": "memory://0x7f3a2c10",
      "confidence": 0.91
    }
  ],
  "triage_latency_ms": 85
}
```

### **2.3 Couche 2 & 3 → Couche 4 : ExtractionAndQualificationResult**

```json
{
  "page_id": "uuid-de-la-page",
  "content_markdown": "## Titre de Section\nTexte brut extrait...",
  "pedagogical_type": "exercise_unsolved | course_theory | ...",
  "pedagogical_index": 14,
  "has_solution": 0,
  "linked_solution_chunk_id": null,
  "token_count": 387,
  "artifacts": [
    {
      "block_id_ref": "b_01",
      "domain": "chemistry",
      "artifact_type": "smiles_chem",
      "raw_data": "C1=CC=CC=C1",
      "raw_binary": null,
      "render_config_json": "{\"renderer\": \"ketcher\"}",
      "caption": "Molécule de benzène",
      "searchable_text": "benzene C1=CC=CC=C1 chimie organique",
      "bounding_box_json": "{\"x0\": 120, \"y0\": 340, \"x1\": 280, \"y1\": 420}"
    }
  ],
  "extraction_latency_ms": 340
}
```

### **2.4 Couche 4 → Couche 5 : ValidationResult (Linter)**

```json
{
  "page_id": "uuid-de-la-page",
  "is_valid": false,
  "errors": [
    {
      "block_id_ref": "b_01",
      "error_type": "UNBALANCED_LATEX | MALFORMED_SVG | INVALID_TABLE_DIMENSIONS | UNICODE_NOISE | INVALID_SMILES",
      "details": "Missing \\end{matrix} at position 45",
      "severity": "ERROR | WARNING"
    }
  ],
  "lint_latency_ms": 3
}
```

**Règle :** Si `is_valid == true` → on saute directement la Couche 5 (VLM non invoqué, économie de quota). Si `is_valid == false` ET `errors` contient uniquement des `WARNING` → le chunk est persisté avec un flag `linter_errors_json` renseigné mais sans VLM recovery. VLM recovery uniquement pour les `ERROR`.

### **2.5 Couche 5 → Couche 6 : VLMResult**

```json
{
  "page_id": "uuid-de-la-page",
  "block_id_ref": "b_01",
  "repaired_content": "$E = mc^2$",
  "provider_used": "gemini-1.5-flash",
  "fallback_triggered": false,
  "vlm_latency_ms": 1200
}
```

---

## **3. SPÉCIFICATIONS RAG (RETRIEVAL & EMBEDDINGS)**

Les paramètres de découpage et de recherche doivent être implémentés **exactement** comme suit. Zéro improvisation autorisée.

### **3.1 Stratégie de Chunking**

* **Max Token Size :** 512 tokens (via `tiktoken` cl100k_base ou équivalent).
* **Overlap :** 15% (environ 75 tokens de chevauchement entre chunks consécutifs).
* **Séparateurs de priorité (ordre décroissant) :**
  1. `\n## ` (Titres H2 Markdown)
  2. `\n### ` (Titres H3 Markdown)
  3. `\n\n` (Paragraphes)
  4. `\n` (Lignes)
  5. ` ` (Mots — uniquement en dernier recours)
* **Règle de préservation :** Un bloc d'artefact (formule LaTeX, tableau, SVG) ne doit **jamais** être coupé à mi-chemin par un seuil de token. Il est toujours inclus en entier dans un chunk, même si cela dépasse légèrement le max token size.

### **3.2 Modèle d'Embedding**

* **Modèle imposé (V3.1.1 — vérifié fastembed 2026-08-21) :** `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (384 dimensions — schéma inchangé) via **fastembed** (ONNX Runtime, zéro dépendance PyTorch). Couverture multilingue arabe/français/anglais — indispensable pour un corpus à priorité arabe. Aucun préfixe de requête requis.
* **Fallback (dernier recours) :** `sentence-transformers/all-MiniLM-L6-v2` (384d, dans fastembed — anglophone : dégradation qualité assumée, WARN loggé).
* **Note de vérification :** `intfloat/multilingual-e5-small` (candidat initial V3.1) est REJETÉ — non supporté par fastembed (0.7.x et 0.8.0 vérifiés) ; `multilingual-e5-large` (supporté) est en 1024d, incompatible avec le schéma `float[384]` de `vec_chunks`.
* **Retiré (V3.1) :** sentence-transformers et `bge-small-en-v1.5` (dépendance PyTorch + modèle anglophone inadapté au corpus arabe).
* **Dimensions de vecteur :** 384. Sérialisation en `BLOB` `Float32Array` (little-endian) pour `sqlite-vec`.
* **Normalisation :** Les vecteurs sont normalisés (norme L2 = 1.0) avant stockage.
* **Batch size :** 1 (traitement unitaire, conformément à la queue séquentielle).

### **3.3 Reciprocal Rank Fusion (RRF) & Retrieval**

* **Top-K extraction :** K=20 (pré-filtre FTS5 et K=20 voisins vectoriels) → K=5 résultats finaux après RRF.
* **Formule RRF mathématique :**
  ```
  Score_RRF(chunk) = 1 / (60 + Rank_BM25) + 1 / (60 + Rank_Vec)
  ```
  Où `Rank_BM25` est le rang dans les résultats FTS5 et `Rank_Vec` est le rang dans les résultats sqlite-vec.
* **Seuil de pertinence (Anti-Hallucination — V3.1, scores bruts non-ordinaux) :** le RRF ordonne mais ne filtre pas (un rang 1 passe toujours, même sémantiquement nul). Un chunk n'est éligible que si (distance cosinus sqlite-vec ≤ 0.45) OU (score `bm25(search_index)` ≤ -0.3 — score négatif SQLite = pertinent ; calibré en conditions réelles Phase 2 : un match significatif vaut ≤ -0.3, -1.5 rejetait les corpus courts, tri `ORDER BY bm25(...) ASC`, plus petit = meilleur). Si aucun chunk n'est éligible, l'agent IA répond obligatoirement : *"Je ne trouve pas d'informations pertinentes dans la bibliothèque actuelle."* En mode `fts5-fallback`, seul le critère BM25 s'applique. Les deux seuils sont stockés dans `app_settings` (`ragdom_config.sqlite`) et ajustables sans redéploiement.

### **3.3.1 Stratégie de Résilience Vectorielle & Mode Strict (Arbitrage Windows / R&D)**

Afin de garantir une résilience maximale sous tous les environnements hôtes (Windows, Linux, macOS) sans compromettre la rigueur du système :

1. **Mode Résilient (Option B — Défaut R&D) :**
   * Au démarrage de chaque connexion SQLite, le module `db/connection.py` tente le chargement dynamique de l'extension binaire : `sqlite_vec.load(conn)`.
   * **En cas de succès :** Le moteur tourne en mode **Hybride Complet** (`vector_engine = "sqlite-vec"`, status `"ready"`). Les requêtes exploitent la formule RRF bidirectionnelle (FTS5 BM25 + sqlite-vec).
   * **En cas d'échec de chargement (DLL manquante ou incompatible) :** 
     - Le backend bascule **automatiquement et de manière non-bloquante** en mode dégradé **FTS5 BM25 Pur** (`vector_engine = "fts5-fallback"`, status `"fallback_bm25_only"`).
     - La formule RRF s'adapte sans crash : `Score_RRF(chunk) = 1 / (60 + Rank_BM25)`.
     - L'événement est consigné dans les logs avec un avertissement explicite : `[WARN] sqlite-vec non disponible. Bascule en mode dégradé FTS5 BM25.`.

2. **Mode Strict Forcé (Option A Forcée — Directive ArchiSys3.0) :**
   * Contrôlé via la variable d'environnement `RAGDOM_FORCE_SQLITE_VEC=true` (dans `.env`) ou le paramètre `force_sqlite_vec = 'true'` dans `ragdom_config.sqlite` (table `app_settings`).
   * Lorsque `force_sqlite_vec == true`, tout échec de chargement de `sqlite_vec` lève une **exception fatale** `RuntimeError("Échec critique : sqlite-vec non chargeable alors que le mode strict est forcé.")` et bloque le démarrage du serveur ou l'exécution du job d'ingestion.

3. **Télémétrie, Alerte & Commutation UI/UX (Automation Hub) :**
   * L'endpoint `GET /api/system/health` retourne l'état détaillé :
     ```json
     {
       "status": "ok",
       "version": "3.5",
       "queue_length": 0,
       "vector_engine": "sqlite-vec | fts5-fallback",
       "vector_engine_status": "ready | fallback_bm25_only | error",
       "vector_engine_message": "Moteur hybride opérationnel (FTS5 + sqlite-vec 384d)" 
     }
     ```
   * **Dans l'UI Automation Hub :**
     - Si le moteur est en mode dégradé, un **Bandeau d'Alerte Jaune/Orange** persistant s'affiche en tête de page : 
       `⚠️ Alerte Moteur : Mode dégradé FTS5 BM25 actif (sqlite-vec non chargé). Recherche sémantique vectorielle désactivée.`
     - Un **Switch Toggle interactif** *"Forcer le mode strict sqlite-vec"* permet à ArchiSys3.0 d'activer/désactiver le mode strict directement depuis l'UI via `POST /api/system/vector-engine/toggle-strict`.
     - Un bouton *"Tester le chargement de sqlite-vec"* permet de retester la DLL à chaud sans redémarrer le serveur.

### **3.4 Construction du Contexte (Prompting LLM)**

* Le contexte injecté au LLM doit inclure les métadonnées de provenance avec ce format exact :

```
[Doc: {title} | Page: {page_number} | Section: {section_title} | Type: {pedagogical_type}]
{content_markdown}
```

* Les artefacts liés au chunk sont injectés après le texte sous forme de description textuelle (ex: `[Artefact: latex_formula] $E = mc^2$`).

### **3.5 Recherche Multi-Bases**

* Lorsqu'une recherche cible plusieurs bases SQLite, l'orchestrateur effectue des requêtes **parallèles** sur chaque base (connexions indépendantes, threads séparés) et agrège les résultats via une seconde passe de RRF globale.
* Chaque résultat conserve la trace de la base source (`database_filename`).

### **3.6 Ingestion & Traitement des Documents Mixtes (Arabe + FR/EN)**

* **Ingestion OCR Multi-Scripts (Couche 2) :** RapidOCR et les pipelines de segmentation sont configurés pour reconnaître les documents bilingues/mixtes (arabe littéraire + variables/symboles/formules en alphabet latin ou grec).
* **Indexation FTS5 Bilingue (V3.1) :** Le tokenizer `unicode61 remove_diacritics 2` indexe sans perte les tokens arabes (diacritiques normalisés nativement par le tokenizer) et les termes techniques ou formules latines dans la même table virtuelle `search_index`.
* **Préservation BiDi des Actifs :** Lors de l'extraction, les formules LaTeX (`$ ... $` et `$$ ... $$`), les noms chimiques, les codes et les tableaux contenant des symboles scientifiques sont étiquetés pour un rendu strict en `LTR` côté Frontend via `direction: ltr !important; unicode-bidi: isolate !important;`, évitant toute corruption d'ordre de lecture dans un flux RTL.

### **3.6.1 OCR VLM de Page Entière (Tier 2, contrat D3-B étendu) — (MAJ 2026-08-22)**

Extension du contrat D3-B : au-delà de la réparation VLM par bloc (Couche 5), la Couche 2 (`engines/sci-engine/pipeline/layer_2_extract.py`) sait transcrire une **page entière** par le VLM lorsque l'extraction Tier 1 est illisible. Référence code : `layer_2_extract._maybe_vlm_page_ocr`.

* **Déclenchement :**
  * **Pages scannées (non natives) :** OCR VLM systématiquement tenté (RapidOCR sans modèle adapté = repli hors-ligne).
  * **Pages natives vectorielles :** OCR VLM tenté **uniquement** si le texte extrait est jugé illisible par une **gate qualité générique** (`_looks_unreadable`) — cas des polices non-Unicode (glyphes privés) qui produisent du texte extrait mais inexploitable. La gate ne se déclenche jamais sur du texte arabe/latin sain (détection : longueur, ratio de tokens ultra-courts, mots longs sans voyelles, seuil arabe ≥ 0.3 = lisible).
* **Sortie :** transcription **Markdown fidèle + LaTeX** (`$...$` / `$$...$$`), titres `##/###`, texte arabe exact (RTL préservé), tableaux Markdown, numéros d'exercices conservés (prompt `_VLM_OCR_PROMPT`).
* **Provider vision :** appel `llm.key_manager.generate(prompt, image_b64=...)` — le noyau gère la **rotation de clés/providers** (priorité croissante, 429/403 → clé suivante, 401 → désactivation, 5xx → backoff). Le provider retenu est tracé dans `ctx["vlm"]["page_ocr_provider"]`. Aucun provider joignable → `None` : **repli sur le Tier 1**, le pipeline ne s'arrête jamais.
* **Repli hors-ligne :** RapidOCR (modèles PP-OCRv4 embarqués dans le paquet) reste le premier extracteur des scans ; le VLM ne fait que le **surclasser** quand il répond.
* **Flag :** `RAGDOM_VLM_PAGE_OCR` — `auto` (défaut : comportement ci-dessus) | `false` (désactive totalement l'OCR VLM de page → Tier 1 seul). Le moteur retenu est reporté dans `engine_used` (`VLM-OCR` en cas de succès).

---

## **4. PROTOCOLE DES AGENTS & HANDOFFS**

### **4.1 PipelineOrchestrator**

* **Rôle :** Gère la file d'attente séquentielle stricte (une page à la fois). Lit et écrit les états dans `pipeline_jobs`. Ne fait aucun traitement métier lui-même. *(V3.4 : il vit dans `/backend/core/` et invoque les couches du moteur actif résolu par `engine_registry` — voir §4.6.)*
* **Boucle principale :**
  1. `SELECT * FROM pipeline_jobs WHERE status = 'QUEUED' ORDER BY rowid LIMIT 1`
  2. Met à jour `status = 'PROCESSING_CV'`
  3. Passe le contrôle à `VisionWorker`
  4. Reçoit le résultat final, met à jour `status = 'READY'`
* **Handoff sur erreur :** Si exception catchée à n'importe quelle couche → `status = 'QUARANTINE'`, incrémente `retry_count`. Si `retry_count >= 3` → `status = 'QUARANTINE'` définitif (pas de retry infini). Si PDF invalide → `status = 'INVALID_SOURCE'` (pas de retry).
* **Max retries :** 3 tentatives avant mise en quarantaine définitive.

### **4.2 VisionWorker**

* **Rôle :** Reçoit un `memory://ptr` (PyMuPDF Pixmap), exécute les modèles ONNX (rapid-layout, RapidOCR, rapid-latex-ocr, rapid-table...), retourne un `ExtractionAndQualificationResult`.
* **Contrainte absolue :** Zéro accès direct à la base de données SQLite. Le VisionWorker est pur : entrée = pointeur mémoire, sortie = JSON struct.
* **Nettoyage mémoire :** Après chaque page, appel obligatoire à `del pixmap; gc.collect(); fitz.TOOLS.clear_cache()`.

### **4.3 FallbackVLMAgent (Key Manager)**

* **Déclenchement :** Invoqué **uniquement** si `ValidationResult.is_valid == false` ET `errors` contient au moins un `ERROR` de sévérité.
* **Action :** Envoie le `crop_ptr` (image base64 du bloc problématique) au VLM avec un prompt correctif strict.
* **Prompt correctif type :**
  ```
  Tu es un extracteur LaTeX expert. L'OCR a produit ce contenu invalide :
  [CONTENU BRUT]
  Corrige-le et retourne UNIQUEMENT le LaTeX valide, sans explication.
  ```
* **Gestion des clés :** Rotation automatique sur erreur 429/403. Désactivation sur 401. Backoff exponentiel sur 500/503/504. Fallback final sur Ollama local.
* **Timeout :** 30 secondes maximum par appel VLM. Au-delà → log WARNING, le bloc est persisté avec le contenu brut non corrigé.

---

### **4.4 SolutionLinker (Couche 3bis — passe de réconciliation post-document, V3.1)**

* **Déclenchement :** une fois TOUTES les pages du document au statut `READY` (fin de batch), avant l'événement SSE `job_complete`.
* **Rôle :** requête sur les chunks `solution_only` du document, appariement avec les `exercise_unsolved` par (numéro d'exercice extrait par regex FR/AR/EN + proximité TOC), puis écriture de `linked_solution_chunk_id` et `has_solution = 1` en une transaction unique. Peuple également `content_links` (course_exercise, assessment_*) si les tables curriculum sont actives.
* **Justification :** le séquentiel strict persiste page par page ; un corrigé en fin de manuel ne peut pas être lié au fil de l'eau.
* **Contrainte :** zéro accès VLM — appariement purement algorithmique (regex + TOC). Ambiguïtés consignées dans `linter_errors_json` du benchmark de la page concernée.

### **4.5 Purge Scopée & Correction Humaine (V3.2)**

**Purge Scopée (`POST /api/pipeline/purge`, contrat : Blueprint §7.6) :**
* Portées, du plus fin au plus large : `page` → `page_range` → `chapter` (sous-arbre TOC complet, `toc_id` + descendants) → `document` → `database` → transverses : `artifacts_only`, `curriculum_only`.
* **`dry_run: true` obligatoire en premier appel côté UI** : exécute les mêmes requêtes en `SELECT COUNT(*)` et retourne l'impact exact sans modification. L'exécution réelle utilise une transaction unique ; les triggers DELETE (§1) garantissent zéro entrée fantôme dans `search_index` et `vec_chunks`. Les lignes `page_scans` du périmètre sont supprimées dans la même transaction (V3.5).
* **`preserve_human_edits` (défaut `true`) :** les lignes `is_human_edited = 1` sont exclues de la purge et comptées dans `preserved_human_edited`. Exception : `scope = database` supprime tout (le garde-fou `confirm` protège).
* Après purge, les `pipeline_jobs` du périmètre repassent à l'état supprimé (ré-ingestion propre possible) et `ingestion_batches` concernés passent à `STOPPED` s'ils étaient actifs.

**Correction Humaine (`PUT /api/library/chunks/{id}`, `PUT /api/library/artifacts/{id}`) :**
* Séquence atomique : validation Couche 4 (linter, résultat retourné au client) → régénération embedding (fastembed, préfixes §3.2) → mise à jour ligne (+ `is_human_edited = 1`, `updated_at = now`) → sync FTS par trigger UPDATE → sync `vec_chunks` (delete + insert si mode hybride).
* Un lint en `ERROR` n'empêche PAS l'enregistrement (l'humain a raison en dernier ressort) mais le résultat est retourné et consigné dans `linter_errors_json` du benchmark de la page.
* Les contenus `is_human_edited = 1` ne sont JAMAIS écrasés par une ré-ingestion de la même page (la Couche 7 saute les chunks marqués) ni par une purge avec `preserve_human_edits = true`.

**Chat RAG (`POST /api/search/ask`) :**
* Pipeline : retrieval hybride → filtrage seuils réels (§3.3) → si zéro chunk éligible : réponse imposée retournée avec `no_context: true` et **ZÉRO appel LLM** → sinon : contexte formaté (§3.4) → génération via Key Manager (rotation/fallback standard §3.1 Blueprint).
* Le prompt système impose : réponse UNIQUEMENT depuis le contexte fourni, citations obligatoires des chunks utilisés, même langue que la question.

---

### **4.6 Contrat de Moteur & Registre (V3.4 — Architecture Multi-Moteurs)**

* **Séparation stricte :** le noyau `/backend` ne contient AUCUN code métier d'extraction. Chaque moteur vit dans `/engines/{id}/` avec trois éléments obligatoires : `engine.json` (manifeste), `pipeline/` (couches 0→7 + 3bis), `models/` (ses modèles ONNX). Les futurs moteurs (legal-engine, medical-engine…) n'entraînent AUCUNE modification du noyau ni AUCUN mélange de pipelines/scripts/configs entre moteurs (Règle d'Or).
* **L'interface de moteur = les contrats DTO du §2 :** les couches d'un moteur consomment et produisent exactement RestorationResult → TriageResult → ExtractionAndQualificationResult → ValidationResult → VLMResult. Machine d'états `pipeline_jobs` et Cycle de Vie des Moteurs ML (D2-B) identiques pour tout moteur.
* **Manifeste `engine.json` (schéma imposé) :**
```json
{
  "id": "sci-engine",
  "label": "Moteur Scientifique",
  "version": "1.0.0",
  "accent": "#2563eb",
  "families_tier1": ["latex_formula", "data_table", "code_snippet", "geometry_vector", "flowchart", "dense_illustration", "microscopy_photo"],
  "status": "active"
}
```
* **engine_registry (`/backend/core/engine_registry.py`) :** au démarrage, scanne `ENGINES_DIR`, valide chaque manifeste, expose `GET /api/system/engines`. L'orchestrateur résout le moteur actif et charge ses couches dynamiquement par CHEMIN DE FICHIER via `importlib.util.spec_from_file_location` sur `{ENGINES_DIR}/{id}/pipeline/layer_N.py` (un id contenant un tiret, ex. `sci-engine`, n'est pas un nom de module Python valide — jamais d'`import engines.sci-engine`). Un manifeste invalide → moteur ignoré avec WARN consigné, jamais de crash du noyau.

---

## **5. TESTS ET CRITÈRES D'ACCEPTATION (D.O.D — Definition Of Done)**

> [!IMPORTANT]
> **Autonomie Totale des Tests :** ArchiSys3.0 n'exécute aucun test directement. L'agent exécute lui-même 100% des tests via les commandes CLI appropriées (Pytest, Playwright, scripts de bench psutil, linters), capture les logs réels et fournit le rapport de preuve chiffré dans sa réponse ainsi que dans `/docs/ragdom/04_state/current_state.md`.

L'implémentation d'une phase n'est considérée terminée que si **tous** ces critères sont vérifiés et validés de manière autonome par l'agent.

### **5.1 Tests Backend (Pytest)**

- **[ ] SQLite Integrity :** Insertion d'un document complet (avec chunks ET artefacts) sans violation de Foreign Keys ni échec des Triggers FTS5. Vérification que les deux triggers (`trg_chunks_fts_sync` et `trg_artifacts_fts_sync`) produisent bien des entrées dans `search_index`.
- **[ ] RAM Plancher (D2-B) :** pipeline au repos, moteurs ML déchargés : RSS **<= 250 Mo** (`psutil.Process().memory_info().rss`).
- **[ ] RAM Pic (D2-B) :** ingestion d'un PDF de test de 100 pages mixtes : pic RSS **<= MAX_RAM_MB** (défaut 2048 Mo).
- **[ ] RAM Non-Fuite (D2-B) :** retour au plancher (±15%) après chaque page (preuve `del`/`gc.collect()`/`clear_cache()`).
- **[ ] RRF Test :** Une requête hybride sur un corpus de test retourne bien des résultats triés par `Score_RRF` décroissant, avec des scores cohérents avec la formule `1/(60+rank_bm25) + 1/(60+rank_vec)`.
- **[ ] Recovery Test :** Un `kill -SIGTERM` envoyé au milieu du traitement d'une page doit permettre au pipeline de reprendre **exactement** à la page non terminée (statut `PROCESSING_CV`) lors du relancement, sans réindexer les pages déjà au statut `READY`.
- **[ ] INVALID_SOURCE Test :** Un PDF chiffré ou corrompu doit déclencher le statut `INVALID_SOURCE` sur `pipeline_jobs` sans arrêter le backend, et le job suivant dans la queue doit commencer automatiquement.
- **[ ] Key Manager Rotation Test :** Simuler une erreur 429 sur la clé primaire → vérifier que la rotation vers la clé secondaire s'effectue sans que le job échoue.
- **[ ] Linter Performance Test :** Le linter (couche 4) doit traiter n'importe quel bloc en **< 5ms** (mesuré avec `time.perf_counter`).
- **[ ] Débit Baseline (D4-A, non-bloquant) :** mesure du débit (pages/h) sur le PDF étalon, consignée dans `current_state.md` — toute évolution du pipeline est comparée à cette baseline.
- **[ ] Fallback Vectoriel (V3.1) :** base créée en mode hybride puis rouverte SANS sqlite-vec → ingestion continue sans crash (drop automatique des triggers vec) ; retour hybride → `vec_chunks` re-rempli depuis `embedding_vector`.
- **[ ] Reset Propre (V3.1) :** après `POST /api/pipeline/reset`, zéro entrée fantôme dans `search_index` (triggers DELETE).
- **[ ] Purge Scopée (V3.2) :** `dry_run` retourne exactement les mêmes comptes que l'exécution réelle ; `scope=chapter` ne touche aucune ligne hors du sous-arbre TOC ; les lignes `is_human_edited=1` sont préservées (sauf scope database) ; zéro entrée FTS/vec fantôme après purge.
- **[ ] Correction Humaine (V3.2) :** `PUT /chunks/{id}` → FTS mis à jour (trigger UPDATE), embedding régénéré, `is_human_edited=1` ; une ré-ingestion de la même page ne réécrase PAS le chunk corrigé.
- **[ ] Ask Anti-Hallucination (V3.2) :** requête sans chunk éligible → réponse imposée + `no_context:true` + **zéro appel LLM** (vérifié par mock du Key Manager).
- **[ ] Base Autonome (V3.5) :** copier UNIQUEMENT le fichier .sqlite vers un autre emplacement (sans /sources/ ni /pipeline-set/) → l'API sert 100% du contenu : scans pleine résolution ET vignettes depuis `page_scans`, chunks, artefacts, TOC, curriculum, benchmarks. Zéro accès au système de fichiers hors /databases/.

### **5.2 Tests Frontend (Jest + Playwright & D.O.D. UI/UX)**

- **[ ] PHP Templates Parity & Checkpoint :** Avant tout développement, l'agent a validé avec ArchiSys3.0 la relecture intégrale des 3 templates de `/Template_UI-UX/` (`index.php`, `library.php`, `automation.php`). Les 3 vues React produites sont 100% fidèles visuellement, structurellement et comportementalement (6 onglets, splash screen, terminal SSE, halo radiant doré).
- **[ ] UI Sync-Scroll :** Le `SideBySideViewer` mappe correctement les Y-offsets entre le scan original et le texte Markdown rendu. Test : scroller le panneau gauche à 50% → vérifier que le panneau droit est aussi à 50%.
- **[ ] Zero Mock Test :** Vérifier qu'aucune donnée statique (liste de domaines, filtres, noms de bases) n'est présente dans le code source React compilé. Tous les filtres doivent provenir de requêtes API.
- **[ ] ArtifactRenderer Routing :** Pour chaque `artifact_type` testé, vérifier que le bon moteur de rendu est instancié en moins de 16ms.
- **[ ] SSE Stream Test :** Vérifier que la console de télémétrie (Vue 3) reçoit bien les événements SSE et les affiche en temps réel.
- **[ ] Multi-Base Selector :** Vérifier que la sélection d'une base dans le dropdown (`GET /api/system/databases`) met à jour tous les composants (TOCExplorer, facettes, SearchStudio) sans rechargement de page.
- **[ ] AskStudio Citations (V3.2) :** la réponse RAG affiche des citations cliquables qui naviguent vers le chunk source dans le SideBySideViewer ; le cas `no_context` affiche le message imposé sans invention.
- **[ ] PurgeStudio Dry-Run (V3.2) :** la modale de prévisualisation affiche les comptes du dry_run AVANT toute exécution ; le scope database exige la double saisie du nom exact de la base.
- **[ ] Virtualisation (V3.3) :** une galerie/table de 1000+ éléments scrolle à 60 fps avec un DOM borné (< 200 nœuds de cartes montés simultanément — @tanstack/react-virtual).
- **[ ] Command Palette (V3.3) :** Ctrl+K ouvre l'omnibox ; changement de base, saut d'onglet et lancement d'action pilotables 100% au clavier.

---

## **6. STRATÉGIE DE MIGRATION SQLITE**

Lorsque le schéma SQLite évolue (ajout d'une colonne, d'un index, d'un trigger) sur une base déjà peuplée :

1. **Jamais de DROP TABLE** : Toute migration est additive uniquement.
2. **Pattern de migration :** Utiliser des scripts numérotés dans `/backend/db/migrations/` : `migration_001_add_has_solution.sql`, `migration_002_add_blur_score.sql`, etc.
3. **Table de versioning :** Une table `schema_version` dans chaque base SQLite trace les migrations appliquées :
   ```sql
   CREATE TABLE IF NOT EXISTS schema_version (
       version INTEGER PRIMARY KEY,
       applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
       description TEXT
   );
   ```
4. **Au démarrage du backend :** L'orchestrateur vérifie la version du schéma de la base cible et applique automatiquement les migrations manquantes dans l'ordre croissant.
5. **Colonnes ajoutées :** Toujours avec une valeur DEFAULT compatible pour ne pas invalider les lignes existantes.

---

## **7. BASE DE CONFIGURATION : ragdom_config.sqlite**

Fichier : `/backend/ragdom_config.sqlite` (base SQLite dédiée à la configuration globale du système — **séparée des bases documentaires**). Créée et initialisée au premier démarrage du backend.

```sql
-- ============================================================
-- TABLE 1 : Clés API des providers LLM
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_keys (
    id              TEXT PRIMARY KEY,      -- UUID généré
    provider        TEXT NOT NULL,         -- 'gemini' | 'groq' | 'openai' | 'anthropic' | 'ollama'
    api_key         TEXT NOT NULL,         -- Clé API en clair (base locale, non partagée)
    status          TEXT DEFAULT 'active' CHECK(status IN ('active', 'blocked', 'disabled')),
    blocked_until   DATETIME,              -- NULL si pas bloquée. Rempli lors d'un 429.
    last_error_code INTEGER,               -- Dernier code HTTP d'erreur reçu
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_llm_keys_provider ON llm_keys(provider);
CREATE INDEX IF NOT EXISTS idx_llm_keys_status   ON llm_keys(status);

-- ============================================================
-- TABLE 2 : Paramètres actifs par provider
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_settings (
    provider      TEXT PRIMARY KEY,   -- 'gemini' | 'groq' | 'openai' | 'anthropic' | 'ollama'
    active_model  TEXT,               -- Modèle sélectionné ex: 'gemini-1.5-flash', 'llama3'
    is_enabled    INTEGER DEFAULT 1,  -- 1=activé, 0=désactivé
    priority      INTEGER DEFAULT 99, -- Ordre de priorité (1=premier essayé)
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Données initiales (providers disponibles par défaut, désactivés jusqu'à saisie des clés)
INSERT OR IGNORE INTO llm_settings (provider, active_model, is_enabled, priority) VALUES
    ('gemini',    'gemini-1.5-flash', 0, 1),
    ('groq',      'llama-3.1-70b-versatile', 0, 2),
    ('openai',    'gpt-4o-mini', 0, 3),
    ('anthropic', 'claude-3-haiku-20240307', 0, 4),
    ('ollama',    'llama3', 0, 5);

-- ============================================================
-- TABLE 3 : Paramètres applicatifs globaux (V3.1)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
INSERT OR IGNORE INTO app_settings (key, value) VALUES
    ('force_sqlite_vec',       'false'),
    ('vec_distance_threshold', '0.45'),
    ('bm25_score_threshold',   '-0.3');
```

---

## **8. REQUIREMENTS.TXT BACKEND (VERSIONS ÉPINGLÉES)**

Fichier : `/backend/requirements.txt`. L'agent doit utiliser **exactement** ces packages. Toute dépendance supplémentaire doit être approuvée par ArchiSys3.0 avant ajout.

```txt
# ── Core API & Server ──────────────────────────────────────────
fastapi==0.115.0
uvicorn[standard]==0.30.6
python-dotenv==1.0.1
pydantic==2.9.2
psutil==6.0.0

# ── PDF & Mémoire ─────────────────────────────────────────────
PyMuPDF==1.24.10
PyMuPDF4LLM==0.0.17

# ── Computer Vision (CPU) ─────────────────────────────────────
opencv-python-headless==4.10.0.84
numpy==1.26.4                # ✔ CONTRAINTE PIVOT : rapidocr/rapid-latex-ocr exigent numpy<2 (rapid-layout ≥1.0 exige numpy>=2 → exclu)
onnxruntime==1.19.2
scikit-image==0.24.0
pillow==10.4.0
deskew==1.5.1

# ── OCR & Layout (ONNX, Tier 1) ───────────────────────────────
rapidocr-onnxruntime==1.3.24
rapid-layout==0.4.0          # ✔ vérifié PyPI 2026-08-21 — layout ONNX (remplace 'YOLOv10-Doc'). ≥1.0.0 exige numpy>=2 : rester en 0.4.0
rapid-table==3.0.2           # ✔ vérifié PyPI 2026-08-21 — tableaux ONNX (remplace TATR). NE PAS installer l'extra [torch]
rapid-latex-ocr==0.0.9       # ✔ vérifié PyPI 2026-08-21 — formules LaTeX ONNX (remplace Nougat). Exige numpy<2

# ── NLP & Embeddings (ONNX, zéro torch) ───────────────────────
tiktoken==0.7.0
fastembed==0.7.4             # ✔ vérifié PyPI 2026-08-21 — paraphrase-multilingual-MiniLM-L12-v2 (384d)

# ── SQLite extensions ─────────────────────────────────────────
sqlite-vec==0.1.6

# ── Validation d'artefacts (linters Tier 1/2) ─────────────────
rdkit==2024.3.5              # validation SMILES/InChI (linter chimie)
biopython==1.84              # validation FASTA/GenBank
tree-sitter==0.23.1
music21==9.3.0

# ── ML / Clustering ───────────────────────────────────────────
scikit-learn==1.5.2

# ── LLM Clients Cloud ─────────────────────────────────────────
google-genai==0.8.0             # ✔ CORRIGÉ 2026-08-21 : 0.8.3 inexistant sur PyPI (constaté en build réel Render)
groq==0.11.0
openai==1.47.1
anthropic==0.34.2            # V3.1 : CORRIGÉ (le paquet 'anthropics' n'existe pas)

# ── LLM Local ─────────────────────────────────────────────────
llama-cpp-python==0.3.1
httpx==0.27.2

# ── Utils ─────────────────────────────────────────────────────
python-multipart==0.0.12
aiofiles==24.1.0
```

**Retirés en V3.1 (motifs) :** `GDAL` (in-installable via pip/venv sous Windows — cartographie basculée Tier 3 import), `sentence-transformers` (dépendance PyTorch), `anthropics` (paquet inexistant → `anthropic`), Nougat / Docling / Surya / TATR / DECIMER / MolScribe (PyTorch/TensorFlow, hors contraintes CPU-First — familles couvertes en Tier 2 via VLM). **Vérification Phase 0 : EFFECTUÉE le 2026-08-21** (API PyPI + installation réelle en venv propre + tests d'import) : `rapid-layout==0.4.0`, `rapid-table==3.0.2`, `rapid-latex-ocr==0.0.9`, `fastembed==0.7.4` coexistent avec `numpy==1.26.4` + `onnxruntime==1.19.2`, **zéro dépendance torch** installée. La whitelist ci-dessus est GELÉE.

**⚠️ Procédure post-install obligatoire (opencv) :** les paquets rapid-* déclarent `opencv-python` (complet, dépendances GUI/libGL) en dépendance. Après `pip install -r requirements.txt`, exécuter :
```bash
pip uninstall -y opencv-python opencv-contrib-python
pip install opencv-python-headless==4.10.0.84
```
(même module `cv2`, sans dépendances GUI — indispensable sur serveur headless, sans effet négatif sous Windows).

**Version Python requise :** `>= 3.10` et `< 3.13`. Recommandé : **Python 3.11.x**.

---

## **9. PACKAGE.JSON FRONTEND (DÉPENDANCES NPM)**

Fichier : `/frontend/package.json`. L'agent initialise le projet avec `npm create vite@latest . -- --template react-ts` puis installe exactement ces dépendances.

```json
{
  "name": "ragdom-frontend",
  "version": "3.5.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "jest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^6.26.2",
    "lucide-react": "^0.446.0",
    "katex": "^0.16.11",
    "dompurify": "^3.1.6",
    "mermaid": "^11.3.0",
    "shiki": "^1.21.0",
    "marked": "^14.1.2",
    "three": "^0.169.0",
    "plotly.js-dist-min": "^2.35.2",
    "maplibre-gl": "^4.7.1",
    "3dmol": "^2.4.2",
    "openseadragon": "^5.0.1",
    "@tanstack/react-table": "^8.20.5",
    "@tanstack/react-virtual": "^3.10.8",
    "vexflow": "^4.2.6",
    "abcjs": "^6.4.3",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.3"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/dompurify": "^3.0.5",
    "@types/katex": "^0.16.7",
    "@vitejs/plugin-react": "^4.3.2",
    "typescript": "~5.6.2",
    "vite": "^5.4.8",
    "tailwindcss": "^3.4.13",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "@playwright/test": "^1.47.2",
    "jest": "^29.7.0",
    "@testing-library/react": "^16.0.1"
  }
}
```

**Installation des composants shadcn/ui :** Après `npm install`, exécuter :
```bash
npx shadcn@latest init
npx shadcn@latest add button card dialog dropdown-menu input label select separator sheet slider switch tabs tooltip
```

**Note Tiering (V3.1 — D3-B) :** les renderers chimie (Ketcher/RDKit.js), bio (BioJS), DICOM (Cornerstone.js), IFC (web-ifc-viewer) sont ajoutés à la whitelist AU MOMENT de l'activation de leur famille (add-on), pas en v1. D'ici là, `ArtifactRenderer` affiche un fallback « visionneuse non installée » + crop WebP de secours.

---

## **10. STRUCTURE DU FICHIER `.env` (VARIABLES D'ENVIRONNEMENT)**

Fichier : `/backend/.env`. **(MAJ 2026-08-22 — règle révisée)** Le `.env` est désormais **VERSIONNÉ, pré-rempli et prêt à l'emploi, MAIS SANS AUCUN SECRET** : chaque variable est présente en commentaire (`#`) à sa valeur par défaut, avec son mode d'emploi en commentaire ; pour personnaliser, on décommente et on modifie la ligne. Le `.env` est **optionnel** — sans lui, `backend/config.py` déduit tous les chemins de l'arborescence du projet (portabilité clone-and-run). Les secrets (clés LLM, `RAGDOM_AUTH_TOKEN`) ne sont **jamais** committés : ils se définissent dans l'environnement de l'hébergeur (ou dans un `.env` local non poussé si le dépôt est privé). *(L'ancien `.env.example` séparé n'est plus requis ; le `.env` versionné pré-rempli en tient lieu.)*

```env
# ── Chemins Physiques du Projet ───────────────────────────────
# Chemins ABSOLUS vers les dossiers du système de fichiers RAGDom
SOURCES_DIR=/chemin/absolu/vers/sources
DATABASES_DIR=/chemin/absolu/vers/databases
PIPELINE_SET_DIR=/chemin/absolu/vers/pipeline-set
ENGINES_DIR=/chemin/absolu/vers/engines
MODELS_DIR=/chemin/absolu/vers/backend/models   # partagés (embedding) — modèles moteur : {ENGINES_DIR}/<id>/models/
CONFIG_DB_PATH=/chemin/absolu/vers/backend/ragdom_config.sqlite

# ── Serveur Backend ───────────────────────────────────────────
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8000

# ── Frontend (CORS) ───────────────────────────────────────────
FRONTEND_URL=http://localhost:5173

# ── Clés API Cloud (optionnelles, gérées via l'UI Key Manager) ─
# Ces variables sont un fallback de démarrage. La gestion principale
# se fait via ragdom_config.sqlite (table llm_keys).
GEMINI_API_KEY=
GROQ_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# ── Serveur LLM Local ─────────────────────────────────────────
OLLAMA_BASE_URL=http://localhost:11434

# ── Paramètres Pipeline ───────────────────────────────────────
MAX_RAM_MB=2048   # Pic d'inférence (Palier 2, D2-B). Plancher structurel fixe : 250 Mo hors moteurs.
RAGDOM_FORCE_SQLITE_VEC=false   # Mode strict Option A (voir §3.3.1). false = Option B résiliente.
VLM_TIMEOUT_SECONDS=30
MAX_RETRY_COUNT=3
RAGDOM_INTRA_PAGE_WORKERS=1   # Parallélisme intra-page borné 1-3 (D4-B). 1 = séquentiel strict (défaut).
RAGDOM_VLM_PAGE_OCR=auto   # OCR VLM de page entière (§3.6.1) : auto (défaut) | false (Tier 1 seul).

# ── Web-Ready (Phase 7 — à définir chez l'hébergeur, jamais de secret dans le dépôt) ──
RAGDOM_READONLY=false   # true = mode consultation : les routes d'ADMINISTRATION n'existent pas (404), seules les routes de LECTURE répondent.
RAGDOM_AUTH_TOKEN=      # Jeton d'administration (Palier 3). Si défini, les routes admin exigent « Authorization: Bearer <jeton> ». Vide = aucun contrôle (local nominal).
RAGDOM_ALLOW_REVEAL=true   # Autorise la révélation en clair des clés LLM (/api/llm/keys/{id}/reveal). DOIT être false sur tout déploiement web.
RAGDOM_ASK_RATE_PER_MIN=0   # Quota /api/search/ask par IP et par minute (0 = désactivé, défaut local ; >0 → 429 au-delà).
RAGDOM_LOW_MEMORY=false   # true (hébergements ≤512 Mo) : ne charge JAMAIS l'encodeur d'embeddings ONNX (~300 Mo de pic → OOM kill), recherche BM25 seule ; les bases pré-construites conservent leurs vecteurs.
RAGDOM_SEED_LLM_KEYS=   # Seed IDEMPOTENT au démarrage (disque éphémère). Entrées séparées par virgules/retours ligne : « provider:clé » ou « provider:clé:modèle ». Toute entrée absente est insérée dans llm_keys et son provider activé. JAMAIS de vraie clé dans le dépôt.
RAGDOM_PUBLISHED_DBS=  # Dossier des bases pré-ingérées à installer au démarrage (défaut : {racine}/databases_publiees). Chaque .sqlite absent de DATABASES_DIR y est copié (bibliothèque pré-chargée à chaque réveil).
```

**Sémantique exacte (source : `backend/config.py`, `backend/.env`, `backend/main.py`, `backend/db/connection.py`) — (MAJ 2026-08-22) :** `RAGDOM_READONLY`, `RAGDOM_ALLOW_REVEAL` et `RAGDOM_LOW_MEMORY` sont booléens (`"true"` insensible à la casse). `RAGDOM_AUTH_TOKEN` vide vaut `None` (pas de contrôle). `RAGDOM_ASK_RATE_PER_MIN` et `RAGDOM_INTRA_PAGE_WORKERS` sont des entiers (ce dernier borné à `[1, 3]`). `RAGDOM_VLM_PAGE_OCR` : seule la valeur littérale `false` désactive ; toute autre valeur (dont `auto`) active. `RAGDOM_SEED_LLM_KEYS` est relu à chaque `init_config_db()` (seed idempotent). `RAGDOM_PUBLISHED_DBS` est lu au lifespan `main.py` (copie non destructive : jamais d'écrasement d'une base déjà présente).

---

## **11. REGISTRE DES MODÈLES ONNX & AI**

**(V3.4)** Les modèles PROPRES AU MOTEUR sont stockés dans `/engines/sci-engine/models/` ; seul le modèle d'embedding (la recherche est une fonction du noyau) reste dans `/backend/models/embedding/`. L'agent doit les télécharger depuis les sources officielles listées ci-dessous.

```
/engines/sci-engine/models/          ← modèles du moteur (V3.4)
    ├── layout/
    │   └── (modèles rapid-layout)    Source: pip install rapid-layout (téléchargement auto, cache géré)
    │                                  [V3.1 : entrée 'yolov10_doc.onnx / onnx-community/yolov10n' SUPPRIMÉE —
    │                                   référence erronée : modèle COCO générique, pas un layout documentaire]
    ├── ocr/
    │   ├── ch_PP-OCRv4_det.onnx      Source: pip install rapidocr-onnxruntime (inclus)
    │   ├── ch_PP-OCRv4_rec.onnx      Source: pip install rapidocr-onnxruntime (inclus)
    │   └── ch_ppocr_mobile_cls.onnx  Source: pip install rapidocr-onnxruntime (inclus)
    ├── dewarp/
    │   └── doc_aligner.onnx          Source: https://huggingface.co/RaphaelLiu/DocAligner
    ├── table/
    │   └── (modèles rapid-table)     Source: pip install rapid-table (téléchargement auto)
    └── math/
        └── (modèles rapid-latex-ocr) Source: pip install rapid-latex-ocr (téléchargement auto)
                                       [V3.1 : Nougat SUPPRIMÉ — PyTorch, hors contraintes CPU-First]

/backend/models/                      ← modèles PARTAGÉS du noyau (V3.4)
    └── embedding/
        └── paraphrase-multilingual-MiniLM-L12-v2/  Source: pip install fastembed==0.7.4 (ONNX, cache géré)
```

**Règle V3.1 :** chaque entrée du registre DOIT porter une URL vérifiée, la taille attendue et un hash SHA256, renseignés à la Phase 0. **Vérification PyPI des paquets : effectuée le 2026-08-21, whitelist gelée** (voir §8) ; reste à consigner les hashs SHA256 des modèles téléchargés au premier run.

**Chargement dans Python (pattern imposé) :**
```python
import os
import onnxruntime as ort

MODELS_DIR  = os.environ.get("MODELS_DIR")    # modèles PARTAGÉS du noyau (embedding)
ENGINES_DIR = os.environ.get("ENGINES_DIR")   # modèles PAR MOTEUR : {ENGINES_DIR}/{engine_id}/models/

def load_model(relative_path: str, engine_id: str | None = None) -> ort.InferenceSession:
    # V3.5 : engine_id fourni → modèle du moteur ; sinon → modèle partagé du noyau
    base = os.path.join(ENGINES_DIR, engine_id, "models") if engine_id else MODELS_DIR
    model_path = os.path.join(base, relative_path)
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Modèle introuvable : {model_path}")
    return ort.InferenceSession(
        model_path,
        providers=["CPUExecutionProvider"],
        sess_options=_get_sess_options()
    )

def _get_sess_options() -> ort.SessionOptions:
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.intra_op_num_threads = os.cpu_count() or 4
    opts.inter_op_num_threads = 1  # Séquentiel inter-op
    return opts
```

---

## **12. DICTIONNAIRE render_config_json PAR ARTIFACT_TYPE**

La colonne `render_config_json` dans `scientific_artifacts` doit suivre **exactement** ce format JSON selon le type d'artefact. Le composant `ArtifactRenderer.tsx` utilise ce JSON pour instancier le bon renderer sans logique supplémentaire.

```json
// artifact_type: "latex_formula" | "matrix" | "tensor"
{ "renderer": "katex", "displayMode": true, "throwOnError": false }

// artifact_type: "geometry_vector" | "technical_blueprint" | "circuit_schematic" | "iso_cut" | "feynman_diagram" | "decay_chain"
{ "renderer": "svg", "sanitize": true, "zoomable": true }

// artifact_type: "pdb_protein" | "cif_crystal"
{ "renderer": "3dmol", "style": "cartoon", "backgroundColor": "white" }

// artifact_type: "smiles_chem" | "mol_block" | "inchi"
{ "renderer": "ketcher", "readOnly": true }

// artifact_type: "fasta_sequence" | "genbank_record"
{ "renderer": "biojs", "format": "fasta" }

// artifact_type: "code_snippet" | "ast_tree"
{ "renderer": "shiki", "lang": "python", "theme": "github-dark" }

// artifact_type: "flowchart" | "state_machine" | "network_topology" | "packet_frame"
{ "renderer": "mermaid", "theme": "default" }

// artifact_type: "cad_3d_model" | "point_cloud"
{ "renderer": "three", "format": "gltf" }

// artifact_type: "geojson_map" | "topography_layer"
{ "renderer": "maplibre", "style": "https://demotiles.maplibre.org/style.json", "zoom": 5 }

// artifact_type: "data_table" | "hierarchical_grid"
{ "renderer": "tanstack-table", "pagination": true, "pageSize": 20 }

// artifact_type: "signal_waveform" | "spectrum_fft" | "bode_plot" | "block_diagram" | "geological_strata" | "well_log" | "isobar_map" | "wind_rose" | "ray_tracing" | "optical_spectrum"
{ "renderer": "plotly", "type": "scatter" }

// artifact_type: "dense_illustration" | "histology_cut" | "dicom_slice" | "xray_image"
{ "renderer": "openseadragon", "tileSources": null, "showNavigator": true }

// artifact_type: "sheet_music"
{ "renderer": "vexflow", "format": "musicxml" }

// artifact_type: "tablature"
{ "renderer": "abcjs", "format": "abc" }

// artifact_type: "microscopy_photo" | "macro_sample"
{ "renderer": "img-loupe", "magnification": 3 }

// artifact_type: "bim_ifc_slice" | "floorplan_2d"   (V3.1 — Tier 3, fallback "svg" en v1)
{ "renderer": "web-ifc", "readOnly": true }

// artifact_type: "geogebra_xml"   (V3.1 — rendu SVG en v1, GGB-Wasm en add-on)
{ "renderer": "svg", "sanitize": true, "zoomable": true }

// artifact_type: "phonetic_tree" | "hieroglyph_vector"   (V3.1)
{ "renderer": "svg", "sanitize": true, "zoomable": true }
```

---

## **12.1 CONTRAT DE PORTABILITÉ DE LA BASE AUTONOME (MAJ 2026-08-22)**

Contrat **plug-and-play** normatif : ce qu'un consommateur (React, PHP, Electron, APK
Android, No-Code) est en droit d'attendre d'un `.sqlite` RAGDom, sans aucune dépendance
externe. Il fait autorité sur la lecture du contenu multimodal ; il ne redéfinit pas le
DDL (§1) ni le dictionnaire des renderers (§12) — il en garantit la **consommabilité**.

Référence de code : `backend/db/schema_core.sql` + `schema_vec.sql` (§1),
`backend/api/routes_library.py` (`/artifacts`, `/artifact-binary`, `/page-scan`),
`engines/sci-engine/pipeline/` (Couches 0→7 + 3bis). Les modules
`artifact_qualifier.py` / `layer_2_extract.py` sont **EN COURS** d'écriture par un autre
agent : les clauses ci-dessous décrivent le contrat **CIBLE** que ces modules doivent
respecter, indépendamment de leur état d'implémentation courant.

### **12.1.1 — Autonomie (un seul fichier)**

Un unique fichier `.sqlite` contient **la totalité** du contenu servi à l'UI ; aucun lien
vers `/sources/`, `/pipeline-set/` ni aucun asset disque n'est autorisé à la lecture :

- **Texte du flux** : `document_chunks.content_markdown` (Markdown + LaTeX `$…$` / `$$…$$`).
- **Sommaire hiérarchique** : `document_toc` (arbre `parent_id` / `level` 1→3).
- **Scans de pages** : `page_scans` (`image_webp` pleine résolution BLOB + `thumb_webp`
  vignette + `width_px` / `height_px` / `dpi`), pré-requis de la conversion BBox → CSS %.
- **Artefacts** : `scientific_artifacts` portant, pour CHAQUE artefact :
  - `raw_data` : payload textuel **structuré** (LaTeX, SVG, Markdown, SMILES, Mermaid,
    JSON Plotly…) — peut être `NULL` ;
  - `raw_binary` : découpe **WebP ORIGINALE** (BLOB) — **TOUJOURS conservée**, jamais
    modifiée ni supprimée par une requalification ;
  - `render_config_json` : configuration du renderer (§12) ;
  - `caption` : légende textuelle ;
  - `bounding_box_json` : dict `{"x0","y0","x1","y1"}` en pixels du scan (300 DPI).
- **Recherche plein-texte** : table FTS5 `search_index` (peuplée par triggers).
- **Recherche vectorielle** : `vec_chunks` (sqlite-vec) **si présente** ; son absence est
  un état valide (repli BM25, §1 Règle Conditionnelle) — le consommateur ne doit jamais
  la présumer.

### **12.1.2 — Ancrage in-situ des illustrations**

Une ancre `![caption](asset://artifacts/{artifact_id})` placée dans `content_markdown`
signifie : « l'illustration `{artifact_id}` s'affiche **à CETTE position** du flux de
lecture ». Résolution imposée :

1. `{artifact_id}` → `SELECT` de la ligne `scientific_artifacts`.
2. Si `raw_data` **non vide** → rendre selon `render_config_json` (renderer de §12).
3. **Sinon** → servir `raw_binary` en `image/webp` (repli universel).
4. L'**original** (`raw_binary`) reste **TOUJOURS disponible** en contrôle/comparateur,
   même quand un rendu structuré existe (via `/api/library/artifact-binary`).

Le schéma d'URI **`asset://figures/…`** est également reconnu : il est résolu côté
frontend par `frontend/src/lib/markdownKatex.ts` (fonction `transformStructuredBlocks`,
via le callback optionnel `resolveAsset(figureFileName)`). Un consommateur qui rencontre
`asset://figures/NOM` doit fournir ce résolveur ; à défaut le nom brut est utilisé.
Un consommateur peut donc rencontrer les deux schémas et doit les traiter comme des
ancres d'illustration.

### **12.1.3 — Familles v1 garanties**

Tout consommateur conforme rend **au minimum** ces familles (le reste de §12 est réservé
V3.x ; toute famille inconnue retombe sur le repli universel `raw_binary`) :

| `artifact_type` | Renderer (§12) | Couvre |
|---|---|---|
| `latex_formula` | katex | Formules mathématiques |
| `matrix` | katex | Matrices **ET** opérations posées (`\begin{array}`) |
| `data_table` | tanstack-table | Tableaux de données |
| `geometry_vector` | svg | Géométrie, dessins libres, schémas fléchés, démonstrations visuelles |
| `flowchart` | mermaid | Organigrammes, diagrammes d'états |
| `signal_waveform` | plotly | Courbes / signaux (Plotly JSON) |
| `smiles_chem` | ketcher | Molécules (SMILES) |
| `code_snippet` | shiki | Extraits de code |
| `dense_illustration` | openseadragon | Illustration dense / repli image |

**Repli universel** : pour tout `artifact_type` non géré, ou tout `raw_data` vide, le
consommateur affiche `raw_binary` (`image/webp`). Aucun artefact n'est jamais « perdu ».

### **12.1.4 — Sémantique pédagogique (clé additive)**

`render_config_json` **peut** porter une clé additive
`"semantic": "demonstration" | "illustration" | "exercise_support"`, **quel que soit** le
`artifact_type` — une démonstration peut être un schéma fléché, un dessin libre ou une
suite d'opérations posées. Cette clé est **purement additive** : un renderer de §12 qui
l'ignore fonctionne à l'identique (aucun dommage). Un consommateur pédagogique peut la
lire pour adapter l'affichage (badge, regroupement, filtrage).

### **12.1.5 — Ordre & fidélité de lecture**

- **Ordre canonique** = ordre d'apparition des ancres `asset://…` dans `content_markdown`.
- **À défaut d'ancre** = tri stable `(page_number, y0, x0)` (y0/x0 issus de
  `bounding_box_json`).
- **Recadrage de contrôle** : une bbox couvrant **> 70 %** de la surface de la page est un
  recadrage de contrôle (quasi pleine page), **pas** une figure de contenu. Le ratio est
  exposé par l'API sous `area_ratio` (float borné `[0,1]`, `GET /api/library/artifacts` ;
  `NULL` si non calculable). Un consommateur peut masquer/dé-prioriser ces artefacts.

### **12.1.6 — Recette de conformité consommateur (checklist 7 points)**

Un consommateur est déclaré conforme s'il réussit, sur une base fournie **seule** :

1. **Ouvrir** le `.sqlite` sans aucun fichier annexe (ni `/sources/`, ni `/pipeline-set/`).
2. **Résoudre** une ancre `asset://artifacts/{id}` → ligne `scientific_artifacts`.
3. **Rendre** un artefact **SVG** (`geometry_vector`).
4. **Rendre** un artefact **LaTeX** (`latex_formula` ou `matrix`).
5. **Rendre** un artefact **tableau** (`data_table`).
6. **Afficher** l'**original** `raw_binary` d'un artefact dans un comparateur côté rendu.
7. **Lire** la clé `semantic` d'un artefact (et l'ignorer sans erreur si absente).

---

## **13. RÈGLES DE GÉNÉRATION doc_source ET domain_tags_json**

Ces champs sont **auto-générés** par l'orchestrateur lors de l'enregistrement d'un nouveau document. L'agent ne doit jamais les saisir manuellement.

**Règle pour `doc_source` :**
- Valeur = chemin **relatif** depuis `/sources/` vers le dossier contenant le PDF.
- Exemple : PDF en `/sources/Maths/1AM/manuel.pdf` → `doc_source = "Maths/1AM"`
- Séparateur : `/` (slash Unix, même sur Windows)

**Règle pour `domain_tags_json` :**
- Valeur = tableau JSON des **composantes du chemin relatif** (chaque niveau de dossier).
- Exemple : PDF en `/sources/Maths/1AM/manuel.pdf` → `domain_tags_json = '["Maths", "1AM"]'`
- Si le PDF est à la racine de `/sources/` : `domain_tags_json = '[]'`

**Règle pour `academic_level` :**
- Si la dernière composante du chemin correspond à un niveau scolaire reconnu (ex: `1AM`, `2AS`, `Term`, `L1`, `M2`, `Bac`), la valeur est extraite automatiquement.
- Sinon : `NULL`.

**Règle pour le nommage de la base SQLite :**
- Format : `composantes_du_chemin.sqlite` (avec `_` comme séparateur entre niveaux).
- Exemple : `/sources/Maths/1AM/` → `/databases/Maths_1AM.sqlite`
- Si un seul niveau : `/sources/Chimie/` → `/databases/Chimie.sqlite`

**Implémentation Python imposée :**
```python
import os
import json

def extract_document_metadata(source_path: str, sources_dir: str) -> dict:
    rel_path = os.path.relpath(os.path.dirname(source_path), sources_dir)
    parts = rel_path.replace("\\", "/").split("/") if rel_path != "." else []
    return {
        "doc_source": "/".join(parts),
        "domain_tags_json": json.dumps(parts),
        "academic_level": parts[-1] if parts else None,
        "db_name": "_".join(parts) + ".sqlite" if parts else "root.sqlite"
    }
```

---

## **14. POLITIQUE DE PAGINATION DES ROUTES API**

Toutes les routes retournant des listes potentiellement longues acceptent les paramètres de pagination suivants :

| Paramètre | Type | Défaut | Description |
|---|---|---|---|
| `page` | integer | `1` | Numéro de page (1-indexé) |
| `limit` | integer | `50` | Nombre d'éléments par page (max: 200) |

**Routes concernées :**
- `GET /api/library/documents?db=...&page=1&limit=50`
- `GET /api/library/chunks?db=...&document_id=...&page=1&limit=50`
- `POST /api/search/hybrid?db=...` (le `top_k` dans le body remplace `limit`)
- `POST /api/search/hybrid-multi` (V3.1 — le `top_k` dans le body remplace `limit`)
- `GET /api/library/benchmarks?db=...&page=1&limit=50` (V3.2)
- `GET /api/pipeline/quarantine?db=...` (V3.2 — liste courte, pagination optionnelle)
- `GET /api/curriculum/{terms|programs|assessments|links}?db=...` (V3.2)
- `GET /api/library/page-scans?db=...` (manifeste galerie, paginé)
- `GET /api/library/benchmarks?db=...` (télémétrie historique, paginée)

**Routes NON paginées (arbre ou objet complet) — (MAJ 2026-08-22) :**
- `GET /api/library/toc` — renvoie un **arbre** `{ "toc": [...] }` (hiérarchie parent/enfants), jamais une liste plate paginée.
- `GET /api/library/curriculum` — renvoie un **objet** agrégé `{ terms, programs, assessments, links, aggregates }`, non paginé.
- `GET /api/library/facets` / `GET /api/system/engines` / `GET /api/pipeline/queue` — objets/listes courtes par nature, non paginés.

**Format de réponse paginée (imposé) :**
```json
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 412,
    "total_pages": 9
  }
}
```

**Alias legacy (MAJ 2026-08-22) :** pour la rétro-compatibilité UI, `GET /api/library/documents` et `GET /api/library/chunks` renvoient la charge sous **`data`** (forme imposée) **ET** sous une clé nommée d'origine (`documents` / `chunks` respectivement) pointant sur le même tableau. Tout nouveau code lit `data` ; les clés nommées sont conservées comme alias.

---

## **15. SQUELETTE main.py (FASTAPI — RÉFÉRENCE IMPOSÉE)**

Fichier : `/backend/main.py`. L'agent doit utiliser **exactement** cette structure comme point de départ.

```python
import os
import sqlite3
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Chargement obligatoire du .env avant tout import des modules internes
load_dotenv()

from api.routes_system   import router as system_router
from api.routes_library  import router as library_router
from api.routes_pipeline import router as pipeline_router
from api.routes_llm      import router as llm_router
from api.routes_search   import router as search_router  # V3.1
from db.connection       import init_config_db

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Événements de démarrage et d'arrêt du serveur."""
    # --- DÉMARRAGE ---
    print("[RAGDom] Initialisation de la base de configuration...")
    init_config_db()  # Crée ragdom_config.sqlite si inexistant

    print("[RAGDom] Vérification des dossiers physiques...")
    for env_var in ["SOURCES_DIR", "DATABASES_DIR", "PIPELINE_SET_DIR", "MODELS_DIR", "ENGINES_DIR"]:
        path = os.environ.get(env_var)
        if not path:
            raise RuntimeError(f"Variable d'environnement manquante : {env_var}")
        os.makedirs(path, exist_ok=True)

    print("[RAGDom] Backend prêt.")
    yield
    # --- ARRÊT ---
    print("[RAGDom] Arrêt propre du backend.")

app = FastAPI(
    title="RAGDom API",
    version="3.5.0",
    description="Backend RAGDom — Bibliothèque numérique scientifique locale",
    lifespan=lifespan
)

# ── CORS (Développement) ──────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ───────────────────────────────────────────────────
app.include_router(system_router,   prefix="/api/system",   tags=["System"])
app.include_router(library_router,  prefix="/api/library",  tags=["Library"])
app.include_router(pipeline_router, prefix="/api/pipeline", tags=["Pipeline"])
app.include_router(search_router,   prefix="/api/search",   tags=["Search"])  # V3.1
app.include_router(llm_router,      prefix="/api/llm",      tags=["LLM"])

# ── Point d'entrée direct ─────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.environ.get("BACKEND_HOST", "0.0.0.0"),
        port=int(os.environ.get("BACKEND_PORT", 8000)),
        reload=True
    )
```

**Commande de lancement :**
```bash
cd /chemin/absolu/vers/backend
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
