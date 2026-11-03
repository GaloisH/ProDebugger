"""Rule and evidence structures (schema only).

Rule checks run over a compiled record (see core/record.py) and attach their
findings to it. The fields below match ``rules.json`` and ``evidences.json`` in
the examples on the online platform. The rules themselves and how they are
checked are not published.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple

RULE_TYPES = ("Fact", "Entity", "Goal", "Constraint")
RULE_SCOPES = ("step", "prefix", "response", "trajectory")
EVIDENCE_STATUSES = ("candidate", "confirmed", "dismissed")


@dataclass(frozen=True)
class Rule:
    """A declarative rule description."""
    id: str                               # e.g. "decision.applicability/v1"
    variables: Dict[str, str]             # variable name -> one of RULE_TYPES
    scope: str                            # one of RULE_SCOPES
    trigger: str
    applicability: str
    property: str
    evidence_requirements: Tuple[str, ...]
    exceptions: Tuple[str, ...]
    witness_builder: str


@dataclass
class Evidence:
    """One finding, pointing at facts of the same record by fid."""
    eid: int
    kind: str
    t: int                                # step the finding belongs to
    refs: Tuple[int, ...]                 # fids, never later than step t
    status: str = "candidate"             # one of EVIDENCE_STATUSES
    rule: Optional[str] = None            # Rule.id that produced it
    details: Dict[str, Any] = field(default_factory=dict)


__all__ = ["Rule", "Evidence", "RULE_TYPES", "RULE_SCOPES", "EVIDENCE_STATUSES"]
