# -*- coding: utf-8 -*-
"""Contrat immutable et comparaisons des embeddings produits par RAGDom."""
import importlib.metadata
import json
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


@dataclass(frozen=True)
class EmbeddingProfile:
    """Tous les paramètres qui peuvent modifier l'espace vectoriel persistant."""

    model_name: str
    fastembed_version: str
    pooling: str
    dimensions: int
    normalized: bool
    query_prefix: str
    passage_prefix: str
    max_input_tokens: int
    truncation: str
    passage_max_characters: int
    dtype: str
    endianness: str
    metric: str
    pipeline_version: str
    model_source: str
    model_file: str
    model_revision: Optional[str] = None
    model_artifact_hash: Optional[str] = None

    @property
    def natural_key(self) -> Tuple[str, str, str, int, int]:
        return (self.model_name, self.fastembed_version, self.pooling,
                self.dimensions, int(self.normalized))

    def contract(self) -> Dict[str, Any]:
        return asdict(self)

    def storage_payload(self) -> Dict[str, Any]:
        return {
            "model_name": self.model_name,
            "model_version": self.fastembed_version,
            "pooling": self.pooling,
            "dimensions": self.dimensions,
            "normalized": self.normalized,
            "metadata": {"profile_contract": self.contract()},
        }


def _installed_fastembed_version() -> str:
    try:
        return importlib.metadata.version("fastembed")
    except importlib.metadata.PackageNotFoundError:
        return "unavailable"


CURRENT_PROFILE = EmbeddingProfile(
    model_name="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    fastembed_version=_installed_fastembed_version(),
    pooling="mean",
    dimensions=384,
    normalized=True,
    query_prefix="query: ",
    passage_prefix="passage: ",
    max_input_tokens=512,
    truncation="tokenizer_tail",
    passage_max_characters=2000,
    dtype="float32",
    endianness="little",
    # sqlite-vec vec0(float[384]) utilise L2 par défaut. Sur des vecteurs L2
    # normalisés, son classement est équivalent au cosinus.
    metric="l2",
    pipeline_version="ragdom-fastembed-mean-v1",
    model_source="qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q",
    model_file="model_optimized.onnx",
)


def runtime_profile(embedder, base: EmbeddingProfile = CURRENT_PROFILE) -> EmbeddingProfile:
    """Enrichit le contrat avec les identifiants déjà présents dans le cache local."""
    model = getattr(embedder, "model", embedder)
    model_dir_value = getattr(model, "_model_dir", None)
    if not model_dir_value:
        return base
    model_dir = Path(model_dir_value)
    revision = model_dir.name if model_dir.parent.name == "snapshots" else None
    artifact_hash = None
    candidates = [model_dir / "files_metadata.json", model_dir.parent / "files_metadata.json"]
    if model_dir.parent.name == "snapshots":
        candidates.append(model_dir.parent.parent / "files_metadata.json")
    for metadata_path in candidates:
        try:
            files = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, TypeError, ValueError):
            continue
        wanted = files.get(base.model_file) or files.get("onnx/" + base.model_file)
        if isinstance(wanted, dict):
            artifact_hash = wanted.get("blob_id") or wanted.get("sha256")
            if artifact_hash:
                break
    return replace(base, model_revision=revision, model_artifact_hash=artifact_hash)


def natural_key(profile: Dict[str, Any]) -> Tuple[str, str, str, int, int]:
    return (str(profile["model_name"]), str(profile["model_version"]),
            str(profile["pooling"]), int(profile["dimensions"]),
            int(bool(profile["normalized"])))


def metadata_json(profile: Dict[str, Any]) -> str:
    metadata = profile.get("metadata") or {}
    return json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def profile_from_row(row) -> Dict[str, Any]:
    raw_metadata = row[6] if len(row) > 6 else "{}"
    try:
        metadata = json.loads(raw_metadata or "{}")
    except (TypeError, ValueError):
        metadata = {}
    return {
        "id": row[0], "model_name": row[1], "model_version": row[2],
        "pooling": row[3], "dimensions": int(row[4]),
        "normalized": bool(row[5]), "metadata": metadata,
    }


def compatibility_reasons(stored: Optional[Dict[str, Any]],
                          expected: EmbeddingProfile = CURRENT_PROFILE) -> List[str]:
    """Raisons déterministes; une métadonnée absente n'est jamais supposée compatible."""
    if stored is None:
        return ["embedding_profile_missing"]
    reasons = []
    expected_payload = expected.storage_payload()
    for key in ("model_name", "model_version", "pooling", "dimensions", "normalized"):
        if stored.get(key) != expected_payload[key]:
            reasons.append("profile_%s_mismatch" % key)
    contract = (stored.get("metadata") or {}).get("profile_contract")
    if not isinstance(contract, dict):
        reasons.append("profile_contract_metadata_missing")
        return reasons
    for key, value in expected.contract().items():
        # Le diagnostic hors chargement de modèle ne connaît pas forcément les
        # identifiants du cache. Dès qu'ils sont disponibles côté requête, ils
        # deviennent au contraire bloquants comme tous les autres champs.
        if key in ("model_revision", "model_artifact_hash") and value is None:
            continue
        if contract.get(key) != value:
            reasons.append("profile_contract_%s_mismatch" % key)
    return reasons


def active_vector_profiles(conn) -> Tuple[List[Dict[str, Any]], int, int]:
    """Profils réellement actifs, nombre total de vecteurs et vecteurs sans profil."""
    rows = conn.execute(
        "SELECT DISTINCT p.id,p.model_name,p.model_version,p.pooling,p.dimensions,p.normalized,"
        " p.metadata_json FROM document_chunks c"
        " LEFT JOIN document_embedding_profiles d ON d.document_id=c.document_id"
        " LEFT JOIN embedding_profiles p ON p.id=d.profile_id"
        " WHERE c.embedding_vector IS NOT NULL AND p.id IS NOT NULL ORDER BY p.id"
    ).fetchall()
    total = conn.execute(
        "SELECT COUNT(*) FROM document_chunks WHERE embedding_vector IS NOT NULL"
    ).fetchone()[0]
    unassigned = conn.execute(
        "SELECT COUNT(*) FROM document_chunks c LEFT JOIN document_embedding_profiles d"
        " ON d.document_id=c.document_id WHERE c.embedding_vector IS NOT NULL AND d.profile_id IS NULL"
    ).fetchone()[0]
    return [profile_from_row(row) for row in rows], int(total), int(unassigned)
