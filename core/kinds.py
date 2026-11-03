"""Entity kinds (schema only).

Every entity has a kind, and kinds form an is-a hierarchy (for example
``spraybottle`` is-a ``object``). Each benchmark profile declares its own kinds.
In ``canonical_record.json`` they appear under ``kinds`` as ``kind -> parent``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class KindDeclaration:
    kind: str
    parent: Optional[str] = None  # None for a root kind
