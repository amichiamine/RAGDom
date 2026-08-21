# -*- coding: utf-8 -*-
"""RAGDom — Registre des moteurs (tech_specs §4.6, V3.4 Architecture Multi-Moteurs).

Scanne ENGINES_DIR, valide les manifestes engine.json, charge les couches
d'un moteur par CHEMIN DE FICHIER via importlib (jamais d'import par nom de
package : un id comme "sci-engine" contient un tiret). Manifeste invalide
→ moteur ignoré avec WARN, jamais de crash du noyau. Python 3.9+.
"""
import importlib.util
import json
import logging
import os
from pathlib import Path
from types import ModuleType
from typing import Dict, List, Optional

import config

logger = logging.getLogger("ragdom.engines")

_REQUIRED_FIELDS = ("id", "label", "version", "accent", "families_tier1", "status")
_registry: Dict[str, dict] = {}
_module_cache: Dict[str, ModuleType] = {}


def scan_engines() -> List[dict]:
    """(Re)scanne ENGINES_DIR et retourne la liste des manifestes valides."""
    _registry.clear()
    root = Path(config.ENGINES_DIR)
    if not root.is_dir():
        logger.warning("ENGINES_DIR introuvable : %s", root)
        return []
    for entry in sorted(root.iterdir()):
        manifest_path = entry / "engine.json"
        if not entry.is_dir() or not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            missing = [f for f in _REQUIRED_FIELDS if f not in manifest]
            if missing:
                raise ValueError("champs manquants : %s" % ", ".join(missing))
            if manifest["id"] != entry.name:
                raise ValueError("id %r != nom du dossier %r" % (manifest["id"], entry.name))
            if not (entry / "pipeline").is_dir():
                raise ValueError("dossier pipeline/ manquant")
            _registry[manifest["id"]] = manifest
        except Exception as exc:  # noqa: BLE001 — un moteur cassé ne doit jamais tuer le noyau
            logger.warning("[WARN] Moteur %s ignoré (manifeste invalide : %s)", entry.name, exc)
    return list(_registry.values())


def list_engines() -> List[dict]:
    if not _registry:
        scan_engines()
    return list(_registry.values())


def active_engine() -> Optional[dict]:
    """Premier moteur au statut 'active' (v1 : un seul moteur actif à la fois)."""
    for manifest in list_engines():
        if manifest.get("status") == "active":
            return manifest
    return None


def load_layer(engine_id: str, layer_module: str) -> ModuleType:
    """Charge engines/{id}/pipeline/{layer_module}.py par chemin de fichier (cache par processus)."""
    cache_key = engine_id + "/" + layer_module
    if cache_key in _module_cache:
        return _module_cache[cache_key]
    path = Path(config.ENGINES_DIR) / engine_id / "pipeline" / (layer_module + ".py")
    if not path.exists():
        raise FileNotFoundError("Couche introuvable : %s" % path)
    spec = importlib.util.spec_from_file_location("ragdom_engine_" + engine_id.replace("-", "_") + "_" + layer_module, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _module_cache[cache_key] = module
    return module


def clear_layer_cache() -> None:
    """Déchargement des modules de couches (Cycle de Vie des Moteurs — D2-B)."""
    _module_cache.clear()
