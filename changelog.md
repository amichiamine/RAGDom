# Changelog RAGDom — V3.0 → V3.1 → V3.1.1 → V3.2 → V3.3 → V3.4 → V3.5

**Fichier :** `/docs/ragdom/04_state/changelog.md`
**Date de clôture :** 2026-08-21
**Périmètre :** les 6 documents fondateurs (Blueprint Master, tech_specs, Frontend_UI_Specs, Agents, Skills, README — ex-Prompt de Lancement)
**Statut final :** Corpus V3.5 (Base Autonome) — contre-audit de clôture indépendant : **VERDICT GO** (0 bloquant ; 1 majeure + 9 réserves, toutes corrigées par la passe de clôture §9). **GO Phase 1.**

---

## 2026-08-22 — V5.1 : fusion RRF filtrée par canal

- Les rangs BM25 et vectoriels sont désormais calculés uniquement après application de leur seuil brut respectif ; un voisin vectoriel hors seuil ne peut plus reclasser un résultat lexical valide.
- Les lignes FTS multiples d'un même chunk sont dédupliquées en conservant son meilleur score, avec un ordre stable pour les égalités.
- Test de non-régression dédié ajouté ; pytest 106/106 dans les modes hybride et faible mémoire, TypeScript strict et build Vite verts.

## 0. Chronologie du cycle de révision

| Étape | Événement | Résultat |
|---|---|---|
| 1 | **Audit initial V3.0** (relecture croisée des 6 documents) | ~30 findings classés P0 (bloquants) / P1 (incohérences de contrat) / P2 (angles morts) |
| 2 | **Document de décision — 4 arbitrages de principe** | ArchiSys3.0 valide : **D1-B, D2-B, D3-B, D4-A** |
| 3 | **Patchs V3.1** (96 opérations, script à ancres strictes) | 6 documents amendés ; DDL core validé par exécution SQLite réelle |
| 4 | **Contre-audit indépendant** (second auditeur, lecture à froid) | 15 divergences résiduelles (3 bloquantes) — verdict NO-GO provisoire |
| 5 | **Passe corrective V3.1.1** (31 opérations) | Toutes divergences résolues ; re-scan : zéro résidu |
| 6 | **Vérification PyPI + installation réelle en venv** | Whitelist gelée ; 3 vices d'installation découverts et corrigés ; `import torch` → ImportError (preuve CPU-First) |

---

## 1. Registre des décisions de principe (arbitrages validés)

| ID | Décision | Option retenue | Justification |
|---|---|---|---|
| **D1** | Zéro Dogme vs Vue 2 Library (2G) | **B — Noyau agnostique + Couche Curriculum optionnelle** | La Vue 2 pixel-perfect exigeait des entités (trimestres, programmes MEN, évaluations) absentes du schéma. Le dogme descend de la couche produit vers la couche données : 4 tables `curriculum_*` optionnelles + Mode Repli Générique. Zéro Mock préservé (compteurs = COUNT(*)/GROUP BY). |
| **D2** | Budget RAM 250 Mo vs moteurs d'extraction | **B — Contrat Mémoire à Deux Paliers** | 250 Mo unique était infalsifiable avec les moteurs ML résidents. Plancher structurel ≤ 250 Mo hors moteurs + pic ≤ MAX_RAM_MB (défaut 2048) + Règle du Cycle de Vie des Moteurs (lazy load, un seul moteur lourd résident). |
| **D3** | Promesse d'extraction des 25 familles | **B — Tiering explicite** | La colonne « Moteur » V3.0 mélangeait moteurs réels, moteurs PyTorch interdits et références hallucinées. Les 25 familles restent garanties en STOCKAGE/RENDU ; l'extraction est étagée : Tier 1 natif local (~8 familles), Tier 2 VLM conditionnel, Tier 3 import structuré. |
| **D4** | Débit du traitement séquentiel strict | **A — Assumé + transparence (v1), parallélisme intra-page en add-on v2** | Le séquentiel strict fonde la résilience (recovery, atomicité). Ajout carte ETA & Débit (Vue 3) alimentée par `execution_time_ms` + benchmark de débit baseline au D.O.D. + Phase 6 optionnelle au master_plan. |

---

## 2. Changements par document

### 2.1 Blueprint Master RAGDom.md (V3.0 → V3.1.1)

| Changement | Origine | Justification |
|---|---|---|
| §1.2 — Règle du Zéro Dogme reformulée (« Noyau Agnostique / Vues Data-Driven ») | D1-B | Résout la contradiction fondatrice avec la Vue 2 spécialisée 2G |
| Philosophie + Partie 8 — « <250 Mo RAM » remplacé par le Contrat Mémoire à Deux Paliers | D2-B | L'ancien chiffre unique rendait le D.O.D. inéchouable par construction |
| Partie 4 — Note normative de Tiering (Tier 1/2/3) en tête du tableau des 25 familles | D3-B | Sépare la promesse de rendu (tenue à 100 %) de la promesse d'extraction (étagée) |
| Famille 22 (DICOM) — renderer cible : OpenSeadragon (fallback v1) / Cornerstone.js (add-on) | Contre-audit E4 | Le tableau (Cornerstone) divergeait du dictionnaire render_config_json (openseadragon) |
| §2.2 — Arborescence : ajout `routes_search.py`, `routes_llm.py` ; `schema.sql` → `schema_core.sql` + `schema_vec.sql` + `migrations/` | Audit P1 + Contre-audit E3 | main.py importait des routeurs absents de l'arborescence imposée ; le DDL est scindé pour le fallback vectoriel |
| §5.1 — Inventaire technique réécrit sur la stack Tier 1 réelle (rapid-layout / rapid-latex-ocr / rapid-table / RapidOCR / PyMuPDF4LLM) | Audit P0 + D3-B | Nougat/Surya/TATR/DECIMER/MolScribe = PyTorch/TF interdits ; « Circuitikz parser » et « YOLOv10-Doc ONNX » = références inexistantes/erronées ; GDAL in-installable pip/Windows |
| §5.2 — Schéma ASCII de la Couche 2 réécrit avec les mêmes moteurs Tier 1 (+ VLM Tier 2 / Tier 3) | **Contre-audit E1 (BLOQUANT)** | Le diagramme prescrivait encore les moteurs retirés — un agent Read-Before-Write aurait tenté des pip install interdits |
| §5.2 — Ajout Couche 3bis SolutionLinker (renvoi tech_specs §4.4) | Audit P2 | La liaison Énoncé→Corrigé de fin de manuel est impossible au fil de l'eau en séquentiel strict |
| §6.1 — Design System : dual-theme Dark défaut ; classes `col-*`/`btn-*` = custom CSS (Bootstrap framework toujours interdit) ; Font Awesome autorisé par exception pixel-perfect | Audit P1 (conflit thème clair vs specs dark) | Le Blueprint imposait un thème clair contredit par Frontend_UI_Specs ; arbitré par la Règle 0 de préséance (UI → Frontend_UI_Specs) |
| §6.2 — Note D1-B sous les 6 onglets (compteurs 690/27/272 = exemples, activation conditionnée aux tables curriculum) ; Vue 3 : carte ETA & Débit + bouton Stop câblé sur `POST /api/pipeline/stop` | D1-B, D4-A | Zéro Mock + transparence du débit |
| §6.3 — « 7 Steps Pills » → « 8 Step Pills (0→7) » | Audit P1 | 8 couches = 8 pills (off-by-one) |
| Partie 7 — Contrat API consolidé : `page-scan` en binaire `image/webp` (fin du base64 JSON) ; sémantique batch (`/start` → `batch_id`, `/status?batch_id`, `DELETE /batch/{id}`) ; **ajouts** : `POST /pipeline/stop`, `GET /library/curriculum`, `POST /search/hybrid-multi`, `GET /llm/keys` (masquées) + `POST /llm/keys/{id}/reveal` ; définition INDEXED vs READY ; SSE 4 événements aux payloads unifiés (`page_number`, `batch_id`, `queue_length`, `pages_indexed`…) ; `document_id` ajouté aux résultats de recherche ; exemples `"version": "3.1"` | Audit P1 + Contre-audit B1/B2/C1-C4 | Le client api.ts et le contrat divergeaient sur les routes, paramètres, réponses et événements SSE |

### 2.2 tech_specs.md (V3.0 → V3.1.1)

| Changement | Origine | Justification |
|---|---|---|
| §1 — DDL scindé `schema_core.sql` / `schema_vec.sql` + Règle d'Application Conditionnelle (drop auto des triggers vec en fallback, re-remplissage au retour hybride) | Audit P0 | Le DDL V3.0 créait `vec_chunks` inconditionnellement → crash de création et d'ingestion précisément dans le scénario que l'Option B devait sauver |
| §1 — Tokenizer FTS5 : `porter unicode61` → `unicode61 remove_diacritics 2` + note « bm25() ASC = meilleur » | Audit P2 | Le stemming porter est anglophone (inutile/nuisible en arabe) ; le sens du score bm25 SQLite est un piège classique |
| §1 — 3 triggers de cohérence FTS ajoutés (DELETE chunks, DELETE artifacts, UPDATE chunks) + trigger `trg_chunks_vec_delete` | Audit P2 | `/pipeline/reset` laissait des entrées fantômes dans `search_index` (validé par test SQLite réel : 1 ligne après insert → 0 après delete) |
| §1 — Table `ingestion_batches` + colonne `pipeline_jobs.batch_id` | Audit P2 | La table était par page mais l'API retournait un job par document : granularité ambiguë |
| §1bis — 4 tables curriculum OPTIONNELLES (`curriculum_terms`, `curriculum_programs`, `assessments`, `content_links`) | D1-B | Support data-driven de la Vue 2 sans violer le Zéro Dogme |
| §1 — `schema_version` initiale → v2 + référence `migration_002_v31.sql` | Migration | Bases V3.0 existantes migrables sans DROP |
| §3.2 — Embedding : `bge-small-en-v1.5` (anglophone, PyTorch) → **`paraphrase-multilingual-MiniLM-L12-v2` via fastembed (ONNX, 384d)** ; note de rejet documentée d'`e5-small` | Audit P2 + **Vérif PyPI** | Le modèle V3.0 était anglophone sur un corpus à priorité arabe ; le candidat V3.1 `multilingual-e5-small` s'est révélé **non supporté par fastembed** (vérifié 0.7.4 et wheel 0.8.0) ; e5-large = 1024d incompatible schéma |
| §3.3 — Seuil anti-hallucination : RRF ≥ 0.015 (ordinal, vide de sens) → seuils bruts (distance cosinus ≤ 0.45 OU bm25 ≤ -1.5), stockés dans `app_settings` | Audit P2 | Un rang 1 passait toujours le seuil ordinal, même sémantiquement nul |
| §3.6 — Indexation bilingue alignée sur le nouveau tokenizer | Contre-audit (résidu) | Cohérence interne |
| §4.2 — VisionWorker : moteurs cités = rapid-layout / rapid-latex-ocr / rapid-table (ex-YOLOv10/Nougat) | Contre-audit E2 | Moteurs fantômes résiduels |
| §4.4 — **Nouvelle section SolutionLinker (Couche 3bis)** : passe post-document algorithmique (regex + TOC), transaction unique, zéro VLM | Audit P2 | Liaisons Énoncé→Corrigé impossibles page à page |
| §5.1 — D.O.D. : test RAM unique → 3 tests (plancher/pic/non-fuite) + Débit Baseline + Fallback Vectoriel + Reset Propre (12 tests backend au total) | D2-B, D4-A | Critères falsifiables et alignés sur le contrat à deux paliers |
| §7 — Table `app_settings` ajoutée à ragdom_config.sqlite (force_sqlite_vec, seuils) | Audit (gap) | §3.3.1 la référençait sans qu'elle soit définie |
| §8 — requirements.txt V3.1.1 **gelé et vérifié** : `anthropic` (ex-`anthropics` inexistant) ; retraits GDAL/sentence-transformers/Nougat/Docling/Surya/TATR/DECIMER/MolScribe ; ajouts `rapid-layout==0.4.0`, `rapid-table==3.0.2`, `rapid-latex-ocr==0.0.9`, `fastembed==0.7.4`, **pin pivot `numpy==1.26.4`** ; procédure post-install opencv-headless | Audit P0 + **Vérif PyPI** | `pip install` V3.0 échouait à la première ligne ; conflit numpy découvert (rapid-layout ≥1.0 exige numpy≥2 vs rapidocr/latex-ocr <2) ; rapid-* tirent opencv-python complet (libGL) |
| §9 — package.json : `openseadragon` (casse npm corrigée), ajouts `marked` + `three`, version 3.1.0, Note Tiering des renderers différés | Audit P1 | `marked` était exigé par le moteur KaTeX monopasse sans être installé ; whitelist fermée vs 25 familles |
| §10 — .env : `MAX_RAM_MB=2048` (palier pic) + `RAGDOM_FORCE_SQLITE_VEC` ajouté | D2-B + Contre-audit E10 | Variable promise par §3.3.1 mais absente du bloc normatif |
| §11 — Registre modèles purgé : entrée `yolov10_doc.onnx/onnx-community/yolov10n` SUPPRIMÉE (modèle COCO générique — référence erronée), Nougat SUPPRIMÉ ; règle hash SHA256 ; vérification PyPI consignée | Audit P0 + Vérif PyPI | Registre hallucination-proof |
| §12 — render_config_json complété (bim_ifc_slice, geogebra_xml, phonetic_tree, hieroglyph_vector) | Audit P1 | Familles omises du dictionnaire |
| §14/§15 — pagination hybrid-multi ; main.py : import + montage `search_router`, `version="3.1.0"` | Audit P1 + Contre-audit E6 | Le router search n'était jamais monté dans le squelette imposé |

### 2.3 Frontend_UI_Specs.md (V3.0 → V3.1.1)

| Changement | Origine | Justification |
|---|---|---|
| §1.5 — Police Inter ajoutée au lien Google Fonts (mode LTR) | Audit P2 | Police citée pour FR/EN mais jamais chargée |
| §3.1 — Types corrigés : `LlmKey.api_key` → `masked_key` ; `SearchResult` aligné contrat (content_markdown, bm25_rank, vec_rank, database_filename?) ; `PipelineSSEEvent` réécrit champ-par-champ sur le contrat SSE (ram_mb, latency_ms, queue_length, pages_indexed, artifacts_extracted, error, details) ; **nouveaux types** : BatchStatus, BatchStatusResponse, CurriculumTerm/Program/Assessment/ContentLink/CurriculumPayload ; commentaire raw_binary | Audit P1 + **Contre-audit B1/C1-C4 (BLOQUANTS)** + D1-B | La fuite de clés en clair et les payloads SSE non typés auraient cassé silencieusement à l'exécution |
| §4.4 — api.ts réconcilié : `submit` (route inexistante) → `start(payload batch)` ; `getStatus(batchId)`, `stop()`, `cancelBatch()` ; `reset(documentId?)` optionnel ; `getPageScanUrl` param `page` (URL valide en `<img src>`) ; `getCurriculum`, `hybridMulti`, `revealKey` ; `filters` conditionnel ; types de retour complets (message, engine) | Audit P1 + Contre-audit A1/A2/B3/D2 | Le client appelait des routes inexistantes et fabriquait des URLs d'image pointant sur du JSON |
| §5.2 — **Préambule Mode Repli Générique** (curriculum_available=false → exploration générique ; compteurs = exemples, jamais constantes) ; bootstrap.Collapse → équivalent React contrôlé | D1-B + Audit P1 | Résout le conflit Zéro Mock vs 6 onglets 2G |
| §5.3 — Carte ETA & Débit ajoutée ; « 7 step-pills » → 8 ; bouton Stop câblé sur api.pipeline.stop() | D4-A | Transparence du débit séquentiel |
| §6 — Règles 12 (classes custom, Bootstrap interdit) et 13 (Mode Repli) ajoutées | Audit P1 | Les specs utilisaient des classes bootstrap-like sans statuer sur le framework |

### 2.4 Agents.md (V3.0 → V3.1.1)

| Changement | Origine | Justification |
|---|---|---|
| **Règle 0 — Hiérarchie d'Autorité des Documents** (SQL/DTO → tech_specs ; API → Blueprint P7 ; UI → Frontend_UI_Specs ; comportement → Agents ; templates PHP = référence visuelle seulement) | Audit P1 | Trois documents revendiquaient « l'autorité absolue » sans règle de résolution de conflits |
| Règle 2 — Vocabulaire étendu : SolutionLinker (Couche 3bis), ingestion_batches, tables curriculum | V3.1 | L'agent a interdiction d'inventer des noms : le vocabulaire officiel devait les inclure |
| master_plan — Phase 0 : vérification pip **cochée [x]** (faite le 2026-08-21, versions consignées) ; Phase 1 : schema_core/vec + layer_3bis_link.py ; Phase 2 : routes_search + /stop ; Phase 4 : Sprint Curriculum & Mode Repli + Carte ETA ; Phase 5 : benchmarks RAM 3 paliers + baseline débit ; **Phase 6 optionnelle** (parallélisme intra-page, D4-B) | Tous | Plan aligné sur le contrat V3.1.1 |

### 2.5 Skills.md (V3.0 → V3.1.1)

| Changement | Origine | Justification |
|---|---|---|
| §2.2 — rapid-layout remplace YOLOv10-Doc dans les modèles ONNX exécutés | Contre-audit E2 | Moteur fantôme résiduel |
| **§2.2bis — Règle du Cycle de Vie des Moteurs ML** (lazy load, un seul moteur lourd résident, vérification retour au plancher) | D2-B | Cœur opérationnel du contrat à deux paliers |
| §2.3 — Stack de moteurs réécrite avec marquage Tier ; liste explicite des retraits v1 | D3-B | Restreint les compétences de l'agent aux moteurs réels |
| §3.2 — Tokenizer `unicode61 remove_diacritics 2` + note bm25 ASC | Audit P2 | Recherche arabe |
| §3.3 — Seuils bruts (0.45 / -1.5) via app_settings | Audit P2 | Anti-hallucination réel |
| §3.4 — `get_connection` : sanitisation anti path-traversal du `?db=` (regex + realpath → HTTP 400) | Audit P2 | `?db=../../x.sqlite` échappait de DATABASES_DIR |

### 2.6 Prompt de Lancement RAGDom.md (V3.0 → V3.1.1)

| Changement | Origine | Justification |
|---|---|---|
| Comptages corrigés : « 7 tables, 2 triggers » → 9 tables cœur + batches + 4 curriculum, 5 triggers FTS + 2 vec conditionnels ; « 7 tests » → 12 backend + 6 frontend | Audit P1 | Les comptages V3.0 étaient faux dès l'origine (9 tables/3 triggers réels) — pièges pour un agent au mot près |
| Descriptions mises à jour : Couche 3bis, paraphrase-multilingual-MiniLM-L12-v2, seuils réels, Mode Repli, carte ETA, Règle 0 (+8 règles) | Tous | Fidélité au corpus V3.1.1 |
| 5 contraintes ajoutées à la liste d'assimilation : Préséance, Deux Paliers, Tiering, Mode Repli, Whitelist Gelée & Vérifiée | Tous | L'agent doit reformuler ces contraintes au démarrage |

---

## 3. Whitelist Python gelée (vérifiée le 2026-08-21)

**Méthode :** API PyPI JSON + installation réelle en venv propre + tests d'import + preuve d'absence de torch (`import torch` → ImportError).

| Paquet | Version gelée | Note de vérification |
|---|---|---|
| rapid-layout | **0.4.0** | Dernière version compatible numpy<2 (≥1.0.0 exige numpy≥2 → exclu) |
| rapid-table | **3.0.2** | torch = extra optionnel `[torch]`, NON installé |
| rapid-latex-ocr | **0.0.9** | Exige numpy<2 ; Python <3.13 ✔ |
| fastembed | **0.7.4** | Supporte paraphrase-multilingual-MiniLM-L12-v2 (384d) ; ne supporte PAS e5-small |
| numpy | **1.26.4** | **PIN PIVOT** — résout le conflit numpy<2 (rapidocr, latex-ocr) vs numpy≥2 (rapid-layout récent) |
| anthropic | 0.34.2 | Corrigé (le paquet `anthropics` n'existe pas) |

**Procédure post-install obligatoire :** `pip uninstall -y opencv-python opencv-contrib-python && pip install opencv-python-headless==4.10.0.84` (les rapid-* tirent l'opencv complet, dépendant de libGL).

---

## 4. Réserves restantes (connues, non bloquantes)

1. **Python du test = 3.9** (cible : 3.11). La résolution pip peut différer marginalement ; toutes les contraintes `requires_python` des paquets gelés couvrent 3.11. À re-confirmer au premier `pip install` sur la machine cible (tâche Phase 0 restante : consigner les hashs SHA256 des modèles au premier run).
2. **Qualité effective des moteurs RapidAI** sur les scans réels du corpus 2G (précision layout/LaTeX) : à mesurer au benchmark Phase 1 — la baseline de débit du D.O.D. servira aussi de baseline qualité.
3. **rapid-table 3.x** : API récente (refonte majeure vs 1.x/2.x) — vérifier la signature d'appel exacte lors de l'implémentation de la Couche 2 (Règle 3 : jamais supposer une API).

---

*Généré et archivé le 2026-08-21 — cycle complet : audit initial → 4 arbitrages (D1-B/D2-B/D3-B/D4-A) → patchs V3.1 (96 ops) → contre-audit indépendant (15 divergences) → passe corrective V3.1.1 (31 ops) → vérification PyPI & gel de whitelist.*


---

## 5. V3.1.1 → V3.2 : Couverture Totale (2026-08-21)

**Déclencheur :** audit de couverture UI/UX par parcours utilisateur — 13 angles morts identifiés (7 « promis par le backend sans UI », 6 « attendus d'un produit de ce type ») + demande explicite d'ArchiSys3.0 d'une purge scopée multi-niveaux. Décision : tout combler dans la spécification (aucun report en backlog silencieux).

| Ajout | Documents touchés | Ce que ça couvre |
|---|---|---|
| **Blueprint Partie 7.6** — contrat API Administration complet | Blueprint | `/search/ask` (chat RAG, zéro appel LLM si aucun chunk éligible), `/pipeline/purge` (7 portées + dry_run + confirm), quarantaine + retry, PUT chunks/artifacts, sources (upload/dossiers/suppression), export/duplication/suppression de bases, settings whitelistés, benchmarks paginés, curriculum CRUD + import, import artefacts Tier 3 ; `/pipeline/reset` déprécié en alias |
| **Purge Scopée Multi-Niveaux** | Blueprint §7.6, tech_specs §4.5, Frontend §7.4 | page → plage → chapitre (sous-arbre TOC) → document → base (double saisie du nom) → artefacts seuls → curriculum seul ; prévisualisation d'impact obligatoire (dry_run) ; protection des corrections manuelles |
| **Correction Humaine** | tech_specs (colonnes `is_human_edited` + §4.5 + migration_003), Frontend §7.3 | éditeur Markdown/KaTeX live, re-lint + re-embed + resync FTS/vec ; contenus corrigés JAMAIS écrasés par ré-ingestion ni purge (sauf scope base) |
| **Chat RAG (AskStudio)** | Blueprint §7.6 + §6.2, tech_specs §4.5, Frontend §7.1 | comble le trou entre tech_specs §3.4 (contexte LLM spécifié) et l'UI ; citations cliquables, cas no_context sans invention |
| **Vue 3 : 8 panneaux d'administration** | Blueprint §6.2, Frontend §7.4-7.11 | PurgeStudio, QuarantineManager, SourcesManager, DatabaseLifecycle, SettingsPanel (seuils anti-hallucination à chaud), TelemetryExplorer (exploitation de processing_benchmarks), CurriculumStudio (sortie du Mode Repli), ArtifactImportModal (Tier 3) |
| **SearchStudio multi-bases** | Frontend §7.2 | expose enfin `/search/hybrid-multi` (V3.1) dans l'UI |
| **États système & Onboarding** | Blueprint §6.5, Frontend §7.12 | premier lancement guidé (zéro base), ConnectionGuard backend injoignable, états vides normés |
| **Accessibilité normative** | Blueprint §6.5, Frontend §7.13 | clavier complet, focus-trap, ARIA, prefers-reduced-motion, contrastes AA sur les 2 thèmes |
| **D.O.D. étendu** | tech_specs §5 | 15 tests backend (+Purge Scopée, +Correction Humaine, +Ask Anti-Hallucination) et 8 tests frontend (+AskStudio Citations, +PurgeStudio Dry-Run) |
| **master_plan Phase 4B** | Agents.md | 11 lots de travail Administration & Couverture Totale, gating inchangé |

**Schéma :** `schema_version` → 3 (migration_003_v32.sql : `ALTER TABLE … ADD COLUMN is_human_edited INTEGER DEFAULT 0` sur document_chunks et scientific_artifacts). Aucune table nouvelle — la V3.2 est purement additive (Règle d'Or respectée).

**Hors périmètre documentaire (rappel) :** le skill motion-design reste un module séparé livré dans `.agents/skills/motion-design/` (découverte native Antigravity), non fusionné dans Skills.md — décision ArchiSys3.0 du 2026-08-21.


---

## 6. V3.2 → V3.3 : Confort & Ergonomie (2026-08-21)

**Déclencheur :** directive ArchiSys3.0 — l'interface doit être non seulement technique (ingestion, gestion, contrôles, éditions fines à chaque micro-étape du cycle de vie) mais **confortable, ergonomique et fluide**, dimensionnée pour la manipulation de masses de données hétérogènes, et préparée à la cohabitation de plusieurs moteurs dans `/engines/`.

| Ajout | Documents | Détail |
|---|---|---|
| **README.md (ex-Prompt de Lancement)** | renommage + §0 Déploiement | Le package est transmis tel quel à l'agent : §0 définit l'extraction à la racine, l'arborescence à créer (dont `/engines/sci-engine/` et `/Template_UI-UX/` vide), l'archivage du changelog, la checklist de vérification, et l'interdiction de déplacer les .md fondateurs et `.agents/skills/` |
| **Motion Design System normatif** | Frontend PARTIE 8.1, Blueprint §6.6 | Tokens `--dur-1..4` / `--ease-out-*` + table d'application par composant (issue du skill motion-design) ; legacy pixel-perfect conservé ; zéro animation haute fréquence ; linear pour le temps |
| **Ergonomie de masse** | Frontend §8.2 | Virtualisation obligatoire >100 éléments (`@tanstack/react-virtual` ajouté à la whitelist), densité compact/confortable, sélection en masse + barre d'actions flottante, **Command Palette Ctrl+K**, sticky headers, opérations longues non-bloquantes |
| **Confort de feedback** | Frontend §8.3 | Toasts unifiés avec Annuler 5s, optimistic UI mesuré (jamais sur le destructif), skeletons à forme réelle, **Inspecteur de Cycle de Vie par page** (chronologie couches 0→7, timings/RAM/confiance), compteurs animés |
| **Identité multi-moteurs & couleurs** | Frontend §8.4, Blueprint §6.6 | Token `--engine-accent` (sci-engine = Cobalt) + badge moteur en Topbar — retheming d'un futur moteur en une variable ; **couleurs de domaine algorithmiques** (hash→HSL, Zéro Dogme préservé) ; couleurs sémantiques réservées aux états ; élévation normalisée 3 niveaux |
| **D.O.D. étendu** | tech_specs §5.2 | +2 tests frontend : Virtualisation 60fps/DOM borné, Command Palette clavier — total **15 backend + 10 frontend** |
| **master_plan Phase 4B** | Agents.md | +1 lot PARTIE 8 ; Règle 1 : README.md ajouté en position 0 de la liste Read-Before-Write |


---

## 7. V3.3 → V3.4 : Architecture Multi-Moteurs (2026-08-21)

**Déclencheur :** contradiction relevée par ArchiSys3.0 — le Blueprint plaçait TOUT le code du moteur scientifique (couches 0→7, modèles ONNX) dans `/backend/pipeline/` alors que `/engines/sci-engine/` était décrit comme « le moteur actuel » mais restait vide. À l'arrivée des moteurs futurs (legal-engine, medical-engine…), leurs pipelines, scripts et configs se seraient mélangés dans `/backend/`.

| Changement | Documents | Détail |
|---|---|---|
| **Noyau agnostique** | Blueprint §2.2 | `/backend/pipeline/` → `/backend/core/` (orchestrator générique + engine_registry) ; le backend ne contient plus AUCUN code métier d'extraction |
| **Moteur autonome** | Blueprint §2.1 | `/engines/sci-engine/` = `engine.json` (manifeste) + `pipeline/` (couches 0→7+3bis) + `models/` (layout, ocr, dewarp, table, math) — zéro mélange entre moteurs |
| **Contrat de Moteur §4.6** | tech_specs | L'interface d'un moteur = les contrats DTO §2 ; schéma imposé du manifeste engine.json ; engine_registry (scan ENGINES_DIR, import dynamique, manifeste invalide → WARN sans crash) ; ajout d'un moteur = zéro modification du noyau (Règle d'Or) |
| **Modèles par moteur** | tech_specs §11 | Modèles ONNX du moteur → `/engines/sci-engine/models/` ; embedding (fonction noyau de recherche) reste dans `/backend/models/embedding/` ; `.env` : + `ENGINES_DIR`, main.py vérifie la variable |
| **Route registre** | Blueprint §7.6, Frontend §7.14/§8.4 | `GET /api/system/engines` (manifestes + moteur actif) — alimente le badge moteur Topbar et `--engine-accent` ; type `EngineManifest` + `api.system.getEngines()` |
| **master_plan Phase 1** | Agents.md | + engine_registry + engine.json ; couches implémentées dans `/engines/sci-engine/pipeline/` ; orchestrator → core/ |
| **Harmonisation des versions** | les 7 documents | Tous les en-têtes alignés sur 3.4 (Skills.md était resté à 3.1 — la checklist de déploiement du README §0.3 aurait échoué) |


---

## 8. V3.4 → V3.5 : Base Autonome (2026-08-21)

**Déclencheur :** audit de complétude du schéma demandé par ArchiSys3.0 — « l'UI/UX consomme et affiche 100% du contenu de la base, sans rien simuler ni récupérer ailleurs que dans le(s) .sqlite ». Verdict : la promesse de Portabilité Totale était STRUCTURELLEMENT fausse — les scans de pages n'étaient stockés dans AUCUNE table.

| Trou détecté | Gravité | Correction |
|---|---|---|
| **Scans de pages sans table** — SideBySideViewer, galerie, Overlay Diff, previews, modale HD consommaient `/library/page-scan` sans source en base (WebP de la Couche 0 purgés avec /pipeline-set/, sinon relecture de /sources/ = dépendance externe) | **BLOQUANT** (portabilité) | **Table `page_scans`** (image_webp pleine résolution + thumb_webp vignette + width/height/dpi, UNIQUE(document_id,page_number), CASCADE) — persistée par la Couche 7, incluse dans les purges, servie par la route page-scan (+ `&thumb=true`, en-têtes `X-Scan-Width/Height`) |
| Dimensions de page introuvables (conversion BBox → CSS % du §4.5 sans source) | MAJEUR | `width_px`/`height_px` dans page_scans + en-têtes HTTP dédiés ; règle 12bis (jamais de dimensions devinées) |
| Numéro d'exercice affiché en badge (Vue 2) mais jamais stocké (extrait par regex puis jeté) | MAJEUR | Colonne `document_chunks.pedagogical_index` (posée par la Couche 3, réutilisée par SolutionLinker) + DTO Couche 3 étendu |
| Type TS `Chunk` sans `is_human_edited` (colonne V3.2 jamais exposée au front) ni date de correction | MINEUR | `Chunk.is_human_edited`, `Chunk.pedagogical_index`, `updated_at` (chunks + artifacts, posé à chaque correction humaine) |
| Grilles chargeant la pleine résolution (272 vignettes × 300 DPI) | PERF | Vignette `thumb_webp` + règle 12bis : grilles = thumb, pleine résolution réservée au viewer/modale |

**Schéma :** `schema_version` → 4 (`migration_004_v35.sql` : CREATE page_scans + ALTER pedagogical_index/updated_at ; backfill des scans par ré-ingestion Couche 0+7 seule pour les bases existantes). **D.O.D. : +1 test backend « Base Autonome »** (copier le .sqlite seul → 100% du contenu servi, zéro accès hors /databases/) — total **16 backend + 10 frontend**. Périmètre restant hors base documentaire (voulu) : historique de chat AskStudio (mémoire de session v1) et configuration système (ragdom_config.sqlite, séparée par conception).

---

## 9. Passe de clôture post contre-audit final (2026-08-21) — VERDICT GO

Contre-audit indépendant du corpus V3.5 complet (7 fichiers, 4748 lignes) : **0 BLOQUANT, 1 MAJEUR, 5 MINEURS, 4 COSMÉTIQUES** — axes API↔client↔types (A) et README (D) déclarés PROPRES, comptages tous confirmés par recomptage (16+10 tests, 9 tables cœur, 5+2 triggers). Verdict : **GO conditionné à la passe suivante, appliquée immédiatement** :

| Réf | Sévérité | Correction |
|---|---|---|
| C-1 | MAJEUR | Pattern `load_model` §11 rendu conscient des moteurs : `engine_id` → `{ENGINES_DIR}/{id}/models/`, sinon MODELS_DIR (embedding) — dewarp redevient chargeable |
| B-1 | MINEUR | `RestorationResult` + `width_px`/`height_px` + règle : la Couche 7 persiste page_scans depuis le Pixmap restauré (source unique des dimensions BBox) |
| C-2 | MINEUR | Test-After-Write scindé : import package pour /backend, importlib par chemin de fichier pour les couches moteur (tiret dans l'id) |
| C-3 | MINEUR | Exemple de Plan Chirurgical : `/engines/sci-engine/pipeline/layer_X_xxx.py` |
| E-1 | MINEUR | Exemples health `"version"` → "3.5" (Blueprint + tech_specs) |
| E-2 | MINEUR | package.json et FastAPI `version` → 3.5.0 (Swagger affichera la bonne version) |
| C-4 | COSM. | Commande de démarrage Skills harmonisée sur tech_specs §15 |
| C-5 | COSM. | §4.6 : chargement des couches par chemin de fichier (importlib), jamais `import engines.sci-engine` |
| CWD | COSM. | CWD Lock : ajout du répertoire `engines\` |

**Le corpus V3.5 est clos : GO Phase 1 définitif.**

---

## 2026-08-22 — V4.2 : fix boucle d'explosion des cadres pleine page (DÉPLOYÉ)

- **`POST /api/pipeline/requalify-artifacts` (mode `explode`)** : le marqueur de SUCCÈS
  `vlm_exploded_at` est désormais TOUJOURS exclu de la sélection de requalification
  (`render_config_json NOT LIKE '%vlm_exploded_at%'`), y compris sous `retry_failed`
  (qui vise les ÉCHECS à retenter, pas les succès à refaire). Sans cette exclusion,
  les cadres déjà explosés restaient éligibles à chaque passe (`ORDER BY page_number`
  + `limit` → toujours le MÊME lot) : la boucle ne convergeait jamais vers `frames=0`
  et re-créait des sous-artefacts en doublon. Garde d'idempotence conservée côté
  `_explode_fullpage_frames`. Source : `backend/api/routes_pipeline.py`.

## 2026-08-22 — V4.3 : correctifs pipeline + structure documentaire + contrat de rendu

**Backend**

- **Équivalence v1/v2 STRICTE de la Couche 2** (`engines/sci-engine/pipeline/layer_2_extract_v2.py`) :
  la variante parallèle (`RAGDOM_INTRA_PAGE_WORKERS ≥ 2`) exécute désormais la MÊME
  qualification VLM séquentielle post-pool et le MÊME ancrage in-situ que la v1, par
  réutilisation directe des helpers v1 (`_vlm_qualifier`, `_apply_qualification`,
  `_anchor_artifacts`, seuil `_AREA_RATIO_MAX`) — zéro duplication de logique moteur,
  exclusion identique des cadres > 0,70 d'`area_ratio`, `raw_binary` intouché.
- **Sommaire incrémental + plages de pages fiables** (`backend/core/orchestrator.py`,
  `engines/sci-engine/pipeline/layer_1_triage.py`) : le sommaire de repli dérivé des
  titres est construit AU FIL DE L'EAU pendant l'ingestion (nouvelle variable d'env
  `RAGDOM_TOC_INCREMENTAL_EVERY`, défaut 10 pages, 0 = désactivé) en plus du rebuild
  complet au finalize ; jamais d'écrasement d'un sommaire natif. `page_end` corrigé
  (fin d'une entrée de niveau N = page du prochain titre de niveau ≤ N STRICTEMENT
  postérieur − 1, borné) — fini les plages « X → dernière page » ; le TOC natif reçoit
  aussi un `page_end` calculé (plus de `NULL` forçant un `COALESCE` à 100000).
- **Classification pédagogique arabe renforcée** (`engines/sci-engine/pipeline/layer_3_qualify.py`) :
  normalisation des harakat (U+064B-U+0652, alef superscript, tatweel) avant qualification ;
  marqueurs arabes nus sans numéro (تمرين/تمارين/نشاط/أنشطة/وضعية + rubriques
  أتذكر/أتحقق/أطبق/أتدرب…) ; ordre de test solutions AVANT exercices (« حل التمرين N »
  classé `solution_only`) ; ancrage en tête de ligne des marqueurs FR/évaluation
  (fini les faux positifs « BAC » angle géométrique et « TP » bruit OCR).
- **Liaisons relationnelles exposées** (`backend/api/routes_library.py`) :
  `GET /api/library/chunks` expose désormais `linked_solution_chunk_id` et `toc_id`
  par chunk + filtre optionnel `has_solution`.

**Frontend**

- **Application du contrat de rendu §12** (`frontend/src/components/library/ArtifactRenderer.tsx`) :
  `render_config_json.renderer` lu EN PRIORITÉ (repli heuristique de type) ; `mermaid`
  et `plotly.js-dist-min` EMBARQUÉS (imports dynamiques → rendu structuré natif de
  flowchart/signal_waveform) ; `ketcher`/`shiki` restent NON installés avec étiquette
  « visionneuse non installée » ; NOUVEAU badge d'état de rendu (structuré / original /
  visionneuse non installée) calculé sur le rendu EFFECTIF + badge de type in-situ ;
  `data_table` via tanstack-table (tri par colonne, repli markdown) ; comparateur étendu
  à mermaid/plotly ; résolution `asset://artifacts` et `asset://figures` dans
  `lib/markdown.ts` ; formule structurée sans binaire rendue en KaTeX (plus masquée).
- **Structure & navigation curriculum** (`frontend/src/components/library/curriculum/tabs/`) :
  capsules de plages fiabilisées côté client (validation du `page_end` API + recalcul
  par niveaux, plage d'une page « ص N ») ; badges de type effectif dans l'onglet Cours
  avec ponts dorés vers Exercices/Évaluations (aucun contenu masqué) ; navigation
  bidirectionnelle exercice↔corrigé (priorité au `linked_solution_chunk_id` backend,
  replis locaux `course_exercise` puis `pedagogical_index`) ; pont chunk→scan de page ;
  préchargement des artefacts par plage de pages (fini le repli image transitoire).

**Exploitation / ops**

- Bases enrichies **republiées** en assets de la release `corpus-1am-v1` — procédure
  imposée par le disque Render éphémère : **export authentifié → republication de
  l'asset → seulement ensuite redéploiement** (sinon la base enrichie est perdue au
  réveil). Seed local via `npm run fetch:dbs` (`scripts/fetch_published_dbs.mjs`,
  variables `RAGDOM_RELEASE_REPO`/`RAGDOM_RELEASE_TAG`/`RAGDOM_PUBLISHED_DBS`).
- Clés Gemini 2 et 4 **définitivement 403 `PERMISSION_DENIED`** (permission projet,
  PAS un rate-limit : la rotation ne les récupère pas — à désactiver, pas à retenter).

**Documentation alignée (le code fait référence) :** Blueprint §5.2 (équivalence v1/v2),
§6.2 (contrat de rendu ArtifactRenderer + structure/navigation), §7.2 (chunks :
`linked_solution_chunk_id`/`toc_id`/`has_solution`), §7.4 (sommaire incrémental + plages
fiables) ; tech_specs §3.6 (classification AR), §10 (`RAGDOM_TOC_INCREMENTAL_EVERY` +
équivalence v1/v2), §12 (renderer lu en priorité + indicateur d'état de rendu) ;
README §0bis (seed local) ; GUIDE_UTILISATEUR §5 ; current_state.md.
