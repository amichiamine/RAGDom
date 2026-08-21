# Sprint « Parité Pixel-Perfect » — Vue 2 LibraryView : les 6 Onglets Curriculum

**Version :** 1.0 — 2026-08-21
**Sources normatives (Règle 0) :** Frontend_UI_Specs §5.2 (structure UI) · `Template_UI-UX/library.php` (valeurs pixel de référence, 2 346 lignes inventoriées) · tech_specs (SQL/DTO) · Blueprint P7 (API)
**Préconditions :** `npm install` fonctionnel (machine cible ou levée du blocage registry) — **ce sprint est bloqué tant que node_modules n'existe pas** ; base curriculum peuplée (`curriculum_available: true`) pour la recette réelle.

---

## 0. Objectif et périmètre

Faire passer `LibraryView` du Mode Repli Générique (livré, commit 8d2ce08) à la **parité pixel-perfect** avec `library.php` : les 6 onglets (Matrice 360°, Programme, Cours, Exercices, Évaluations, Scans), la sidebar multifonctions 320px, le Splash Screen télémétrique, le moteur de ponts relationnels au halo doré, et le moteur KaTeX monopasse avec rubriques didactiques 2G.

**Hors périmètre :** Vue 1 (index.php) et Vue 3 (automation.php) — leurs versions Mode Repli sont livrées ; leur parité fine fera l'objet d'un sprint ultérieur. CurriculumStudio (Vue 3, §7.10) est INCLUS ici car c'est la clé de sortie du Mode Repli, indispensable à la recette.

**Décisions d'implémentation (conformes Frontend_UI_Specs) :**
- Tailwind + CSS custom tokens — PAS de Bootstrap. Les classes `col-lg-8`, `collapse`, etc. du template sont des références structurelles à transposer (grille CSS/flex + accordéons React contrôlés, Règle 12 §6).
- Rebranding : « UstadAI Hub (2G) » du template → « RAGDom Hub » ; `localStorage ustad_theme` → `ragdom_theme` ; accent piloté par `--engine-accent` (V3.4).
- **Aucun compteur en dur** : 690/27/272/201 sont des exemples du corpus 2G — tout vient des agrégats API (préambule §5.2).
- Les scans viennent de la table `page_scans` du .sqlite (Base Autonome V3.5) via `GET /api/library/page-scan` — jamais de `glob` fichiers comme le fait le PHP.

---

## 1. Mapping des données : template PHP → API RAGDom

| Concept template (SQLite UstadAI) | Source RAGDom | Endpoint |
|---|---|---|
| `chapitres_cours` (cours, page_debut/fin) | `curriculum_programs` (séquences) + `toc_entries` (chapitres) + `document_chunks` (`pedagogical_type='course'`) | `GET /library/curriculum`, `/library/toc`, `/library/chunks` |
| `programme_officiel` (مقاطع) | `curriculum_programs` (term_id, seq_index, title, source, competencies_json) | `GET /library/curriculum` |
| `exercices_activites` (énoncé+correction) | chunks `exercise_solved` / `exercise_unsolved` + liaisons `content_links` (SolutionLinker `pedagogical_index`) | `GET /library/chunks?pedagogical_type=…` |
| `evaluations_sujets` (sujet+corrigé+images) | `curriculum_assessments` + benchmarks + artifacts | `GET /library/curriculum`, `/library/benchmarks`, `/library/artifacts` |
| `$pages_manifest` (glob scans/) | table `page_scans` (image_webp, thumb_webp, width/height) | `GET /library/page-scan` (+ manifeste, cf. Lot 1) |
| trimestres 1/2/3 | `curriculum_terms` (term_index, label) | `GET /library/curriculum` |
| niveaux/matières (8 niveaux, 8 disciplines) | 1 base .sqlite = 1 niveau×matière (`Maths_1AM.sqlite`) — les dropdowns listent les BASES | `GET /system/databases` |

**Écart assumé vs template :** les dropdowns Niveau/Matière du PHP rechargent la page (`?niveau=…`) ; en React ils commutent la base active (`ActiveDbContext`) sans reload — comportement supérieur, visuel identique.

---

## 2. Lots de travail (ordre d'exécution = ordre des commits)

### LOT 0 — Déblocage & fondations (prérequis absolu)
- [ ] `npm install` + `npx tsc --noEmit` + `vite build` (rejouer frontend/VALIDATION.md, corriger les erreurs résiduelles)
- [ ] Dépendances : `katex@0.16.8`, `marked@4` (ou react-markdown+remark-math+rehype-katex — trancher au Lot 3), `@tanstack/react-virtual`
- [ ] Injecter les tokens CSS du template dans `index.css` (déjà partiellement présents — compléter) : les 18 variables light/dark du tableau de référence (`--bg-body #f8fafc/#070d1e`, `--primary #2563eb/#3b82f6`, `--sidebar-bg`, `--card-shadow(-hover)`, `--topbar-bg` avec alpha…), `--sidebar-width:320px`, polices Cairo/Tajawal/Outfit (Google Fonts), easing signature `cubic-bezier(0.16,1,0.3,1)` + easing structure `cubic-bezier(0.4,0,0.2,1)`
- [ ] Keyframes globales : `targetFlashGlow` (2.2s, #fef08a → ambre atténué → surface, scale 1.02→1.005→1), `tabFadeSlide` (0.35s, translateY(12px) scale(0.995)), `pulseGlow` (2s, scale 1↔1.08)
- **D.o.D :** build vert, tokens visibles dans le devtools, thème dark par défaut persisté (`ragdom_theme`).

### LOT 1 — Compléments API backend (agrégats — zéro simulation frontend)
- [ ] `GET /api/library/page-scans` (manifeste) : liste `{page_number, width, height, has_thumb, toc_id?, chapter_title?, exercises_count, term_index?}` — jointure page_scans × toc × chunks. Pagination `limit≤500`.
- [ ] Enrichir `GET /api/library/curriculum` d'un bloc `aggregates` : par terme `{programs, courses, exercises, assessments}` ; par programme `{courses_count, exercises_count}` ; par chapitre `{exercises_count, page_start, page_end}` — calculés en SQL (COUNT + GROUP BY), jamais côté client sur 2G.
- [ ] `GET /api/library/chunks` : ajouter filtres `term_index` et `page_start/page_end` (le filtre trimestre 360° et le Page Jumper en dépendent).
- [ ] Tests pytest (3 nouveaux) : manifeste scans, agrégats cohérents avec le corpus e2e, filtre term.
- **Commit :** `feat(api): agrégats curriculum + manifeste page_scans pour la Vue 2 pixel-perfect`

### LOT 2 — Shell : Sidebar 320px + Topbar + système d'onglets
- [ ] `LibraryShell.tsx` : flex layout, sidebar fixed à droite (RTL), `translateX(100%)`→`translateX(0)` (.3s cubic-bezier(0.4,0,0.2,1)), workspace `margin-right: var(--sidebar-width)` quand ouverte (>992px), FAB mobile 54px rond (`bottom:24px; right:24px`, shadow `0 6px 20px rgba(37,99,235,0.4)`, masqué ≥993px), raccourci **Ctrl/Cmd+B**
- [ ] `Sidebar.tsx` : header (logo fa-atom carré primary, « RAGDom Hub », fermeture), Dropdown Bases-Niveaux (bordure warning, badges état bâti/vide), Dropdown Matières (bordure info, couleurs de domaine algorithmiques hash→HSL §PARTIE 8 — les 8 hex du template servent de table de correspondance pour les matières connues), Dropdown Trimestre (bordure success : 360°/🍂/❄️/🌸), Master Search (debounce 150ms + fa-xmark), Page Jumper (préfixe ص, bornes réelles min/max du manifeste — PAS 10/210 en dur), 6 `SidebarNavButton` (icônes/couleurs du tableau : sitemap-warning, graduation-cap-success, book-open-primary, pen-ruler-danger, file-signature-info, images-warning ; badges compteurs = agrégats API ; état `.active` fond primary + ombre), footer (thème, liens Automation/Dashboard)
- [ ] `WorkspaceTopbar.tsx` : sticky, `backdrop-filter: blur(12px)`, fond `--topbar-bg`, pills retour/automation/toggle, breadcrumb `Niveau / Matière / Onglet`, badges pages+docs (doré) et état base (vert « معتمدة » / gris)
- [ ] `LibraryTabs` state machine : 6 onglets montés/démontés avec `tabFadeSlide` rejouée à chaque commutation, `history.replaceState` (?tab=), fermeture sidebar auto ≤992px
- **Commit :** `feat(ui): shell Vue 2 — sidebar 360°, topbar sticky, système 6 onglets (pixel-perfect)`

### LOT 3 — Moteur KaTeX monopasse + rubriques didactiques (le plus lourd)
- [ ] `markdownKatex.ts` : portage EXACT du pipeline §5.2.6 / template l.2128-2251 — auto-guérison (`rac{`→`\frac{`, `ext{`→`\text{`, `ight)`/`eft(`, `\frac 1{2}`, `\$frac`), normalisation `\begin{aligned}`→`$$`, virgules arabes ،→, et ؛→;, mots arabes isolés→`\text{}`, protection `%%%MATHBLOCK_N%%%` avant marked puis réinjection `katex.renderToString({throwOnError:false, strict:'ignore', output:'html'})`
- [ ] Transformations rubriques (5 encadrés — hex exacts) : discover (bordure-droite 5px `#2563eb`, texte `#1e40af`), learn (cadre 2px `#eab308`, `#854d0e`, radius 12), methods (5px `#9333ea`, `#6b21a8`), now (2px pointillé `#16a34a`, `#15803d`, radius 10), assess (5px `#0d9488`, `#0f766e`) + badge remédiation `أعود إلى الصفحة N` (pill `#0d9488`→hover `#0f766e` translateY(-1px), ouvre le scan N) + bannière page (gradient `#1e3a8a→#2563eb` + bouton معاينة jaune) + carte géométrie 📐 + `asset://figures/` → `GET /library/artifact-binary`
- [ ] Isolation LTR : `.katex{direction:ltr!important;unicode-bidi:isolate!important}`, `.katex-display` centré scrollable, `.katex-mathml` masqué ; tables markdown : header gradient `#1e3a8a→#2563eb` police Cairo, zébrage, hover `rgba(37,99,235,0.05)`, variante dark
- [ ] `<MarkdownKatex raw={…}/>` mémoïsé + rendu paresseux (IntersectionObserver) — remplace l'actuel MarkdownContent dans la Vue 2
- [ ] Tests unitaires du pipeline (10 cas : chaque auto-guérison, un MATHBLOCK imbriqué, une rubrique, une bannière)
- **Commit :** `feat(ui): moteur KaTeX monopasse déterministe + rubriques didactiques 2G`

### LOT 4 — Moteur de ponts relationnels (halo doré)
- [ ] Hook `useTargetHighlight` + `BridgeContext` : `jumpTo(tabKey, targetId)` → commute l'onglet, déplie l'accordéon parent (state contrôlé, équivalent Règle 12), attend 120ms, `scrollIntoView({behavior:'smooth', block:'center'})`, applique `.target-highlight` avec re-jeu forcé (retrait + reflow + rajout), retrait à **2 300 ms**
- [ ] `BridgeButton.tsx` — 5 variantes aux hex EXACTS : cours `#fef3c7/#92400e/#fde68a`, exo `#fee2e2/#991b1b/#fecaca`, eval `#e0f2fe/#075985/#bae6fd`, prog `#dcfce7/#166534/#bbf7d0`, scan (tokens surface) ; pills 0.8rem/4px 12px/radius 20, hover translateY(-1px)
- [ ] Actions combinées : `filterExercicesByCours(id)`, `filterExercicesByPage(n)`, `jumpToScanPage(n)`, `jumpToMasterPage(n)` (résolution page→chapitre via agrégats)
- **Commit :** `feat(ui): ponts relationnels + halo doré targetFlashGlow (2.3s)`

### LOT 5 — Onglets 1 & 2 : Matrice 360° + Programme
- [ ] `MatrixTab` : 3 `TrimestreCard` repliables (radius 20, emoji 🍂❄️🌸, badges primary/info/success par trimestre, récap agrégats), boutons globaux فتح/طي, colonne 8/12 `RelationalNode` (radius 14, hover border-primary + translateY(-2px) + shadow-hover ; badge warning n° cours, plage ص X→Y, 4 BridgeButtons) + colonne 4/12 évaluations (bridge-eval pleine largeur, état vide alert-secondary)
- [ ] `ProgrammeTab` : grille 2 col `ProgrammeCard` (badge success مقطع #n, badge trimestre, badge source officielle, titre, encadré ressources `line-height:1.8` retours ligne préservés, footer ponts cours/exos du مقطع)
- [ ] Filtre trimestre global : masque les cartes `data-trim` non concernées ET force l'ouverture du trimestre choisi
- **Commit :** `feat(ui): onglets Matrice 360° + Programme officiel (pixel-perfect)`

### LOT 6 — Onglet 3 : Cours & side-by-side fluide
- [ ] `CoursTab` + `CoursCard` : barre titre repliable (badges n°/trimestre/pages), barre d'actions (bouton scans outline-warning→warning actif, ponts exo/prog/scan), corps accordéon
- [ ] Mode côte-à-côte `.fluid-pane` (transition all 0.35s cubic-bezier(0.16,1,0.3,1)) : texte `100%`↔`50%` + `ScansRail` sticky (top:70px, max-height calc(100vh-100px)) listant les pages page_debut→page_fin via `page-scan?thumb=true`, clic → modale HD (binaire pleine résolution + X-Scan-Width/Height)
- [ ] Ouverture programmée : `jumpToCours(id)` déplie PUIS halo
- **Commit :** `feat(ui): onglet Cours — side-by-side fluide KaTeX/scans (50/50)`

### LOT 7 — Onglet 4 : Banque d'exercices (virtualisée)
- [ ] `ExercicesTab` : header compteur agrégat + `#exoFilterStatus` dynamique + btn-group trimestres (الكل actif par défaut) + فتح/طي الحلول ; grille 2 col **virtualisée @tanstack/react-virtual** (le corpus 2G ≈ 690 exercices × KaTeX — rendu paresseux obligatoire)
- [ ] `ExerciceCard` : badges n°/page/trimestre, ponts cours/scan, œil → collapse scan de page (max-height 280px fond dark, lien plein écran), énoncé KaTeX, corrigé repliable « إظهار الحل » sur fond `rgba(16,185,129,0.08)` — liaison chunk exercise↔solution via content_links du SolutionLinker
- [ ] Filtres croisés : trimestre / cours (pont) / page (pont galerie) / Master Search — listes dérivées `useMemo`, état du filtre annoncé dans `#exoFilterStatus`
- **Commit :** `feat(ui): banque d'exercices virtualisée + corrigés liés (SolutionLinker)`

### LOT 8 — Onglet 5 : Évaluations & mode parallèle sujet/corrigé
- [ ] `EvaluationsTab` + `EvaluationCard` : badges n°/trimestre, bouton « معاينة متوازية » outline-success→success actif, boutons images sujet (bridge-eval) / corrigé (bridge-cours) → modale
- [ ] Mode 50/50 `.fluid-pane` : colonne sujet (fond surface) / colonne corrigé (fond `rgba(16,185,129,0.08)`, bouton fermeture) avec **rendu KaTeX du corrigé paresseux** (uniquement à la première ouverture — `dataset.rendered` du template ⇒ state `renderedOnce`)
- **Commit :** `feat(ui): évaluations — mode parallèle sujet/corrigé 50/50 lazy`
 
### LOT 9 — Onglet 6 : Galerie des scans (virtualisée)
- [ ] `ScansTab` : barre filtres catégorie (الكل / 📚 livre / 📑 examens, séparateur vertical, 3 pills trimestre), grille responsive 2/3/4/6 colonnes **virtualisée**, alimentée par le manifeste Lot 1 (thumb_webp — jamais l'image pleine en grille)
- [ ] `ScanPageCard` : thumb-wrap 220px overflow hidden fond `#0f172a`, zoom hover `scale(1.05)` (0.3s), badge ص N (top-start) + badge كتاب•ف N (bottom-end, filtre trim au clic), pied : titre cours tronqué, badge « N تمارين » (danger-subtle → `filterExercicesByPage`), boutons الدرس/agrandir ; hover carte translateY(-4px) border-primary
- [ ] `ScanEvalCard` : bordure info, badge sujet (info) / corrigé (success), pont `jumpToEval`
- [ ] `ImageModal` universel : modal-xl centré, header dark, img max-width 900px, corps max-height 85vh scroll
- **Commit :** `feat(ui): galerie visuelle relationnelle virtualisée (livre + examens)`

### LOT 10 — Splash Screen télémétrique + bascule Mode Repli
- [ ] `SplashScreen.tsx` : overlay z-99999 radial `#1e293b→#070d1e`, carte glassmorphism (blur 20px, radius 28, `rgba(15,23,42,0.85)`, double shadow), fa-atom spin ambre `#f59e0b` + pulseGlow 2s, barre tricolore `#3b82f6→#10b981→#f59e0b` halo `0 0 15px rgba(16,185,129,0.8)`, badges métriques agrégats
- [ ] Pipeline de préchargement : pré-rendu KaTeX par **chunks de 35** via requestAnimationFrame, messages par paliers <25/<50/<85/<100/100% (textes arabes exacts §5.2.1), sortie opacity 0.6s puis démontage (delay 300ms)
- [ ] Routage de la vue : `curriculum_available:false` → Mode Repli actuel (inchangé) ; `true` → Splash puis les 6 onglets. AUCUNE régression du Mode Repli (test).
- [ ] `CurriculumStudio.tsx` (Vue 3, §7.10) : 4 sous-onglets CRUD (Trimestres/Programmes/Évaluations/Liaisons, API routes_curriculum existante), import JSON merge/replace avec validation + rapport, bandeau d'état Mode Repli ⇄ 6 onglets
- **Commit :** `feat(ui): splash télémétrique + CurriculumStudio (clé de sortie du Mode Repli)`

### LOT 11 — Recette pixel-perfect & D.o.D
- [ ] **Checklist des valeurs critiques** (revue devtools, les 2 thèmes) : sidebar 320px · thumb 220px · halo 2.2s/retrait 2.3s · splash blur 20/radius 28/fade 0.6s/chunk 35 · easings signatures · vert corrigé `rgba(16,185,129,0.08)` · primary `#2563eb/#3b82f6` · body dark `#070d1e` · breakpoint 992px · gradients tables/splash · 5 hex bridge · 5 rubriques · 8 couleurs matières
- [ ] RTL : `dir="rtl"` racine, propriétés logiques partout, KaTeX isolé LTR — revue sur les 6 onglets
- [ ] Responsive : 4 largeurs (375/768/1200/1920) × 6 onglets ; FAB mobile ; fermeture sidebar auto
- [ ] Accessibilité §PARTIE 9 : `role=tablist/tab/tabpanel`, focus visible, aria-live sur les statuts de filtre
- [ ] Perf : base 2G réelle — TTI < 3s (grâce au splash chunké), scroll 60fps sur exercices/scans virtualisés, RAM onglet < 500 Mo
- [ ] `npx tsc --noEmit` + `vite build` + tests unitaires pipeline KaTeX verts
- **Commit :** `test(ui): recette pixel-perfect Vue 2 — checklist valeurs critiques + RTL + responsive`

---

## 3. Risques & parades

| Risque | Impact | Parade |
|---|---|---|
| npm toujours bloqué dans le sandbox | Sprint entier | Exécuter le sprint sur la machine cible (Antigravity) ; ce plan est auto-porteur |
| Pipeline KaTeX divergent du template | Rendu maths cassé | Portage ligne à ligne l.2128-2251 + 10 tests unitaires (Lot 3) AVANT les onglets |
| Pas de base 2G réelle pour la recette | Recette partielle | Jeu de données curriculum synthétique via POST /curriculum/import + PDF e2e existant ; recette finale différée à la 1re ingestion réelle |
| 690 cartes KaTeX gèlent le thread | UX | Virtualisation + rendu paresseux + splash chunké (35) — mesuré au Lot 11 |
| Écart Bootstrap→Tailwind sur les grilles | Pixel-drift | Les breakpoints du template (992px, col-xl-6, 2/3/4/6 col) sont repris en valeurs media-queries explicites, pas via l'échelle Tailwind par défaut |

## 4. Estimation & ordonnancement

Lots 0-1 (fondations+API) : 1 session · Lot 2 (shell) : 1 · Lots 3-4 (moteurs KaTeX+ponts) : 2 · Lots 5-6 : 1.5 · Lots 7-8-9 (onglets lourds) : 2 · Lot 10 : 1 · Lot 11 (recette) : 1 → **~9-10 sessions de travail agent**, 11 commits atomiques. Chemin critique : Lot 0 → Lot 3 → tout le reste (les onglets consomment MarkdownKatex et les ponts).
