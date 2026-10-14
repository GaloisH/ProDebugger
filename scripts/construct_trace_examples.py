"""Build explicitly authored debugger demonstrations using real offline tools.

No model requests or environment actions are executed. Original run archives and
benchmark results are read-only. Use --output for a separate reproducibility run.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from prodebugger.record_bridge import build_bundle, plain, read_json, write_json
from prodebugger.debug_tools import DebugTools, GLOBAL
from prodebugger.query_trace import packet as trace_packet
from prodebugger.trace_manager import packet as manager_packet
from prodebugger.direct_submit import packet as submit_packet, commit as submit_commit
from prodebugger.query_simplify import simplify_sql
from scripts.audit_trace_queries import restore_archived_facts
from local_judgement import SLOTS

RUN = "evidence-query-claims-n30-20261013"
SUMMARY = ROOT / "results" / "summary" / RUN
TRACES = ROOT / "results" / "traces" / RUN
SPEC_PATH = SUMMARY / "constructed_specs.json"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def sql_for(spec, last):
    """The author specifies exact element branches; only SQL quoting is automated."""
    branches = []
    for term, module, lo, hi in spec["searches"]:
        hi = last if hi == "last" else hi
        branches.append(
            f"-- Inspect the {module} evidence for {term!r} in original steps {lo}-{hi}.\n"
            "SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,\n"
            "       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,\n"
            "       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity\n"
            f"FROM SEARCH_TEXT({literal(term)},{literal(module)},{lo},{hi})")
    # Keep parsed facts separate from exact original excerpts in the output.
    branches.append(
        "-- Track the disputed entity; parsed claims and derived checks remain unverified.\n"
        "SELECT step,'parsed_fact' AS module,span AS text,NULL AS source_id,\n"
        "       NULL AS start,NULL AS end,fid,source_kind,parse_status,\n"
        "       rel,args,slot,side,value,value_type,assertion_time,claim_scope,claim_polarity\n"
        f"FROM TRACK_ENTITY({literal(spec['entity'])},1,{last})")
    return simplify_sql(f"-- Purpose: {spec['sql_purpose']}\n"
            "-- Search entity-specific history before the anchor and later recovery; never retrieve whole steps.\n"
            "WITH evidence AS (\n" + "\nUNION\n".join(branches) +
            "\n)\n-- Deduplicate overlapping excerpts while retaining exact source offsets.\n"
            "SELECT DISTINCT * FROM evidence ORDER BY step,module,start,fid;\n")


def archived_inputs(tid, archive_index):
    archive = TRACES / f"{tid}.tar.gz"
    entry = next(a for a in archive_index["archives"] if Path(a["archive"]).name == archive.name)
    data = archive.read_bytes()
    if sha(data) != entry["sha256"]:
        raise ValueError(f"Original archive checksum mismatch: {tid}")
    inputs, fingerprints = {}, {}
    with tarfile.open(archive) as handle:
        for name in ("input.json", "audited_parse.json", "canonical_record.json"):
            member_name = f"{RUN}/{tid}/{name}"
            member = handle.extractfile(member_name)
            if member is None:
                raise ValueError(member_name)
            raw = member.read()
            recorded = next(m for m in entry["members"] if m["path"] == member_name)
            if sha(raw) != recorded["sha256"]:
                raise ValueError(f"Original member checksum mismatch: {member_name}")
            inputs[name] = json.loads(raw)
            fingerprints[name] = sha(raw)
    return inputs, {"archive": str(archive.relative_to(ROOT)),
                    "archive_sha256": sha(data), "input_sha256": fingerprints}


def original(source, step, module):
    row = source["steps"][step - 1]
    return row["env_text"] if module == "observation" else row["parts"].get(module) or ""


def ensure(condition, message):
    if not condition:
        raise ValueError(message)


def build_one(spec, output, archive_index):
    tid = spec["trajectory_id"]
    inputs, origin = archived_inputs(tid, archive_index)
    source = inputs["input.json"]
    bundle = build_bundle(source, audited=inputs["audited_parse.json"])
    restore_archived_facts(bundle, inputs["canonical_record.json"])
    tools = DebugTools(bundle)
    ensure(not tools.claim_parser.online and tools.claim_parser.client is None,
           "Demonstrations must never call a model")
    output.mkdir(parents=True, exist_ok=False)
    provenance = {"schema": "authored-debugger-demonstration/v1", "synthetic": True,
        "trajectory_id": tid, "source_run": RUN, **origin,
        "author": "Codex, manually authored at the user's request",
        "authoring_context": "The author reviewed saved traces and offline evaluations; this is not a blind model evaluation",
        "decisions": "Manually authored MAP/ROUTE/manager/TRACE/SUBMIT decisions, not model responses",
        "tool_results": "Actually executed offline against the unchanged archived input and audited parse",
        "semantic_parser": "Offline templates only; unresolved clauses are preserved; no simulated LLM backoff",
        "environment_actions": "Historical source actions only; no new environment execution",
        "model_api_calls": 0, "include_in_benchmark": False,
        "correctness_scope": "Source quotations and protocol checked; causal conclusions are authored examples, not an independently scored success"}
    write_json(output / "provenance.json", provenance)
    write_json(output / "authoring_spec.json", spec)
    events = []

    def call(name, arguments, phase, explanation):
        response = tools.execute(name, arguments, f"authored-{len(events)+1:03d}", record=False)
        ensure("error" not in response, f"{tid}/{name}: {response.get('error')}")
        events.append({"ordinal": len(events) + 1, "phase": phase,
            "request_origin": "manually_authored", "response_origin": "offline_backend_execution",
            "explanation": explanation, "tool": name, "arguments": arguments, "response": response})
        return response["data"]

    goal_map = call("view", {"spec": "requirements", "scope": GLOBAL}, "MAP", spec["map_note"])
    write_json(output / "goal_map.json", goal_map)
    anchor = spec["anchor_step"]
    slot = SLOTS[spec["anchor_module"]]
    facts = [f for f in tools.index.facts.values() if f.t == anchor and f.slot == slot and f.side == "mind"]
    ensure(bool(facts), f"No anchor Fact for {tid}")
    fid = facts[0].fid
    call("span", {"fid": fid, "scope": GLOBAL}, "ROUTE", "Inspect the original anchor module behind the selected Fact.")
    call("view", {"spec": f"local_audits | steps:{anchor}:{anchor} | detail:full", "scope": GLOBAL},
         "ROUTE", "Compare the anchor with its observation, related modules and parse audit before declaring a hypothesis.")
    requirements = sorted(tools.index.requirements)
    route = {"candidate_id": "authored_route", "issue_step": anchor, "issue_fids": [fid],
             "goal_links": requirements, "hypothesis": spec["question"]}
    call("route_cases", {"candidates": [route]}, "ROUTE", spec["route_note"])
    write_json(output / "route_candidates.json", [route])
    write_json(output / "manager_input.json", manager_packet(tools))

    aid = "investigate_origin_and_recovery"
    evidence = [{"source_id": f"source:{anchor}:{spec['anchor_module']}", "quote": spec["anchor_quote"]}]
    criteria = spec["criteria"]
    plan = {"assignments": [{"agent_id": aid, "anchor_case_id": "authored_route",
        "route_case_ids": ["authored_route"], "question": spec["question"],
        "search_targets": spec["search_targets"], "evidence": evidence, "criteria": criteria}],
        "decision_rules": [{"rule_id": f"evidence_{outcome}", "conditions": [{"agent_id": aid,
            "outcome": outcome, "finding": criteria[outcome]}],
            "conclusion": spec["decisions"][outcome], "caveat": spec["limitation"]}
            for outcome in ("supported", "refuted", "unknown")],
        "uncertainty": spec["limitation"]}
    accepted_plan = call("plan_trace", plan, "MANAGER",
                         "One investigator can compare origin, same-step alternatives and later recovery in one query.")
    write_json(output / "manager_plan.json", accepted_plan)
    case = tools.windows.windows[0]
    trace_input = trace_packet(tools, case)
    write_json(output / "trace_input.json", trace_input)
    sql = sql_for(spec, len(source["steps"]))
    (output / "query.sql").write_text(sql, encoding="utf-8")
    ensure(not re.search(r"--[^\n]*[\u4e00-\u9fff]", sql), "SQL comments must be English")
    response = call("query_logs", {"candidate_id": aid, "sql": sql}, "TRACE_QUERY", spec["query_note"])
    ensure(not response.get("error") and not response.get("partial") and not response.get("truncated"),
           f"Incomplete query for {tid}")
    ensure(response["returned_rows"] > 0, f"Empty query for {tid}")
    write_json(output / "query_result.json", response)

    for row in response["rows"]:
        if row.get("source_id") is None:
            continue
        text = original(source, row["step"], row["module"])
        ensure(text[row["start"]:row["end"]] == row["text"], "Source offsets do not match original")

    def visible(note):
        quote, step, module = note["quote"], note["step"], note["module"]
        ensure(quote in original(source, step, module), f"Invented quote at {tid}/{step}/{module}: {quote}")
        if step == anchor:
            return True
        return any(row.get("step") == step and row.get("module") == module and quote in (row.get("text") or "")
                   for row in response["rows"])

    ensure(all(visible(n) for n in spec["evidence_notes"]), f"Reasoning cites unreturned evidence for {tid}")
    authored = []
    for candidate in spec["candidates"]:
        ensure(visible({"step": candidate["step"], "module": candidate["module"],
                        "quote": candidate["output_quote"]}), "Candidate quote was not retrieved")
        authored.append({**candidate, "requirement_links": requirements})
    assessment = {"window_id": aid, "candidates": authored, "uncertainty": spec["limitation"]}
    trace = call("assess", assessment, "TRACE_ASSESS", spec["assessment_note"])
    write_json(output / "trace_assessment.json", trace)
    write_json(output / "evidence_notes.json", spec["evidence_notes"])
    tools.phase = "SUBMIT"
    submit_input = submit_packet(tools)
    write_json(output / "submit_input.json", submit_input)
    ensure(submit_input["manager_guidance"]["plan"] == accepted_plan, "Manager plan changed at handoff")
    ensure(submit_input["manager_guidance"]["trace_evidence"][aid]["rows"] == response["rows"], "SQL rows changed at handoff")
    ensure(all("is_root_cause" not in c["assessment"] for c in submit_input["candidates"]),
           "Single-worker causal role must not be disclosed to SUBMIT")
    selected = submit_input["candidates"][spec["selected_candidate"]]
    answer = {"status": "diagnosed", "selected_candidate_id": selected["candidate_id"],
        "fault_class": selected["assessment"]["fault_class"], "output_quote": selected["assessment"]["output_quote"],
        "reasoning": spec["submit_reasoning"], "comparisons": [
            {"candidate_id": c["candidate_id"], "reasoning": spec["comparisons"][i]}
            for i, c in enumerate(submit_input["candidates"])],
        "repair": spec["repair"], "uncertainty": spec["limitation"]}
    accepted = submit_commit(tools, answer, "authored-submit", record=False)
    events.append({"ordinal": len(events) + 1, "phase": "SUBMIT",
        "request_origin": "manually_authored", "response_origin": "offline_structural_validation",
        "explanation": spec["submit_reasoning"], "response": answer, "validation": accepted})
    write_json(output / "submit_answer.json", {"provenance": provenance, "answer": answer})
    result = {**accepted["result"], "semantic_verdict": "Manually authored source-grounded example; structural validation is not causal correctness certification"}
    write_json(output / "result.json", {"provenance": provenance, "result": result})
    (output / "events.jsonl").write_text("".join(json.dumps(plain(e), ensure_ascii=False) + "\n" for e in events), encoding="utf-8")
    checks = {"archived_inputs_verified": True, "source_excerpts_exact": True,
        "all_cited_evidence_visible": True, "manager_plan_validated": True,
        "trace_assess_validated": True, "submit_validated": True,
        "manager_plan_preserved": True, "query_rows_preserved": True,
        "single_worker_root_role_hidden": True, "english_sql_comments": True,
        "queries": 1, "rows": response["returned_rows"], "agents": 1,
        "selected_steps": sorted({c["step"] for c in authored}), "model_api_calls": 0,
        "partial": False, "truncated": False, "benchmark_metrics_modified": False}
    write_json(output / "validation.json", checks)
    lines = [f"# {spec['title']}", "", "人工构造的 debugger 示范。决策为手工编写，工具返回为真实离线执行；不计入 30 任务实测成绩。", "",
        f"原任务：{source['task']}", "", f"来源：`{tid}`；原始归档 `{tid}.tar.gz` 的 SHA-256：`{origin['archive_sha256']}`。", "",
        "## 逐阶段轨迹", ""]
    for event in events:
        lines += [f"### {event['ordinal']}. {event['phase']} — {event.get('tool', 'authored JSON response')}", "", event["explanation"], ""]
        if "arguments" in event:
            args = event["arguments"]
            if event["tool"] == "query_logs":
                lines += ["```sql", sql.rstrip(), "```", "", f"真实离线查询返回 {response['returned_rows']} 行，无报错、无截断。全部结果见 [query_result.json](query_result.json)。", ""]
            elif event["tool"] in {"plan_trace", "assess"}:
                filename = "manager_plan.json" if event["tool"] == "plan_trace" else "trace_assessment.json"
                lines += [f"完整输入与返回见 [{filename}]({filename}) 和 [events.jsonl](events.jsonl)。", ""]
            else:
                lines += ["```json", json.dumps(args, ensure_ascii=False, indent=2), "```", ""]
    lines += ["## 查询证据与判断", ""]
    for note in spec["evidence_notes"]:
        lines += [f"**Step {note['step']} / {note['module']}**", "", "> " + note["quote"].replace("\n", "\n> "), "", note["interpretation"], ""]
    lines += ["## 最终示范输出", "", f"`{selected['step']} / {selected['module']} / {answer['fault_class']}`", "", answer["reasoning"], "", "修复建议：" + answer["repair"], "", "证据边界：" + spec["limitation"], "",
        "原始 observation(t) 先于 action(t)，action(t) 的反馈通常位于 observation(t+1)。没有新建环境反馈、供应商请求 ID、模型耗时或 token 统计。", "",
        "阶段输入：[MAP](goal_map.json)、[manager](manager_input.json)、[TRACE](trace_input.json)、[SUBMIT](submit_input.json)。", "",
        "完整交接：[manager 计划](manager_plan.json)、[TRACE 结果](trace_assessment.json)、[SUBMIT 答案](submit_answer.json)、[结构校验](validation.json)、[来源说明](provenance.json)。", ""]
    (output / "README.md").write_text("\n".join(lines), encoding="utf-8")
    return {"trajectory_id": tid, "title": spec["title"], "selected_step": selected["step"],
            "selected_module": selected["module"], "fault_class": answer["fault_class"],
            "synthetic": True, "include_in_benchmark": False, "validation": checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=TRACES / "constructed")
    args = parser.parse_args()
    specs = read_json(SPEC_PATH)
    ensure(len(specs) == 6 and len({s['trajectory_id'] for s in specs}) == 6, "Exactly six distinct examples required")
    archive_index = read_json(SUMMARY / "trace_archives.json")
    original_paths = [p for p in SUMMARY.iterdir() if p.is_file()] + list(TRACES.glob("*.tar.gz"))
    before = {str(p): sha(p.read_bytes()) for p in original_paths}
    args.output.mkdir(parents=True, exist_ok=False)
    rows = [build_one(spec, args.output / spec["trajectory_id"], archive_index) for spec in specs]
    ensure(before == {str(p): sha(p.read_bytes()) for p in original_paths}, "An original run artifact changed")
    manifest = {"schema": "authored-debugger-demonstrations/v1", "source_run": RUN,
        "synthetic": True, "include_in_benchmark": False, "model_api_calls": 0,
        "original_artifacts_unchanged": True, "tasks": rows,
        "files": [{"path": str(p.relative_to(args.output)), "sha256": sha(p.read_bytes()), "bytes": p.stat().st_size}
                  for p in sorted(args.output.rglob("*")) if p.is_file()]}
    lines = ["# 六条逐阶段构造轨迹", "", "基于同一轮 30 条中的 6 条原始任务，手工编写完整诊断示范。原始观察和动作不变；DSL 查询在归档日志上实际离线执行。人工决策标记为 synthetic，不作为模型实测或新增准确率。", "",
        "每条包含 MAP → ROUTE → manager → TRACE 查询 → TRACE 判断 → SUBMIT，附完整交接 JSON、原文引用、SQL 返回和校验结果。", "",
        "| 任务 | 示范选择 | 内容 |", "|---|---|---|"]
    for row in rows:
        lines.append(f"| [{row['trajectory_id']}]({row['trajectory_id']}/README.md) | {row['selected_step']} / {row['selected_module']} | {row['title']} |")
    lines += ["", "每条 1 个 investigator、1 次带英文注释的元素查询。SUBMIT 选择 TRACE 已提交的候选并保留证据限制；单 worker 的 is_root_cause 不传入 SUBMIT。解析使用存档审核结果和离线模板，不伪造 LLM backoff。", "",
        "校验包括：原始归档及成员 SHA-256、精确原文和偏移、引用可见性、manager/TRACE/SUBMIT 协议、查询结果交接、原始文件未变。校验通过只说明这些约束成立，不构成根因的独立真值认证。", "",
        "在仓库根目录可重建到新目录（不需要 API key）：", "", "```bash", "PYTHONHASHSEED=42 .venv/bin/python -B scripts/construct_trace_examples.py --output /tmp/prodebugger-constructed-replay", "```", "",
        "手工配置保存在 `results/summary/evidence-query-claims-n30-20261013/constructed_specs.json`。生成器只读归档，拒绝覆盖已有输出目录。", ""]
    (args.output / "README.md").write_text("\n".join(lines), encoding="utf-8")
    manifest["files"].append({"path": "README.md", "sha256": sha((args.output / "README.md").read_bytes()),
                              "bytes": (args.output / "README.md").stat().st_size})
    write_json(args.output / "manifest.json", manifest)
    print(json.dumps({"output": str(args.output), "tasks": len(rows), "queries": len(rows),
                      "model_api_calls": 0, "original_artifacts_unchanged": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
