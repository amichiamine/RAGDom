# -*- coding: utf-8 -*-
"""sci-engine — Qualification VLM des artefacts visuels (tech_specs §12).

Contrat consolidé (multimodal COMPLET) : les découpes WebP `dense_illustration`
(Tier 1) qui sont de VRAIES sous-figures (et non des cadres quasi-pleine-page)
sont soumises à un VLM qui tente de les RE-TYPER FINEMENT, de les STRUCTURER en
base ET de consigner leur SÉMANTIQUE pédagogique.

Familles traitées (chaque artefact TYPÉ + STRUCTURÉ + SÉMANTIQUE) :

  geometry / drawing / diagram-svg + svg valide  → geometry_vector (svg, katex-free)
  operation (opération posée) / matrix + latex   → matrix         (LaTeX, katex)
  diagram-mermaid / flowchart      + mermaid      → flowchart      (mermaid)
  plot                             + plotly_json  → signal_waveform (plotly)
  table                            + markdown     → data_table     (markdown)
  chemistry                        + smiles       → smiles_chem    (ketcher)
  code                             + code+lang    → code_snippet   (shiki)
  photo / other / échec                           → None (reste dense_illustration ;
                                                    caption maj si renvoyée)

SÉMANTIQUE : une DÉMONSTRATION = enchaînement qui PROUVE/EXPLIQUE une propriété
(souvent flèches/étapes, quelle qu'en soit la FORME : schéma fléché, dessin libre
démonstratif, enchaînement annoté). Détectée quel que soit le `type`. Le champ
`semantic` non-null est FUSIONNÉ dans render_config_json (clé additive, ignorée
par les renderers) — y compris pour un dense_illustration conservé.

EXIGENCE ABSOLUE : le `raw_binary` (crop WebP original) n'est JAMAIS modifié ni
supprimé — il sert de comparateur / contrôle visuel dans l'UI à côté du rendu
structuré. Ce module ne renvoie QUE le nouveau typage textuel ; l'appelant
(couche 2 ou route de requalification) conserve le binaire tel quel.

Le pipeline NE S'ARRÊTE JAMAIS ici : toute erreur (VLM injoignable, JSON
illisible, SVG hors gabarit…) renvoie None ou un simple caption. Python 3.9+.
"""
import base64
import json
import re

# ── Gabarits render_config_json (tech_specs §12, verbatim) ──
_RC_GEOMETRY = {"renderer": "svg", "sanitize": True, "zoomable": True}
_RC_MATRIX = {"renderer": "katex", "displayMode": True, "throwOnError": False}
_RC_FLOWCHART = {"renderer": "mermaid", "theme": "default"}
_RC_PLOT = {"renderer": "plotly", "type": "scatter"}
_RC_TABLE = {"renderer": "tanstack-table", "pagination": True, "pageSize": 20}
_RC_CHEM = {"renderer": "ketcher", "readOnly": True}
_RC_CODE = {"renderer": "shiki", "lang": "text", "theme": "github-dark"}
_RC_DENSE = {"renderer": "openseadragon", "tileSources": None, "showNavigator": True}

_SVG_MAX_BYTES = 200 * 1024  # SVG autonome < 200 Ko (garde-fou UI)
_SVG_RE = re.compile(r"<svg\b[^>]*>.*</svg>", re.S | re.I)

_VALID_TYPES = {"geometry", "drawing", "operation", "diagram", "flowchart",
                "plot", "matrix", "table", "chemistry", "code", "photo", "other"}
_VALID_SEMANTICS = {"demonstration", "illustration", "exercise_support"}

# ── Sanitation LaTeX (bug production : délimiteurs embarqués + commandes mutilées) ──
# (a) Délimiteurs mathématiques en tête/queue à retirer : le renderer frontend
#     (katex) fournit SES PROPRES délimiteurs — un $$…$$ embarqué casse le rendu.
_LATEX_LEAD_RE = re.compile(r"^\s*(?:\$\$|\$|\\\[|\\\()\s*")
_LATEX_TAIL_RE = re.compile(r"\s*(?:\$\$|\$|\\\]|\\\))\s*$")
# (b) Commandes fréquemment mutilées (backslash perdu à l'OCR/au VLM). On répare
#     UNIQUEMENT en DÉBUT de mot (précédé d'un non-lettre) et NON déjà précédé
#     d'un backslash — sinon on double des commandes déjà correctes.
_LATEX_FIX_COMMANDS = ("begin", "end", "hline", "frac", "quad", "times",
                       "div", "cdot")
_LATEX_FIX_RES = [
    (re.compile(r"(?<![\\A-Za-z])(" + cmd + r")\b"), r"\\\1")
    for cmd in _LATEX_FIX_COMMANDS
]
# (c) Backslash orphelin en toute fin de chaîne (sans commande derrière).
_LATEX_TRAIL_BACKSLASH_RE = re.compile(r"\\+\s*$")


def _sanitize_latex(s):
    """Nettoie une chaîne LaTeX AVANT persistance (matrix/latex) : retire les
    délimiteurs mathématiques embarqués (tête/queue), répare les commandes
    évidentes dont le backslash a été perdu (begin{, end{, hline, frac{, quad,
    times, div, cdot), et supprime un backslash orphelin final. Idempotent et
    sans exception : une entrée non-str renvoie l'entrée telle quelle."""
    if not isinstance(s, str):
        return s
    out = s.strip()
    # (a) délimiteurs en tête/queue, retirés en boucle ($$...$$, $...$, \[...\], \(...\)).
    changed = True
    while changed and out:
        changed = False
        m = _LATEX_LEAD_RE.match(out)
        if m and m.end() > 0:
            out = out[m.end():]
            changed = True
        m = _LATEX_TAIL_RE.search(out)
        # On ne coupe que si le délimiteur final n'est pas déjà le début de chaîne
        # (évite de vider une chaîne réduite à un simple "$").
        if m and m.start() > 0:
            out = out[:m.start()]
            changed = True
    # (b) réparation des commandes mutilées.
    for rx, repl in _LATEX_FIX_RES:
        out = rx.sub(repl, out)
    # (c) backslash orphelin final (mais on préserve un "\\" de saut de ligne
    #     LaTeX SEULEMENT s'il est suivi de contenu — ici on est en fin de chaîne,
    #     donc un backslash terminal est toujours orphelin).
    out = _LATEX_TRAIL_BACKSLASH_RE.sub("", out)
    return out.strip()

_PROMPT = (
    "Tu es un extracteur d'artefacts scientifiques. On te donne l'image d'UNE figure "
    "issue d'un manuel scolaire (langue arabe, sens RTL). Analyse-la et réponds "
    "STRICTEMENT par UN SEUL objet JSON, sans texte avant ni après, sans balise "
    "Markdown, au format EXACT :\n"
    '{"type":"geometry|drawing|operation|diagram|flowchart|plot|matrix|table|'
    'chemistry|code|photo|other",'
    '"semantic":"demonstration|illustration|exercise_support|null",'
    '"caption_ar":"légende courte en arabe",'
    '"svg":null,"latex":null,"mermaid":null,"plotly_json":null,"markdown":null,'
    '"smiles":null,"code":null,"lang":null}\n'
    "Règles de TYPE :\n"
    "- geometry / drawing (y compris DESSIN LIBRE démonstratif) → \"svg\" : "
    "reproduction FIDÈLE (traits, points, labels, FLÈCHES et ANNOTATIONS comprises) "
    "en SVG autonome (<svg ...>...</svg> avec viewBox ; texte arabe autorisé).\n"
    "- operation (opération POSÉE : addition/soustraction/multiplication/division "
    "en colonnes) → \"latex\" avec \\begin{array} FIDÈLE (retenues en exposant).\n"
    "- diagram (état / structure / décomposition / schéma FLÉCHÉ) → \"mermaid\" si "
    "c'est un graphe ou un flux, SINON \"svg\".\n"
    "- flowchart (organigramme) → \"mermaid\".\n"
    "- plot (courbe / graphique) → \"plotly_json\" : "
    '{"data":[{"x":[...],"y":[...],"type":"scatter"}],"layout":{"title":"..."}}.\n'
    "- matrix → \"latex\" (matrice/expression, sans délimiteurs $).\n"
    "- table → \"markdown\" (tableau Markdown avec | et ---).\n"
    "- chemistry → \"smiles\" (chaîne SMILES).\n"
    "- code → \"code\" (le code) ET \"lang\" (le langage).\n"
    "- photo (photographie réelle) / other → tous les champs de contenu à null.\n"
    "Règle de SÉMANTIQUE :\n"
    "- \"semantic\"=\"demonstration\" si la figure PROUVE ou EXPLIQUE une propriété "
    "par un ENCHAÎNEMENT (étapes, flèches, annotations) — quelle qu'en soit la forme "
    "(schéma fléché, dessin libre démonstratif, enchaînement annoté).\n"
    "- \"illustration\" si purement illustrative ; \"exercise_support\" si support "
    "d'exercice ; null si indéterminé.\n"
    "- \"caption_ar\" est TOUJOURS une légende courte en arabe.\n"
    "Ne renvoie QUE le JSON.")


def _extract_json(text):
    """Parse robuste : isole le PREMIER objet {...} équilibré et json.loads.

    Tolère les préambules, les clôtures ```json, et le bruit après l'objet.
    Renvoie un dict ou None (jamais d'exception)."""
    if not text or not isinstance(text, str):
        return None
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                candidate = text[start:i + 1]
                try:
                    parsed = json.loads(candidate)
                    return parsed if isinstance(parsed, dict) else None
                except (ValueError, TypeError):
                    return None
    return None


def _valid_svg(svg):
    if not svg or not isinstance(svg, str):
        return False
    if not _SVG_RE.search(svg):
        return False
    return len(svg.encode("utf-8")) < _SVG_MAX_BYTES


def _valid_plotly(payload):
    """plotly_json valide = objet avec un tableau `data` non vide (ou chaîne JSON idem)."""
    obj = payload
    if isinstance(payload, str):
        try:
            obj = json.loads(payload)
        except (ValueError, TypeError):
            return None
    if not isinstance(obj, dict):
        return None
    data = obj.get("data")
    if not isinstance(data, list) or not data:
        return None
    return json.dumps(obj, ensure_ascii=False)


def _clean(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def _semantic_of(parsed):
    sem = parsed.get("semantic")
    sem = sem.strip().lower() if isinstance(sem, str) else None
    return sem if sem in _VALID_SEMANTICS else None


def _with_semantic(render_config: dict, semantic):
    """Fusionne la sémantique (clé additive) dans le render_config et sérialise."""
    rc = dict(render_config)
    if semantic:
        rc["semantic"] = semantic
    return json.dumps(rc, ensure_ascii=False)


def _map_result(parsed):
    """Applique le mapping type→artefact structuré (tech_specs §12) + sémantique.

    Renvoie un dict {artifact_type, raw_data, render_config_json, caption,
    searchable_text, semantic} prêt à persister. Si le type est
    photo/other/échec de structuration : renvoie un dict SANS artifact_type
    (l'artefact reste dense_illustration) mais qui porte tout de même `caption`
    et `semantic` (fusion additive côté appelant). Renvoie None si le VLM n'a
    rien d'exploitable (pas de dict / type invalide / ni caption ni semantic)."""
    if not isinstance(parsed, dict):
        return None
    art_type = parsed.get("type")
    if art_type not in _VALID_TYPES:
        art_type = None
    caption = _clean(parsed.get("caption_ar"))
    semantic = _semantic_of(parsed)
    latex = _clean(parsed.get("latex"))
    svg = _clean(parsed.get("svg"))
    mermaid = _clean(parsed.get("mermaid"))
    markdown = _clean(parsed.get("markdown"))
    smiles = _clean(parsed.get("smiles"))
    code = _clean(parsed.get("code"))
    lang = _clean(parsed.get("lang"))
    plotly = _valid_plotly(parsed.get("plotly_json"))

    new_type = raw_data = base_rc = None
    if art_type in ("geometry", "drawing") and _valid_svg(svg):
        new_type, raw_data, base_rc = "geometry_vector", svg, _RC_GEOMETRY
    elif art_type == "diagram" and _valid_svg(svg) and not mermaid:
        new_type, raw_data, base_rc = "geometry_vector", svg, _RC_GEOMETRY
    elif art_type == "diagram" and mermaid:
        new_type, raw_data, base_rc = "flowchart", mermaid, _RC_FLOWCHART
    elif art_type == "flowchart" and mermaid:
        new_type, raw_data, base_rc = "flowchart", mermaid, _RC_FLOWCHART
    elif art_type in ("operation", "matrix") and latex:
        # Sanitation : délimiteurs embarqués retirés + commandes mutilées réparées
        # (le renderer katex fournit ses propres $$). raw_binary/base intacts.
        new_type = "matrix"
        raw_data = "$$%s$$" % _sanitize_latex(latex)
        base_rc = _RC_MATRIX
    elif art_type == "plot" and plotly:
        new_type, raw_data, base_rc = "signal_waveform", plotly, _RC_PLOT
    elif art_type == "table" and markdown:
        new_type, raw_data, base_rc = "data_table", markdown, _RC_TABLE
    elif art_type == "chemistry" and smiles:
        new_type, raw_data, base_rc = "smiles_chem", smiles, _RC_CHEM
    elif art_type == "code" and code:
        rc = dict(_RC_CODE)
        rc["lang"] = lang or "text"
        new_type, raw_data, base_rc = "code_snippet", code, rc

    if new_type is None:
        # photo / other / structure attendue absente → NON requalifié : l'artefact
        # reste dense_illustration. On renvoie tout de même caption + semantic pour
        # que l'appelant mette à jour la légende et fusionne la sémantique.
        if caption is None and semantic is None:
            return None
        return {"artifact_type": None, "raw_data": None,
                "render_config_json": _with_semantic(_RC_DENSE, semantic) if semantic else None,
                "caption": caption, "semantic": semantic,
                "searchable_text": caption}

    searchable = (caption or "") + " " + (raw_data or "")
    return {
        "artifact_type": new_type,
        "raw_data": raw_data,
        "render_config_json": _with_semantic(base_rc, semantic),
        "caption": caption,
        "semantic": semantic,
        "searchable_text": searchable.strip()[:500] or new_type,
    }


def qualify_visual_artifact(webp_bytes, generate_fn, timeout_s=60):
    """Qualifie UNE découpe WebP via VLM et renvoie le nouveau typage structuré.

    Args:
        webp_bytes  : bytes du crop WebP original (JAMAIS modifié).
        generate_fn : callable(prompt, image_b64=..., timeout_s=...) → dict|None
                      (typiquement backend.llm.key_manager.generate).
        timeout_s   : délai VLM.

    Returns:
        dict|None. En cas de RE-TYPAGE : {artifact_type, raw_data,
        render_config_json, caption, searchable_text, semantic}. En cas de
        photo/other mais avec légende/sémantique utile : même forme mais
        artifact_type=None (l'appelant garde dense_illustration + met à jour
        caption / fusionne semantic). None si rien d'exploitable.
        Ne lève JAMAIS : le pipeline ne s'arrête pas ici.
    """
    if not webp_bytes or generate_fn is None:
        return None
    try:
        image_b64 = base64.b64encode(webp_bytes).decode("ascii")
    except (TypeError, ValueError):
        return None
    try:
        result = generate_fn(_PROMPT, image_b64=image_b64, timeout_s=timeout_s)
    except Exception:  # noqa: BLE001 — VLM injoignable / exception provider : on abandonne
        return None
    if not result or not isinstance(result, dict):
        return None
    parsed = _extract_json(result.get("content"))
    mapped = _map_result(parsed)
    if mapped is not None and result.get("provider"):
        mapped["vlm_provider"] = result.get("provider")
    return mapped


_EXPLODE_PROMPT = (
    "Analyse cette page de manuel scolaire. Liste CHAQUE élément visuel distinct "
    "(opération posée, tableau, figure géométrique, schéma fléché, encadré de méthode, "
    "graphique, dessin) — PAS les paragraphes de texte simple. Réponds UNIQUEMENT en JSON : "
    '{"elements":[{"type":"geometry"|"drawing"|"operation"|"diagram"|"flowchart"|"plot"|"matrix"|"table"|"chemistry"|"code"|"photo",'
    '"semantic":"demonstration"|"illustration"|"exercise_support"|null,'
    '"caption_ar":"légende courte arabe",'
    '"bbox_pct":{"x0":0-100,"y0":0-100,"x1":0-100,"y1":0-100} (position en POURCENTAGE de l\'image),'
    '"svg":str|null,"latex":str|null (opération posée → \\begin{array} fidèle avec retenues),'
    '"mermaid":str|null,"plotly_json":str|null,"markdown":str|null,"smiles":str|null,"code":str|null,"lang":str|null}]}. '
    "Maximum 12 éléments, les plus significatifs d'abord.")


def explode_full_page(webp_bytes, generate_fn, timeout_s=90):
    """Explose un cadre quasi-pleine-page en SOUS-ARTEFACTS individuels :
    le VLM liste chaque élément visuel (type + forme structurée + bbox %),
    chaque élément reçoit son PROPRE crop WebP découpé de l'original
    (comparateur) + son raw_data structuré. Retourne une liste (possiblement
    vide) de dicts prêts à insérer ; None si l'appel VLM échoue."""
    import base64 as _b64
    result = generate_fn(_EXPLODE_PROMPT,
                         image_b64=_b64.b64encode(webp_bytes).decode("ascii"),
                         timeout_s=timeout_s)
    if not result or not result.get("content"):
        return None
    parsed = _extract_json(result["content"])
    if not parsed or not isinstance(parsed.get("elements"), list):
        return None
    try:
        import cv2
        import numpy as np
        img = cv2.imdecode(np.frombuffer(webp_bytes, np.uint8), cv2.IMREAD_COLOR)
        H, W = img.shape[:2]
    except Exception:  # noqa: BLE001 — pas de découpe possible : abandon propre
        return None
    out = []
    for el in parsed["elements"][:12]:
        if not isinstance(el, dict):
            continue
        bb = el.get("bbox_pct") or {}
        try:
            vals = [float(bb[k]) for k in ("x0", "y0", "x1", "y1")]
            # Échelle auto : les VLM répondent en % (0-100) OU en norme 0-1000 (Gemini box_2d).
            scale = 1000.0 if max(vals) > 100.0 else 100.0
            x0 = max(0, int(W * vals[0] / scale)); y0 = max(0, int(H * vals[1] / scale))
            x1 = min(W, int(W * vals[2] / scale)); y1 = min(H, int(H * vals[3] / scale))
        except (KeyError, TypeError, ValueError):
            continue
        if x1 - x0 < 20 or y1 - y0 < 20:
            continue
        ok, buf = cv2.imencode(".webp", img[y0:y1, x0:x1], [cv2.IMWRITE_WEBP_QUALITY, 80])
        crop = buf.tobytes() if ok else None
        mapped = _map_result(el)  # même mapping §12 que la qualification unitaire
        if mapped is None or not mapped.get("artifact_type"):
            import json as _json
            sem = el.get("semantic") if el.get("semantic") in _VALID_SEMANTICS else None
            mapped = {"artifact_type": "dense_illustration", "raw_data": None,
                      "render_config_json": _json.dumps(_with_semantic(dict(_RC_DENSE), sem),
                                                        ensure_ascii=False)}
        caption = (el.get("caption_ar") or "").strip() or None
        out.append({"artifact_type": mapped["artifact_type"], "raw_data": mapped.get("raw_data"),
                    "render_config_json": mapped["render_config_json"], "caption": caption,
                    "searchable_text": caption or mapped["artifact_type"],
                    "raw_binary": crop, "bbox_rel": (x0, y0, x1, y1),
                    "semantic": el.get("semantic")})
    return out
