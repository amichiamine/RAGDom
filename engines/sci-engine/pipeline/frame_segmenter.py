# -*- coding: utf-8 -*-
"""sci-engine — Segmentation LOCALE (CPU, ZÉRO LLM) des cadres pleine page.

Stratégie « CV-first » de l'explosion (tech_specs §12 — variante locale). Un
cadre quasi-pleine-page (>70 % de la page) ne peut PAS être envoyé au VLM en un
seul gros appel (grosse image + long JSON → 429 immédiat sur la clé forte,
échec du repli flash-lite : 42 cadres perdus mesurés en production). On le
DÉCOUPE donc localement en sous-régions visuelles par vision par ordinateur ;
chaque sous-région (≤ ~70 % de page par construction) redevient candidate de la
qualification standard par PETITS crops — le seul mécanisme qui tienne les
quotas (98/98 réussis le même jour).

Méthode (mêmes outils que layer_0_cv / layer_2_extract : cv2 + numpy) :
  1. décodage WebP → niveaux de gris ;
  2. binarisation adaptative (Otsu inversé en repli : l'encre devient blanche) ;
  3. découpe récursive par PROFILS DE PROJECTION (« XY-cut ») : on coupe la
     région là où l'encre par ligne (resp. par colonne) descend nettement sous
     sa moyenne — les VALLÉES du profil, robustes même sans blanc pur (pages de
     manuel : bandes colorées, tableaux, colonnes RTL) ;
  4. resserrage de chaque boîte sur son encre réelle ;
  5. fusion des boîtes qui se chevauchent ou sont très proches ;
  6. filtrage : aire minimale (~0,5 % de page), ratios extrêmes exclus, densité
     d'encre minimale ;
  7. heuristique texte/figure : une zone dont l'encre se répartit en LIGNES
     régulières (profil très périodique) et peu remplie est du TEXTE pur → on
     la MARQUE (is_text) et on la déprioritise. On préfère SUR-segmenter
     légèrement (un crop de texte sera reclassé photo/other par la
     qualification aval) que rater une figure.

Sortie : liste de dicts {"bbox_rel": (x0,y0,x1,y1) EN PIXELS RELATIFS au crop
d'entrée, "raw_binary": WebP du sous-crop, "ink_ratio": float, "is_text": bool}.
Nombre de régions borné (max_regions). Dégradation gracieuse ABSOLUE : toute
exception → [] (le pipeline ne s'arrête JAMAIS ici). Python 3.9+.
"""
import cv2
import numpy as np

# ── Constantes (aucune valeur en dur non documentée) ─────────────────────────
# Qualité de réencodage WebP des sous-crops (aligné sur layer_2_extract._webp).
_WEBP_QUALITY = 80

# Un cadre trop petit ne vaut pas la peine d'être segmenté (déjà une sous-figure).
_MIN_FRAME_SIDE_PX = 200

# Binarisation adaptative : bloc de seuillage (impair) et constante soustraite.
_ADAPT_BLOCK = 41
_ADAPT_C = 15

# ── Découpe par projection (XY-cut) ──
# Une « vallée » de projection = suite de lignes/colonnes dont l'encre passe
# sous VALLEY_FRAC × moyenne d'encre de la bande. Coupe pédagogiquement fiable
# sur les manuels (interlignes, gouttières entre colonnes, bords de cellules).
_VALLEY_FRAC = 0.30
# Longueur minimale d'une vallée pour valoir une coupe (fraction de page).
_MIN_VALLEY_H_FRAC = 0.010   # ≈ 1,0 % de la hauteur de page
_MIN_VALLEY_W_FRAC = 0.012   # ≈ 1,2 % de la largeur de page
# Lissage du profil (moyenne glissante) en fraction de page — supprime le bruit.
_SMOOTH_FRAC = 0.004
# Une ligne/colonne est « active » si son encre dépasse ce seuil (fraction du côté).
_ACTIVE_FRAC = 0.02
# Profondeur maximale de récursion (garde-fou anti-explosion combinatoire).
_MAX_DEPTH = 5
# En dessous de cette taille (fraction de page), on ne recoupe plus une région.
_STOP_SIDE_FRAC = 0.03

# ── Filtrage des boîtes ──
_MIN_AREA_FRAC = 0.005   # aire mini d'une région ≈ 0,5 % de la page
_MAX_AREA_FRAC = 0.92    # au-delà, c'est (presque) tout le cadre → écarté
_MAX_ASPECT = 25.0       # ratio largeur/hauteur (ou inverse) au-delà → filet/trait
_MIN_INK_RATIO = 0.010   # densité d'encre mini d'une région retenue (1,0 %)

# Fusion des boîtes : on ne recolle QUE des fragments (petit label/tick détaché
# d'une figure), jamais deux grands blocs adjacents (qui resteraient collés en
# un seul cadre pleine page). Deux boîtes fusionnent si elles se CHEVAUCHENT
# réellement, OU si l'une est un fragment (aire < _MERGE_SMALL_FRAC de page) ET
# qu'elles sont distantes de moins de _MERGE_GAP_FRAC de page.
_MERGE_GAP_FRAC = 0.012
_MERGE_SMALL_FRAC = 0.020  # une boîte < 2,0 % de page est un « fragment » recollable
_MERGE_COVER = 0.60        # un fragment n'est absorbé que s'il est recouvert à ≥60 %
                           # (sur X ou Y) par le bloc — exclut les bandes de marge
# Un vrai fragment (label, tick, exposant détaché) est petit dans LES DEUX
# dimensions. Une bande de marge fine mais LONGUE (barre latérale de numéros de
# page) n'en est pas un : son grand côté dépasse cette fraction de page → jamais
# recollée (sinon elle sert de « pont » entre plusieurs blocs).
_MERGE_FRAG_MAX_SIDE_FRAC = 0.12

# ── Heuristique texte/figure ──
_TEXT_MIN_LINES = 4          # sous ce nb de lignes, indécidable → figure (gardée)
_TEXT_LINE_REGULARITY = 0.55 # part des inter-lignes proches de la médiane → texte
_TEXT_MAX_FILL = 0.42        # au-delà de ce remplissage → figure (aplat/tableau)

# Marge (padding) autour de chaque sous-crop, en fraction de page : évite de
# rogner labels/traits en bord de figure.
_PAD_FRAC = 0.004


def _binarize(gray):
    """Binarisation adaptative (encre → 255). Repli Otsu inversé. Jamais d'exception."""
    try:
        block = _ADAPT_BLOCK if _ADAPT_BLOCK % 2 == 1 else _ADAPT_BLOCK + 1
        bin_img = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, block, _ADAPT_C)
        ink = float(np.count_nonzero(bin_img)) / float(bin_img.size or 1)
        # Adaptatif dégénéré (page quasi vide ou saturée) → Otsu inversé, plus
        # stable sur les aplats colorés.
        if ink < 0.002 or ink > 0.85:
            _t, bin_img = cv2.threshold(gray, 0, 255,
                                        cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        return bin_img
    except Exception:  # noqa: BLE001
        try:
            _t, bin_img = cv2.threshold(gray, 0, 255,
                                        cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            return bin_img
        except Exception:  # noqa: BLE001
            return None


def _valley_splits(proj, min_valley):
    """Positions de découpe = milieux des VALLÉES internes du profil `proj`.

    Une vallée = suite de valeurs sous `_VALLEY_FRAC × moyenne_active`, d'au moins
    `min_valley` de long, NON collée à un bord (une vallée en bord = marge, pas
    une coupe). Renvoie la liste des segments [(start,end), …] ou [] si aucune
    coupe interne (la bande reste entière)."""
    n = len(proj)
    active = proj[proj > 0]
    if active.size == 0:
        return []
    level = _VALLEY_FRAC * float(active.mean())
    is_valley = proj < level
    runs = []
    start = None
    for i in range(n):
        if is_valley[i] and start is None:
            start = i
        elif not is_valley[i] and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, n))
    cuts = []
    for s, e in runs:
        if (e - s) < min_valley:
            continue
        if s == 0 or e == n:  # vallée en bord = marge externe, jamais une coupe
            continue
        cuts.append((s + e) // 2)
    if not cuts:
        return []
    bounds = [0] + cuts + [n]
    return [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1)]


def _axis_splits(sub, axis, W, H):
    """Découpe `sub` selon `axis` (0 = horizontale/lignes, 1 = verticale/colonnes)
    via les vallées de projection. Renvoie [(start,end), …] (>1 = coupe trouvée)."""
    if axis == 0:  # projection sur les lignes (encre par ligne)
        proj = (sub > 0).sum(axis=1).astype(np.float32) / float(max(1, sub.shape[1]))
        min_valley = int(_MIN_VALLEY_H_FRAC * H)
        smooth = max(3, int(_SMOOTH_FRAC * H))
    else:          # projection sur les colonnes (encre par colonne)
        proj = (sub > 0).sum(axis=0).astype(np.float32) / float(max(1, sub.shape[0]))
        min_valley = int(_MIN_VALLEY_W_FRAC * W)
        smooth = max(3, int(_SMOOTH_FRAC * W))
    if proj.max() <= 0:
        return []
    # Seuil d'activité + lissage (moyenne glissante) pour ignorer le bruit.
    proj = np.where(proj >= _ACTIVE_FRAC, proj, 0.0)
    kernel = np.ones(smooth, dtype=np.float32) / float(smooth)
    proj = np.convolve(proj, kernel, mode="same")
    return _valley_splits(proj, max(1, min_valley))


def _xy_cut(bin_img, box, depth, prefer_axis, W, H, out):
    """Découpe récursive XY-cut. Empile les feuilles (boîtes non recoupables)
    dans `out`. `prefer_axis` alterne pour éviter de couper deux fois le même axe."""
    x0, y0, x1, y1 = box
    sub = bin_img[y0:y1, x0:x1]
    if sub.size == 0:
        return
    h, w = sub.shape[:2]
    if depth >= _MAX_DEPTH or (w < _STOP_SIDE_FRAC * W and h < _STOP_SIDE_FRAC * H):
        out.append(box)
        return
    for axis in ([0, 1] if prefer_axis == 0 else [1, 0]):
        splits = _axis_splits(sub, axis, W, H)
        if len(splits) > 1:
            for s, e in splits:
                if axis == 0:
                    child = (x0, y0 + s, x1, y0 + e)
                else:
                    child = (x0 + s, y0, x0 + e, y1)
                _xy_cut(bin_img, child, depth + 1, 1 - axis, W, H, out)
            return
    out.append(box)  # aucune coupe interne : feuille


def _tighten(bin_img, box):
    """Resserre une boîte sur l'encre réelle qu'elle contient. None si vide."""
    x0, y0, x1, y1 = box
    sub = bin_img[y0:y1, x0:x1]
    if sub.size == 0:
        return None
    rows = np.where((sub > 0).any(axis=1))[0]
    cols = np.where((sub > 0).any(axis=0))[0]
    if rows.size == 0 or cols.size == 0:
        return None
    return (x0 + int(cols[0]), y0 + int(rows[0]),
            x0 + int(cols[-1]) + 1, y0 + int(rows[-1]) + 1)


def _overlap(a, b):
    """True si les rectangles a,b se chevauchent (intersection non vide)."""
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _near(a, b, gap):
    """True si a,b sont distants de moins de `gap` sur LES DEUX axes (adjacents)."""
    dx = max(0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0, max(a[1], b[1]) - min(a[3], b[3]))
    return dx <= gap and dy <= gap


def _union_area(a, b):
    x0 = min(a[0], b[0]); y0 = min(a[1], b[1])
    x1 = max(a[2], b[2]); y1 = max(a[3], b[3])
    return (x1 - x0) * (y1 - y0)


def _span_covered(frag, other, axis):
    """Part de l'étendue du fragment sur `axis` (0=x, 1=y) recouverte par la
    projection de `other`. Sert à n'absorber un fragment que s'il est bien « dans
    l'ombre » d'un bloc (et pas une bande de marge traversant plusieurs blocs)."""
    lo_i, hi_i = (0, 2) if axis == 0 else (1, 3)
    f_lo, f_hi = frag[lo_i], frag[hi_i]
    o_lo, o_hi = other[lo_i], other[hi_i]
    inter = max(0, min(f_hi, o_hi) - max(f_lo, o_lo))
    length = max(1, f_hi - f_lo)
    return inter / float(length)


def _is_fragment(box, small_area, max_side):
    """Vrai fragment recollable = petit EN AIRE et petit dans les DEUX dimensions
    (label/tick/exposant), pas une bande de marge fine mais longue."""
    area = (box[2] - box[0]) * (box[3] - box[1])
    long_side = max(box[2] - box[0], box[3] - box[1])
    return area < small_area and long_side <= max_side


def _should_merge(a, b, gap, small_area, max_area, max_side):
    """Fusionne SEULEMENT si :
      - chevauchement réel, OU
      - l'une est un FRAGMENT (petit en aire ET dans les deux dimensions), proche
        de l'autre, ET « dans l'ombre » du bloc sur au moins un axe
        (≥ _MERGE_COVER de son étendue).
    Et jamais si l'englobante dépasse max_area (anti-reconstitution pleine page)."""
    if _overlap(a, b):
        return True
    if _union_area(a, b) > max_area:
        return False
    if not _near(a, b, gap):
        return False
    if _is_fragment(a, small_area, max_side):
        frag, other = a, b
    elif _is_fragment(b, small_area, max_side):
        frag, other = b, a
    else:
        return False  # deux blocs adjacents non fragmentaires : jamais fusionnés
    return (_span_covered(frag, other, 0) >= _MERGE_COVER
            or _span_covered(frag, other, 1) >= _MERGE_COVER)


def _merge_boxes(boxes, gap, small_area, max_area, max_side):
    """Fusion itérative (union englobante) — voir _should_merge pour la règle."""
    boxes = list(boxes)
    changed = True
    while changed and len(boxes) > 1:
        changed = False
        merged = []
        used = [False] * len(boxes)
        for i in range(len(boxes)):
            if used[i]:
                continue
            cur = tuple(boxes[i])
            used[i] = True
            for j in range(i + 1, len(boxes)):
                if used[j]:
                    continue
                if _should_merge(cur, boxes[j], gap, small_area, max_area, max_side):
                    cur = (min(cur[0], boxes[j][0]), min(cur[1], boxes[j][1]),
                           max(cur[2], boxes[j][2]), max(cur[3], boxes[j][3]))
                    used[j] = True
                    changed = True
            merged.append(tuple(cur))
        boxes = merged
    return boxes


def _looks_like_text(sub_bin):
    """Heuristique texte pur : lignes d'encre nombreuses, régulières et peu
    remplies. True → pavé de texte (à déprioritiser). Jamais d'exception."""
    try:
        h, w = sub_bin.shape[:2]
        if h < 10 or w < 10:
            return False
        fill = float(np.count_nonzero(sub_bin)) / float(sub_bin.size or 1)
        if fill >= _TEXT_MAX_FILL:
            return False  # aplat coloré / tableau plein → figure
        row_ink = (sub_bin > 0).sum(axis=1).astype(np.float32)
        if row_ink.max() <= 0:
            return False
        active = row_ink > (0.15 * float(row_ink.max()))
        centers = []
        start = None
        for y in range(len(active)):
            if active[y] and start is None:
                start = y
            elif not active[y] and start is not None:
                centers.append((start + y) / 2.0)
                start = None
        if start is not None:
            centers.append((start + len(active)) / 2.0)
        if len(centers) < _TEXT_MIN_LINES:
            return False
        gaps = np.diff(np.array(centers, dtype=np.float32))
        if gaps.size == 0:
            return False
        median_gap = float(np.median(gaps))
        if median_gap <= 0:
            return False
        regular = float(np.mean(np.abs(gaps - median_gap) <= 0.35 * median_gap))
        return regular >= _TEXT_LINE_REGULARITY
    except Exception:  # noqa: BLE001 — dans le doute, on garde la région
        return False


def _encode_webp(bgr_crop):
    """Réencode un crop BGR en WebP. bytes ou None (jamais d'exception)."""
    try:
        if bgr_crop is None or bgr_crop.size == 0:
            return None
        ok, buf = cv2.imencode(".webp", bgr_crop, [cv2.IMWRITE_WEBP_QUALITY, _WEBP_QUALITY])
        return buf.tobytes() if ok else None
    except Exception:  # noqa: BLE001
        return None


def segment_frame(webp_bytes, max_regions=20):
    """Segmente LOCALEMENT un cadre WebP pleine page en sous-régions visuelles.

    Args:
        webp_bytes  : bytes du crop WebP du cadre pleine page (JAMAIS modifié).
        max_regions : borne supérieure du nombre de sous-régions renvoyées.

    Returns:
        list de dicts {"bbox_rel": (x0,y0,x1,y1) px RELATIFS au crop d'entrée,
        "raw_binary": WebP du sous-crop, "ink_ratio": float,
        "is_text": bool (True = région jugée « texte pur »)}, triée en ordre de
        lecture (haut→bas puis gauche→droite). JAMAIS d'exception : toute erreur
        → [] (le pipeline ne s'arrête pas ici). Une page 100 % texte peut
        légitimement renvoyer [] (rien à structurer).
    """
    if not webp_bytes:
        return []
    try:
        img = cv2.imdecode(np.frombuffer(webp_bytes, np.uint8), cv2.IMREAD_COLOR)
    except Exception:  # noqa: BLE001
        return []
    if img is None or img.size == 0:
        return []
    try:
        H, W = img.shape[:2]
        if min(H, W) < _MIN_FRAME_SIDE_PX:
            return []  # déjà petit : rien à exploser
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        bin_img = _binarize(gray)
        if bin_img is None:
            return []

        # 1) Découpe récursive par projection.
        leaves = []
        _xy_cut(bin_img, (0, 0, W, H), 0, 0, W, H, leaves)

        # 2) Resserrage + pré-filtrage des feuilles.
        page_area = float(W * H)
        min_area = _MIN_AREA_FRAC * page_area
        max_area = _MAX_AREA_FRAC * page_area
        tight = []
        for box in leaves:
            t = _tighten(bin_img, box)
            if t is None:
                continue
            bw, bh = (t[2] - t[0]), (t[3] - t[1])
            area = float(bw * bh)
            if area < min_area or area > max_area:
                continue
            aspect = (bw / float(bh)) if bh else 0.0
            if aspect <= 0 or aspect > _MAX_ASPECT or (1.0 / aspect) > _MAX_ASPECT:
                continue
            tight.append(t)

        if not tight:
            return []

        # 3) Fusion des FRAGMENTS proches (labels/ticks éclatés au XY-cut) —
        # jamais deux grands blocs adjacents (cf. _should_merge).
        gap = int(max(W, H) * _MERGE_GAP_FRAC)
        small_area = _MERGE_SMALL_FRAC * page_area
        max_side = _MERGE_FRAG_MAX_SIDE_FRAC * max(W, H)
        boxes = _merge_boxes(tight, gap, small_area, max_area, max_side)

        # 4) Filtrage final + densité + heuristique texte.
        pad = int(max(W, H) * _PAD_FRAC)
        regions = []
        for (x0, y0, x1, y1) in boxes:
            bw, bh = (x1 - x0), (y1 - y0)
            area = float(bw * bh)
            if area < min_area or area > max_area:
                continue
            aspect = (bw / float(bh)) if bh else 0.0
            if aspect <= 0 or aspect > _MAX_ASPECT or (1.0 / aspect) > _MAX_ASPECT:
                continue
            sub_bin = bin_img[max(0, y0):min(H, y1), max(0, x0):min(W, x1)]
            if sub_bin.size == 0:
                continue
            ink_ratio = float(np.count_nonzero(sub_bin)) / float(sub_bin.size)
            if ink_ratio < _MIN_INK_RATIO:
                continue
            is_text = _looks_like_text(sub_bin)
            px0 = max(0, x0 - pad); py0 = max(0, y0 - pad)
            px1 = min(W, x1 + pad); py1 = min(H, y1 + pad)
            regions.append({"bbox": (px0, py0, px1, py1), "area": area,
                            "ink_ratio": ink_ratio, "is_text": is_text})

        if not regions:
            return []

        # 5) Bornage du nombre : on PRIORISE les figures (non-texte) si troncature.
        regions.sort(key=lambda r: (r["is_text"], r["bbox"][1], r["bbox"][0]))
        regions = regions[:max(1, int(max_regions))]
        regions.sort(key=lambda r: (r["bbox"][1], r["bbox"][0]))  # ordre de lecture

        out = []
        for r in regions:
            x0, y0, x1, y1 = r["bbox"]
            webp = _encode_webp(img[y0:y1, x0:x1])
            if webp is None:
                continue
            out.append({"bbox_rel": (int(x0), int(y0), int(x1), int(y1)),
                        "raw_binary": webp,
                        "ink_ratio": round(float(r["ink_ratio"]), 4),
                        "is_text": bool(r["is_text"])})
        return out
    except Exception:  # noqa: BLE001 — dégradation gracieuse absolue
        return []
