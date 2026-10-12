"""Build a local, offline experiment browser from the durable debugger logs."""
from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from prodebugger.llm_client import json_lines
from prodebugger.record_bridge import ROOT, read_json, digest

ASSETS = Path(__file__).resolve().parent / "assets"


def optional_json(path, default=None):
    return read_json(path) if path.is_file() else default


def case_data(run, result):
    output = run / result["trajectory_id"]
    source = optional_json(output / "input.json", {})
    tools = [r for r in json_lines(output / "tool_calls.jsonl") if r.get("event") == "committed"]
    by_id = {r["tool_call_id"]: r for r in tools}
    ledger = json_lines(output / "usage.jsonl")
    attempts = {}
    for row in ledger:
        key = row.get("request_file")
        if not key:
            continue
        attempts[key] = {**attempts.get(key, {}), **row}
    models = []
    for key, row in attempts.items():
        # Logs are data; never follow an arbitrary path supplied by a log entry.
        request = optional_json(output / key, {}) if re.fullmatch(r"requests/\d+\.json", key) else {}
        models.append({"kind": "model", "phase": row.get("phase", request.get("phase", "UNKNOWN")),
                       "title": f"模型请求 #{len(models) + 1}", "status": row.get("event", "pending"),
                       "request": request, "response": row.get("message"),
                       "usage": {k: row.get(k) for k in ("input_tokens", "output_tokens", "response_model",
                                 "timestamp_utc", "error_type", "retryable")}, "request_file": key})
    events, model_index, used = [], 0, set()
    transcript = json_lines(output / "messages.jsonl")
    window_reviews = {r["response_turn"]: r for r in json_lines(output / "window_trace.jsonl")}
    direct_answers = {r["response_turn"]: r for r in json_lines(output / "direct_submit.jsonl")}
    for row in transcript:
        m = row.get("message", row)
        if m.get("role") == "user":
            try:
                content = json.loads(m.get("content", "{}"))
            except (ValueError, TypeError):
                continue
            if content.get("schema") == "debugger-handoff/v1":
                events.append({"kind": "handoff", "phase": row.get("phase", content["to"]),
                               "title": f"{content.get('from') or 'START'} → {content['to']}",
                               "status": "handoff", "data": content, "turn": row.get("turn")})
        elif m.get("role") == "assistant":
            # Failed/retried attempts have no assistant transcript; show them before
            # the next durable response, so every billed attempt stays inspectable.
            while model_index < len(models) and models[model_index]["status"] != "completed":
                events.append(models[model_index]); model_index += 1
            match = next((i for i in range(model_index, len(models))
                          if digest(models[i].get("response")) == digest(m)), None)
            if match is not None:
                models.insert(model_index, models.pop(match))
            if model_index < len(models):
                event = models[model_index]
                event["turn"] = row.get("turn")
                events.append(event); model_index += 1
            else:
                events.append({"kind": "model", "phase": row.get("phase", "UNKNOWN"),
                               "title": f"模型响应 · turn {row.get('turn', '?')}",
                               "response": m, "request": {}, "status": "legacy", "usage": {}})
            review = window_reviews.get(row.get("turn"))
            if review is None:
                review = next((window_reviews[c.get("id")] for c in m.get("tool_calls", []) or []
                               if c.get("id") in window_reviews), None)
            if review is not None:
                events.append({"kind": "assessment", "phase": "TRACE", "turn": row["turn"],
                               "title": "窗口根因结论 · " + review["window_id"],
                               "status": "committed", "data": review})
            if row.get("turn") in direct_answers:
                events.append({"kind": "answer", "phase": "SUBMIT", "turn": row["turn"],
                               "title": "直接比较 TRACE 可疑步骤 · 最终答案",
                               "status": "committed", "data": direct_answers[row["turn"]]})
        elif m.get("role") == "tool":
            event = by_id.get(m.get("tool_call_id"))
            if event:
                events.append({"kind": "tool", "phase": event["phase"], "title": event["name"],
                               "status": "error" if "error" in event["result"] else "committed",
                               "data": event, "turn": row.get("turn")})
                used.add(event["tool_call_id"])
    events.extend(models[model_index:])
    events.extend({"kind": "tool", "phase": t["phase"], "title": t["name"],
                   "status": "error" if "error" in t["result"] else "committed", "data": t}
                  for t in tools if t["tool_call_id"] not in used)
    for i, event in enumerate(events):
        event["index"] = i
    record = optional_json(output / "canonical_record.json", {})
    return {"run": run.name, "trajectory_id": result["trajectory_id"], "task": source.get("task", ""),
            "domain": source.get("task_type", ""), "steps": source.get("steps", []),
            "record": record, "result": result, "events": events,
            "phase_events": json_lines(output / "phase_events.jsonl"),
            "assessments": {},
            "comparison": (list(direct_answers.values())[-1]["raw_answer"] if direct_answers
                           else None),
            "usage": result.get("usage", {}),
            "goal_map": optional_json(output / "goal_map.json"),
            "windows": optional_json(output / "trace_windows.json", {}),
            "candidate_reviews": {}}


def script_json(value):
    return (json.dumps(value, ensure_ascii=False).replace("&", "\\u0026").replace("<", "\\u003c")
            .replace(">", "\\u003e").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def page_html(data, nav, manifest):
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Debugger 实验 · {html.escape(manifest.get('run_id', ''))}</title>
<link rel="stylesheet" href="theme.css"><link rel="stylesheet" href="case-browser.css">
<link rel="stylesheet" href="viewer.css"></head><body><div class="app-shell">
<header class="wb-topbar"><div class="wb-brand"><span class="wb-brand-mark">D</span>
<span>PRODEBUGGER<small>DSL EXPERIMENT BROWSER</small></span></div>
<span class="wb-local">离线实验记录</span></header><div id="app"></div>
<footer class="wb-footer">MAP → ROUTE → TRACE → SUBMIT<span>有限窗口覆盖 · 协议接受不等同于归因准确</span></footer>
</div><script id="case-data" type="application/json">{script_json(data)}</script>
<script id="nav-data" type="application/json">{script_json(nav)}</script>
<script id="manifest-data" type="application/json">{script_json(manifest)}</script>
<script src="viewer.js"></script></body></html>'''


def build_report(run, results=None):
    run = Path(run)
    if results is None:
        results = optional_json(run / "resume_results.json")
        if results is None:
            results = optional_json(run / "results.json", [])
    manifest = optional_json(run / "resume_manifest.json") or optional_json(run / "manifest.json", {"run_id": run.name})
    # Only browser-relevant configuration; old manifests may contain cost fields.
    manifest = {k: manifest.get(k) for k in ("run_id", "created_at", "mode", "submission_policy")}
    browser = run / "browser"
    browser.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ASSETS / "theme.css", browser / "theme.css")
    shutil.copyfile(ASSETS / "case-browser.css", browser / "case-browser.css")
    for name in ("viewer.css", "viewer.js"):
        shutil.copyfile(ASSETS / name, browser / name)
    nav = [{"id": r["trajectory_id"], "href": f"case-{i+1:03d}.html", "status": r["status"]}
           for i, r in enumerate(results)]
    first = None
    for entry, result in zip(nav, results):
        data = case_data(run, result)
        if first is None:
            first = data
        (browser / entry["href"]).write_text(page_html(data, nav, manifest), encoding="utf-8")
    (browser / "index.html").write_text(page_html(first, nav, manifest), encoding="utf-8")
    return browser / "index.html"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path)
    args = parser.parse_args()
    print(build_report(args.run_dir.resolve()))


if __name__ == "__main__":
    main()
