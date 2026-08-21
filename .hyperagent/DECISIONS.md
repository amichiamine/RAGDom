# DECISIONS — architecture et choix actés (ne pas re-débattre)

- D1 : /ask ne répond JAMAIS sans sources (no_context honnête, zéro appel LLM
  si aucun chunk éligible). Vérifié en réel.
- D2-B : contrat mémoire deux paliers, pipeline séquentiel par page ; UNE base
  à la fois (worker unique + file d'attente chaînée multi-bases).
- D3-B : extraction multi-moteurs Tier 1 (PyMuPDF4LLM natif / RapidOCR scan)
  + Tier 2 VLM : réparation d'artefacts (couche 5) ET OCR de page entière
  (couche 2, ajouté 2026-08-21 — les scans arabes exigent un VLM).
- D4-A : l'unité d'exécution est la PAGE (pas de couche isolée) ; la
  ré-exécution scopée = purge + toutes couches sur le périmètre.
- Nommage bases : chemin sous /sources/ → underscores (1AM/math/sources →
  1AM_math_sources.sqlite) — tech_specs §13.
- Auth : username+scrypt dans ragdom_config.sqlite ; session Bearer via
  access_policy ; setup gardé par RAGDOM_AUTH_TOKEN env sur le web.
- Modèle LLM lié À LA CLÉ (pas au provider) ; provider = repli. Même clé
  enregistrable N fois avec N modèles (quotas distincts).
- Sommaire : signets natifs si présents, SINON dérivation des titres Markdown
  au finalize (jamais d'écrasement d'un sommaire natif).
- Library : coquille pixel-perfect library.php TOUJOURS active ; Matrice/
  Programme exigent le curriculum (empty-state élégant + CTA) ; ?classic=1.
- Livraison des bases ingérées : assets de release (pas dans le dépôt, limite
  100 Mo) ; databases_publiees/ = mécanisme de pré-chargement.
