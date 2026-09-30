"""Paths, experiment constants, and file/data helpers."""
from __future__ import annotations

import json
import random
import shutil
import time
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq


HERE = Path(__file__).resolve().parent.parent
PACKAGE = HERE.parents[1]
ROOT = PACKAGE.parent
CORE = PACKAGE / "core"
PROMPTS = HERE / "prompts"
ARMS = ("baseline", "four_stage")
INPUT_USD_PER_M = 0.30
OUTPUT_USD_PER_M = 1.20
OPERATORS = (
    "profile", "failed", "conflicts", "view", "about", "lens", "attempts",
    "could_have", "back", "up", "siblings", "neighbours", "down", "versions",
    "check", "span", "state", "contrast", "count", "assess", "protocol",
    "global", "hold", "drop", "note", "recall", "cost", "submit",
)
TOOL = [{"type": "function", "function": {
    "name": "run_operator",
    "description": "Run one shipped ProDebugger dbg.py operator for this trajectory."
                   " The trajectory ID and operator name are already supplied"
                   " separately; args contains ONLY arguments after the operator."
                   " Examples: profile -> []; view ->"
                   " ['local_audits | steps:1:3 | detail:summary'];"
                   " assess -> ['1', '<JSON object>'].",
    "parameters": {"type": "object", "properties": {
        "op": {"type": "string", "enum": list(OPERATORS)},
        "args": {"type": "array", "items": {"type": "string"}},
    }, "required": ["op", "args"]},
}}]


def compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def decode_model_json(content: str) -> Any:
    candidates = [content]
    if content.startswith('{"steps":['):
        if content.endswith("}}}}"):
            candidates.append(content[:-1] + "]}")
        if content.endswith("}}}}]}"):
            candidates.append(content[:-6] + "}}}]}")
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None


def save_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    for attempt in range(10):
        try:
            tmp.replace(path)
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.1)


def selected_ids(size: int, seed: int) -> list[str]:
    table = pq.read_table(CORE / "data" / "train.parquet",
                          columns=["trajectory_id", "task_type"])
    ids = sorted(row["trajectory_id"] for row in table.to_pylist()
                 if row["task_type"] == "webshop")
    if not 1 <= size <= len(ids):
        raise ValueError(f"sample size must be in 1..{len(ids)}")
    # Keep smaller ablations nested in the original ten-case sample so prior
    # case-level records remain comparable and reusable.
    return random.Random(seed).sample(ids, min(len(ids), max(10, size)))[:size]


def copy_core(dst: Path) -> None:
    if dst.exists():
        raise FileExistsError(dst)
    shutil.copytree(CORE, dst, ignore=shutil.ignore_patterns(
        "sessions", "submissions", "__pycache__", "*.pyc", "tests"))
    (dst / "sessions").mkdir()
    (dst / "submissions").mkdir()
    (dst / "submissions" / "benchmark.jsonl").touch()
