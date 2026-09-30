"""Reproduce per-case four_stage trajectory dashboards from saved logs.

Usage: python frontend/case_browser/analyze_case_run.py <run-directory> [--trajectory-id ID]
Writes metrics, a summary, a paired HTML, and one HTML per arm under analysis/.
Only saved logs are read; no model or debugger is invoked.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path


MODULES = ("memory", "reflection", "plan", "action")
ARMS = ("baseline", "four_stage")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def brief_arg(command: dict) -> str:
    args = command["args"]
    op = command["operator"]
    if op == "assess":
        return f"step {args[0]}" if args else ""
    if op == "submit":
        return f"fid {args[0]}, {args[1]}/{args[2]}" if len(args) >= 3 else ""
    if op in ("hold", "contrast", "check"):
        return ", ".join(args)
    return " ".join(args)[:150]


def failure_reason(command: dict) -> str | None:
    if command["exit_code"] == 0:
        return None
    output = command["output"]
    if isinstance(output, dict):
        return str(output.get("error") or output.get("stderr") or output.get("unparsed_stdout") or output)[:350]
    return str(output)[:350]


def failure_class(reason: str) -> str:
    if "assessment needs exactly" in reason:
        return "assessment_schema"
    if "read local_audits" in reason:
        return "missing_audit_read"
    if "evidence_for" in reason or "primary_fid" in reason or "proposition" in reason:
        return "assessment_validation"
    if "not_applicable" in reason:
        return "assessment_validation"
    if "detail must be" in reason:
        return "invalid_view_query"
    if "IndexError" in reason:
        return "missing_operator_argument"
    return "other"


def phase_for(number: int, commands: list[dict]) -> str:
    end = len(commands) + 1
    first_assess = next((i for i, c in enumerate(commands, 1) if c["operator"] == "assess"), end)
    global_call = next((i for i, c in enumerate(commands, 1)
                        if i > first_assess and c["operator"] == "global"), end)
    final_check = next((i for i, c in enumerate(commands, 1)
                        if i > global_call and c["operator"] == "check"), end)
    if final_check == end:
        final_check = next((i for i, c in enumerate(commands, 1)
                            if i > global_call and c["operator"] == "submit"), end)
    if number < first_assess:
        return "map"
    if number < global_call:
        return "review"
    if number < final_check:
        return "trace"
    return "final"


def original_actions(cases: dict[str, dict], n_steps: int) -> list[dict]:
    """Use saved audit output; it covers all steps in completed four-stage runs."""
    found: dict[int, dict] = {}
    for arm in ("four_stage", "baseline"):
        for source_command, command in enumerate(cases[arm]["commands"], 1):
            output = command["output"]
            if command["operator"] != "view" or not isinstance(output, dict):
                continue
            for row in output.get("audits", []):
                step = row.get("step")
                if not isinstance(step, int) or step in found:
                    continue
                action = row.get("modules", {}).get("action", {})
                outputs = action.get("outputs") or []
                item = outputs[0] if outputs else {}
                intention = action.get("review_context", {}).get("input_context", {}).get("intention") or {}
                span = item.get("span") or ""
                found[step] = {"step": step, "recorded_intention_verb": intention.get("verb"),
                               "action": span, "action_kind": action_kind(span, intention.get("verb")),
                               "fid": item.get("fid"), "source_arm": arm,
                               "source_command": source_command}
            for row in output.get("intentions", []):
                step = row.get("step")
                if not isinstance(step, int) or step in found:
                    continue
                action = row.get("action") or {}
                span = action.get("span") or ""
                verb = (row.get("intention") or {}).get("verb")
                found[step] = {"step": step, "recorded_intention_verb": verb,
                               "action": span, "action_kind": action_kind(span, verb),
                               "fid": action.get("fid"), "source_arm": arm,
                               "source_command": source_command}
    return [found.get(step, {"step": step, "recorded_intention_verb": None,
                             "action": "", "action_kind": "missing", "fid": None,
                             "source_arm": None, "source_command": None})
            for step in range(1, n_steps + 1)]


def action_kind(action: str, verb: str | None = None) -> str:
    if action == "next >":
        return "next_page"
    if action == "back to search":
        return "back_to_search"
    if verb == "search" or (action and verb is None and len(action.split()) > 3):
        return "search_query"
    if action:
        return verb or "other_action"
    return "missing"


def run_analysis(run_dir: Path, tid: str | None = None) -> dict:
    manifest = read_json(run_dir / "manifest.json")
    report = read_json(run_dir / "report.json")
    tid = tid or manifest["trajectory_ids"][0]
    if tid not in manifest["trajectory_ids"]:
        raise ValueError(f"Trajectory {tid} is absent from {run_dir}")
    report_case = next(row for row in report["per_case"] if row["trajectory_id"] == tid)
    usage_rows = [json.loads(line) for line in (run_dir / "api_usage.jsonl").read_text(encoding="utf-8").splitlines() if line]
    result = {"trajectory_id": tid, "original_steps": None, "manifest": {
        "model": manifest["model"], "resumed_at_utc": manifest.get("resumed_at_utc", []),
        "sample_size": manifest["sample_size"]}, "gold": report_case["gold"], "arms": {}}
    cases = {arm: read_json(run_dir / "cases" / arm / f"{tid}.json") for arm in ARMS}
    n_steps = next((c["output"]["steps"] for arm in ARMS for c in cases[arm]["commands"]
                    if c["operator"] == "profile" and isinstance(c["output"], dict)
                    and isinstance(c["output"].get("steps"), int)), None)
    if n_steps is None:
        raise ValueError(f"No usable profile step count for {tid}")
    result["original_steps"] = n_steps
    result["original_actions"] = original_actions(cases, n_steps)
    for arm in ARMS:
        case = cases[arm]
        session = read_json(run_dir / "work" / arm / "core" / "sessions" / f"{tid}.json")
        commands = case["commands"]
        seen_views: set[str] = set()
        failed_assess_steps: set[str] = set()
        command_rows = []
        for number, command in enumerate(commands, 1):
            reason = failure_reason(command)
            arg = brief_arg(command)
            repeated_view = command["operator"] == "view" and arg in seen_views
            retry_after_failure = (command["operator"] == "assess" and bool(command["args"])
                                   and command["args"][0] in failed_assess_steps)
            if command["operator"] == "view":
                seen_views.add(arg)
            if command["operator"] == "assess" and command["args"]:
                if command["exit_code"] != 0:
                    failed_assess_steps.add(command["args"][0])
                else:
                    failed_assess_steps.discard(command["args"][0])
            command_rows.append({"n": number, "operator": command["operator"], "arg": arg,
                                 "exit_code": command["exit_code"], "failure": reason,
                                 "failure_class": failure_class(reason) if reason else None,
                                 "phase": phase_for(number, commands),
                                 "repeated_view": repeated_view,
                                 "retry_after_failure": retry_after_failure})
        assessments = []
        for step in range(1, n_steps + 1):
            row = session["assessments"].get(str(step))
            assessments.append({"step": step, "modules": {
                module: {"status": (row or {}).get(module, {}).get("status", "not_assessed"),
                         "fid": (row or {}).get(module, {}).get("primary_fid"),
                         "fault_class": (row or {}).get(module, {}).get("fault_class"),
                         "evidence_for": (row or {}).get(module, {}).get("evidence_for", []),
                         "reasoning": (row or {}).get(module, {}).get("reasoning", "")[:450]}
                for module in MODULES}})
        used = [row for row in usage_rows
                if row["arm"] == arm and row["trajectory_id"] == tid]
        ops = collections.Counter(c["operator"] for c in commands)
        phases = collections.Counter(c["phase"] for c in command_rows)
        errors = collections.Counter(c["failure_class"] for c in command_rows if c["failure"])
        statuses = collections.Counter(m["status"] for row in assessments for m in row["modules"].values())
        result["arms"][arm] = {
            "commands": command_rows,
            "command_count": len(commands),
            "command_failures": sum(c["exit_code"] != 0 for c in commands),
            "operators": dict(ops), "phases": dict(phases), "failure_classes": dict(errors),
            "repeated_view_count": sum(c["repeated_view"] for c in command_rows),
            "assess_retries_after_failure": sum(c["retry_after_failure"] for c in command_rows),
            "assess_attempts": ops["assess"], "assessed_steps": len(session.get("assessments", {})),
            "assessment_statuses": dict(statuses), "assessments": assessments,
            "api_calls": len(used), "prompt_tokens": sum(x["prompt_tokens"] for x in used),
            "completion_tokens": sum(x["completion_tokens"] for x in used),
            "usd": round(sum(x["conservative_usd"] for x in used), 7),
            "api_phases": dict(collections.Counter(re.sub(r"_try\d+$", "", x["phase"]).split("_")[0] for x in used)),
            "reported_operator_calls": (case.get("submission") or {}).get("operator_calls"),
            "reported_model_calls": (case.get("submission") or {}).get("model_calls"),
            "selected": {k: (case.get("submission") or {}).get(k)
                         for k in ("step", "fid", "module", "fault_class", "accepted")},
            "protocol": {
                "held_fids": next((c["output"] for c in reversed(commands) if c["operator"] == "hold"), []),
                "contrast_fids": [r["fid"] for r in next((c["output"] for c in reversed(commands)
                                                         if c["operator"] == "contrast"), {}).get("rows", [])],
                "check_verdict": next((c["output"].get("verdict") for c in reversed(commands)
                                       if c["operator"] == "check" and isinstance(c["output"], dict)), None),
                "global_error_ledger_count": len(next((c["output"] for c in reversed(commands)
                                                       if c["operator"] == "global" and isinstance(c["output"], dict)), {}).get("local_error_ledger", []))},
            "model_stage_keys": list(case["model"]),
        }
        if arm == "baseline":
            messages_path = run_dir / "cases" / arm / f"{tid}.messages.json"
            messages = read_json(messages_path) if messages_path.exists() else []
            result["arms"][arm]["assistant_turns"] = sum(m["role"] == "assistant" for m in messages)
            result["arms"][arm]["revision_messages"] = [
                {"message_index": i, "text": (m.get("content") or "")[:700]}
                for i, m in enumerate(messages) if m["role"] == "assistant"
                and re.search(r"Revision [12]", m.get("content") or "", re.I)]
        else:
            trace = case["model"].get("trace_propose") or {}
            final = case["model"].get("revise_submit") or {}
            result["arms"][arm]["stage_selection"] = {
                "provisional_fid": trace.get("selected_fid"),
                "final_fid": final.get("selected_fid"),
                "rival_fids": trace.get("rival_fids", []),
                "revision_1_recorded": bool(final.get("revision_1")),
                "revision_2_recorded": bool(final.get("revision_2"))}
    return result


def concise_markdown(data: dict) -> str:
    def chosen(arm: str) -> str:
        selected = data["arms"][arm]["selected"]
        return (f"{selected['step']} / {selected['module']}"
                if selected["step"] is not None else "未提交")

    lines = [f"# 调试轨迹：{data['trajectory_id']}", "",
             f"原始轨迹 {data['original_steps']} 步；标注错误步：第 {data['gold']['step']} 步 "
             f"{data['gold']['module']}/{', '.join(data['gold']['types'])}。", "",
             "| 指标 | baseline | four_stage |", "|---|---:|---:|"]
    b, f = (data["arms"][arm] for arm in ARMS)
    for name, key in (("CLI 调用", "command_count"), ("CLI 非零退出", "command_failures"),
                      ("API 调用", "api_calls"), ("局部评估步数", "assessed_steps")):
        lines.append(f"| {name} | {b[key]} | {f[key]} |")
    lines += ["", "| 最终提交 | baseline | four_stage |", "|---|---|---|",
              f"| 步骤 / 模块 | {chosen('baseline')} | {chosen('four_stage')} |", "",
              "详细命令和逐步判断见 [配对图表](./trajectory_dashboard.html)、"
              "[baseline 单方案](./baseline_debug.html)、[four_stage 单方案](./four_stage_debug.html)"
              "及 [metrics.json](./metrics.json)。标注步骤与原始动作是否语义一致，需结合图表逐步核查。", ""]
    return "\n".join(lines)


def dashboard(data: dict, display_arms: tuple[str, ...] = ARMS) -> str:
    page_data = {**data, "display_arms": display_arms,
                 "arms": {arm: data["arms"][arm] for arm in display_arms}}
    payload = json.dumps(page_data, ensure_ascii=False).replace("</", "<\\/")
    return """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>诊断轨迹对比</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,"Microsoft YaHei",sans-serif;--bg:#f7f9fc;--fg:#17212f;--muted:#526173;--panel:#fff;--line:#d7dee8;--blue:#2775c9;--violet:#8055b8;--green:#26856b;--orange:#d18a20;--red:#c44c55;--gray:#aab5c2}
@media(prefers-color-scheme:dark){:root{--bg:#111820;--fg:#ecf1f7;--muted:#b8c4d0;--panel:#1b2733;--line:#3c4a58;--blue:#67aaf1;--violet:#bb92eb;--green:#70c9ac;--orange:#efba67;--red:#f18a90;--gray:#647383}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg)}main{max-width:1160px;margin:auto;padding:28px 20px 64px}h1{font-size:1.7rem;margin:0 0 8px}h2{font-size:1.2rem;margin:0 0 12px}p{color:var(--muted);line-height:1.55;margin:7px 0 18px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin-top:18px}table{border-collapse:collapse;width:100%;font-size:.94rem}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--muted);font-weight:600}td.num{text-align:right;font-variant-numeric:tabular-nums}.legend{display:flex;gap:15px;flex-wrap:wrap;margin:8px 0 12px;color:var(--muted);font-size:.88rem}.sw{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-1px}.timeline{display:grid;grid-template-columns:repeat(76,minmax(0,1fr));gap:2px;min-height:38px}.cell{min-width:0;height:36px;border:0;border-radius:3px;padding:0;cursor:pointer;background:var(--gray);position:relative}.cell:focus-visible,.step:focus-visible{outline:3px solid var(--fg);outline-offset:1px}.cell.fail:after{content:"×";position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:16px;font-weight:700}.cell.selected,.step.selected{box-shadow:0 0 0 3px var(--fg)}.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:.8rem;margin-top:5px}.lane{margin-bottom:18px}.lane strong{display:block;margin-bottom:5px}.detail{min-height:70px;border-top:1px solid var(--line);padding-top:12px;margin-top:14px;line-height:1.55;overflow-wrap:anywhere}.mini{font-size:.86rem;color:var(--muted)}.heat{display:grid;grid-template-columns:52px repeat(30,minmax(0,1fr));gap:3px;align-items:center;margin:8px 0}.step{height:29px;min-width:0;border:0;border-radius:3px;cursor:pointer;background:var(--gray);font-size:.72rem;color:var(--fg)}.step.error{background:var(--red);color:#fff}.step.uncertain{background:var(--orange);color:#18202a}.step.correct{background:var(--green);color:#fff}.step.na{background:var(--gray)}.step.gold{border-bottom:4px solid var(--fg)}.path{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap}.node{flex:1 1 170px;border:1px solid var(--line);border-radius:8px;padding:12px}.node strong{display:block;margin-bottom:5px}.arrow{align-self:center;color:var(--muted)}.barrow{display:grid;grid-template-columns:94px 1fr 45px;align-items:center;gap:9px;margin:7px 0}.track{height:15px;background:var(--line);border-radius:3px;overflow:hidden}.fill{height:100%}@media(max-width:700px){.grid{grid-template-columns:1fr}.timeline{grid-template-columns:repeat(38,minmax(0,1fr))}.heat{grid-template-columns:42px repeat(30,minmax(0,1fr));gap:1px}.step{font-size:0}.step.gold:after{content:"◆";font-size:11px}main{padding:18px 10px 50px}.panel{padding:12px}}
.cell.retry:before{content:"↻";position:absolute;top:-10px;right:-2px;color:var(--fg);font-size:12px;font-weight:700}.step.orig-search_query{background:var(--blue);color:#fff}.step.orig-next_page{background:var(--violet);color:#fff}.step.orig-back_to_search{background:var(--orange);color:#18202a}.step.orig-click{background:var(--violet);color:#fff}.step.orig-other_action{background:var(--gray)}.step.unassessed{background:var(--gray)}.step.annotation{background:transparent;color:var(--red);font-weight:700;border:2px solid var(--red)}.step.annotation-empty{background:transparent;cursor:default}.heat{grid-template-columns:70px repeat(var(--steps),minmax(0,1fr))}@media(max-width:700px){.heat{grid-template-columns:62px repeat(var(--steps),minmax(0,1fr))}}
</style></head><body><main><h1 id="page-title">调试方法执行轨迹</h1><p id="intro"></p>
<section class="panel"><h2>三种口径</h2><div id="summary"></div></section>
<section class="panel"><h2>诊断命令轨迹</h2><div class="legend"><span><i class="sw" style="background:var(--blue)"></i>Map</span><span><i class="sw" style="background:var(--violet)"></i>Review</span><span><i class="sw" style="background:var(--green)"></i>Trace</span><span><i class="sw" style="background:var(--orange)"></i>Final</span><span>× 非零退出</span><span>↻ 失败后重试</span></div><div id="timeline"></div><div id="command-detail" class="detail" aria-live="polite">点击一个命令查看操作、参数与结果。</div></section>
<div class="grid"><section class="panel"><h2>操作类型</h2><div id="operators"></div></section><section class="panel"><h2>阶段分布</h2><div id="phases"></div></section></div>
<section class="panel"><h2>原始轨迹与局部错误判断</h2><p class="mini">每列为原始轨迹一步；“原始标注”一行标出 gold 错误步。方法行：红色 error、橙色 uncertain、绿色无错误判断、灰色未评估。点击标注格查看原始标注说明。</p><div id="heatmap"></div><div id="step-detail" class="detail" aria-live="polite">点击一个步骤查看原始动作、标注与诊断判断。</div></section>
<section class="panel"><h2>候选归因到提交</h2><div id="paths" class="grid"></div><p class="mini">接口接受与归因正确分别判断。标注的步骤号来自 report.json，若说明与该步记录不符，请核对步骤对齐。</p></section>
<p class="mini">数据源：cases 命令日志、sessions 局部判断、api_usage.jsonl 和 report.json。</p></main>
<script id="data" type="application/json">"""+payload+"""</script><script>
const D=JSON.parse(document.getElementById('data').textContent), arms=D.display_arms;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const val=(x)=>Number(x).toLocaleString('zh-CN');
document.getElementById('page-title').textContent=arms.length===1?`${arms[0]} 单方案调试轨迹`:'两种调试方法的执行轨迹';
document.title=document.getElementById('page-title').textContent;
document.getElementById('intro').textContent=`轨迹 ${D.trajectory_id}，原始 ${D.original_steps} 步。命令序号表示执行顺序，不表示耗时。点击命令或步骤查看证据。`;
document.getElementById('summary').innerHTML=`<table><thead><tr><th>指标</th>${arms.map(a=>`<th>${a}</th>`).join('')}</tr></thead><tbody>${[
['原始轨迹步数',()=>D.original_steps],['CLI 调用',a=>D.arms[a].command_count],['CLI 失败',a=>D.arms[a].command_failures],['实际 API 调用',a=>D.arms[a].api_calls],['输入 token',a=>val(D.arms[a].prompt_tokens)],['输出 token',a=>val(D.arms[a].completion_tokens)],['估算费用 USD',a=>D.arms[a].usd.toFixed(4)],['提交记录 operator/model calls',a=>(D.arms[a].reported_operator_calls??'—')+'/'+(D.arms[a].reported_model_calls??'—')]
].map(([name,fn])=>`<tr><td>${name}</td>${arms.map(a=>`<td class="num">${fn(a)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const color={map:'var(--blue)',review:'var(--violet)',trace:'var(--green)',final:'var(--orange)'};
const timeline=document.getElementById('timeline');
timeline.innerHTML=arms.map(a=>`<div class="lane"><strong>${a} · ${D.arms[a].command_count} 个命令</strong><div class="timeline">${D.arms[a].commands.map(c=>`<button class="cell ${c.failure?'fail':''} ${c.retry_after_failure?'retry':''}" type="button" style="background:${color[c.phase]}" data-arm="${a}" data-n="${c.n}" aria-label="${a} 命令 ${c.n} ${esc(c.operator)} ${c.failure?'失败':''}${c.retry_after_failure?' 重试':''}" title="#${c.n} ${esc(c.operator)} ${esc(c.arg)}"></button>`).join('')}</div><div class="axis"><span>#1</span><span>#${D.arms[a].command_count}</span></div></div>`).join('');
timeline.addEventListener('click',e=>{let el=e.target.closest('button[data-n]');if(!el)return;document.querySelectorAll('.cell.selected').forEach(x=>x.classList.remove('selected'));el.classList.add('selected');let a=el.dataset.arm,c=D.arms[a].commands[+el.dataset.n-1];document.getElementById('command-detail').innerHTML=`<strong>${a} #${c.n} · ${esc(c.operator)}</strong> <span class="mini">${esc(c.phase)} / exit ${c.exit_code}${c.repeated_view?' / 相同 view 再次调用':''}</span><br>${esc(c.arg||'无参数')}${c.failure?`<br><strong>失败：</strong>${esc(c.failure)}`:''}`});
function bars(id,key){let keys=[...new Set(arms.flatMap(a=>Object.keys(D.arms[a][key])))],max=Math.max(...arms.flatMap(a=>Object.values(D.arms[a][key])));document.getElementById(id).innerHTML=keys.map(k=>`<div><strong>${esc(k)}</strong>${arms.map(a=>{let n=D.arms[a][key][k]||0;return `<div class="barrow"><span>${a}</span><div class="track"><div class="fill" style="width:${n/max*100}%;background:${a==='baseline'?'var(--blue)':'var(--violet)'}"></div></div><span>${n}</span></div>`}).join('')}</div>`).join('')};bars('operators','operators');bars('phases','phases');
function severity(row){let s=Object.values(row.modules).map(x=>x.status);return s.includes('error')?'error':s.includes('uncertain')?'uncertain':s.every(x=>x==='not_assessed')?'unassessed':s.every(x=>x==='not_applicable')?'na':'correct'}
const heat=document.getElementById('heatmap'),style=`style="--steps:${D.original_steps}"`;
heat.innerHTML=`<div class="heat" ${style}><span></span>${Array.from({length:D.original_steps},(_,i)=>`<span class="mini" style="text-align:center">${(i+1)===D.gold.step||(i+1)===1||(i+1)===D.original_steps||(i+1)%5===0?i+1:''}</span>`).join('')}</div>`
+`<div class="heat" ${style}><strong>原始动作</strong>${D.original_actions.map(o=>`<button class="step orig-${esc(o.action_kind)} ${o.step===D.gold.step?'gold':''}" type="button" data-step="${o.step}" aria-label="原始步骤 ${o.step} ${esc(o.action_kind)}" title="第 ${o.step} 步：${esc(o.action_kind)}">${o.step}</button>`).join('')}</div>`
+`<div class="heat" ${style}><strong>原始标注</strong>${D.original_actions.map(o=>o.step===D.gold.step?`<button class="step annotation" type="button" data-step="${o.step}" aria-label="标注错误步 ${o.step} ${esc(D.gold.module)} ${esc(D.gold.types.join(','))}">★</button>`:'<span class="step annotation-empty" aria-hidden="true"></span>').join('')}</div>`
+arms.map(a=>`<div class="heat" ${style}><strong>${a}</strong>${D.arms[a].assessments.map(r=>`<button class="step ${severity(r)} ${r.step===D.gold.step?'gold':''}" type="button" data-step="${r.step}" aria-label="${a} 原始步骤 ${r.step} ${severity(r)}" title="${a} 第 ${r.step} 步：${severity(r)}">${r.step}</button>`).join('')}</div>`).join('');
heat.addEventListener('click',e=>{let el=e.target.closest('button[data-step]');if(!el)return;document.querySelectorAll('.step.selected').forEach(x=>x.classList.remove('selected'));document.querySelectorAll(`.step[data-step="${el.dataset.step}"]`).forEach(x=>x.classList.add('selected'));let n=+el.dataset.step,o=D.original_actions[n-1];document.getElementById('step-detail').innerHTML=`<strong>原始步骤 ${n}：${esc(o.action_kind)} · fid ${o.fid??'—'}</strong> <span class="mini">意图：${esc(o.recorded_intention_verb??'—')}；动作来源：${esc(o.source_arm??'—')} 命令 #${o.source_command??'—'}</span><br>${esc(o.action||'动作文本缺失')}${n===D.gold.step?`<p><strong>原始错误标注：</strong>${esc(D.gold.module)} / ${esc(D.gold.types.join(', '))}。${esc(D.gold.reasoning)} <span class="mini">来源：report.json → per_case → gold</span></p>`:''}<div class="grid">${arms.map(a=>{let r=D.arms[a].assessments[n-1];return `<div><strong>${a}</strong><br>${Object.entries(r.modules).filter(([m,v])=>v.status==='error'||v.status==='uncertain').map(([m,v])=>`${esc(m)}：${esc(v.status)}，fid ${v.fid??'—'}，${esc(v.fault_class??'')}`).join('<br>')||'无 error/uncertain 判断'}</div>`}).join('')}</div>`});
document.getElementById('paths').innerHTML=arms.map(a=>{let d=D.arms[a],p=d.protocol,s=d.selected;let evidence=d.commands.filter(c=>['global','hold','contrast','check','submit'].includes(c.operator)).map(c=>`${c.operator} #${c.n}`).join(' → ');return `<div><h3>${a}</h3><div class="path"><div class="node"><strong>局部评估</strong>${d.assessed_steps}/${D.original_steps} 步；${d.assessment_statuses.error||0} 个 error</div><span class="arrow">→</span><div class="node"><strong>候选比较</strong>${p.contrast_fids.length?'fid '+esc(p.contrast_fids.join(', ')):'尚无记录'}</div><span class="arrow">→</span><div class="node"><strong>提交</strong>${s.step==null?'尚未提交':`第 ${s.step} 步 ${esc(s.module)}<br>fid ${s.fid}`}</div></div><p class="mini">证据命令：${esc(evidence||'尚无')}。check=${esc(p.check_verdict??'未记录')}。</p></div>`}).join('');
</script></body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--trajectory-id", help="Case ID; defaults to the first trajectory in the manifest")
    args = parser.parse_args()
    run_dir = args.run_dir.resolve()
    data = run_analysis(run_dir, args.trajectory_id)
    output = run_dir / "analysis" if data["manifest"]["sample_size"] == 1 else run_dir / "analysis" / data["trajectory_id"]
    output.mkdir(parents=True, exist_ok=True)
    (output / "metrics.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "analysis.md").write_text(concise_markdown(data), encoding="utf-8")
    (output / "trajectory_dashboard.html").write_text(dashboard(data), encoding="utf-8")
    for arm in ARMS:
        (output / f"{arm}_debug.html").write_text(dashboard(data, (arm,)), encoding="utf-8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
