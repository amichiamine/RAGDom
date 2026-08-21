-- schema_vec.sql — appliqué UNIQUEMENT si sqlite-vec est chargé (tech_specs §1, Règle Conditionnelle)

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
