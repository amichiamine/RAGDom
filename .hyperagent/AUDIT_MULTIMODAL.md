# AUDIT MULTIMODAL — extraction → stockage → rendu (2026-08-22, V4.2)

Audit demandé par l'utilisateur : « certaines illustrations sont encore affichées
en WebP/image, je n'arrive pas à distinguer les types de formats dans la Library,
et beaucoup sont censées être extraites en LaTeX/KaTeX mais ne le sont pas ».

Méthode : lecture du code (backend + frontend), SQL direct sur la base LIVE
exportée, et contrôle visuel au navigateur sur https://ragdom.onrender.com.
Chaque chiffre ci-dessous est MESURÉ, pas estimé.

---

## 1. ÉTAT RÉEL MESURÉ (base live `1AM_math_official-books.sqlite`, 993 artefacts)

| artifact_type | total | structuré (`raw_data`) | bitmap seul | % structuré |
|---|---:|---:|---:|---:|
| latex_formula | 613 | 605 | 8 | 99 % |
| **dense_illustration** | **312** | **0** | **312** | **0 %** |
| data_table | 37 | 32 | 5 | 86 % |
| geometry_vector | 21 | 21 | 0 | 100 % |
| matrix | 7 | 7 | 0 | 100 % |
| signal_waveform | 2 | 2 | 0 | 100 % |
| flowchart | 1 | 1 | 0 | 100 % |
| **TOTAL** | **993** | **668** | **325** | **67 %** |

Marqueurs VLM : `vlm_exploded_at` 12 · `vlm_qualified_at` 43 · `vlm_failed_at` 4.
Sémantique : exercise_support 72 · illustration 26 · demonstration 5.
Ancrage in-situ : 45 / 255 chunks contiennent `asset://artifacts/`.
Renderers déclarés : katex 620 · openseadragon 213 · tanstack-table 37 · svg 21 ·
plotly 2 · mermaid 1 → **99 `dense_illustration` n'ont AUCUN render_config_json**.

### Décomposition des 312 `dense_illustration` non structurées
- 167 sont des **cadres pleine page** (`area_ratio` > 0,70) : 12 explosés, **155 restants**.
- 145 sont des illustrations normales (≤ 0,70) : 43 qualifiées photo/other, 4 en échec,
  **98 JAMAIS soumises au VLM**.

**Le WebP n'est jamais perdu** : `raw_binary` est conservé en toutes circonstances
(vérifié : aucun UPDATE ne l'écrase). Le problème n'est pas le stockage mais la
**production** de `raw_data`.

**Règle de distinction (contrat §12.1.2-3)** : un artefact est structuré si et
seulement si `raw_data` est non vide. `artifact_type` NE SUFFIT PAS — un artefact
qui aurait dû être `geometry_vector` mais dont la structuration a échoué reste typé
`dense_illustration` avec `raw_data = NULL`.

---

## 2. ÉCARTS BACKEND (pourquoi ça reste des images)

| # | Cause | Emplacement | Impact |
|---|---|---|---|
| B1 | **`layer_2_extract_v2.py` ne qualifie JAMAIS** : aucun appel au qualifier, ni ancrage | `layer_2_extract_v2.py` (tout le fichier) ; chargé si `RAGDOM_INTRA_PAGE_WORKERS>=2` (`orchestrator.py:227-229`) | **0 % structuré** en mode parallèle |
| B2 | PDF natif : tout bloc non-texte typé `image` | `layer_1_triage.py:43` | Formules/tableaux vectoriels → images |
| B3 | Branches `formula`/`table` mortes en natif (`and not ctx["is_native_vector"]`) | `layer_2_extract.py:317, 337, 342` | Pas d'extraction native de tableau/formule bloc |
| B4 | Cadres > 70 % exclus de la qualification à l'ingestion | `layer_2_extract.py:366-367` | Pleines pages jamais structurées sans `explode` |
| B5 | Exceptions VLM avalées → repli silencieux | `artifact_qualifier.py:268` | dense_illustration conservé |
| B6 | Validation stricte SVG (>200 Ko) / Plotly (`data` non vide) | `artifact_qualifier.py:132-153` | Structure rejetée → image |
| B7 | Couche 5 répare en **LaTeX** même un `data_table` | `layer_5_vlm.py:13-14, 47` | raw_data inadapté pour les tableaux |
| B8 | Linter ne valide QUE LaTeX et SVG (ni Mermaid, ni Plotly, ni SMILES) | `layer_4_lint.py:73-75` | Structures invalides non détectées |
| B9 | `artifacts_qualified` / `vlm_provider` jamais persistés | `layer_2_extract.py:376` | Impossible de savoir depuis la base si la qualification a tourné |

**Couverture réelle** : le code sait produire **8 types** (`latex_formula`, `matrix`,
`data_table`, `geometry_vector`, `flowchart`, `signal_waveform`, `smiles_chem`,
`code_snippet`) sur les ~45 sous-types documentés (Blueprint PARTIE 4). Plusieurs
familles **Tier 1 « garanties »** ne sont produites nulle part : `tensor`,
`hierarchical_grid`, `technical_blueprint`, `iso_cut`, `histology_cut`,
`microscopy_photo`, `ast_tree`.

---

## 3. ÉCARTS FRONTEND (pourquoi on ne distingue pas les formats)

| # | Cause | Emplacement | Impact |
|---|---|---|---|
| F1 | **`render_config_json.renderer` JAMAIS lu** ; routage par sous-chaîne de `artifact_type` | `ArtifactRenderer.tsx:35-46` | Le dictionnaire §12 n'est pas appliqué |
| F2 | Renderers **mermaid / plotly / ketcher / shiki NON installés** | `frontend/package.json:25-34` (clés commentées) | flowchart, signal_waveform, smiles_chem, code_snippet → **image + panneau source** |
| F3 | **Aucun indicateur « structuré fidèle » vs « image de repli »** | `ArtifactRenderer.tsx:174-259` | **C'est la confusion signalée par l'utilisateur** |
| F4 | Badge de type présent uniquement dans la galerie, et calculé sur `artifact_type` — pas sur le rendu réel | `PageMedia.tsx:141-150` | Un `smiles_chem` affiché en image porte quand même le badge « صيغة كيميائية » |
| F5 | Comparateur (structuré/original/comparer) réservé à `matrix`/`geometry_vector`/`data_table` | `ArtifactRenderer.tsx:114-115` | Absent là où il serait le plus utile |
| F6 | `MarkdownContent` / `lib/markdown.ts` ne résolvent pas `asset://artifacts/{id}` | `MarkdownContent.tsx:2` | Images cassées dans `SideBySideViewer` |
| F7 | `data_table` rendu en markdown, pas en tanstack-table | `ArtifactRenderer.tsx:153` | Pas de pagination/tri promis par §12 |
| F8 | Formule sans binaire **totalement masquée** de la galerie | `PageMedia.tsx:94` | Contenu invisible |
| F9 | Cache `artifactById` peuplé de façon asynchrone par PageMedia | `CoursTab.tsx:186-203` | Repli image transitoire au 1er rendu |
| F10 | CSS KaTeX chargée depuis un CDN, pas bundlée | `frontend/index.html:11` | Rendu LaTeX cassé hors-ligne (contredit §12.1.1 « plug-and-play ») |

### Contrôle visuel du live (DOM mesuré, onglet Cours déplié)
87 `<img>` (toutes `artifact-binary`, donc WebP) · 662 SVG inline · 85 KaTeX ·
2 tableaux HTML · 0 panneau source visible.
Badges relevés : رسم 94 · شكل 32 · جدول 30 · صيغة 15 · إشارة 2 · مخطط 2 ·
sémantiques : حل 47, سند تمرين 45, توضيح 19, برهان 2.
→ Les badges annoncent bien un **type**, mais **rien n'indique le format réellement
rendu**. Confirmation directe de la plainte utilisateur.

### Verdict par famille « v1 garantie » (§12.1.3)
| Famille | Attendu | Réel | Verdict |
|---|---|---|---|
| latex_formula / matrix / tensor | katex | KaTeX | ✅ OK |
| geometry_vector | svg | SVG inline sanitisé | ✅ OK |
| data_table | tanstack-table | markdown GFM | ⚠️ dégradé |
| flowchart | mermaid | image + source | ❌ image |
| signal_waveform | plotly | image + source | ❌ image |
| smiles_chem | ketcher | image + source | ❌ image |
| code_snippet | shiki | image + source | ❌ image |
| dense_illustration | openseadragon | `<img>` plat | ⚠️ dégradé |

**5 des 9 familles garanties sont dégradées en image.**

---

## 4. PLAN DE CORRECTION RECOMMANDÉ (par rapport valeur/effort)

1. **Indicateur de format** (F3/F4) — badge « مهيكل / أصل » calculé sur le rendu
   effectif, pas sur `artifact_type`. Corrige directement la plainte. Effort faible.
2. **Câbler le qualifier dans `layer_2_extract_v2.py`** (B1) — sinon toute ingestion
   parallèle produit 0 % de structuré. Effort moyen, impact majeur.
3. **Lire `render_config_json.renderer`** en priorité dans `detectFamily` (F1) —
   aligne le frontend sur le contrat §12. Effort faible.
4. **Installer mermaid + plotly** (F2) — débloque 2 familles garanties ; à défaut,
   afficher explicitement « visionneuse non installée » (promesse `package.json:25`).
5. **Résoudre `asset://` dans `lib/markdown.ts`** (F6) — corrige des images cassées.
6. **Finir la structuration** : 155 cadres à exploser + 98 illustrations jamais
   soumises (dépend des quotas Gemini quotidiens ; clés 2/4 définitivement HS en 403).
