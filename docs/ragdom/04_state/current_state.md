# État Actuel du Projet RAGDom

**Phase :** Phase 1 — Backend Pipeline (socle noyau TERMINÉ ; couches moteur en cours)
**Date de mise à jour :** 2026-08-21
**Sprint actuel :** Sprint 1 — Couches du moteur sci-engine

## Ce qui est OPÉRATIONNEL (preuves : pytest 12/12 + uvicorn live)
- [x] Arborescence complète (README §0.2) + venv + whitelist installée
- [x] schema_core.sql / schema_vec.sql extraits de tech_specs, validés (13 tables, triggers OK)
- [x] db/connection.py : sanitisation ?db= (5 attaques bloquées), Option A/B, migrations, config DB
- [x] core/engine_registry.py : sci-engine détecté, manifeste invalide ignoré sans crash
- [x] core/orchestrator.py : queue stricte, recovery (1 transitoire→QUEUED), skip READY, batchs
- [x] main.py + routes_system : serveur démarré, /health (sqlite-vec READY — mode hybride complet),
      /engines (sci-engine actif, accent #2563eb), /databases (scan physique, zéro mock)

## Ce qui est EN COURS
- [ ] Sprint 1 : layers 0→7 + 3bis de sci-engine (voir current_sprint.md)

## Blocages & Points d'Attention
- Aucun blocage. Déviations d'environnement documentées dans feedback_log.md.
- Checkpoint Règle 8 : les 3 templates PHP seront demandés à ArchiSys3.0 avant la Phase 4.

## Prochaine Action Prioritaire
- Implémenter layer_0_cv.py + layer_7_persist.py (chemin critique : page_scans / Base Autonome),
  puis les couches d'extraction, avec les tests D.O.D. RAM/Recovery/INVALID_SOURCE.
