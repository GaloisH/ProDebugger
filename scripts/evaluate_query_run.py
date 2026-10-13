"""Post-run label comparison. Never imported by compilation or model requests."""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pyarrow.parquet as pq
from prodebugger.record_bridge import read_json, write_json
from prodebugger.llm_client import json_lines


def evaluate(run, data_dir):
    manifest = read_json(run / "manifest.json")
    ids = manifest["trajectory_ids"]
    labels = {}
    for path in Path(data_dir).glob("*.parquet"):
        for row in pq.read_table(path, filters=[("trajectory_id", "in", ids)], columns=[
                "trajectory_id", "task_type", "critical_failure_step", "critical_failure_module", "failure_types"]).to_pylist():
            labels[row["trajectory_id"]] = row
    rows, total_usage = [], Counter()
    for tid in ids:
        folder = run / tid
        result = read_json(folder / "result.json")
        label = labels[tid]
        root = result.get("root") or {}
        audits = read_json(folder / "audited_parse.json")["units"] if (folder / "audited_parse.json").exists() else {}
        parse_stats = Counter(u["status"] for u in audits.values())
        queries = json_lines(folder / "trace_queries.jsonl")
        trace = json_lines(folder / "window_trace.jsonl")
        cases = [w for event in json_lines(folder / "tool_calls.jsonl")
                 if event.get("event") == "committed" and event.get("name") == "route_cases" and "data" in event["result"]
                 for w in event["arguments"]["candidates"]]
        usage = result.get("usage", {})
        parsing = result.get("parsing_usage", {})
        claim_parsing = result.get("claim_parsing_usage", usage.get("claim_parsing", {}))
        for key in ("input_tokens", "output_tokens", "model_calls"):
            total_usage["diagnosis_" + key] += usage.get(key, 0)
            total_usage["parsing_" + key] += parsing.get(key, 0)
            total_usage["claim_parsing_" + key] += claim_parsing.get(key, 0)
        row = {"trajectory_id": tid, "task_type": label["task_type"], "status": result["status"],
               "predicted_step": root.get("step"), "predicted_module": root.get("module"), "predicted_class": root.get("fault_class"),
               "gold_step": label["critical_failure_step"], "gold_module": label["critical_failure_module"],
               "gold_classes": label["failure_types"], "step_match": root.get("step") == label["critical_failure_step"],
               "step_module_match": root.get("step") == label["critical_failure_step"] and root.get("module") == label["critical_failure_module"],
               "route_cases": len(cases), "trace_results": len(trace), "queries": len(queries),
               "gold_step_in_route": any(c["issue_step"] == label["critical_failure_step"] for c in cases),
               "gold_step_module_in_trace": any(c["step"] == label["critical_failure_step"] and c["module"] == label["critical_failure_module"]
                                                 for event in trace for c in event["candidates"]),
               "invalid_queries": sum("error" in q for q in queries), "truncated_queries": sum(bool(q.get("truncated")) for q in queries),
               "parse_units": dict(parse_stats), "parse_calls": parsing.get("model_calls", 0) + claim_parsing.get("model_calls", 0),
               "claim_parse_calls": claim_parsing.get("model_calls", 0),
               "output_quote": root.get("output_quote"), "reasoning": root.get("reasoning", result.get("reasoning")),
               "uncertainty": result.get("uncertainty"), "stop_reason": result.get("stop_reason"),
               "query_details": [{k: q.get(k) for k in ("candidate_id", "query", "returned_rows", "returned_steps", "truncated", "error")} for q in queries]}
        row["full_match"] = row["step_module_match"] and root.get("fault_class") in (label["failure_types"] or [])
        rows.append(row)
    starts = [read_json(run / tid / "worker.json")["started_at"] for tid in ids]
    summary = {"tasks": len(rows), "workers": manifest["config"]["workers"], "start_interval": [min(starts), max(starts)],
               "statuses": dict(Counter(r["status"] for r in rows)), "step_matches": sum(r["step_match"] for r in rows),
               "step_module_matches": sum(r["step_module_match"] for r in rows), "full_matches": sum(r["full_match"] for r in rows),
               "gold_step_in_route": sum(r["gold_step_in_route"] for r in rows),
               "gold_step_module_in_trace": sum(r["gold_step_module_in_trace"] for r in rows),
               "queries": sum(r["queries"] for r in rows), "invalid_queries": sum(r["invalid_queries"] for r in rows),
               "truncated_queries": sum(r["truncated_queries"] for r in rows), "parse_calls": sum(r["parse_calls"] for r in rows),
               "claim_parse_calls": sum(r["claim_parse_calls"] for r in rows),
               "parse_units": dict(sum((Counter(r["parse_units"]) for r in rows), Counter())), "usage": dict(total_usage),
               "evaluation_scope": f"One-based original steps compared directly to native critical_failure_step. Labels read only in this post-run script; all {len(rows)} tasks remain in the denominator. This is a small-sample exact annotation comparison, not causal correctness certification."}
    write_json(run / "evaluation.json", {"summary": summary, "trajectories": rows})
    lines = [f"# {len(rows)} 条轨迹：严格解析审核与单次 SQL TRACE", "",
             f"模型：`{manifest['config']['model']}`；并发：{summary['workers']} 个 worker；任务：{len(rows)} 条。", "",
             f"状态：{summary['statuses']}。原始 step 精确匹配 {summary['step_matches']}/{len(rows)}；step＋module 匹配 {summary['step_module_matches']}/{len(rows)}；再加错误类型匹配 {summary['full_matches']}/{len(rows)}。", "",
             f"解析：{summary['parse_units']}，实际 backoff 请求 {summary['parse_calls']} 次。TRACE 查询 {summary['queries']} 次，SQL 错误 {summary['invalid_queries']} 次，截断 {summary['truncated_queries']} 次。", "",
             f"阶段诊断：ROUTE 锚点包含标注 step 的任务 {summary['gold_step_in_route']}/{len(rows)}；TRACE 候选包含标注 step＋module 的任务 {summary['gold_step_module_in_trace']}/{len(rows)}。", "",
             "| 轨迹 | 状态 | 输出 step/module | 标注 step/module | 完全匹配 | 解析调用 | 查询数 |",
             "|---|---|---|---|---|---:|---:|"]
    for row in rows:
        lines.append(f"| {row['trajectory_id']} | {row['status']} | {row['predicted_step']}/{row['predicted_module']} | {row['gold_step']}/{row['gold_module']} | {'是' if row['full_match'] else '否'} | {row['parse_calls']} | {row['queries']} |")
    lines += ["", "只在本报告生成阶段读取标注；标注不进入解析、ROUTE、TRACE 或 SUBMIT。所有任务均计入分母。该小样本结果不代表总体准确率；模板通过和结构校验也不等于语义判断一定正确。", "",
              f"本次记录的 SUBMIT 协议：{manifest['submission_policy']}。TRACE 保留原结果字段；旧 window 字段只作锚点兼容元数据，查询范围由 SQL 决定。", "",
              "用量（供应商报告 token；解析与诊断分开）：", "", "```json", json.dumps(dict(total_usage), ensure_ascii=False, indent=2), "```", ""]
    for row in rows:
        lines += [f"## {row['trajectory_id']}", "", str(row["reasoning"] or row["stop_reason"]), ""]
        for query in row["query_details"]:
            lines += [f"候选 `{query['candidate_id']}`，返回步骤 {query['returned_steps']}；错误：{query.get('error') or '无'}。", "", "```sql", query["query"], "```", ""]
    (run / "evaluation.md").write_text("\n".join(lines), encoding="utf-8")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--data-dir", type=Path, default=Path("core/data"))
    args = parser.parse_args()
    print(json.dumps(evaluate(args.run, args.data_dir), ensure_ascii=False, indent=2))
