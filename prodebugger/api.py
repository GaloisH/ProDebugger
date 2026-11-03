"""Planned public entry point of ProDebugger.

Only the interface is published here; the implementation is not yet released.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Report:
    """Result of debugging one trajectory. See examples/sample_report.json."""

    trajectory_id: str
    status: str  # "diagnosed" or "uncertain"
    step: int | None = None
    module: str | None = None
    summary: str = ""
    evidence: list[dict[str, Any]] = field(default_factory=list)
    alternatives: list[str] = field(default_factory=list)


class Debugger:
    """Diagnoses a recorded agent trajectory through MAP, ROUTE, TRACE and SUBMIT."""

    def __init__(self, model: str, **options: Any) -> None:
        raise NotImplementedError("ProDebugger has not been released yet.")

    def run(self, trajectory: dict[str, Any]) -> Report:
        raise NotImplementedError("ProDebugger has not been released yet.")
