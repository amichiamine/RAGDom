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

# ── Regex de qualification (Skills §2.5) — opportunistes, jamais imposées ──
_PATTERNS = [
    ("exercise_unsolved", re.compile(r"(?:^|\n)\s*(?:\*{0,2})(?:Exercice|Exercise|Problem|Activité)\s*(?:n?[°ºo]\s*)?(\d{1,3})", re.I)),
    ("exercise_unsolved", re.compile(r"(?:تمرين|مسألة|نشاط)\s*(?:رقم\s*)?(\d{1,3})")),
    ("exercise_unsolved", re.compile(r"(?:ال)?(?:تمرين|مسألة|نشاط|وضعية)\s+(%s)" % _AR_ORD_RE)),
    ("solution_only", re.compile(r"(?:^|\n)\s*(?:\*{0,2})(?:Solution|Corrigé|Correction)\s*(?:de\s+l['']exercice\s*)?(?:n?[°ºo]\s*)?(\d{1,3})?", re.I)),
    ("solution_only", re.compile(r"(?:حل|تصحيح)\s*(?:ال)?(?:تمرين|فرض|اختبار)?\s*(?:رقم\s*)?(\d{1,3})?")),
    ("solution_only", re.compile(r"(?:حل|تصحيح)\s+(?:ال)?(?:تمرين|فرض|اختبار)\s+(%s)" % _AR_ORD_RE)),
    ("evaluation_exam", re.compile(r"(?:Devoir|Composition|Examen|Contrôle|BEM|BAC)\b|(?:فرض|اختبار|امتحان)", re.I)),
    ("proof_demonstration", re.compile(r"(?:Démonstration|Preuve|Proof)\b|(?:برهان|إثبات)", re.I)),
    ("practical_work", re.compile(r"(?:TP|Travaux\s+pratiques|Manipulation)\b|(?:عمل\s*تطبيقي)", re.I)),
    ("course_theory", re.compile(r"(?:Définition|Théorème|Propriété|Règle|Cours|Leçon)\b|(?:تعريف|مبرهنة|خاصية|قاعدة|درس)", re.I)),
]
_H2_RE = re.compile(r"\n(?=##?#?\s)")
_embedder = {"tried": False, "model": None}


def _qualify(text: str):
    """Retourne (pedagogical_type|None, pedagogical_index|None) — Zéro Dogme."""
    for ptype, pattern in _PATTERNS:
        match = pattern.search(text)
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
        _embedder["model"] = TextEmbedding("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
    except Exception:  # noqa: BLE001 — hors-ligne / modèle absent : FTS seul
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


def run(ctx: dict) -> dict:
    started = time.perf_counter()
    markdown = ctx.get("content_markdown", "") or ""
    try:
        import tiktoken
        encoder = tiktoken.get_encoding("cl100k_base")
    except Exception:  # noqa: BLE001 — repli heuristique 4 chars/token
        encoder = None

    max_tokens, overlap_ratio = 512, 0.15
    chunks, current, current_tokens = [], [], 0
    for unit in _split_units(markdown):
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

    ctx.update(chunks=chunk_rows,
               qualification_latency_ms=int((time.perf_counter() - started) * 1000))
    ctx.setdefault("latencies", {})["layer_3_qualify"] = ctx["qualification_latency_ms"]
    return ctx
