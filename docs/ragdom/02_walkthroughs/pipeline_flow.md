# Flux du pipeline (état réel au 2026-08-21)

Orchestrateur (noyau /backend/core) : QUEUED → [layer_0..7 du moteur actif via registre]
→ INDEXED → READY. Recovery au démarrage (transitoires→QUEUED), skip des pages READY,
retry→QUARANTINE à MAX_RETRY_COUNT, INVALID_SOURCE sans retry. Événements SSE :
page_update / queue_update / job_complete / error (payloads Blueprint §7.4).
Les couches 0→7 de sci-engine : EN COURS (Sprint 1).
