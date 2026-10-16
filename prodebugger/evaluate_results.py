"""Score saved ProDebugger results against the released reference annotations."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]


def load_references(dataset: Path) -> dict[str, dict[str, Any]]:
    rows = pq.read_table(
        dataset,
        columns=["trajectory_id", "critical_failure_step", "critical_failure_module"],
    ).to_pylist()
    return {
        str(row["trajectory_id"]): {
            "step": int(row["critical_failure_step"]),
            "module": str(row["critical_failure_module"]).strip().casefold(),
        }
        for row in rows
    }


def evaluate(results_file: Path, dataset: Path, sample_file: Path | None = None) -> dict[str, Any]:
    if results_file.is_dir():
        results_file = results_file / "results.json"
    results = json.loads(results_file.read_text(encoding="utf-8"))
    if not isinstance(results, list) or any(not isinstance(item, dict) for item in results):
        raise ValueError("results input must be a JSON array of per-trajectory result objects")
    if not results and sample_file is None:
        raise ValueError("results input is empty")

    references = load_references(dataset)
    by_id: dict[str, dict[str, Any]] = {}
    for result in results:
        tid = result.get("trajectory_id")
        if not isinstance(tid, str) or tid not in references:
            raise ValueError(f"trajectory_id missing from dataset: {tid!r}")
        if tid in by_id:
            raise ValueError(f"duplicate result for trajectory_id: {tid}")
        by_id[tid] = result

    if sample_file:
        sample = json.loads(sample_file.read_text(encoding="utf-8"))
        expected_ids = sample.get("trajectory_ids") if isinstance(sample, dict) else sample
        if not isinstance(expected_ids, list) or not expected_ids or any(not isinstance(t, str) for t in expected_ids):
            raise ValueError("sample file must be a nonempty JSON ID list or an object with trajectory_ids")
        if len(expected_ids) != len(set(expected_ids)):
            raise ValueError("sample IDs must be unique")
        unknown = set(expected_ids) - references.keys()
        if unknown:
            raise ValueError(f"sample IDs missing from dataset: {sorted(unknown)}")
        unexpected = by_id.keys() - set(expected_ids)
        if unexpected:
            raise ValueError(f"results contain IDs outside sample: {sorted(unexpected)}")
    else:
        expected_ids = list(by_id)

    step_correct = module_correct = 0
    module_given_step_correct = 0
    step_correct_count = 0
    scored = []
    for tid in expected_ids:
        result = by_id.get(tid, {})
        root = result.get("root")
        pred_step = root.get("step") if isinstance(root, dict) else None
        pred_module = root.get("module") if isinstance(root, dict) else None
        ref = references[tid]
        accepted_diagnosis = result.get("status") == "diagnosed" and result.get("accepted") is True
        exact_step = accepted_diagnosis and type(pred_step) is int and pred_step == ref["step"]
        exact_module = accepted_diagnosis and isinstance(pred_module, str) and pred_module.strip().casefold() == ref["module"]
        exact_pair = exact_step and exact_module
        step_correct += int(exact_step)
        module_correct += int(exact_pair)
        if exact_step:
            step_correct_count += 1
            module_given_step_correct += int(exact_module)
        scored.append({
            "trajectory_id": tid,
            "status": result.get("status", "missing_result"),
            "predicted_step": pred_step,
            "reference_step": ref["step"],
            "step_exact_match": exact_step,
            "predicted_module": pred_module,
            "reference_module": ref["module"],
            "module_exact_match": exact_module,
            "step_and_module_exact_match": exact_pair,
            "accepted": result.get("accepted"),
        })

    n = len(expected_ids)
    status_counts = Counter(
        by_id[tid].get("status", "unknown") if tid in by_id else "missing_result"
        for tid in expected_ids
    )
    return {
        "schema": "prodebugger-evaluation/v1",
        "results_file": str(results_file),
        "dataset_file": str(dataset),
        "sample_file": str(sample_file) if sample_file else None,
        "expected_trajectories": n,
        "returned_trajectories": len(by_id),
        "missing_results": n - len(by_id),
        "status_counts": dict(sorted(status_counts.items())),
        "metrics": {
            "step_exact_accuracy": step_correct / n,
            "step_and_module_exact_accuracy": module_correct / n,
            "module_exact_accuracy_given_correct_step": (
                module_given_step_correct / step_correct_count if step_correct_count else None
            ),
        },
        "counts": {
            "step_exact_matches": step_correct,
            "step_and_module_exact_matches": module_correct,
            "correct_step_denominator_for_conditional_module_accuracy": step_correct_count,
        },
        "metric_policy": {
            "denominator": "Every expected sample ID when --sample-file is supplied, otherwise every result object. Errors, missing result objects, and results without a selected root count as incorrect.",
            "step_exact_accuracy": "Selected root step exactly equals critical_failure_step.",
            "step_and_module_exact_accuracy": "Both selected root step and module exactly match their reference; module matching ignores case and surrounding whitespace only.",
            "conditional_module_accuracy": "Module exact match among results whose step is an exact match.",
            "limitations": "These are exact-match agreement metrics against supplied annotations, not proof of causality or a comparison with a baseline.",
        },
        "per_trajectory": scored,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path, help="results.json or a run directory containing results.json")
    parser.add_argument("--dataset", type=Path, default=ROOT / "core/data/train.parquet")
    parser.add_argument("--sample-file", type=Path, help="Optional expected JSON ID list; missing results then count as incorrect")
    parser.add_argument("--out", type=Path, help="Optional output JSON path; defaults to stdout")
    args = parser.parse_args(argv)
    report = evaluate(args.results, args.dataset, args.sample_file)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered, encoding="utf-8")
        print(args.out)
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
