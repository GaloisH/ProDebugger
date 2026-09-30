"""Build an offline browser for every saved four-stage debug case.

Run with the project environment, which provides pyarrow:
    .venv/Scripts/python.exe frontend/case_browser/build.py

The input may be a runs directory, one run directory, or its cases directory.
Each run/case gets one self-contained data page; CSS and JavaScript are shared.
No benchmark agent or model is run.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

import pyarrow.parquet as pq

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
EXPERIMENT = ROOT / "experiments" / "four_stage"

from analyze_case_run import ARMS, phase_for


DEFAULT_SOURCE = EXPERIMENT / "runs"
DEFAULT_OUTPUT = HERE / "output"
CORPUS = ROOT / "core" / "data" / "train.parquet"
ASSETS = HERE / "assets"
TAGS = ("memory", "reflection", "plan", "action")
TASK_RE = re.compile(r"task is(?: to)?:\s*(.*?)\n", re.I)
OBS_RE = re.compile(r"(?:current )?observation is:\s*(.*?)(?:\nYour admissible|\nPlease |\Z)", re.I | re.S)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_script(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def find_runs(source: Path) -> list[Path]:
    source = source.resolve()
    if source.name == "cases" and source.is_dir():
        source = source.parent
    if (source / "cases").is_dir():
        return [source]
    runs = sorted(path for path in source.iterdir() if path.is_dir() and (path / "cases").is_dir())
    if not runs:
        raise ValueError(f"No run/cases directories under {source}")
    return runs


def case_ids(run: Path) -> list[str]:
    ids = {path.stem for arm in ARMS for path in (run / "cases" / arm).glob("*.json")
           if not path.name.endswith(".messages.json")}
    manifest = read_json(run / "manifest.json") if (run / "manifest.json").exists() else {}
    ordered = [tid for tid in manifest.get("trajectory_ids", []) if tid in ids]
    return ordered + sorted(ids - set(ordered))


def gold_data(row: dict) -> dict:
    annotations = row.get("step_annotations") or []
    if isinstance(annotations, str):
        try:
            annotations = json.loads(annotations)
        except json.JSONDecodeError:
            annotations = []
    return {
        "critical_step": row.get("critical_failure_step"),
        "module": row.get("critical_failure_module"),
        "types": row.get("failure_types") or [],
        "reasonings": row.get("failure_reasonings") or [],
        "step_annotations": annotations if isinstance(annotations, list) else [],
    }


def original_steps(row: dict) -> tuple[str, list[dict]]:
    messages = json.loads(row["full_trajectory"])["messages"]
    task_match = TASK_RE.search(messages[0]["content"]) if messages else None
    task = task_match.group(1).strip() if task_match else ""
    annotations = gold_data(row)["step_annotations"]
    by_step: dict[int, list[dict]] = {}
    for annotation in annotations:
        if isinstance(annotation, dict) and isinstance(annotation.get("step"), int):
            by_step.setdefault(annotation["step"], []).append(annotation)
    steps = []
    for index in range(0, len(messages) - 1, 2):
        user, agent = messages[index:index + 2]
        if user.get("role") != "user" or agent.get("role") != "assistant":
            break
        text = agent.get("content") or ""
        modules = {}
        for tag in TAGS:
            match = re.search(rf"<{tag}>(.*?)</{tag}>", text, re.I | re.S)
            modules[tag] = match.group(1).strip() if match else None
        obs_match = OBS_RE.search(user.get("content") or "")
        number = len(steps) + 1
        steps.append({
            "n": number,
            "observation": obs_match.group(1).strip() if obs_match else "",
            "user_message": user.get("content") or "",
            "agent_message": text,
            "modules": modules,
            "annotations": by_step.get(number, []),
        })
    return task, steps


def model_events(case: dict, messages_path: Path) -> list[dict]:
    if messages_path.exists():
        events = []
        for index, message in enumerate(read_json(messages_path)):
            if message.get("role") == "assistant":
                events.append({"n": len(events) + 1, "label": f"Assistant turn {len(events) + 1}",
                               "source_index": index, "kind": "assistant",
                               "content": message.get("content"),
                               "reasoning_content": message.get("reasoning_content"),
                               "tool_calls": message.get("tool_calls") or []})
            elif message.get("role") == "user" and index > 1:
                events.append({"n": len(events) + 1, "label": "Reminder",
                               "source_index": index, "kind": "user_reminder",
                               "content": message.get("content")})
        return events
    return []


def arm_data(run: Path, arm: str, tid: str, usage: list[dict]) -> dict | None:
    path = run / "cases" / arm / f"{tid}.json"
    if not path.exists():
        return None
    case = read_json(path)
    commands = case.get("commands") or []
    command_events = []
    failed_exact: dict[tuple[str, str], int] = {}
    failed_assess_step: dict[str, int] = {}
    for number, command in enumerate(commands, 1):
        operator = command.get("operator") or ""
        args = command.get("args") or []
        key = (operator, json.dumps(args, ensure_ascii=False, sort_keys=True))
        assess_step = str(args[0]) if operator == "assess" and args else None
        retry_of = (failed_assess_step.get(assess_step) if assess_step is not None else None)
        if retry_of is None:
            retry_of = failed_exact.get(key)
        command_events.append({"n": number, "operator": operator, "args": args,
                               "exit_code": command.get("exit_code"), "output": command.get("output"),
                               "phase": phase_for(number, commands), "retry_of": retry_of})
        if command.get("exit_code") != 0:
            failed_exact[key] = number
            if assess_step is not None:
                failed_assess_step[assess_step] = number
        else:
            failed_exact.pop(key, None)
            if assess_step is not None:
                failed_assess_step.pop(assess_step, None)
    session_path = run / "work" / arm / "core" / "sessions" / f"{tid}.json"
    session = read_json(session_path) if session_path.exists() else {}
    messages_path = path.with_suffix(".messages.json")
    used = [item for item in usage if item.get("arm") == arm and item.get("trajectory_id") == tid]
    return {
        "case_error": case.get("error"), "result": case.get("result"),
        "submission": case.get("submission"), "commands": command_events,
        "model_events": model_events(case, messages_path),
        "phase_events": [{"n": number, "label": phase, "kind": "phase_result", "content": value}
                         for number, (phase, value) in enumerate((case.get("model") or {}).items(), 1)],
        "assessments": session.get("assessments") or {},
        "usage": {"calls": len(used),
                  "prompt_tokens": sum(item.get("prompt_tokens", 0) for item in used),
                  "completion_tokens": sum(item.get("completion_tokens", 0) for item in used),
                  "usd": round(sum(item.get("conservative_usd", 0) for item in used), 7)},
        "sources": {"case": str(path.relative_to(ROOT)).replace("\\", "/"),
                    "session": str(session_path.relative_to(ROOT)).replace("\\", "/") if session_path.exists() else None,
                    "messages": str(messages_path.relative_to(ROOT)).replace("\\", "/") if messages_path.exists() else None},
    }


def original_action_kind(text: str) -> str:
    action = text.strip().lower()
    if action.startswith("search["):
        return "search"
    if action.startswith("click[next >"):
        return "next_page"
    if action.startswith("click[back to search"):
        return "back_to_search"
    if action.startswith("click[buy now"):
        return "purchase"
    if action.startswith("click["):
        return "click"
    return "other" if action else "missing"


def add_action_sources(steps: list[dict], arms: dict) -> None:
    """Attach saved audit fids to raw actions without changing their text or order."""
    found: dict[int, dict] = {}
    for arm in ("four_stage", "baseline"):
        data = arms.get(arm)
        if not data:
            continue
        for command in data["commands"]:
            output = command["output"]
            if command["operator"] != "view" or not isinstance(output, dict):
                continue
            for row in output.get("audits", []):
                step = row.get("step")
                if not isinstance(step, int) or step in found:
                    continue
                action = (row.get("modules") or {}).get("action") or {}
                outputs = action.get("outputs") or []
                item = outputs[0] if outputs and isinstance(outputs[0], dict) else {}
                found[step] = {"fid": item.get("fid"), "source_arm": arm,
                               "source_command": command["n"]}
            for row in output.get("intentions", []):
                step = row.get("step")
                if not isinstance(step, int) or step in found:
                    continue
                action = row.get("action") or {}
                found[step] = {"fid": action.get("fid"), "source_arm": arm,
                               "source_command": command["n"]}
    for step in steps:
        raw_action = step["modules"].get("action") or ""
        step["action_trace"] = {"kind": original_action_kind(raw_action),
                                "text": raw_action, **found.get(step["n"],
                                {"fid": None, "source_arm": None, "source_command": None})}


def page_data(run: Path, tid: str, row: dict) -> dict:
    manifest = read_json(run / "manifest.json") if (run / "manifest.json").exists() else {}
    usage_path = run / "api_usage.jsonl"
    usage = [json.loads(line) for line in usage_path.read_text(encoding="utf-8").splitlines() if line] if usage_path.exists() else []
    task, original = original_steps(row)
    arms = {arm: arm_data(run, arm, tid, usage) for arm in ARMS}
    add_action_sources(original, arms)
    return {"run": run.name, "trajectory_id": tid, "task_type": row.get("task_type"),
            "llm_model": row.get("llm_model"), "task": task, "original": original,
            "gold": gold_data(row), "run_status": manifest.get("status"),
            "arms": arms}


def page_html(data: dict, nav: dict, current: str) -> str:
    return ("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>Agent 调试轨迹浏览器</title><link rel=\"stylesheet\" href=\"viewer.css\">"
            "</head><body><div id=\"app\"></div>"
            f"<script id=\"nav-data\" type=\"application/json\">{write_json_script(nav)}</script>"
            f"<script id=\"case-data\" type=\"application/json\">{write_json_script(data)}</script>"
            f"<script id=\"current-id\" type=\"application/json\">{write_json_script(current)}</script>"
            "<script src=\"viewer.js\"></script></body></html>\n")


def build(source: Path, output: Path, corpus: Path) -> tuple[int, int]:
    runs = find_runs(source)
    rows = {row["trajectory_id"]: row for row in pq.read_table(
        corpus, columns=["trajectory_id", "task_type", "llm_model", "full_trajectory",
                         "critical_failure_step", "critical_failure_module",
                         "failure_types", "failure_reasonings", "step_annotations"]).to_pylist()}
    entries = []
    for run in runs:
        for tid in case_ids(run):
            if tid not in rows:
                raise ValueError(f"Raw trajectory {tid} is absent from {corpus}")
            entries.append((run, tid, rows[tid]))
    if not entries:
        raise ValueError("No case JSON files found")
    nav_cases = []
    for index, (run, tid, row) in enumerate(entries, 1):
        case_state = {}
        for arm in ARMS:
            path = run / "cases" / arm / f"{tid}.json"
            if path.exists():
                case = read_json(path)
                case_state[arm] = {"present": True, "submitted": bool(case.get("submission")),
                                   "commands": len(case.get("commands") or []),
                                   "error": case.get("error")}
            else:
                case_state[arm] = {"present": False, "submitted": False, "commands": 0, "error": None}
        nav_cases.append({"id": f"case-{index:03d}", "href": f"case-{index:03d}.html",
                          "run": run.name, "tid": tid, "task_type": row.get("task_type"),
                          "llm_model": row.get("llm_model"), "gold_step": row.get("critical_failure_step"),
                          "arms": case_state})
    nav = {"runs": [run.name for run in runs], "cases": nav_cases}
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ASSETS / "viewer.css", output / "viewer.css")
    shutil.copyfile(ASSETS / "viewer.js", output / "viewer.js")
    for (run, tid, row), item in zip(entries, nav_cases):
        data = page_data(run, tid, row)
        (output / item["href"]).write_text(page_html(data, nav, item["id"]), encoding="utf-8")
    first = entries[0]
    (output / "index.html").write_text(page_html(page_data(*first), nav, nav_cases[0]["id"]), encoding="utf-8")
    return len(runs), len(entries)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--corpus", type=Path, default=CORPUS)
    args = parser.parse_args()
    runs, cases = build(args.source, args.output, args.corpus)
    print(f"Generated {cases} case pages across {runs} runs at {args.output.resolve() / 'index.html'}")


if __name__ == "__main__":
    main()
