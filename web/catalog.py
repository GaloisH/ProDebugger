"""Print the benchmark case catalog as JSON for the workbench launcher.

Runs as a subprocess of web/launcher.py so the server itself never needs
pyarrow or core/. Reference labels are included for the launcher's post-run
comparison only; they are never passed to the debugger.

    .venv/Scripts/python.exe web/catalog.py --data-dir core/data
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUPPORTED = {"alfworld", "webshop"}  # core/profiles domains
COLUMNS = ["trajectory_id", "task_type", "llm_model", "num_steps", "full_trajectory",
           "critical_failure_step", "critical_failure_module", "failure_types"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "core" / "data")
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT / "core"))
    from data_io import as_int, read_rows, reference, unpack

    cases = []
    for row in read_rows(str(args.data_dir), COLUMNS):
        try:
            task = unpack(row)[1]
        except Exception:  # unknown layouts still list, without a task preview
            task = ""
        cases.append({
            "trajectory_id": row["trajectory_id"], "split": row["_split"], "task_type": row["task_type"],
            "llm_model": row["llm_model"], "num_steps": as_int(row["num_steps"]), "task": task,
            "supported": row["task_type"] in SUPPORTED, "reference": reference(row),
        })
    json.dump({"cases": cases}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
