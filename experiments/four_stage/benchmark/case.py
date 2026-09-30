"""Isolated dbg.py case execution and persistent case state."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from .common import OPERATORS, compact, save_json


class Case:
    def __init__(self, run_dir: Path, arm: str, tid: str, max_operators: int):
        self.arm = arm
        self.tid = tid
        self.core = run_dir / "work" / arm / "core"
        self.path = run_dir / "cases" / arm / f"{tid}.json"
        self.messages_path = self.path.with_suffix(".messages.json")
        self.max_operators = max_operators
        if self.path.exists():
            self.log = json.loads(self.path.read_text(encoding="utf-8"))
            if self.log["trajectory_id"] != tid or self.log["arm"] != arm:
                raise ValueError(f"case log does not match {arm}/{tid}")
        else:
            self.log: dict[str, Any] = {"trajectory_id": tid, "arm": arm,
                                        "commands": [], "model": {}, "result": None,
                                        "error": None}
        self.save()

    def save(self) -> None:
        save_json(self.path, self.log)

    def cli(self, op: str, *args: str, strict: bool = True) -> Any:
        if op not in OPERATORS:
            raise ValueError(f"operator not allowed: {op}")
        if op != "cost" and sum(x["operator"] != "cost" for x in self.log["commands"]) >= self.max_operators:
            raise RuntimeError(f"operator limit {self.max_operators} reached")
        proc = subprocess.run(
            [sys.executable, str(self.core / "dbg.py"), self.tid, op, *args],
            cwd=self.core.parent, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=120,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        try:
            output = json.loads(proc.stdout)
        except json.JSONDecodeError:
            output = {"unparsed_stdout": proc.stdout[-2000:],
                      "stderr": proc.stderr[-2000:]}
        self.log["commands"].append({"operator": op, "args": list(args),
                                     "exit_code": proc.returncode, "output": output})
        if op == "submit" and proc.returncode == 0 and output.get("accepted"):
            self.log["result"] = output
        self.save()
        if strict and proc.returncode:
            raise RuntimeError(f"CLI {op} failed: {compact(output)[:600]}")
        return output if strict else {"exit_code": proc.returncode, "output": output}

    def model_result(self, phase: str, value: Any) -> None:
        self.log["model"][phase] = value
        self.save()

    def assessed_steps(self) -> set[int]:
        path = self.core / "sessions" / f"{self.tid}.json"
        if not path.exists():
            return set()
        state = json.loads(path.read_text(encoding="utf-8"))
        return {int(step) for step in state.get("assessments", {})}

    def finish(self) -> dict | None:
        result = self.log.get("result")
        if not result or not result.get("accepted"):
            return None
        cost = self.cli("cost")
        row = {"trajectory_id": self.tid, "step": result["step"],
               "fid": result["fid"], "module": result["module"],
               "fault_class": result["fault_class"],
               "operator_calls": cost["operator_calls"],
               "model_calls": cost["model_calls"],
               "accepted": True, "forced": False}
        self.log["submission"] = row
        self.save()
        return row
