"""Print the benchmark case catalog as JSON for the workbench launcher.

Runs as a subprocess of web/launcher.py so the server itself never needs
pyarrow or core/. Reference labels are included for the launcher's post-run
comparison only; they are never passed to the debugger.

    .venv/Scripts/python.exe web/catalog.py --data-dir core/data
"""
from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUPPORTED = {"alfworld", "webshop"}  # core/profiles domains
COLUMNS = ["trajectory_id", "task_type", "llm_model", "num_steps", "full_trajectory",
           "critical_failure_step", "critical_failure_module", "failure_types"]


def listed(value) -> list:
    # Older parquet rows store lists as their Python repr.
    if isinstance(value, str):
        try:
            value = ast.literal_eval(value)
        except (ValueError, SyntaxError):
            return [value]
    return list(value or [])


def as_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "core" / "data")
    args = parser.parse_args()
    import pyarrow.parquet as pq
    sys.path.insert(0, str(ROOT / "core"))
    from data_io import unpack

    cases = []
    for split in ("train", "validation", "test"):
        path = args.data_dir / f"{split}.parquet"
        if not path.is_file():
            continue
        for row in pq.read_table(path, columns=COLUMNS).to_pylist():
            try:
                task = unpack(row)[1]
            except Exception:  # unknown layouts still list, without a task preview
                task = ""
            cases.append({
                "trajectory_id": row["trajectory_id"], "split": split, "task_type": row["task_type"],
                "llm_model": row["llm_model"], "num_steps": as_int(row["num_steps"]), "task": task,
                "supported": row["task_type"] in SUPPORTED,
                "reference": {"step": as_int(row["critical_failure_step"]),
                              "module": row["critical_failure_module"],
                              "types": listed(row["failure_types"])},
            })
    json.dump({"cases": cases}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
