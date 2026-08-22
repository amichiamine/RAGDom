# -*- coding: utf-8 -*-
"""sci-engine — Couche 3 : Qualification pédagogique élastique + chunking + embeddings.

Détection opportuniste sans dogme (regex FR/AR/EN — Zéro Dogme : NULL si aucun
motif). pedagogical_index extrait (V3.5). Chunking tech_specs §3.1 : 512 tokens,
overlap 15%, séparateurs hiérarchiques, blocs d'artefacts jamais coupés.
Embeddings : fastembed/paraphrase-multilingual-MiniLM-L12-v2 (384d) — None si
modèle indisponible (RAGDOM_OFFLINE), la recherche FTS restant opérationnelle.
Python 3.9+.
"""
import os
import re
import struct
import time

# Ordinaux arabes → indices (typographie réelle des sujets algériens :
# « التمرين الأول » plutôt que « تمرين رقم 1 »). Mapping linguistique générique.
_AR_ORDINALS = {"الأول": 1, "الاول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4,
                "الخامس": 5, "السادس": 6, "السابع": 7, "الثامن": 8, "التاسع": 9,
                "العاشر": 10}
_AR_ORD_RE = "|".join(_AR_ORDINALS)

# Diacritiques arabes (harakat/tashkil U+064B-U+0652, alef superscript U+0670,
# tatweel U+0640) : l'OCR des manuels vocalisés produit « التَّمْرِينُ » qu'on doit
# reconnaître comme « التمرين ». On normalise AVANT toute qualification.
_HARAKAT_RE = re.compile(r"[ً-ْٰـ]")


def _strip_harakat(text: str) -> str:
    return _HARAKAT_RE.sub("", text or "")


# ── Regex de qualification (Skills §2.5) — opportunistes, jamais imposées ──
# ORDRE CRITIQUE (Zéro Dogme mais priorités linguistiques) :
#  1. Solutions/corrigés AVANT exercices : « حل التمرين 3 » (corrigé de l'ex 3) ne
#     doit jamais être capté comme exercice par le mot « تمرين » qu'il contient.
#  2. Marqueurs arabes NUS acceptés (sans numéro) : le corpus 1AM écrit « تمرين »,
#     « نشاط », « وضعية » sans systématiquement les numéroter (V4.3 — corpus réel).
#  3. Marqueurs FR/évaluations ANCRÉS en tête de ligne/heading : « BAC » enfoui dans
#     un énoncé (angle BAC, « نتائج امتحان… ») ne doit plus produire de faux positif.
#  4. Le cours (le plus générique) reste en dernier et ne prime jamais sur un exercice.
_PATTERNS = [
    # ── SOLUTIONS / CORRIGÉS (priorité absolue) ──
    ("solution_only", re.compile(r"(?:^|\n)\s*[#>*\-|\s]*(?:Solution|Corrigé|Corrige|Correction)\b\s*(?:de\s+l['’]exercice\s*)?(?:n?[°ºo]\s*)?(\d{1,3})?", re.I)),
    ("solution_only", re.compile(r"(?:الحل|التصحيح|حل|تصحيح)\s+(?:ال)?(?:تمرين|تمارين|فرض|اختبار|مسألة|نشاط)\s+(%s)\b" % _AR_ORD_RE)),
    ("solution_only", re.compile(r"(?:الحل|التصحيح|حل|تصحيح)\s*(?:ال)?(?:تمرين|تمارين|فرض|اختبار|مسألة|نشاط)?\s*(?:رقم\s*)?(\d{1,3})?")),
    ("solution_only", re.compile(r"(?:الحلول|التصحيحات|حلول\s+التمارين|تصحيح\s+التمارين)")),
    # ── ÉVALUATIONS (sujets d'examen) — ANCRÉES en tête pour éviter le bruit OCR ──
    ("evaluation_exam", re.compile(r"(?:^|\n)\s*[#>*\-|\s]*(?:Devoir|Composition|Examen|Contrôle|Controle|BEM|BAC)\b", re.I)),
    ("evaluation_exam", re.compile(r"(?:^|\n)\s*[#>*\-|\s]*(?:ال)?(?:فرض|اختبار|امتحان|تقويم|الوضعية\s+الإدماجية|إدماج)\b")),
    # ── EXERCICES / ACTIVITÉS — FR : numéro requis ; AR : marqueur nu accepté ──
    ("exercise_unsolved", re.compile(r"(?:^|\n)\s*[#>*\-|\s]*(?:Exercice|Exercise|Problem|Activité|Activite)\s*(?:n?[°ºo]\s*)?(\d{1,3})", re.I)),
    ("exercise_unsolved", re.compile(r"(?:ال)?(?:تمرين|تمارين|مسألة|نشاط|أنشطة|وضعية)\s+(%s)\b" % _AR_ORD_RE)),
    ("exercise_unsolved", re.compile(r"(?:ال)?(?:تمرين|تمارين|مسألة|نشاط|أنشطة|وضعية)\s*(?:رقم\s*)?(\d{1,3})")),
    ("exercise_unsolved", re.compile(r"(?:^|\n|\||#|\s)(?:ال)?(?:تمرين|تمارين|أنشطة|نشاط|وضعية|أتدرب|أتمرن|أطبق|أوظف|أنجز)\b")),
    # ── DÉMONSTRATIONS ──
    ("proof_demonstration", re.compile(r"(?:^|\n)\s*[#>*\-|\s]*(?:Démonstration|Demonstration|Preuve|Proof)\b|(?:برهان|إثبات|أبرهن)", re.I)),
    # ── TRAVAUX PRATIQUES — « TP » ANCRÉ en tête (bruit OCR latin « ...Tp... » exclu) ──
    ("practical_work", re.compile(r"(?:^|\n)\s*[#>*\-|\s]*(?:TP|Travaux\s+pratiques|Manipulation)\b|(?:عمل\s*تطبيقي|أنشطة\s*تطبيقية)", re.I)),
    # ── COURS / THÉORIE (dernier : le plus général) ──
    ("course_theory", re.compile(r"(?:^|\n)\s*[#>*\-|\s]*(?:Définition|Definition|Théorème|Theoreme|Propriété|Propriete|Règle|Regle|Cours|Leçon|Lecon)\b|(?:تعريف|مبرهنة|خاصية|قاعدة|الدرس|أتعلم|أكتشف|أتذكر|أستحضر|أتحقق|مكتسباتي)", re.I)),
]
_H2_RE = re.compile(r"\n(?=##?#?\s)")
_embedder = {"tried": False, "model": None, "name": None}


def _qualify(text: str):
    """Retourne (pedagogical_type|None, pedagogical_index|None) — Zéro Dogme.

    Le texte est d'abord normalisé (suppression des harakat) : les marqueurs
    vocalisés du corpus arabe sont ainsi reconnus sans dupliquer chaque regex.
    """
    scan = _strip_harakat(text)
    for ptype, pattern in _PATTERNS:
        match = pattern.search(scan)
        if match:
            index = None
            if match.groups() and match.group(1):
                if match.group(1) in _AR_ORDINALS:
                    index = _AR_ORDINALS[match.group(1)]
                    return ptype, index
                try:
                    index = int(match.group(1))
                except ValueError:
                    index = None
            return ptype, index
    return None, None


def _get_embedder():
    if _embedder["tried"]:
        return _embedder["model"]
    _embedder["tried"] = True
    if os.environ.get("RAGDOM_OFFLINE", "false").lower() == "true":
        return None
    if os.environ.get("RAGDOM_LOW_MEMORY", "false").lower() == "true":
        return None  # hébergements ≤512 Mo : l'encodeur ONNX provoque un OOM kill
                     # → recherche BM25 seule (repli documenté tech_specs §3.3)
    try:
        from fastembed import TextEmbedding
    except Exception:  # noqa: BLE001 — fastembed absent : FTS seul
        _embedder["model"] = None
        return _embedder["model"]
    # Modèle principal (multilingue FR/AR/EN) puis repli mono-lingue plus léger
    # (tech_specs §3.2) avant d'abandonner la recherche vectorielle.
    for model_name in ("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
                       "sentence-transformers/all-MiniLM-L6-v2"):
        try:
            _embedder["model"] = TextEmbedding(model_name)
            _embedder["name"] = model_name
            return _embedder["model"]
        except Exception:  # noqa: BLE001 — hors-ligne / modèle absent : essaie le repli
            _embedder["model"] = None
    return _embedder["model"]


def _token_len(text: str, encoder) -> int:
    return len(encoder.encode(text)) if encoder else max(1, len(text) // 4)


def _split_units(markdown: str):
    """Unités hiérarchiques (H2/H3 puis paragraphes) — un bloc $$..$$ n'est jamais coupé."""
    units = []
    for section in _H2_RE.split(markdown):
        parts = re.split(r"\n\n+", section)
        buffer = ""
        in_math = False
        for part in parts:
            in_math = in_math ^ (part.count("$$") % 2 == 1)
            buffer = (buffer + "\n\n" + part).strip() if buffer else part
            if not in_math:
                units.append(buffer)
                buffer = ""
        if buffer:
            units.append(buffer)
    return [u for u in units if u.strip()]


def _has_open_math(text: str) -> bool:
    """Un fragment laisse-t-il un bloc $$..$$ ouvert ? (nombre impair de $$)."""
    return text.count("$$") % 2 == 1


def _split_by_separator(unit: str, separator: str, max_tokens: int, encoder):
    """Redécoupe un pavé monolithique sur `separator` (repli \\n puis espace),
    sans jamais couper à l'intérieur d'un bloc $$..$$ (tech_specs §3.1)."""
    fragments = unit.split(separator)
    pieces, buffer = [], ""
    for fragment in fragments:
        candidate = (buffer + separator + fragment) if buffer else fragment
        # Ne pas fermer un chunk tant qu'un bloc mathématique reste ouvert.
        if buffer and _token_len(candidate, encoder) > max_tokens and not _has_open_math(buffer):
            pieces.append(buffer)
            buffer = fragment
        else:
            buffer = candidate
    if buffer:
        pieces.append(buffer)
    return [p for p in pieces if p != ""]


def _enforce_max_size(unit: str, max_tokens: int, encoder):
    """Garantit qu'aucune unité ne dépasse max_tokens : replis hiérarchiques
    \\n\\n → \\n → espace (dernier recours). Les blocs $$..$$ restent intègres."""
    if _token_len(unit, encoder) <= max_tokens:
        return [unit]
    for separator in ("\n\n", "\n", " "):
        if separator not in unit:
            continue
        pieces = _split_by_separator(unit, separator, max_tokens, encoder)
        # Un séparateur n'a réduit la taille que s'il a réellement scindé le pavé.
        if len(pieces) > 1:
            result = []
            for piece in pieces:
                if _token_len(piece, encoder) > max_tokens and separator != " ":
                    result.extend(_enforce_max_size(piece, max_tokens, encoder))
                else:
                    result.append(piece)
            return result
    return [unit]  # aucun séparateur exploitable (ou bloc math indivisible) : intègre


def run(ctx: dict) -> dict:
    started = time.perf_counter()
    markdown = ctx.get("content_markdown", "") or ""
    try:
        import tiktoken
        encoder = tiktoken.get_encoding("cl100k_base")
    except Exception:  # noqa: BLE001 — repli heuristique 4 chars/token
        encoder = None

    max_tokens, overlap_ratio = 512, 0.15
    # Découpage hiérarchique complet (tech_specs §3.1) : H2/H3 → \n\n → \n →
    # espace en dernier recours pour les pavés monolithiques dépassant max_tokens.
    base_units = []
    for unit in _split_units(markdown):
        base_units.extend(_enforce_max_size(unit, max_tokens, encoder))
    chunks, current, current_tokens = [], [], 0
    for unit in base_units:
        unit_tokens = _token_len(unit, encoder)
        if current and current_tokens + unit_tokens > max_tokens:
            chunks.append("\n\n".join(current))
            keep = max(1, int(len(current) * overlap_ratio))  # overlap 15% (unités)
            current, current_tokens = current[-keep:], sum(_token_len(u, encoder) for u in current[-keep:])
        current.append(unit)
        current_tokens += unit_tokens
    if current:
        chunks.append("\n\n".join(current))

    section_title = None
    heading = re.search(r"^#{1,3}\s+(.+)$", markdown, re.M)
    if heading:
        section_title = heading.group(1).strip()[:200]

    embedder = _get_embedder()
    chunk_rows = []
    for index, text in enumerate(chunks):
        ptype, pindex = _qualify(text)
        embedding_blob = None
        if embedder is not None:
            try:
                vector = next(iter(embedder.embed(["passage: " + text[:2000]])))
                embedding_blob = struct.pack("<384f", *vector[:384])  # Float32 LE, L2 par fastembed
            except Exception:  # noqa: BLE001
                embedding_blob = None
        chunk_rows.append({
            "chunk_index": index, "section_title": section_title, "content_markdown": text,
            "pedagogical_type": ptype, "pedagogical_index": pindex,
            "token_count": _token_len(text, encoder), "embedding_vector": embedding_blob,
        })

    profile = None
    if embedder is not None and any(row["embedding_vector"] is not None for row in chunk_rows):
        try:
            import importlib.metadata as _metadata
            version = _metadata.version("fastembed")
        except Exception:  # noqa: BLE001
            version = "unknown"
        profile = {"model_name": _embedder.get("name") or "unknown", "model_version": version,
                   "pooling": "mean", "dimensions": 384, "normalized": True}
    ctx.update(chunks=chunk_rows, embedding_profile=profile,
               qualification_latency_ms=int((time.perf_counter() - started) * 1000))
    ctx.setdefault("latencies", {})["layer_3_qualify"] = ctx["qualification_latency_ms"]
    return ctx
