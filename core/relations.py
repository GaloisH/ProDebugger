"""Relations between entities (schema only).

Each fact names a relation. A benchmark profile declares the relations it uses,
with their arity and properties. In ``canonical_record.json`` they appear under
``relations``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import FrozenSet, Optional, Tuple

FUNCTIONAL = "functional"   # the key positions determine a single value
MUTABLE = "mutable"         # the value may change during the run
SYMMETRIC = "symmetric"
TRANSITIVE = "transitive"
OBSERVED = "observed"       # every instance shown to the agent is recorded
PROPERTIES = frozenset({FUNCTIONAL, MUTABLE, SYMMETRIC, TRANSITIVE, OBSERVED})


@dataclass(frozen=True)
class Relation:
    name: str
    arity: int
    props: FrozenSet[str]                     # subset of PROPERTIES
    key: Tuple[int, ...]                      # argument positions that identify the value
    arg_kinds: Tuple[Optional[str], ...] = ()  # expected kind of each argument, if declared
    value_types: FrozenSet[str] = frozenset({"any"})
