"""Abstract-rule definitions and derived evidence over a canonical core Record.

Entities, kinds, relations, facts and goals are core/record.py types. Detection
lives in abstract_rules.py; findings are stored in the Record.evidences sidecar.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Tuple


RULE_TYPES = ("Fact", "Entity", "Goal", "Constraint")
RULE_SCOPES = ("step", "prefix", "response", "trajectory")


@dataclass(frozen=True)
class Rule:
    """Abstract rule data. Symbolic descriptions are stored, never executed."""
    id: str
    variables: Dict[str, str]
    scope: str
    trigger: str
    applicability: str
    property: str
    evidence_requirements: Tuple[str, ...]
    exceptions: Tuple[str, ...]
    witness_builder: str

    def __post_init__(self):
        names = (self.id, self.trigger, self.applicability, self.property, self.witness_builder)
        if any(not isinstance(v, str) or not v.strip() for v in names):
            raise ValueError("rule identifiers/descriptions must be nonempty strings")
        if self.scope not in RULE_SCOPES:
            raise ValueError("unknown rule scope")
        if not isinstance(self.variables, dict) or not self.variables or any(
                not isinstance(k, str) or not k or v not in RULE_TYPES
                for k, v in self.variables.items()):
            raise ValueError("invalid rule variables")
        if any(not isinstance(v, str) or not v.strip()
               for v in (*self.evidence_requirements, *self.exceptions)):
            raise ValueError("rule requirements/exceptions must be nonempty strings")

    @classmethod
    def from_dict(cls, definition):
        data = dict(definition)
        data["variables"] = dict(data["variables"])
        data["evidence_requirements"] = tuple(data["evidence_requirements"])
        data["exceptions"] = tuple(data["exceptions"])
        return cls(**data)


@dataclass
class Evidence:
    """A derived finding whose refs index facts in the same Record.F."""
    eid: int
    kind: str
    t: int
    refs: Tuple[int, ...]
    status: str = "candidate"
    rule: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if type(self.eid) is not int or self.eid < 0:
            raise ValueError("evidence eid must be a nonnegative integer")
        if not isinstance(self.kind, str) or not self.kind.strip():
            raise ValueError("evidence kind must be a nonempty string")
        if type(self.t) is not int or self.t < 0:
            raise ValueError("evidence t must be a nonnegative integer")
        if self.status not in ("candidate", "confirmed", "dismissed"):
            raise ValueError("unknown evidence status")
        if not self.refs or any(type(fid) is not int or fid < 0 for fid in self.refs):
            raise ValueError("evidence refs must contain nonnegative Fact indices")
        self.refs = tuple(dict.fromkeys(self.refs))


@dataclass
class Evidences:
    """Same-kind findings, preserving each event and exposing merged refs."""
    kind: str
    items: List[Evidence] = field(default_factory=list)

    def __post_init__(self):
        if any(item.kind != self.kind for item in self.items):
            raise ValueError("only same-kind evidence can be grouped")

    def add(self, evidence: Evidence) -> None:
        if evidence.kind != self.kind:
            raise ValueError("only same-kind evidence can be grouped")
        self.items.append(evidence)

    @property
    def refs(self) -> Tuple[int, ...]:
        return tuple(sorted({fid for item in self.items for fid in item.refs}))


def add_evidence(record, kind: str, t: int, refs: Iterable[int],
                 status: str = "candidate", rule: Optional[str] = None,
                 details: Optional[Dict[str, Any]] = None) -> Evidence:
    """Append one finding to record.evidences; refs must not point forward."""
    eid = 1 + max((e.eid for g in record.evidences.values() for e in g.items), default=-1)
    evidence = Evidence(eid, kind, t, tuple(refs), status, rule, dict(details or {}))
    for fid in evidence.refs:
        if fid >= len(record.F):
            raise IndexError(f"evidence Fact index {fid} does not exist")
        if record.F[fid].t > evidence.t:
            raise ValueError("evidence must not reference a future fact")
    record.evidences.setdefault(kind, Evidences(kind)).add(evidence)
    return evidence


__all__ = ["Rule", "RULE_TYPES", "RULE_SCOPES", "Evidence", "Evidences", "add_evidence"]
