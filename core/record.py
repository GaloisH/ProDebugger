"""Data structures of a compiled trajectory record (schema only).

A recorded trajectory is compiled into a record of entities, typed facts, task
goals and the original source text. The field names below match the keys of
``canonical_record.json`` in the examples on the online platform. Only the shape
of the data is published here; how it is built and queried is not.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

IR_VERSION = "trajectory-ir/v3"

# Where a fact was read from within a step.
SLOTS = (
    "obs",   # environment observation
    "mem",   # agent memory module
    "refl",  # agent reflection module
    "plan",  # agent plan module
    "act",   # action the agent emitted
    "chk",   # check on the action (e.g. whether it was admissible)
)

# Who the fact is about.
SIDES = ("env", "mind", "task", "dbg")

# How completely a plan names what it intends to do.
BINDINGS = ("full", "verb_only", "unbound", "absent")

CONSTRAINT_OPERATORS = (
    "eq", "neq", "lt", "le", "gt", "ge", "contains", "subset",
    "member_of", "string_match", "semantic_match",
)
CONSTRAINT_VALUE_TYPES = ("boolean", "number", "money", "string", "text", "enum", "entity", "set")
CONSTRAINT_MODES = ("selection", "observation", "semantic")
COMMITMENTS = ("explore", "inspect", "select", "navigate", "commit", "unknown")

# Placeholder for an argument a statement leaves unnamed.
UNBOUND = "*"


@dataclass(frozen=True)
class Entity:
    """A thing in the trajectory, written ``kind:index`` (e.g. ``cabinet:3``)."""
    kind: str
    index: str


@dataclass(frozen=True)
class Constraint:
    """One typed condition of the task, with the task text it came from."""
    property: Entity
    operator: str             # one of CONSTRAINT_OPERATORS
    expected: Any
    value_type: str = "string"  # one of CONSTRAINT_VALUE_TYPES
    unit: Optional[str] = None
    mode: str = "selection"   # one of CONSTRAINT_MODES
    span: str = ""
    confidence: float = 1.0


@dataclass(frozen=True)
class IntentionParameter:
    """A typed argument named by a plan."""
    name: str
    value: Any
    value_type: str = "string"
    span: str = ""


@dataclass(frozen=True)
class IntentionOption:
    """One action that could carry out an intention."""
    verb: str
    objects: Optional[Tuple[Entity, ...]]
    role: str = "alternative"
    span: str = ""
    preconditions: Tuple[str, ...] = ()
    expected_effects: Tuple[str, ...] = ()


@dataclass(frozen=True)
class Intention:
    """What a plan says the agent intends to do.

    ``objects`` is None when the plan names no object and an empty tuple when it
    says the act takes none.
    """
    verb: Optional[str]
    objects: Optional[Tuple[Entity, ...]]
    purpose: Optional[Entity]
    span: str = ""
    parameters: Tuple[IntentionParameter, ...] = ()
    execution_options: Tuple[IntentionOption, ...] = ()
    serves: Tuple[Entity, ...] = ()
    mentions: Tuple[Entity, ...] = ()
    preconditions: Tuple[str, ...] = ()
    expected_effects: Tuple[str, ...] = ()
    commitment: str = "unknown"  # one of COMMITMENTS
    extraction: str = "rule"
    confidence: float = 1.0


@dataclass(frozen=True)
class SourceStep:
    """The original text of one step, kept beside the facts that summarize it."""
    observation: str
    agent: str
    modules: Dict[str, Optional[str]]  # module name -> text
    admissible: Tuple[str, ...] = ()


@dataclass
class Fact:
    """One typed statement read from the trajectory."""
    fid: int
    rel: str                       # relation name, see relations.Relation
    args: Tuple[Entity, ...]
    value: Any
    slot: str                      # one of SLOTS
    side: str                      # one of SIDES
    t: int                         # step number
    situation: Optional[int] = None
    basis: Tuple[int, ...] = ()    # fids of the facts this one rests on
    purpose: Optional[Entity] = None
    span: str = ""                 # source text the fact was read from
    value_type: str = "unknown"


@dataclass
class Goal:
    """A task requirement: ``count`` things of ``of_kind`` related by ``rel`` to ``target``."""
    count: int
    of_kind: str
    rel: str
    target: Optional[Entity]
    attrs: Tuple[Tuple[str, Any], ...] = ()
    name: str = ""
    constraints: Tuple[Constraint, ...] = ()
    status_mode: str = "tracked"   # "tracked" or "unmodeled"


@dataclass
class Record:
    """A compiled trajectory, as serialized to ``canonical_record.json``."""
    trajectory_id: str
    task_type: str
    task: str
    ir_version: str = IR_VERSION
    kinds: Dict[str, Optional[str]] = field(default_factory=dict)      # kind -> parent kind
    relations: Dict[str, Any] = field(default_factory=dict)            # name -> relations.Relation
    entities: Dict[str, Entity] = field(default_factory=dict)
    goals: List[Goal] = field(default_factory=list)
    facts: List[Fact] = field(default_factory=list)
    parse_audits: List[Dict[str, Any]] = field(default_factory=list)
    source_steps: Dict[int, SourceStep] = field(default_factory=dict)
    intentions: Dict[str, Intention] = field(default_factory=dict)
    claim_scopes: Dict[int, Dict[str, Any]] = field(default_factory=dict)
    agent_statements: List[Dict[str, Any]] = field(default_factory=list)
    process_notes: Dict[int, Dict[str, Any]] = field(default_factory=dict)
    commit_values: List[str] = field(default_factory=list)
