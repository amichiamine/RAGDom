# Décisions d'architecture (POURQUOI)

## 2026-08-21 — Extraction programmatique du DDL
schema_core.sql / schema_vec.sql sont EXTRAITS du bloc SQL de tech_specs.md par script
(regex sur les sections vec), pas retranscrits : zéro risque de divergence avec la
source de vérité. Toute évolution du DDL passe par tech_specs d'abord.

## 2026-08-21 — Couches moteur chargées par chemin de fichier
engine_registry.load_layer utilise importlib.util.spec_from_file_location sur
engines/{id}/pipeline/layer_N.py : un id avec tiret (sci-engine) n'est pas un module
Python. Cache par processus, purgeable (Cycle de Vie des Moteurs D2-B).

## 2026-08-21 — Contrat de couche : run(ctx) -> ctx
Chaque layer expose run(ctx: dict) -> dict ; ctx transporte les DTO de tech_specs §2
entre couches (en RAM, jamais sérialisés hors checkpoints /pipeline-set/).
status='INVALID_SOURCE' dans ctx stoppe le document ; skip_remaining_layers permet
à layer_4 de sauter layer_5 quand is_valid=true (économie de quota VLM).
