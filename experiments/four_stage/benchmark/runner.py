"""CLI setup, case execution, and run lifecycle."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from .baseline import baseline
from .case import Case
from .common import (ARMS, HERE, PACKAGE, ROOT,
                     compact, copy_core, save_json, selected_ids)
from .four_stage import four_stage
from .model import BudgetExceeded, Model, configure_model
from .reporting import append_submission, score


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, default=(
        PACKAGE / ".env" if (PACKAGE / ".env").exists() else ROOT / "scripts" / ".env"))
    parser.add_argument("--provider", choices=("auto", "groq", "deepseek"), default="auto")
    parser.add_argument("--base-url")
    parser.add_argument("--model", help="Defaults to MODEL in --env-file")
    parser.add_argument("--reasoning-effort", default="low")
    parser.add_argument("--input-usd-per-m", type=float)
    parser.add_argument("--output-usd-per-m", type=float)
    parser.add_argument("--sample-size", type=int, default=5)
    parser.add_argument("--seed", type=int, default=20260926)
    parser.add_argument("--budget-usd", type=float, default=20.0)
    parser.add_argument("--max-operators", type=int, default=120)
    parser.add_argument("--page-size", type=int, default=2)
    parser.add_argument("--run-dir", type=Path)
    parser.add_argument("--skip-baseline", action="store_true",
                        help="Run and score only the four-stage arm")
    parser.add_argument("--resume", action="store_true",
                        help="Continue an existing run directory, including a shorter prefix sample")
    return parser.parse_args()


def prepare_run(args: argparse.Namespace, ids: list[str]) -> tuple[Path, dict]:
    """Create isolated cores or validate and update a resumable run."""
    arms = ("four_stage",) if args.skip_baseline else ARMS
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = (args.run_dir or HERE / "runs" / f"{timestamp}-seed{args.seed}-n{args.sample_size}").resolve()
    if args.resume:
        if args.run_dir is None or not (run_dir / "manifest.json").exists():
            raise ValueError("--resume requires --run-dir pointing to an existing run")
        manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
        if tuple(manifest.get("arms", ARMS)) != arms:
            raise ValueError("resume arms differ from the saved run; check --skip-baseline")
        previous_ids = manifest["trajectory_ids"]
        if ids != previous_ids[:len(ids)]:
            raise ValueError("resume sample must be a prefix of the saved trajectory list")
        if args.seed != manifest["seed"]:
            raise ValueError("resume seed differs from the saved run")
        args.model = manifest["model"]
        args.provider = manifest.get("provider", "deepseek")
        args.base_url = manifest.get("base_url", args.base_url)
        args.reasoning_effort = manifest["reasoning_effort"]
        args.budget_usd = manifest["budget_usd"]
        args.max_operators = manifest["max_operators"]
        args.page_size = manifest["page_size"]
        prices = manifest["pricing_assumption_usd_per_m"]
        args.input_usd_per_m = prices["input"]
        args.output_usd_per_m = prices["output"]
        configure_model(args)
        manifest.setdefault("original_trajectory_ids", previous_ids)
        manifest["trajectory_ids"] = ids
        manifest["sample_size"] = len(ids)
        manifest["status"] = "running"
        manifest.setdefault("resumed_at_utc", []).append(datetime.now(timezone.utc).isoformat())
        save_json(run_dir / "manifest.json", manifest)
    else:
        configure_model(args)
        if run_dir.exists():
            raise FileExistsError(f"run directory already exists: {run_dir}")
        run_dir.mkdir(parents=True)
        manifest = {"time_utc": datetime.now(timezone.utc).isoformat(),
                    "status": "running", "provider": args.provider,
                    "base_url": args.base_url, "model": args.model,
                    "reasoning_effort": args.reasoning_effort,
                    "sample_size": args.sample_size, "seed": args.seed,
                    "arms": list(arms),
                    "trajectory_ids": ids, "budget_usd": args.budget_usd,
                    "max_operators": args.max_operators, "page_size": args.page_size,
                    "pricing_assumption_usd_per_m": {
                        "input": args.input_usd_per_m, "output": args.output_usd_per_m,
                        "all_input_treated_as_cache_miss": True},
                    "arm_definitions": {arm: {
                        "baseline": "TASK.md + REASONER.md, tool-use agent",
                        "four_stage": "MAP / REVIEW / TRACE+PROPOSE / REVISE+SUBMIT",
                    }[arm] for arm in arms}}
        save_json(run_dir / "manifest.json", manifest)
        for arm in arms:
            copy_core(run_dir / "work" / arm / "core")
    return run_dir, manifest


def run_cases(args: argparse.Namespace, run_dir: Path,
              ids: list[str], model: Model) -> str | None:
    """Run enabled arms per trajectory, retaining failures for the report."""
    stopped = None
    arms = ("four_stage",) if args.skip_baseline else ARMS
    # Group enabled arms by trajectory. The first trajectory is the smoke check
    # and is counted in the selected sample rather than rerun separately.
    for index, tid in enumerate(ids):
        for arm in arms:
            print(f"CASE {index + 1}/{len(ids)} {arm} {tid}", flush=True)
            case = Case(run_dir, arm, tid, args.max_operators)
            try:
                if (case.log.get("result") or {}).get("accepted"):
                    row = case.log.get("submission") or case.finish()
                    append_submission(run_dir, arm, row)
                    if case.log.get("error"):
                        case.log["error"] = None
                        case.save()
                    print(f"REUSED {arm} {tid}: {compact(row)}", flush=True)
                    continue
                case.log["error"] = None
                case.save()
                if arm == "baseline":
                    baseline(model, case)
                else:
                    four_stage(model, case, args.page_size)
                row = case.finish()
                if row is None:
                    raise RuntimeError("no accepted submission")
                append_submission(run_dir, arm, row)
                print(f"ACCEPTED {arm} {tid}: {compact(row)}", flush=True)
            except BudgetExceeded as exc:
                case.log["error"] = f"BudgetExceeded: {exc}"
                case.save()
                stopped = str(exc)
                break
            except Exception as exc:
                case.log["error"] = f"{type(exc).__name__}: {exc}"
                case.save()
                print(f"FAILED {arm} {tid}: {case.log['error']}", flush=True)
        if stopped:
            break
    return stopped


def finish_run(run_dir: Path, ids: list[str], model: Model,
               manifest: dict, stopped: str | None) -> int:
    """Score saved submissions and persist the final run status."""
    arms = tuple(manifest.get("arms", ARMS))
    report = score(run_dir, ids, arms)
    report["budget_spent_usd"] = model.spent
    complete = all(report["arms"][arm]["submitted"] == len(ids) for arm in arms)
    report["status"] = "budget_stopped" if stopped else "completed" if complete else "partial"
    report["stopped_reason"] = stopped
    save_json(run_dir / "report.json", report)
    manifest["status"] = report["status"]
    manifest["budget_spent_usd"] = model.spent
    manifest["stopped_reason"] = stopped
    save_json(run_dir / "manifest.json", manifest)
    print(f"RUN_DIR={run_dir}", flush=True)
    print(f"STATUS={report['status']} COST_USD={model.spent:.4f}", flush=True)
    for arm in arms:
        print(f"{arm}: {compact(report['arms'][arm])}", flush=True)
    return 0 if complete else 2


def main() -> int:
    args = parse_args()
    ids = selected_ids(args.sample_size, args.seed)
    run_dir, manifest = prepare_run(args, ids)
    model = Model(args, run_dir)
    stopped = run_cases(args, run_dir, ids, model)
    return finish_run(run_dir, ids, model, manifest, stopped)
