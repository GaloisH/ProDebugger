"""Offline, annotation-guided audit of archived TRACE requests; never called at runtime."""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prodebugger.record_bridge import build_bundle, read_json, write_json
from prodebugger.debug_tools import DebugTools
from prodebugger.llm_client import json_lines
from prodebugger.query_dsl import execute
from prodebugger.direct_submit import parse


# Manual review notes refer to this named experiment, not universal classifications.
REVIEWS = {
    "GPT-4o_019_": ("take ladle 1 from countertop 1", "成功归因",
        "7/action 命中。另一 TRACE 给出 10/reflection 不确定候选，SUBMIT 将其视为后续完成声称；多 agent 没有导致丢失正确候选。"),
    "GPT-4o_006_": ("I should proceed to cabinet 2", "ROUTE 假设和查询模块遗漏",
        "锚点 4 围绕引号/指令格式，而该类原因被实验排除。SQL 查询移动动作及观测，没有查询标注 5/plan；TRACE 明确缺少原始计划以归因重复决策，返回空。Nothing happens 和到达观测搜索被截断。"),
    "GPT-4o_055_": ("I have placed a clean bowl", "判断口径及步骤边界",
        "6/reflection 原文已返回；5/reflection 更早已有同类完成声称，TRACE 选 5 且 uncertain。缺少 bowl 确实干净/不干净的证据，不等于完成声称已经得到验证。这里同时有标注边界与认识论判据差异，不能归因于 SQL 查不到。"),
    "GPT-4o_047_": ("Step 3 and Step 5", "上游 memory 未查",
        "标注 10/memory 概括先前 look，却遗漏关键未发现信息。TRACE 只追 look、desk 观测及重复计划，选择 16/plan；未查 memory。另一条围绕格式的调查返回空，因此 SUBMIT 只有一个非空候选。"),
    "GPT-4o_037_": ("desklamp is likely located", "原文已可见但归因停在症状",
        "2/memory 的 desklamp is likely located 原文已返回，TRACE 仍选择 22/plan；其他调查选择 14 和 26 的 plan。SUBMIT 用后来找到 pen 的恢复证据降低 14 的优先级，选择 22。没有 2/memory 候选可选。标注将 likely 前提视为 hallucination，提示词允许探索性假设，存在判断口径张力。"),
    "GPT-4o_013_": ("result did not yield any relevant products", "上游 memory 和商品证据未查",
        "标注 2/memory 断言无相关商品；原结果存在值得继续核查的 Disney 商品。SQL 主要查简化搜索与 plan/reflection，未查该 memory 及商品属性；TRACE 给 11/plan uncertain，SUBMIT 在单候选情况下提升为约束忽略。不是两个 agent 冲突。"),
    "GPT-4o_011_": ("a refined search query", "无效查询、字面词及判据差异",
        "一条 SEARCH_TEXT('search','plan') 因泛化词被拒绝且消耗机会。其余未返回标注 21/plan 的精确原文；refining the search 不匹配 a refined search query。TRACE 认为进一步探索尚可能合理，三条均空。不能把检索缺口与探索是否低效混为一谈。"),
    "Qwen3-8B_011_": ("explicitly prioritize", "查询围绕锚点且来源预算耗尽",
        "标注 12/plan 没有 women 字样；查询围绕 women，虽返回 step 12 动作或 memory，却未返回该 plan。memory 搜索 17 匹配只返回 7；随后 reflection 7 匹配返回 0，受共享来源预算限制。TRACE 选择 30/plan uncertain，SUBMIT 单候选提升为错误。14/19 观测解析未解决，但标注 12/plan 原文可直接查。"),
    "GPT-4o_009_": ("new items that may not", "局部强错误掩盖另一标注原因",
        "TRACE 找到 23/action 没执行显式调整搜索计划的强证据；标注是 5/plan 的低效继续翻页。SQL 未查询该 plan 原文。只有一个候选，SUBMIT 无法从不存在的候选中恢复标注归因；两种错误叙述的任务贡献仍需独立比较。"),
    "Qwen3-8B_017_": ("In step 8, the relevant product", "模块归因、可观测性和 SUBMIT 引用错位",
        "9/memory 已在查询和 c2 锚点中可见，但两条 TRACE 分别给 8/memory 与 9/plan，均 uncertain。SUBMIT 选择 8/memory 的 ID，却引用 9/memory 原文，被校验拒绝。商品页列出 medium/b16-blue，没有明确选中或默认状态，根因角色确实受可观测性限制；不能靠解析推导已选状态。"),
}


def inspect(run, output):
    evaluation = read_json(run / "evaluation.json")
    prior_review = read_json(run / "query_review.json")
    rows = []
    for label in evaluation["trajectories"]:
        tid = label["trajectory_id"]
        phrase, category, note = next(v for k, v in REVIEWS.items() if tid.startswith(k))
        folder = run / tid
        source = read_json(folder / "input.json")
        audits = read_json(folder / "audited_parse.json")
        queries = json_lines(folder / "trace_queries.jsonl")
        events = json_lines(folder / "window_trace.jsonl")
        requests = []
        visible = []
        gold_step, gold_module = label["gold_step"], label["gold_module"]
        for f in sorted((folder / "requests").glob("*.json")):
            request = read_json(f)
            if request["phase"] != "TRACE":
                continue
            messages = request["messages"]
            inputs = json.loads(messages[1]["content"])
            requests.append({"path": str(f), "roles": [m["role"] for m in messages],
                "case": inputs["candidate"]["candidate_id"], "anchor": inputs["source"]["step"],
                "top_level_keys": list(inputs), "has_timeline": "route_timeline" in inputs,
                "has_other_agent_results": "trace_evidence" in inputs or "other_agents" in inputs})
            if inputs["source"]["step"] == gold_step:
                text = inputs["source"]["modules"].get(gold_module)
                if text and not any(v["kind"] == "anchor" and v["case"] == inputs["candidate"]["candidate_id"] for v in visible):
                    visible.append({"kind": "anchor", "case": inputs["candidate"]["candidate_id"], "text": text})
        for q in queries:
            for row in q.get("rows", []):
                if row.get("step") == gold_step and row.get("module") == gold_module and row.get("source_kind") == "original_agent_module":
                    visible.append({"kind": "query_excerpt", "case": q["candidate_id"], "text": row.get("text", "")})
        sql = f"SELECT step,module,text,source_kind FROM SEARCH_TEXT('{phrase.replace(chr(39), chr(39) * 2)}','{gold_module}')"
        probe = execute(DebugTools(build_bundle(source, audited=audits)), sql)
        found = [r for r in probe["rows"] if r.get("step") == gold_step and r.get("module") == gold_module]
        if not found or "error" in probe or probe["truncated"]:
            raise RuntimeError(f"capability probe failed: {tid}")
        source_text = source["steps"][gold_step - 1]["parts"][gold_module]
        if any(r["text"] not in source_text for r in found):
            raise RuntimeError("probe returned a non-original excerpt")
        candidates = [{"candidate_id": f"trace-window:{e['window_id']}:{i}", "agent_id": e["window_id"],
            "anchor": e["window"]["issue_step"], **c} for e in events for i, c in enumerate(e["candidates"], 1)]
        messages = json_lines(folder / "messages.jsonl")
        submitted = [m["message"] for m in messages if m["phase"] == "SUBMIT" and m["message"]["role"] == "assistant"]
        raw_submit = parse(submitted[-1]["content"]) if submitted else None
        selected = next((c for c in candidates if c["candidate_id"] == (raw_submit or {}).get("selected_candidate_id")), None)
        quote = (raw_submit or {}).get("output_quote") or ""
        quote_sources = [{"step": s["t"], "module": m} for s in source["steps"] for m, text in s["parts"].items()
                         if quote and quote in (text or "")]
        rows.append({"trajectory_id": tid, "gold": {"step": gold_step, "module": gold_module},
            "result": {k: label[k] for k in ("status", "predicted_step", "predicted_module", "step_module_match", "stop_reason")},
            "manual_diagnosis": {"category": category, "reasoning": note},
            "actual_trace_requests": requests, "gold_source_in_actual_trace": visible,
            "trace_candidates": candidates, "nonempty_agents": len({c["agent_id"] for c in candidates}),
            "gold_in_candidate_pool": label["gold_step_module_in_trace"],
            "queries": queries, "raw_submit": raw_submit, "selected_trace_candidate": selected,
            "submit_quote_source_matches": quote_sources,
            "selected_quote_source_matches": bool(selected and {"step": selected["step"], "module": selected["module"]} in quote_sources),
            "unresolved_parse_units": {k: v for k, v in audits["units"].items() if v["status"] == "unresolved"},
            "annotation_guided_capability_probe": {"not_an_agent_query_or_accuracy_result": True, "sql": sql, "result": probe}})
    summary = {"tasks": len(rows), "actual_run_metrics": prior_review["summary"],
        "gold_source_visible_tasks": sum(bool(r["gold_source_in_actual_trace"]) for r in rows),
        "gold_candidate_pool_tasks": sum(r["gold_in_candidate_pool"] for r in rows),
        "multiple_nonempty_agent_tasks": [r["trajectory_id"] for r in rows if r["nonempty_agents"] >= 2],
        "uncertain_candidate_selected_by_submit": [r["trajectory_id"] for r in rows if r["result"]["status"] == "diagnosed"
                                                   and (r["selected_trace_candidate"] or {}).get("status") == "uncertain"],
        "submit_source_identity_errors": [r["trajectory_id"] for r in rows if r["selected_trace_candidate"] and not r["selected_quote_source_matches"]],
        "successful_annotation_guided_probes": len(rows),
        "actual_trace_request_shapes": dict(Counter("/".join(q["roles"]) for r in rows for q in r["actual_trace_requests"])),
        "scope": "Offline audit of archived pre-manager run. Probes use known annotation phrases to test DSL reachability, not model performance. Manual attribution is not a controlled ablation."}
    report = {"run": str(run), "summary": summary, "trajectories": rows}
    write_json(output / "diagnosis.json", report)
    lines = ["原锚点选择与信息覆盖诊断（离线复核）", f"实验：{run}", "",
        "这是 manager 改动前的已完成实验。只读历史请求、查询、判断及解析结果；没有模型调用，也没有新线上准确率。",
        "标注只用于事后比较及能力探针，未输入诊断 agent。能力探针使用已知答案里的短语，不能当成 agent 会自行发现该短语的证明。", "",
        "主要证据：",
        f"- 17 次实际查询中 15 次返回早期原文；12 个非空 TRACE 结果有 11 个仍选锚点。",
        f"- {summary['gold_source_visible_tasks']}/10 任务的标注 step/module 原文在 TRACE 输入或结果中可见；只有 {summary['gold_candidate_pool_tasks']}/10 的候选池包含标注 step/module。",
        "- 因此现有候选池下 SUBMIT 的标注精确匹配上限为 1/10。唯一包含标注候选的任务已经选对，未发现 SUBMIT 丢弃正确候选造成的额外漏命中。",
        f"- 多个非空 TRACE 的任务只有 {len(summary['multiple_nonempty_agent_tasks'])} 个；不能把所有失败解释为两个 agent 争执。",
        "- A019 正确比较了源错误与完成声称；A037 比较恢复和重复计划但缺少标注 memory 候选；QW017 把 8/memory 的 ID 与 9/memory 的引文绑定，属于来源错位。",
        "- 所有 10 个标注 step/module 都能用当前 DSL 的单条定向原文查询取到，且这些能力探针没有截断。不存在统一的早期日志不可达问题。", "",
        "解析端：5 个 unresolved 观测集中在 QW011 的 14/19 与 QW017 的 7/8/9 商品页。残留审核将 Back to Search、Description、Features、Reviews、Buy Now 等 UI 词列为未覆盖；这是具体的审核过度拒绝问题。",
        "但 QW017 商品页本身没有明确选中/默认 medium 的标识。即使解析完整，也不能把可用选项推导成已选状态。A037/A055 在无观测解析缺口且关键原文可见时仍漏命中，不能用解析缺陷解释全部现象。", "",
        "DSL 端：SEARCH_TEXT 是字面搜索；每个来源最多 360 字符，每个搜索最多 8 个来源，整条查询共享 4320 来源字符预算，且这些限制先于外层 WHERE/LIMIT。17 次实际查询中 7 次截断。QW011 后置 reflection 分支有 7 个匹配却返回 0，证明存在预算挤占。",
        "函数参数只能是字面量，不能把一分支发现的 fid/entity 动态交给另一表函数；加上一次查询机会，发现—核验链路受限。泛化词 search 被拒绝的无效查询也消耗机会。", "",
        "提示词和分工端：查到某个早期 step 的动作并不等于看到了该 step 的 memory/plan。多个查询只检验锚点自己的指控，没有覆盖上游说法。即使早期原文已返回，TRACE 也可能沿用锚点或把无世界状态反证混同为声称已有充分依据。",
        "同时须保留合理的反假阳性约束。A055 早一条已有同类声称，A037 的 likely 前提与标注 hallucination 之间有口径差异，不能宣称每个精确标注偏差都已证明是模型错误。", "",
        "实际信息流（逐个请求验证）：ROUTE 有完整动作/观测时间线；TRACE 首次是 system+自己的锚点输入，第二次加自己的 SQL 调用及结果。没有 ROUTE 的完整会话，没有其他 TRACE 结果，没有完整上游 memory/reflection/plan。SUBMIT 旧输入也不是所有 SQL 原文的并集，而是候选、局部完整原文及另行选择的关联摘录。",
        "架构含义：局部 TRACE 可以辨认强错误，但根因还要求原始依赖、时间顺序与恢复证据。单纯加一个派发者不能保证这一点；分工必须覆盖反证，判定规则必须交给能看到各调查证据的最终比较者。",
        "本次实现：TRACE 内增加 manager；按用户方案 1 看完整动作/观测、全部 ROUTE 锚点原文和解析警告。它分配调查与短原文，声明 supported/refuted/unknown 标准和跨调查 AND 条件。计划直接进入 SUBMIT，并附所有实际有界查询证据及截断/错误；SUBMIT 检验条件，而不是把计划当事实。未通过线上实验验证准确率改进。", ""]
    for r in rows:
        lines += [r["trajectory_id"], f"标注 {r['gold']}；结果 {r['result']['predicted_step']}/{r['result']['predicted_module']}；非空调查 {r['nonempty_agents']}。",
            f"标注模块原文可见：{bool(r['gold_source_in_actual_trace'])}；候选池含标注：{r['gold_in_candidate_pool']}。",
            r["manual_diagnosis"]["category"] + "：" + r["manual_diagnosis"]["reasoning"],
            "标注指导的 DSL 能力探针（不是实际 agent 查询）：" + r["annotation_guided_capability_probe"]["sql"], ""]
    (output / "diagnosis.txt").write_text("\n".join(lines), encoding="utf-8")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(inspect(args.run, args.output), ensure_ascii=False, indent=2))
