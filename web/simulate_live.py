"""Re-write a finished debugger run into a new run directory at a slow pace.

Development aid for the workbench's live view: it copies files in roughly the
order run_experiment writes them (transcript order), so the browser can be
checked against a "running" case without model calls. Nothing is imported
from prodebugger/core; this only copies existing files.

    python web/simulate_live.py artifacts/dsl_debugger/<run>/<trajectory> --delay 0.5
"""
from __future__ import annotations

import argparse
import json
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC_FIRST = ("input.json", "canonical_record.json", "evidences.json", "evaluations.json", "rules.json")
FINAL = ("trace_windows.json", "trace_graph.json", "route_candidates.json", "goal_map.json", "usage.json", "result.json")


def rows(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def append(path: Path, row: dict) -> None:
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(row, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path, help="finished trajectory directory inside a run")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "artifacts" / "dsl_debugger")
    parser.add_argument("--delay", type=float, default=0.5, help="seconds between transcript messages")
    parser.add_argument("--run-id", help="new run directory name (default: <timestamp>-replay)")
    args = parser.parse_args()
    source = args.source.resolve()
    run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-replay"
    target = args.output_dir.resolve() / run_id / source.name
    target.mkdir(parents=True)
    manifest = json.loads((source.parent / "manifest.json").read_text(encoding="utf-8"))
    manifest.update(run_id=run_id, created_at=datetime.now(timezone.utc).isoformat(), trajectory_ids=[source.name])
    (target.parent / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"replaying into {target}", flush=True)

    for name in STATIC_FIRST:
        if (source / name).is_file():
            shutil.copyfile(source / name, target / name)
    tools = rows(source / "tool_calls.jsonl")
    usage = rows(source / "usage.jsonl")
    phases = rows(source / "phase_events.jsonl")
    windows = {r["response_turn"]: r for r in rows(source / "window_trace.jsonl")}
    answers = {r["response_turn"]: r for r in rows(source / "direct_submit.jsonl")}
    requests = sorted((source / "requests").glob("*.json")) if (source / "requests").is_dir() else []
    (target / "requests").mkdir(exist_ok=True)
    usage_i = phase_i = 0

    for message in rows(source / "messages.jsonl"):
        m = message.get("message", {})
        if m.get("role") == "user" and '"debugger-handoff/v1"' in str(m.get("content", "")):
            if phase_i < len(phases):
                append(target / "phase_events.jsonl", phases[phase_i]); phase_i += 1
            if (source / "goal_map.json").is_file() and not (target / "goal_map.json").exists():
                shutil.copyfile(source / "goal_map.json", target / "goal_map.json")
        if m.get("role") == "assistant":
            # Show the pending request first so the browser can render an in-flight card.
            while usage_i < len(usage) and usage[usage_i].get("event") != "completed":
                row = usage[usage_i]; usage_i += 1
                append(target / "usage.jsonl", row)
                request = row.get("request_file", "")
                match = next((p for p in requests if request.endswith(p.name)), None)
                if match:
                    shutil.copyfile(match, target / "requests" / match.name)
            time.sleep(args.delay * 2)
            if usage_i < len(usage):
                append(target / "usage.jsonl", usage[usage_i]); usage_i += 1
        if m.get("role") == "tool":
            for row in tools:
                if row.get("tool_call_id") == m.get("tool_call_id"):
                    append(target / "tool_calls.jsonl", row)
        append(target / "messages.jsonl", message)
        if m.get("role") == "assistant":
            turn = message.get("turn")
            if turn in windows:
                append(target / "window_trace.jsonl", windows[turn])
            if turn in answers:
                append(target / "direct_submit.jsonl", answers[turn])
        time.sleep(args.delay)

    for name in FINAL:
        if (source / name).is_file():
            shutil.copyfile(source / name, target / name)
        time.sleep(0.05)
    shutil.copyfile(source.parent / "results.json", target.parent / "results.json") if (source.parent / "results.json").is_file() else None
    print("done")


if __name__ == "__main__":
    main()
