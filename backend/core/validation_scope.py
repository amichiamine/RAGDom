# -*- coding: utf-8 -*-
"""Résolution universelle et non mutante des périmètres documentaires."""
from dataclasses import dataclass
from typing import List, Optional, Sequence


class ScopeResolutionError(ValueError):
    """Erreur de contrat de scope avec code HTTP transportable."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ScopeTarget:
    document_id: str
    total_pages: int
    pages: tuple
    toc_id: Optional[str] = None

    @property
    def page_start(self) -> int:
        return min(self.pages)

    @property
    def page_end(self) -> int:
        return max(self.pages)


_SCOPE_ALIASES = {"chapter": "toc", "course": "toc", "title": "toc"}
SUPPORTED_SCOPES = frozenset(("base", "document", "toc", "chapter", "course", "title",
                              "page", "page_range", "page_selection"))


def _document(conn, document_id: str):
    row = conn.execute("SELECT id, total_pages FROM documents WHERE id=?", (document_id,)).fetchone()
    if row is None:
        raise ScopeResolutionError(404, "Document introuvable")
    total = int(row[1] or 0)
    if total < 1:
        raise ScopeResolutionError(409, "Document sans page exploitable")
    return row[0], total


def _bounded_pages(pages: Sequence[int], total: int) -> tuple:
    if not pages:
        raise ScopeResolutionError(400, "Sélection de pages vide")
    normalized = []
    for raw in pages:
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise ScopeResolutionError(400, "Les numéros de page doivent être des entiers")
        if raw < 1 or raw > total:
            raise ScopeResolutionError(400, "Page %s hors bornes [1, %s]" % (raw, total))
        if raw not in normalized:
            normalized.append(raw)
    return tuple(sorted(normalized))


def resolve_scope(conn, scope_type: str, document_id: Optional[str] = None,
                  toc_id: Optional[str] = None, page: Optional[int] = None,
                  page_start: Optional[int] = None, page_end: Optional[int] = None,
                  pages: Optional[Sequence[int]] = None) -> List[ScopeTarget]:
    """Résout et valide entièrement un scope AVANT toute mutation.

    ``toc/chapter/course/title`` partagent la même sémantique de plage TOC et
    vérifient obligatoirement que ``toc_id`` appartient au ``document_id`` fourni.
    Les plages ne sont jamais corrigées silencieusement : toute borne invalide est
    une erreur 400.
    """
    if scope_type not in SUPPORTED_SCOPES:
        raise ScopeResolutionError(400, "scope_type invalide")
    if scope_type == "base":
        if any(value is not None for value in (document_id, toc_id, page, page_start, page_end)) or pages:
            raise ScopeResolutionError(400, "Le scope base n'accepte aucun sélecteur")
        rows = conn.execute("SELECT id, total_pages FROM documents ORDER BY id").fetchall()
        if not rows:
            raise ScopeResolutionError(404, "Base sans document")
        targets = []
        for doc_id, total in rows:
            if int(total or 0) > 0:
                targets.append(ScopeTarget(doc_id, int(total), tuple(range(1, int(total) + 1))))
        if not targets:
            raise ScopeResolutionError(409, "Base sans page exploitable")
        return targets

    if not document_id:
        raise ScopeResolutionError(400, "document_id requis pour ce scope")
    doc_id, total = _document(conn, document_id)
    canonical = _SCOPE_ALIASES.get(scope_type, scope_type)

    if canonical == "document":
        if any(value is not None for value in (toc_id, page, page_start, page_end)) or pages:
            raise ScopeResolutionError(400, "Le scope document n'accepte pas de sélecteur de page")
        return [ScopeTarget(doc_id, total, tuple(range(1, total + 1)))]

    if canonical == "toc":
        if not toc_id:
            raise ScopeResolutionError(400, "toc_id requis pour ce scope")
        if any(value is not None for value in (page, page_start, page_end)) or pages:
            raise ScopeResolutionError(400, "Un scope TOC n'accepte pas de sélecteur de page")
        row = conn.execute("SELECT page_start, page_end FROM document_toc"
                           " WHERE id=? AND document_id=?", (toc_id, doc_id)).fetchone()
        if row is None:
            exists = conn.execute("SELECT 1 FROM document_toc WHERE id=?", (toc_id,)).fetchone()
            if exists:
                raise ScopeResolutionError(409, "toc_id n'appartient pas au document")
            raise ScopeResolutionError(404, "Entrée TOC introuvable")
        start, end = int(row[0]), int(row[1] or total)
        selected = _bounded_pages(list(range(start, end + 1)), total)
        return [ScopeTarget(doc_id, total, selected, toc_id=toc_id)]

    if canonical == "page":
        selected_page = page if page is not None else page_start
        if selected_page is None:
            raise ScopeResolutionError(400, "page requise pour le scope page")
        if any(value is not None for value in (toc_id, page_end)) or pages:
            raise ScopeResolutionError(400, "Sélecteurs incompatibles avec le scope page")
        return [ScopeTarget(doc_id, total, _bounded_pages([selected_page], total))]

    if canonical == "page_range":
        if page_start is None or page_end is None:
            raise ScopeResolutionError(400, "page_start et page_end requis")
        if page_start > page_end:
            raise ScopeResolutionError(400, "page_start doit être inférieur ou égal à page_end")
        if toc_id is not None or page is not None or pages:
            raise ScopeResolutionError(400, "Sélecteurs incompatibles avec page_range")
        return [ScopeTarget(doc_id, total,
                            _bounded_pages(list(range(page_start, page_end + 1)), total))]

    if canonical == "page_selection":
        if toc_id is not None or page is not None or page_start is not None or page_end is not None:
            raise ScopeResolutionError(400, "Sélecteurs incompatibles avec page_selection")
        return [ScopeTarget(doc_id, total, _bounded_pages(list(pages or []), total))]

    raise ScopeResolutionError(400, "scope_type non résolu")
