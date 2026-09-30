"""Submission recording and post-diagnosis scoring."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from .common import ARMS, CORE, compact


def append_submission(run_dir: Path, arm: str, row: dict) -> None:
    path = run_dir / "work" / arm / "core" / "submissions" / "benchmark.jsonl"
    existing = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()
                if line] if path.exists() else []
    for item in existing:
        if item["trajectory_id"] == row["trajectory_id"]:
            if item != row:
                raise RuntimeError(f"different submission already saved for {arm}/{row['trajectory_id']}")
            return
    with path.open("a", encoding="utf-8") as stream:
        stream.write(compact(row) + "\n")


def score(run_dir: Path, ids: list[str], arms: tuple[str, ...] = ARMS) -> dict:
    sys.path.insert(0, str(CORE))
    from data_io import gold, load  # annotation access occurs only after all diagnoses
    labels = {row["trajectory_id"]: gold(row) for row in load("webshop")
              if row["trajectory_id"] in ids and row["_split"] == "train"}
    report: dict[str, Any] = {"sample_size": len(ids), "arms": {}, "per_case": []}
    submissions: dict[str, dict[str, dict]] = {}
    for arm in arms:
        core = run_dir / "work" / arm / "core"
        proc = subprocess.run([sys.executable, str(core / "score.py")],
                              cwd=core.parent, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=120)
        if proc.returncode:
            raise RuntimeError(f"score.py failed for {arm}: {proc.stderr[-500:]}")
        (run_dir / f"score_{arm}.txt").write_text(proc.stdout, encoding="utf-8")
        path = core / "submissions" / "benchmark.jsonl"
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
        submissions[arm] = {row["trajectory_id"]: row for row in rows}
        hits = {"step_exact": 0, "step_pm1": 0, "step_module": 0, "all": 0}
        for tid in ids:
            prediction = submissions[arm].get(tid)
            if not prediction or prediction.get("step") is None:
                continue
            reference = labels[tid]
            exact = prediction["step"] == reference["step"]
            hits["step_exact"] += exact
            hits["step_pm1"] += abs(prediction["step"] - reference["step"]) <= 1
            hits["step_module"] += exact and prediction.get("module") == reference["module"]
            hits["all"] += (exact and prediction.get("module") == reference["module"]
                            and prediction.get("fault_class") in reference["types"])
        report["arms"][arm] = {
            "submitted": len(submissions[arm]),
            "accepted": sum(bool(row.get("accepted")) for row in rows),
            "hits": hits, "rates": {key: value / len(ids) for key, value in hits.items()},
            "official_score_file": f"score_{arm}.txt",
        }
    for tid in ids:
        errors = {}
        for arm in ARMS:
            path = run_dir / "cases" / arm / f"{tid}.json"
            errors[arm] = (json.loads(path.read_text(encoding="utf-8")).get("error")
                           if path.exists() else "not_run")
        report["per_case"].append({"trajectory_id": tid,
            "gold": labels[tid],
            "baseline": submissions.get("baseline", {}).get(tid),
            "four_stage": submissions.get("four_stage", {}).get(tid),
            "errors": errors})
    return report
