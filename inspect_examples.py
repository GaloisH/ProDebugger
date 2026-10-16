"""Reproduce two offline compilation and evidence-query examples; no model calls."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from prodebugger.debug_tools import DebugTools
from prodebugger.query_dsl import execute
from prodebugger.record_bridge import build_bundle, parquet_source, plain
from prodebugger.run_compile import compile_trajectory

ROOT = Path(__file__).resolve().parent
CASES = (
    ("alfworld", "GPT-4o_027_alfworld_task_027", "go"),
    ("webshop", "GPT-4o_003_chat_b000_t00_e02-1e119842", "search"),
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "core/data")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "artifacts/reviewer_examples")
    args = parser.parse_args()
    report = {
        "scope": "Two offline compilation and read-only query examples; no LLM diagnosis or accuracy evaluation.",
        "cases": [],
    }
    for domain, tid, action in CASES:
        output = compile_trajectory(tid, args.data_dir, output_dir=args.output_dir)
        bundle = build_bundle(parquet_source(tid, args.data_dir))
        sql = (
            "-- Purpose: inspect a few recorded actions with their Fact provenance.\n"
            "-- LIMIT intentionally shows only the first five matches, not full coverage.\n"
            "SELECT fid,step,rel,args,span,source_kind,parse_status\n"
            f"FROM TRACK_ACTION('{action}') ORDER BY step,fid LIMIT 5;\n"
        )
        result = execute(DebugTools(bundle), sql)
        if "error" in result:
            raise RuntimeError(f"{tid}: {result['error']}")
        (output / "query.sql").write_text(sql, encoding="utf-8")
        (output / "query_result.json").write_text(
            json.dumps(plain(result), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        report["cases"].append({
            "task_type": domain, "trajectory_id": tid,
            "status": "compiled_and_queried", "task": bundle.source["task"],
            "original_steps": len(bundle.source["steps"]),
            "compiled_facts": len(bundle.record.F),
            "query": sql, "returned_rows": result["returned_rows"],
            "rows": result["rows"], "coverage": result["coverage"],
            "limitations": result["limitations"],
        })
    args.output_dir.mkdir(parents=True, exist_ok=True)
    target = args.output_dir / "report.json"
    target.write_text(json.dumps(plain(report), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(target)


if __name__ == "__main__":
    main()
