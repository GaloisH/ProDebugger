"""Main entry point for raw TRACE and tool-free direct SUBMIT."""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from prodebugger.record_bridge import (ROOT, build_bundle, digest, export_bundle,
    parquet_source, read_json, saved_source, valid_id, write_json)
from prodebugger.debug_tools import DebugTools, GLOBAL
from prodebugger.debugger_agent import DebuggerAgent
from prodebugger.llm_client import LLMClient, ReplayClient, PHASES
from prodebugger.direct_submit import POLICY

DEFAULTS = {"model": None, "base_url": None, "api_key_env": "OPENAI_API_KEY", "env_file": None,
            "reasoning_effort": None,
            "window_size": 5, "trace_top_p": 5, "trace_top_k": 2,
            "max_turns": 80, "max_tool_calls": 240,
            "max_input_tokens": 1000000, "max_output_tokens": 200000, "max_tokens": 8192,
            "timeout": 180.0, "retries": 1,
            **{p.lower() + "_model": None for p in PHASES}}
BUDGET_KEYS = {"max_turns", "max_tool_calls", "max_input_tokens", "max_output_tokens"}


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("trajectory_id", nargs="?")
    p.add_argument("--sample-file", type=Path, help="JSON list or object with trajectory_ids (any nonempty unique sample)")
    p.add_argument("--compiled-dir", type=Path, help="Saved trajectory directory or parent containing trajectory directories")
    p.add_argument("--data-dir", type=Path, default=ROOT / "core" / "data")
    p.add_argument("--output-dir", type=Path, default=ROOT / "artifacts" / "dsl_debugger")
    p.add_argument("--run-id", help="New unique directory name; existing runs are never overwritten")
    p.add_argument("--dry-run", action="store_true", help="Compile and probe tools without a model or diagnosis")
    p.add_argument("--replay", type=Path, help="Assistant messages JSON/JSONL, or directory containing TRAJECTORY_ID.json")
    p.add_argument("--resume", type=Path, help="Existing run directory with manifest.json and checkpoints")
    for key in ("model", "base_url", "api_key_env", "env_file", *(p.lower() + "_model" for p in PHASES)):
        p.add_argument("--" + key.replace("_", "-"))
    p.add_argument("--reasoning-effort", choices=["none", "low", "high", "max"], help="Provider reasoning mode; none disables DeepSeek thinking")
    p.add_argument("--trace-top-p", type=int, help="Maximum ranked ROUTE anchors passed to TRACE (default: 5)")
    p.add_argument("--trace-top-k", type=int, help="Maximum distinct root steps per TRACE window (default: 2); same-step module alternatives are retained")
    for key in ("window_size", "max_turns", "max_tool_calls", "max_input_tokens", "max_output_tokens", "max_tokens", "retries"):
        p.add_argument("--" + key.replace("_", "-"), type=int,
                       help="0 disables the application output limit" if key in {"max_tokens", "max_output_tokens"} else None)
    for key in ("timeout",):
        p.add_argument("--" + key.replace("_", "-"), type=float)
    return p


def configuration(args, saved=None):
    cfg = {**DEFAULTS, **{k: v for k, v in (saved or {}).items() if k in DEFAULTS}}
    for key in DEFAULTS:
        value = getattr(args, key)
        if value is not None:
            if saved and key not in BUDGET_KEYS and cfg[key] != value:
                raise ValueError(f"resume cannot change {key}; start a new run")
            cfg[key] = value
    for key in ("window_size", "trace_top_p", "trace_top_k", "max_turns", "max_tool_calls", "max_input_tokens", "timeout"):
        if cfg[key] <= 0:
            raise ValueError(f"{key} must be positive")
    for key in ("max_tokens", "max_output_tokens"):
        if cfg[key] < 0:
            raise ValueError(f"{key} must be nonnegative (0 disables the application limit)")
    if cfg["retries"] < 0:
        raise ValueError("retries must be nonnegative")
    if not math.isfinite(cfg["timeout"]):
        raise ValueError("timeout must be finite")
    return cfg


def trajectory_ids(args):
    if args.trajectory_id and args.sample_file:
        raise ValueError("use a trajectory ID or --sample-file")
    rows = read_json(args.sample_file) if args.sample_file else [args.trajectory_id]
    if isinstance(rows, dict):
        rows = rows.get("trajectory_ids")
    if not isinstance(rows, list) or not rows or any(not isinstance(t, str) for t in rows):
        raise ValueError("provide a trajectory ID or a nonempty trajectory_ids list")
    if len(rows) != len(set(rows)):
        raise ValueError("sample trajectory IDs must be unique")
    return [valid_id(t) for t in rows]


def dry_run(bundle, output, cfg):
    tools = DebugTools(bundle, output, cfg["max_tool_calls"], cfg["window_size"],
                       trace_top_p=cfg["trace_top_p"], trace_top_k=cfg["trace_top_k"])
    goals = tools.execute("view", {"spec": "requirements", "scope": GLOBAL}, "dry:map")
    evidence = tools.execute("view_evidence", {"scope": GLOBAL, "limit": 1}, "dry:evidence")
    facts = bundle.projection.F
    if evidence.get("data", {}).get("items"):
        tools.execute("trace_evidence", {"eid": evidence["data"]["items"][0]["eid"], "scope": GLOBAL}, "dry:graph")
    elif facts:
        tools.execute("trace_fact", {"fid": facts[-1].fid, "scope": GLOBAL}, "dry:graph")
    if bundle.source["steps"]:
        t = len(bundle.source["steps"])
        anchors = [{"candidate_id": "dry:last-step", "issue_step": t, "issue_fids": [], "goal_links": [],
                    "hypothesis": "Tool probe only; this anchor is not an inferred failure."}]
        tools.execute("trace_window", {"candidates": anchors}, "dry:window")
    errors = [e["result"]["error"] for e in tools.events if "error" in e["result"]]
    result = tools.stop_result("error" if errors else "dry_run", "tool probe failed" if errors else "offline compilation and tool probe completed")
    result.update(run_id=output.parent.name, trajectory_id=bundle.record.tid,
                  canonical_fingerprint=bundle.fingerprint, compilation_mode="canonical-core-dsl-projection/v1",
                  facts=len(facts), candidates=len(tools.index.evidence), errors=errors,
                  mapped_goals=len(goals.get("data", {}).get("requirements", [])),
                  usage={"model_calls": 0, "replay_calls": 0, "tool_calls": tools.call_count})
    write_json(output / "result.json", result)
    write_json(output / "usage.json", result["usage"])
    return result


def report(run, results, prefix=""):
    write_json(run / f"{prefix}results.json", results)
    lines = ["# MAP → ROUTE → TRACE → SUBMIT experiment", "", f"Policy: {POLICY}. TRACE coverage is limited to declared windows.", "",
             "| Trajectory | Status | Original Facts | Candidates | Assessed steps | Tool calls | Model calls |", "|---|---|---:|---:|---:|---:|---:|"]
    for r in results:
        lines.append(f"| {r['trajectory_id']} | {r['status']} | {r.get('facts', '—')} | {r.get('candidates', '—')} | "
                     f"{len(r.get('coverage', {}).get('assessed_steps', []))} | {r.get('usage', {}).get('tool_calls', 0)} | {r.get('usage', {}).get('model_calls', 0)} |")
    lines += ["", "Rule candidates and accepted protocol results are not accuracy measurements.",
              "Replay calls are recorded separately from live model calls. See each trajectory's result, usage, and tool event log."]
    (run / f"{prefix}report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    from prodebugger.report import build_report
    build_report(run, results)


def run(args):
    resume = bool(args.resume)
    if resume:
        if args.trajectory_id or args.sample_file or args.compiled_dir or args.dry_run or args.run_id or args.replay:
            raise ValueError("--resume uses the recorded inputs and mode; only budget overrides are supported")
        run_dir = args.resume.resolve()
        previous_manifest = run_dir / "resume_manifest.json"
        manifest = read_json(previous_manifest if previous_manifest.is_file() else run_dir / "manifest.json")
        cfg = configuration(args, manifest["config"])
        ids, mode = manifest["trajectory_ids"], manifest["mode"]
        if mode == "dry_run":
            raise ValueError("dry-run has no agent checkpoint; start a new dry-run")
    else:
        if args.dry_run and args.replay:
            raise ValueError("--dry-run and --replay are separate modes")
        cfg, ids = configuration(args), trajectory_ids(args)
        mode = "dry_run" if args.dry_run else "replay" if args.replay else "online"
        if mode == "online" and not all(cfg[p.lower() + "_model"] or cfg["model"] for p in PHASES):
            raise ValueError("online requires --model or all four phase models; use --dry-run or --replay offline")
        run_id = valid_id(args.run_id or (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]))
        run_dir = args.output_dir.resolve() / run_id
        run_dir.mkdir(parents=True, exist_ok=False)
        manifest = {"schema": "debugger-run/v1", "run_id": run_id, "created_at": datetime.now(timezone.utc).isoformat(),
                    "trajectory_ids": ids, "mode": mode, "config": cfg, "submission_policy": POLICY,
                    "compilation_mode": "canonical-core-dsl-projection/v1", "python_hash_seed": os.getenv("PYTHONHASHSEED"),
                    "python_version": sys.version, "sources": {},
                    "input_source": str(args.compiled_dir.resolve()) if args.compiled_dir else str(args.data_dir.resolve()),
                    "replay_source": str(args.replay.resolve()) if args.replay else None}
    # Effective budgets are recorded even when a resumed attempt stops immediately.
    manifest["config"] = cfg
    write_json(run_dir / ("resume_manifest.json" if resume else "manifest.json"), manifest)
    results = []
    for tid in ids:
        output = run_dir / valid_id(tid)
        output.mkdir(exist_ok=True)
        try:
            source = read_json(output / "input.json") if resume else (saved_source(args.compiled_dir, tid)
                       if args.compiled_dir else parquet_source(tid, args.data_dir))
            bundle = build_bundle(source)
            previous = manifest["sources"].get(tid)
            if resume and (previous is None or previous["fingerprint"] != bundle.fingerprint):
                raise ValueError("source_mismatch: input/compiler/rules/prompt changed; use a new run")
            if not resume:
                manifest["sources"][tid] = {"fingerprint": bundle.fingerprint, "source_versions": bundle.versions,
                    "input_digest": digest(bundle.source), "facts": len(bundle.projection.F),
                    "candidates": sum(len(g.items) for g in bundle.projection.evidences.values())}
                export_bundle(bundle, output)
                write_json(run_dir / "manifest.json", manifest)
            if mode == "dry_run":
                result = dry_run(bundle, output, cfg)
            else:
                replay = Path(manifest["replay_source"]) if mode == "replay" else None
                if replay and replay.is_dir():
                    replay = replay / f"{tid}.json"
                client = ReplayClient(replay, output, cfg["max_turns"]) if replay else LLMClient(cfg, output)
                agent = DebuggerAgent(bundle, client, output, cfg, resume=resume)
                result = agent.run()
                result.update(facts=len(bundle.projection.F), candidates=len(agent.tools.index.evidence),
                              compilation_mode=manifest["compilation_mode"])
                write_json(output / "result.json", result)
            results.append(result)
        except (OSError, ValueError, RuntimeError, ImportError, KeyError, TypeError, IndexError) as exc:
            result = {"schema": "debugger-result/v1", "policy": POLICY, "run_id": run_dir.name,
                      "trajectory_id": tid, "status": "error", "accepted": False, "root": None,
                      "supporting_evidence": [], "counterevidence": [], "causal_chain": [],
                      "repair": None, "alternatives": [], "coverage": {"status": "unavailable"},
                      "stop_reason": str(exc), "error_type": type(exc).__name__,
                      "usage": read_json(output / "usage.json") if (output / "usage.json").is_file()
                               else {"model_calls": 0, "replay_calls": 0, "tool_calls": 0}}
            # Preserve valid historical results when a restore is rejected.
            write_json(output / ("resume_error.json" if resume else "result.json"), result)
            results.append(result)
        report(run_dir, results, "resume_" if resume else "")
        print(f"{tid}: {results[-1]['status']}")
    print(f"Artifacts: {run_dir}")
    print(f"Browser: {run_dir / 'browser' / 'index.html'}")
    return 1 if any(r["status"] == "error" for r in results) else 0


def main(argv=None):
    p = parser()
    try:
        args = p.parse_args(argv)
        seed = os.getenv("PYTHONHASHSEED")
        if args.resume:
            seed = read_json(args.resume / "manifest.json").get("python_hash_seed")
        seed = seed if seed and seed != "random" else "42"
        if os.getenv("PYTHONHASHSEED") != seed:
            env = dict(os.environ, PYTHONHASHSEED=seed)
            return subprocess.run([sys.executable, "-B", str(Path(__file__).resolve()),
                                   *(sys.argv[1:] if argv is None else argv)], env=env).returncode
        return run(args)
    except (ValueError, OSError) as exc:
        p.error(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
