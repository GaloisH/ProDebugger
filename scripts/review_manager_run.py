"""Post-run manager/TRACE/SUBMIT handoff audit and SQL replay; no API calls."""
import argparse
from collections import Counter
from datetime import datetime
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prodebugger.record_bridge import read_json, write_json, digest, build_bundle
from prodebugger.llm_client import json_lines
from prodebugger.debug_tools import DebugTools
from prodebugger.query_dsl import execute
from scripts.audit_trace_queries import restore_archived_facts


def inspect(run, baseline=None):
    manifest = read_json(run / "manifest.json")
    evaluation = read_json(run / "evaluation.json")
    phase_calls, modules, source_modules, role_values = Counter(), Counter(), Counter(), Counter()
    starts, finishes, tasks, all_queries, violations = [], [], [], [], []
    labels = {r["trajectory_id"]: r for r in evaluation["trajectories"]}
    route_reads = duplicate_reads = 0
    for tid in manifest["trajectory_ids"]:
        folder = run / tid
        result = read_json(folder / "result.json")
        worker = read_json(folder / "worker.json")
        starts.append(datetime.fromisoformat(worker["started_at"]))
        finishes.append(datetime.fromisoformat(worker["finished_at"]))
        for phase, usage in result.get("usage", {}).get("by_phase", {}).items():
            phase_calls[phase] += usage["model_calls"]
        plan = read_json(folder / "manager_plan.json") if (folder / "manager_plan.json").exists() else None
        traces = {e["window_id"]: e for e in json_lines(folder / "window_trace.jsonl")}
        queries = json_lines(folder / "trace_queries.jsonl")
        events = [e for e in json_lines(folder / "tool_calls.jsonl") if e["event"] == "committed"]
        reads = [e for e in events if e["phase"] == "ROUTE" and e["name"] not in {"route_cases", "finish", "reroute", "hold", "drop", "contrast"}]
        route_reads += len(reads)
        duplicate_reads += len(reads) - len({e["request_hash"] for e in reads})
        plan_errors = [e["result"]["error"] for e in events if e["name"] == "plan_trace" and "error" in e["result"]]
        source = read_json(folder / "input.json")
        bundle = build_bundle(source, audited=read_json(folder / "audited_parse.json"))
        restore_archived_facts(bundle, read_json(folder / "canonical_record.json"))
        tools = DebugTools(bundle)
        if traces:
            tools.windows.configure([{k: t["window"][k] for k in
                ("candidate_id", "issue_step", "issue_fids", "goal_links", "hypothesis")} for t in traces.values()])
        task_queries = []
        query_keys = ("rows", "error", "truncated", "function_scopes", "partial", "function_errors", "repairs", "skipped_branches")
        for q in queries:
            replay = execute(tools, q["query"])
            replay_equal = all(replay.get(k) == q.get(k) for k in query_keys if k in q)
            if not replay_equal:
                violations.append({"trajectory_id": tid, "agent_id": q["candidate_id"], "issue": "offline SQL replay differs"})
            trace = traces.get(q["candidate_id"], {})
            anchor = trace.get("window", {}).get("issue_step")
            earlier = sorted(t for t in q.get("returned_steps", []) if anchor is not None and t < anchor)
            early_sources = sorted({r["step"] for r in q.get("rows", []) if type(r.get("step")) is int
                and anchor is not None and r["step"] < anchor and r.get("source_kind") in {"original_agent_module", "original_observation"}})
            candidates = trace.get("candidates", [])
            # Count only explicitly attributed original excerpts. Aggregates, aliased
            # columns and parsed Facts cannot certify cross-module source visibility.
            mental_by_step = {}
            for item in q.get("rows", []):
                if (type(item.get("step")) is int and item.get("module") in {"memory", "reflection", "plan"}
                        and item.get("source_kind") == "original_agent_module" and item.get("text")):
                    mental_by_step.setdefault(item["step"], set()).add(item["module"])
            cross_module_steps = sorted(t for t, ms in mental_by_step.items() if len(ms) > 1)
            modules.update(c["module"] for c in candidates)
            role_values.update(str(c.get("is_root_cause")) for c in candidates)
            source_modules.update(s["arguments"][1] for s in q.get("function_scopes", []) if s["function"] == "SEARCH_TEXT")
            row = {"agent_id": q["candidate_id"], "anchor": anchor, "sql": q["query"],
                "has_chinese_comments": bool(re.search(r"--[^\n]*[\u4e00-\u9fff]", q["query"])),
                "has_english_purpose_comment": bool(re.search(r"--\s*Purpose:", q["query"], flags=re.I)),
                "partial": q.get("partial", False), "function_errors": q.get("function_errors", []),
                "repairs": q.get("repairs", []), "skipped_branches": q.get("skipped_branches", []),
                "returned_rows": q.get("returned_rows", 0), "returned_steps": q.get("returned_steps", []),
                "earlier_returned_steps": earlier, "earlier_source_steps": early_sources,
                "cross_module_source_steps": cross_module_steps,
                "cross_module_source_steps_outside_anchor": [t for t in cross_module_steps if t != anchor],
                "mental_source_modules_by_step": {t: sorted(ms) for t, ms in sorted(mental_by_step.items())},
                "error": q.get("error"), "truncated": q.get("truncated", False),
                "function_scopes": q.get("function_scopes", []), "trace_candidates": candidates,
                "trace_uncertainty": trace.get("conclusion", {}).get("uncertainty"), "replay_equal": replay_equal}
            task_queries.append(row); all_queries.append(row)
        submit_inputs, prompt_checks = [], []
        for path in sorted((folder / "requests").glob("*.json")):
            request = read_json(path)
            if request["phase"] in {"MANAGER", "TRACE"}:
                system = next(m["content"] for m in request["messages"] if m["role"] == "system")
                payload = json.loads(next(m["content"] for m in request["messages"] if m["role"] == "user"))
                prompt_checks.append({"phase": request["phase"], "path": str(path),
                    "explicit_manager_prior_origin_duty": "For each distinct unresolved causal mechanism" in system,
                    "manager_source_examples": system.count("<!-- real-manager-example:"),
                    "worker_source_examples": payload.get("query_language", "").count("<!-- real-example:"),
                    "worker_english_comments": "concise English SQL comments" in system,
                    "manager_prioritized_few_agents": "Start with ONE investigator by default" in system,
                    "manager_has_query_reference_and_context": bool(payload.get("query_language") and payload.get("query_context")),
                    "manager_competing_mechanism_guidance": "CHOOSE THE CAUSAL QUESTION BEFORE CHOOSING KEYWORDS" in system,
                    "worker_can_expand_assignment": "NOT a whitelist of phrases, steps, modules or causes" in system,
                    "worker_cross_module_query_guidance": "CROSS-CHECK RELATED MODULES IN THE SAME QUERY" in system,
                    "worker_unbounded_aggregate_retrieval": "no aggregate row, byte, source-count or function-count" in payload.get("query_language", ""),
                    "benchmark_scope": "benchmark_scope" in payload})
            if request["phase"] == "SUBMIT":
                submit_inputs.append(json.loads(request["messages"][-1]["content"]))
        handoff = None
        if submit_inputs:
            inputs = submit_inputs[-1]
            guide = inputs.get("manager_guidance", {})
            definite = [c for c in inputs["candidates"] if c["assessment"]["status"] == "error"]
            # Compute expected disclosure from the immutable TRACE log, not already masked inputs.
            known = [(aid, c) for aid, e in traces.items() for c in e["candidates"]
                     if c["status"] == "error" and type(c.get("is_root_cause")) is bool]
            disclose = len({c["step"] for aid, c in known}) >= 2 and len({aid for aid, c in known}) >= 2
            role_mask_ok = all(("is_root_cause" in c["assessment"]) == (disclose and
                c["assessment"]["status"] == "error" and any(aid == c["window"]["candidate_id"] and
                original["step"] == c["step"] and original["module"] == c["module"] for aid, original in known))
                for c in inputs["candidates"])
            actual_rows = guide.get("trace_evidence", {})
            evidence_ok = set(actual_rows) == {q["candidate_id"] for q in queries} and all(
                all(actual_rows[q["candidate_id"]].get(k) == q.get(k) for k in query_keys if k in q) for q in queries)
            handoff = {"plan_exactly_preserved": guide.get("plan") == plan, "query_evidence_exactly_preserved": evidence_ok,
                "conditional_role_mask_correct": role_mask_ok, "root_roles_disclosed": disclose,
                "candidate_count": len(inputs["candidates"]), "request_count": len(submit_inputs)}
            if not all(handoff[k] for k in ("plan_exactly_preserved", "query_evidence_exactly_preserved", "conditional_role_mask_correct")):
                violations.append({"trajectory_id": tid, "issue": "SUBMIT handoff validation", "detail": handoff})
        direct = json_lines(folder / "direct_submit.jsonl")
        raw_answer = direct[-1]["raw_answer"] if direct else None
        if raw_answer is None:
            answers = [e["message"] for e in json_lines(folder / "messages.jsonl")
                       if e["phase"] == "SUBMIT" and e["message"]["role"] == "assistant"]
            if answers:
                from prodebugger.direct_submit import parse
                try:
                    raw_answer = parse(answers[-1].get("content"))
                except ValueError:
                    raw_answer = {"invalid_json": True}
        root = result.get("root") or {}
        if raw_answer and raw_answer.get("status") == "uncertain":
            violations.append({"trajectory_id": tid, "issue": "model attempted SUBMIT uncertain", "accepted": result["accepted"]})
        label = labels[tid]
        tasks.append({"trajectory_id": tid, "status": result["status"], "root": result.get("root"),
            "stop_reason": result.get("stop_reason"), "gold": {"step": label["gold_step"], "module": label["gold_module"]},
            "step_module_match": label["step_module_match"], "gold_in_trace": label["gold_step_module_in_trace"],
            "elapsed_seconds": (finishes[-1] - starts[-1]).total_seconds(),
            "manager_plan": plan, "manager_validation_errors": plan_errors, "queries": task_queries,
            "submit_handoff": handoff, "submit_answer": raw_answer,
            "rule_ids_mentioned_in_submit": [rule["rule_id"] for rule in (plan or {}).get("decision_rules", [])
                if rule["rule_id"] in json.dumps(raw_answer or {}, ensure_ascii=False)],
            "selected_trace_status": root.get("source_trace_status"), "actual_prompt_checks": prompt_checks})
    mental = [s for q in all_queries for s in q["function_scopes"]
              if s["function"] == "SEARCH_TEXT" and not s.get("error") and s["arguments"][1] in {"memory", "reflection", "plan"}]
    actual_prompts = [p for t in tasks for p in t["actual_prompt_checks"]]
    summary = {**evaluation["summary"], "wall_seconds": round((max(finishes) - min(starts)).total_seconds(), 2),
        "start_spread_seconds": round((max(starts) - min(starts)).total_seconds(), 6), "phase_model_calls": dict(phase_calls),
        "manager_plans": sum(bool(t["manager_plan"]) for t in tasks),
        "assigned_agents": sum(len((t["manager_plan"] or {}).get("assignments", [])) for t in tasks),
        "agent_counts_per_task": {t["trajectory_id"]: len((t["manager_plan"] or {}).get("assignments", [])) for t in tasks},
        "tasks_with_at_most_two_agents": sum(0 < len((t["manager_plan"] or {}).get("assignments", [])) <= 2 for t in tasks),
        "manager_validation_errors": sum(len(t["manager_validation_errors"]) for t in tasks),
        "submit_calls": sum((t["submit_handoff"] or {}).get("request_count", 0) for t in tasks),
        "submit_calls_explicitly_mentioning_rule_ids": sum(bool(t["rule_ids_mentioned_in_submit"]) for t in tasks),
        "nonempty_trace_cases": sum(bool(q["trace_candidates"]) for q in all_queries),
        "trace_cases_selecting_anchor": sum(bool(q["trace_candidates"]) and q["trace_candidates"][0]["step"] == q["anchor"] for q in all_queries),
        "trace_cases_selecting_earlier_step": sum(bool(q["trace_candidates"]) and q["trace_candidates"][0]["step"] < q["anchor"] for q in all_queries),
        "queries_with_earlier_elements": sum(bool(q["earlier_returned_steps"]) for q in all_queries),
        "queries_with_earlier_source_quotes": sum(bool(q["earlier_source_steps"]) for q in all_queries),
        "queries_with_cross_module_source_steps": sum(bool(q["cross_module_source_steps"]) for q in all_queries),
        "queries_with_cross_module_source_steps_outside_anchor": sum(bool(q["cross_module_source_steps_outside_anchor"]) for q in all_queries),
        "queries_with_chinese_comments": sum(q["has_chinese_comments"] for q in all_queries),
        "queries_with_english_purpose_comments": sum(q["has_english_purpose_comment"] for q in all_queries),
        "partial_queries": sum(q["partial"] for q in all_queries),
        "queries_with_repairs": sum(bool(q["repairs"]) for q in all_queries),
        "failed_function_branches": sum(len(q["function_errors"]) for q in all_queries),
        "skipped_output_branches": sum(len(q["skipped_branches"]) for q in all_queries),
        "mental_search_functions": len(mental),
        "point_mental_search_functions": sum(len(s["arguments"]) == 4 and s["arguments"][2] == s["arguments"][3] for s in mental),
        "mental_searches_from_start": sum(len(s["arguments"]) == 2 or s["arguments"][2] <= 1 for s in mental),
        "manager_requests_with_prior_origin_duty_and_examples": sum(p["phase"] == "MANAGER" and p["explicit_manager_prior_origin_duty"] and p["manager_source_examples"] == 2 and p["benchmark_scope"] for p in actual_prompts),
        "trace_requests_with_english_comments_and_examples": sum(p["phase"] == "TRACE" and p["worker_english_comments"] and p["worker_source_examples"] == 4 for p in actual_prompts),
        "manager_requests_with_prioritized_few_agents": sum(p["phase"] == "MANAGER" and p["manager_prioritized_few_agents"] for p in actual_prompts),
        "manager_requests_with_query_reference_and_context": sum(p["phase"] == "MANAGER" and p["manager_has_query_reference_and_context"] for p in actual_prompts),
        "manager_requests_with_competing_mechanism_guidance": sum(p["phase"] == "MANAGER" and p["manager_competing_mechanism_guidance"] for p in actual_prompts),
        "trace_requests_with_expansion_and_cross_module_guidance": sum(p["phase"] == "TRACE" and p["worker_can_expand_assignment"] and p["worker_cross_module_query_guidance"] for p in actual_prompts),
        "trace_requests_without_aggregate_retrieval_budgets": sum(p["phase"] == "TRACE" and p["worker_unbounded_aggregate_retrieval"] for p in actual_prompts),
        "empty_successful_queries": sum(not q["error"] and not q["returned_rows"] for q in all_queries),
        "trace_candidate_modules": dict(modules), "source_search_modules": dict(source_modules),
        "trace_root_roles": dict(role_values), "route_reads": route_reads, "duplicate_route_reads": duplicate_reads,
        "all_sql_replays_equal": all(q["replay_equal"] for q in all_queries), "protocol_violations": violations}
    write_json(run / "manager_review.json", {"summary": summary, "trajectories": tasks})
    comparison, parse_changes = None, {}
    if baseline is not None:
        old = read_json(baseline / "manifest.json")
        parse_changes = {}
        for tid in manifest["trajectory_ids"]:
            before, after = (read_json(path / tid / "audited_parse.json")["units"] for path in (baseline, run))
            changed = [k for k in before.keys() | after.keys() if digest(before.get(k)) != digest(after.get(k))]
            if changed:
                parse_changes[tid] = sorted(changed)
        comparison = {"baseline": str(baseline), "current": str(run),
            "same_task_order": manifest["trajectory_ids"] == old["trajectory_ids"],
            "same_shared_config": all(manifest["config"].get(k) == v for k, v in old["config"].items()),
            "same_inputs": all(digest(read_json(run / tid / "input.json")) == digest(read_json(baseline / tid / "input.json")) for tid in manifest["trajectory_ids"]),
            "parse_units_changed_on_fresh_backoff": parse_changes,
            "before": read_json(baseline / ("manager_review.json" if (baseline / "manager_review.json").exists() else "query_review.json"))["summary"], "after": summary,
            "scope": "One stochastic rerun; labels used only after completion. Prompt and query-engine changes are recorded in source fingerprints; this is not a single-variable ablation. Fresh parsing may differ. Rule-ID mention is not proof of correct conditional reasoning."}
        write_json(run / "comparison.json", comparison)
    lines = [f"Manager 版本：{summary['tasks']} 任务、{summary['workers']} worker 实验", "", f"运行目录：{run}",
        f"完成状态：{summary['statuses']}；用时 {summary['wall_seconds']} 秒；启动间隔 {summary['start_spread_seconds']} 秒。",
        f"step 命中 {summary['step_matches']}/{summary['tasks']}；step+module 命中 {summary['step_module_matches']}/{summary['tasks']}；含类别完全命中 {summary['full_matches']}/{summary['tasks']}。",
        f"Manager 计划 {summary['manager_plans']} 份；分配 {summary['assigned_agents']} 个调查；校验错误 {summary['manager_validation_errors']} 次。",
        f"SQL {summary['queries']} 次，错误 {summary['invalid_queries']} 次，截断 {summary['truncated_queries']} 次，成功但空返回 {summary['empty_successful_queries']} 次。",
        f"SQL 部分恢复 {summary['partial_queries']} 次；参数修正 {summary['queries_with_repairs']} 次；失败函数 {summary['failed_function_branches']} 个；跳过分支 {summary['skipped_output_branches']} 个。",
        f"英文 Purpose 注释 {summary['queries_with_english_purpose_comments']}/{summary['queries']}；含中文注释 {summary['queries_with_chinese_comments']}。",
        f"Mental 搜索 {summary['mental_search_functions']} 个：单步 {summary['point_mental_search_functions']}，从开头搜索 {summary['mental_searches_from_start']}。",
        f"SUBMIT 调用 {summary['submit_calls']} 次；显式提到规则 ID {summary['submit_calls_explicitly_mentioning_rule_ids']} 次。提及 ID 不等于语义判断正确。",
        f"有候选调查 {summary['nonempty_trace_cases']} 个：选锚点 {summary['trace_cases_selecting_anchor']}，选更早步骤 {summary['trace_cases_selecting_earlier_step']}。",
        f"同一步跨 mental 模块原文片段：{summary['queries_with_cross_module_source_steps']}/{summary['queries']} 条查询；锚点以外也有此类证据：{summary['queries_with_cross_module_source_steps_outside_anchor']}。该计数不证明模型正确使用了证据。",
        f"候选池包含标注 step/module 的任务 {summary['gold_step_module_in_trace']}/{summary['tasks']}。",
        f"查询离线重放一致：{summary['all_sql_replays_equal']}；输入传递／协议异常：{violations}。",
        f"基线比较：{comparison and {k: comparison[k] for k in ('same_task_order', 'same_inputs', 'same_shared_config')}}。",
        f"重新 backoff 导致解析变化：{parse_changes}。", "",
        "本次为提示词和查询引擎等变化后的随机重跑，不是单变量消融。精确标注匹配不是因果正确性认证。", ""]
    for t in tasks:
        lines += [t["trajectory_id"], f"状态 {t['status']}，输出 {(t['root'] or {}).get('step')}/{(t['root'] or {}).get('module')}；标注 {t['gold']}。",
            f"耗时 {t['elapsed_seconds']:.1f}s；manager 校验：{t['manager_validation_errors']}。"]
        for a in (t["manager_plan"] or {}).get("assignments", []):
            lines += [f"  {a['agent_id']}：{a['question']}", "  判据：" + json.dumps(a["criteria"], ensure_ascii=False)]
        for rule in (t["manager_plan"] or {}).get("decision_rules", []):
            lines.append("  条件规则：" + json.dumps(rule, ensure_ascii=False))
        for q in t["queries"]:
            lines += [f"  查询 {q['agent_id']} 锚点 {q['anchor']}；返回 {q['returned_rows']} 行；错误 {q['error']}；截断 {q['truncated']}。", q["sql"],
                      "  TRACE：" + json.dumps(q["trace_candidates"], ensure_ascii=False), "  未决：" + str(q["trace_uncertainty"])]
        lines += ["SUBMIT：" + json.dumps(t["submit_answer"], ensure_ascii=False), ""]
    (run / "manager_review.txt").write_text("\n".join(lines), encoding="utf-8")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect(args.run, args.baseline), ensure_ascii=False, indent=2))
