"use strict";

const $ = (id) => document.getElementById(id);
const state = { traces: [], overview: null, trace: null, goal: null, step: null,
  detail: null, history: [], request: 0, domain: "all" };
const statusText = { satisfied: "已满足", unmet: "未满足", unresolved: "未判定",
  sat: "支持", viol: "冲突", unk: "未知", observed: "已观察", missing: "未观察",
  full: "完整绑定", verb_only: "仅动作绑定", unbound: "未绑定", absent: "无意图",
  tracked: "可追踪", unmodeled: "未建模", well_formed: "合法" };
const signalText = { invalid_action: "动作无效", alignment_violation: "计划动作不一致",
  unbound_intention: "意图未绑定", failed_precondition: "前提不成立", missing_effect: "预期效果缺失",
  no_effect: "未见效果", state_change: "状态变化", task_state_change: "目标状态变化",
  new_task_evidence: "新增目标证据", no_new_task_evidence: "无新增目标证据",
  repeated_action: "重复动作", near_duplicate_action: "近似重复", schema_repetition: "模式重复",
  claims_task_complete: "声称完成", contradicted_completion: "完成声明矛盾", commit: "提交",
  terminal_cutoff: "轨迹结束", task_decision: "目标判断", wrong_task_decision: "未满足判断",
  satisfying_task_decision: "满足判断", constraint_substitution: "约束替换" };
const h = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shown = (value) => value === null || value === undefined || value === "" ? "未记录" :
  typeof value === "object" ? JSON.stringify(value) : String(value);
const text = (value) => h(shown(value));
const badge = (value) => `<span class="status ${h(value || "neutral")}">${h(statusText[value] || value || "未记录")}</span>`;
const entityLink = (value) => value ? `<button type="button" class="chip" data-entity="${h(value)}">${h(value)}</button>` : '<span class="muted">未记录</span>';
const factLink = (fid, label) => Number.isInteger(fid) ? `<button type="button" class="fact-id" data-fid="${fid}">${h(label || `#${fid}`)}</button>` : '<span class="muted">未记录</span>';
const chips = (values) => values?.length ? `<div class="chips">${values.map(entityLink).join("")}</div>` : '<span class="muted">未记录</span>';
const section = (title, body) => `<section class="detail-section"><h3>${h(title)}</h3>${body}</section>`;
const source = (label, value, large = false) => `<div class="source-block ${large ? "large" : ""}"><div class="label">${h(label)}</div><p>${text(value)}</p></div>`;
const field = (label, value) => `<div class="info-cell"><span class="label">${h(label)}</span><span class="value">${value}</span></div>`;
const pair = (label, value) => `<div class="kv-row"><span>${h(label)}</span><span>${value}</span></div>`;
const toUrl = (...parts) => parts.map((part) => encodeURIComponent(part)).join("/");

async function getJson(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}
function setError(target, message, retry) {
  $(target).innerHTML = `<div class="error-box">${h(message)}${retry ? '<br><button type="button" data-action="retry">重试</button>' : ""}</div>`;
}
function metric(label, value, tone = "") {
  return `<div class="metric"><div class="metric-label">${h(label)}</div><div class="metric-value ${tone}">${h(value)}</div></div>`;
}
function renderPicker() {
  const options = state.traces.filter((x) => state.domain === "all" || x.domain === state.domain);
  $("trace-select").innerHTML = options.length ? options.map((x) =>
    `<option value="${h(x.id)}">${h(x.id)}</option>`).join("") : '<option value="">没有可用轨迹</option>';
  if (options.some((x) => x.id === state.trace)) $("trace-select").value = state.trace;
  $("picker-meta").textContent = `${options.length} 条可用轨迹 · 仅 WebShop / ALFWorld`;
  return options;
}
function clearPage(message = "选择轨迹以开始") {
  $("summary").innerHTML = "";
  $("goal-list").innerHTML = "";
  $("timeline").innerHTML = `<div class="loading">${h(message)}</div>`;
  $("contract").innerHTML = "";
  $("goal-count").textContent = "0";
  $("step-count").textContent = "0";
  $("detail").innerHTML = '<div class="empty"><span class="empty-icon">⌁</span><strong>选择目标或步骤</strong><p>详细证据将在这里展开。</p></div>';
  $("detail-title").textContent = "证据详情";
}
async function loadTraces() {
  try {
    const data = await getJson("/api/traces");
    state.traces = data.traces;
    const options = renderPicker();
    if (!options.length) { clearPage("没有可用的 WebShop 或 ALFWorld 轨迹。"); return; }
    const saved = new URLSearchParams(location.search).get("trace");
    await selectTrace(options.find((x) => x.id === saved)?.id || options[0].id);
  } catch (error) {
    clearPage();
    setError("timeline", error.message, true);
    $("trace-select").innerHTML = '<option>加载失败</option>';
  }
}
async function selectTrace(tid) {
  if (!tid) return;
  state.trace = tid; state.goal = null; state.step = null; state.detail = null; state.history = [];
  state.overview = null; state.request++;
  $("trace-select").value = tid;
  clearPage("正在编译轨迹并读取证据…");
  const current = state.request;
  try {
    const overview = await getJson(`/api/traces/${toUrl(tid)}`);
    if (current !== state.request) return;
    state.overview = overview;
    history.replaceState(null, "", `?trace=${encodeURIComponent(tid)}`);
    renderOverview();
    if (overview.steps.length) await showStep(overview.steps[0].step, false);
  } catch (error) {
    if (current === state.request) setError("timeline", error.message, true);
  }
}
function renderOverview() {
  const o = state.overview;
  const satisfied = o.goals.filter((g) => g.status.state === "satisfied").length;
  const unresolved = o.goals.filter((g) => g.status.state === "unresolved").length;
  $("summary").innerHTML = metric("轨迹步骤", o.steps.length) + metric("目标要求", o.goals.length) +
    metric("记录满足", satisfied, "teal") + metric("尚无法判定", unresolved, "amber");
  $("goal-count").textContent = String(o.goals.length);
  $("step-count").textContent = String(o.steps.length);
  $("contract").innerHTML = `<div class="label">TASK CONTRACT / 任务原文</div><p>${text(o.task_contract.verbatim)}</p>` +
    `<span class="small-note">结构化覆盖：${h(o.task_contract.coverage)} · 以原文为准</span>`;
  renderGoals(); renderTimeline();
}
function goalName(g) { return g.entity.id.replace(/^req:/, "").replaceAll("_", " "); }
function constraintLabel(c) { return `${c.attribute} ${c.operator} ${shown(c.expected)}`; }
function renderGoals() {
  const o = state.overview; if (!o) return;
  $("clear-goal").hidden = !state.goal;
  $("goal-list").innerHTML = o.goals.map((g) => {
    const id = g.entity.id;
    const constraints = (g.definition.constraints || []).map(constraintLabel).join(" · ");
    return `<button type="button" class="goal-card ${state.goal === id ? "active" : ""}" data-goal="${h(id)}" aria-pressed="${state.goal === id}">
      <div class="goal-top"><span class="goal-name">${h(goalName(g))}</span>${badge(g.status.state)}</div>
      <div class="goal-desc">${h(constraints || `${g.definition.relation} → ${g.definition.target || "任务"}`)}</div>
      <div class="goal-meta"><span>${h(g.definition.status_mode === "tracked" ? "可追踪" : "未建模")}</span><span>·</span><span>${g.related_steps.length} 个直接关联步骤</span></div>
    </button>`;
  }).join("") || '<div class="loading">未提取到结构化目标。请以任务原文为准。</div>';
}
function signal(s) {
  const alert = /invalid|violation|failed|missing|no_effect|repeated|duplicate|substitution|contradicted|wrong/.test(s);
  return `<span class="signal ${alert ? "alert" : ""}">${h(signalText[s] || s)}</span>`;
}
function renderTimeline() {
  const o = state.overview; if (!o) return;
  const previousScroll = $("timeline").scrollTop;
  const related = state.goal ? new Set(o.goals.find((g) => g.entity.id === state.goal)?.related_steps || []) : null;
  $("timeline-intro").textContent = state.goal ?
    `正在聚焦 ${state.goal}：突出 ${related.size} 个直接证据或明确提及步骤。状态与信号仅供查看，不指认根因。` :
    "选择一个目标可突出相关步骤；点击步骤查看当时的计划与证据。";
  $("timeline").innerHTML = o.steps.map((s) => {
    const active = state.step === s.step;
    const isRelated = related?.has(s.step);
    const action = s.action?.text || "本步未记录动作";
    const plan = s.plan?.text || "未记录计划";
    return `<button type="button" class="step-card ${active ? "active" : ""} ${related ? (isRelated ? "related" : "dim") : ""}" data-step="${s.step}" aria-pressed="${active}">
      <div class="step-top"><span class="step-no">STEP ${String(s.step).padStart(2, "0")}</span><span class="small">${s.outcome?.new_task_evidence ? "新增目标证据" : ""}</span></div>
      <div class="step-action">${h(action)}</div><div class="step-plan">计划：${h(plan)}</div>
      ${s.signals?.length ? `<div class="signal-list">${s.signals.slice(0, 3).map(signal).join("")}${s.signals.length > 3 ? `<span class="signal">+${s.signals.length - 3}</span>` : ""}</div>` : ""}
    </button>`;
  }).join("") || '<div class="loading">这条轨迹没有步骤。</div>';
  $("timeline").scrollTop = previousScroll;
}
function showDetailTop() {
  $("detail").scrollTop = 0;
  if (window.matchMedia("(max-width: 760px)").matches) {
    $("detail-panel").scrollIntoView({ behavior: "auto", block: "start" });
  }
}
function navigate(detail, push = true) {
  if (push && state.detail) state.history.push(state.detail);
  state.detail = detail;
  $("detail-back").hidden = !state.history.length;
  if (detail.type === "step") return showStep(detail.id, false);
  if (detail.type === "entity") return showEntity(detail.id, false);
  if (detail.type === "fact") return showFact(detail.id, false);
}
async function showStep(number, push = true) {
  if (push) return navigate({ type: "step", id: number });
  state.step = number; state.detail = { type: "step", id: number };
  renderTimeline();
  $("detail-title").textContent = `步骤 ${number}`;
  $("detail").innerHTML = '<div class="loading">正在读取步骤与意图…</div>';
  const request = ++state.request;
  try {
    const data = await getJson(`/api/traces/${toUrl(state.trace)}/steps/${number}`);
    if (request !== state.request) return;
    $("detail").innerHTML = renderStepDetail(data);
    showDetailTop();
  } catch (error) { if (request === state.request) setError("detail", error.message, true); }
}
async function showEntity(id, push = true) {
  if (push) return navigate({ type: "entity", id });
  state.detail = { type: "entity", id };
  $("detail-title").textContent = "实体详情";
  $("detail").innerHTML = '<div class="loading">正在读取关联证据…</div>';
  const request = ++state.request;
  const colon = id.indexOf(":");
  if (colon < 1) { setError("detail", "无效实体 ID", false); return; }
  const kind = id.slice(0, colon), index = id.slice(colon + 1);
  try {
    const data = await getJson(`/api/traces/${toUrl(state.trace)}/entities/${toUrl(kind, index)}`);
    if (request !== state.request) return;
    $("detail-title").textContent = kind === "req" ? "目标详情" : kind === "int" ? "意图详情" : "实体详情";
    $("detail").innerHTML = renderEntityDetail(data);
    showDetailTop();
  } catch (error) { if (request === state.request) setError("detail", error.message, true); }
}
async function showFact(fid, push = true) {
  if (push) return navigate({ type: "fact", id: fid });
  state.detail = { type: "fact", id: fid };
  $("detail-title").textContent = `事实 #${fid}`;
  $("detail").innerHTML = '<div class="loading">正在读取事实与依据…</div>';
  const request = ++state.request;
  try {
    const data = await getJson(`/api/traces/${toUrl(state.trace)}/facts/${fid}`);
    if (request !== state.request) return;
    $("detail").innerHTML = renderFactDetail(data);
    showDetailTop();
  } catch (error) { if (request === state.request) setError("detail", error.message, true); }
}
function factRow(f) {
  return `<div class="fact-row"><div class="fact-row-head"><span>${factLink(f.fid)} <strong>${h(f.relation || "")}</strong></span>${f.support?.verdict ? badge(f.support.verdict) : ""}</div>
    <p>${h(f.span || shown(f.value))}</p></div>`;
}
function factRows(rows) {
  return rows?.length ? rows.map(factRow).join("") : '<p class="small">未记录关联事实。</p>';
}
function renderStepDetail(d) {
  const e = d.episode, row = d.intention_row, intent = row?.intention;
  const modules = d.source.modules || {};
  const action = e.at.action;
  const validation = row?.validation || {};
  const alignment = validation.plan_action_alignment || {};
  const moduleFacts = Object.values(e.at.modules || {}).flat();
  const allFacts = [...moduleFacts, ...(e.after.observation || []), ...(e.after.task_decisions || [])];
  const unique = [...new Map(allFacts.map((f) => [f.fid, f])).values()];
  const info = `<div class="info-grid">${field("意图绑定", badge(intent?.binding))}${field("承诺级别", text(intent?.commitment))}${field("动作合法性", badge(row?.admissibility))}${field("计划 / 动作", badge(alignment.verdict))}</div>`;
  const intentBody = intent ? `${info}${pair("意图", entityLink(intent.entity))}${pair("动作 / 对象", `${text(intent.verb)} ${chips(intent.objects)}`)}
    ${pair("服务目标", chips(intent.serves))}${pair("父意图 / 目标", entityLink(intent.recorded_parent))}
    ${source("计划原文", row.plan?.span)}${source("实际动作", row.action?.span)}
    ${validation.plan_action_alignment?.reason ? `<p class="small">对齐判断：${h(validation.plan_action_alignment.reason)}</p>` : ""}` :
    `<div class="detail-note">本步没有解析出的意图。${row?.absence_note ? h(row.absence_note) : ""}</div>${source("计划原文", row?.plan?.span)}${source("实际动作", row?.action?.span)}`;
  const validations = [
    ...(validation.preconditions || []).map((x) => pair(`前提 · ${shown(x.name)}`, badge(x.status))),
    ...(validation.expected_effects || []).map((x) => pair(`效果 · ${shown(x.name)}`, badge(x.status))),
    ...(validation.constraint_bindings || []).map((x) => pair(`约束 · ${shown(x.requirement)}`, `${badge(x.relation)} ${entityLink(x.requirement)}`)),
  ].join("");
  return `<div class="detail-kicker">STEP ${String(d.step).padStart(2, "0")} / ${h(state.overview.domain)}</div>
    <h2 class="detail-heading">${h(action?.span || "未记录动作")}</h2>
    <p class="detail-subtitle">本步信号：${e.signals?.length ? e.signals.map((x) => h(signalText[x] || x)).join(" · ") : "无"}。信号是检索线索，不是根因判断。</p>
    ${section("意图与执行", intentBody)}
    ${validations ? section("前提、效果与约束", validations) : ""}
    ${section("输入与四模块原文", source("环境观察", d.source.observation, true) +
      ["memory", "reflection", "plan", "action"].map((key) => source(({memory:"Memory",reflection:"Reflection",plan:"Plan",action:"Action"})[key], modules[key])).join(""))}
    ${section(`本步与后续观察中的事实 (${unique.length})`, factRows(unique))}
    ${e.after.changes?.length ? section("后续状态变化", e.after.changes.map((x) => pair(`第 ${x.step} 步 · ${x.relation}`, `${text(x.from)} → ${text(x.to)} · ${factLink(x.fid)}`)).join("")) : ""}`;
}
function renderGoalEvidence(rows) {
  if (!rows?.length) return '<p class="small">暂无相关证据。</p>';
  return rows.map((event) => {
    const values = event.values || [];
    const refs = values.map((x) => ({ fid: x.fid, span: x.span, relation: x.relation }));
    if (event.fact) refs.push(event.fact);
    return `<div class="source-block"><div class="label">第 ${h(event.step)} 步 · ${h(event.event || "证据")}</div>
      ${refs.length ? refs.map(factRow).join("") : '<p>无事实 ID</p>'}</div>`;
  }).join("");
}
function renderEntityDetail(d) {
  const id = d.entity?.id || "未知实体";
  if (d.entity?.kind === "requirement") {
    const def = d.definition, status = d.status;
    const constraints = (def.constraints || []).map((c) => `<div class="source-block"><div class="label">${h(c.attribute)} · ${h(c.mode)}</div>
      <p>${h(c.operator)} ${text(c.expected)} ${c.unit ? h(c.unit) : ""}</p>${c.source_span ? `<p class="small">任务片段：${h(c.source_span)}</p>` : ""}</div>`).join("");
    return `<div class="detail-kicker">GOAL / ${h(id)}</div><h2 class="detail-heading">${h(id.replace(/^req:/, "").replaceAll("_", " "))}</h2>
      <p class="detail-subtitle">记录状态 ${badge(status.state)} · ${badge(def.status_mode)}</p>
      <div class="info-grid">${field("关系", text(def.relation))}${field("目标对象", entityLink(def.target))}${field("记录满足", `${status.recorded_met} / ${status.required_count}`)}${field("关联步骤", text([...new Set([...status.qualifying_steps, ...status.decision_steps])].join(", ") || "未记录"))}</div>
      <div class="detail-note">${h(status.reason)}。${h((status.limitations || []).join(" "))}</div>
      ${section("类型化约束", constraints || '<p class="small">没有额外约束。</p>')}
      ${section(`相关证据 (${d.evidence?.length || 0} 组)`, renderGoalEvidence(d.evidence))}
      ${d.intentions?.length ? section("关联意图", d.intentions.map((row) => `<div class="fact-row">第 ${row.step} 步 · ${entityLink(row.intention?.entity)} · ${text(row.intention?.verb)}</div>`).join("")) : ""}`;
  }
  if (d.entity?.kind === "intention") {
    const i = d.definition || {}, row = d.execution || {};
    const v = row.validation || {};
    return `<div class="detail-kicker">INTENTION / ${h(id)}</div><h2 class="detail-heading">${h(i.verb || "未绑定动作")}</h2>
      <p class="detail-subtitle">${badge(i.binding)} ${badge(i.commitment)} · 第 ${h(row.step)} 步</p>
      ${section("结构", pair("对象", chips(i.objects)) + pair("服务目标", chips(i.serves)) + pair("父节点", entityLink(i.recorded_parent)) + pair("前提", text(i.preconditions?.join(" · "))) + pair("预期效果", text(i.expected_effects?.join(" · "))))}
      ${section("计划与执行", source("计划", row.plan?.span) + source("动作", row.action?.span) + pair("对齐", badge(v.plan_action_alignment?.verdict)))}
      ${section("关联事实", factRows(d.evidence))}`;
  }
  const related = d.intentions || [];
  return `<div class="detail-kicker">ENTITY / ${h(d.entity?.kind)}</div><h2 class="detail-heading">${h(id)}</h2>
    <p class="detail-subtitle">${d.evidence?.length || 0} 条关联事实 · ${related.length} 个关联意图</p>
    ${d.assignments ? section("属性赋值", Object.entries(d.assignments).map(([name, rows]) =>
      `<div class="source-block"><div class="label">${h(name)}</div>${rows.map((x) => pair(`第 ${x.step} 步`, `${text(x.value)} · ${factLink(x.fid)}`)).join("")}</div>`).join("")) : ""}
    ${related.length ? section("关联意图", related.map((row) => `<div class="fact-row">第 ${row.step} 步 · ${entityLink(row.intention?.entity)} · ${text(row.intention?.verb)}</div>`).join("")) : ""}
    ${section("关联事实", factRows(d.evidence))}`;
}
function renderFactDetail(d) {
  const f = d.fact;
  return `<div class="detail-kicker">FACT / ${h(f.slot)} · ${h(f.side)}</div><h2 class="detail-heading">#${f.fid} ${h(f.relation)}</h2>
    <p class="detail-subtitle">第 <button type="button" class="inline-link" data-step="${f.step}">${f.step}</button> 步 · ${f.support?.verdict ? badge(f.support.verdict) : "环境或任务事实"}</p>
    <div class="info-grid">${field("关系", text(f.relation))}${field("取值", text(f.value))}${field("来源", text(`${f.side} / ${f.slot}`))}${field("值类型", text(f.value_type))}</div>
    ${section("原文", source("SOURCE SPAN", f.span, true))}
    ${section("实体与目的", pair("参数实体", chips(f.arguments)) + pair("目的", entityLink(f.purpose)))}
    ${f.support ? section("局部支持判断", `<div class="detail-note">${h(f.support.reason)}</div>` + pair("引用事实", f.support.cites?.length ? f.support.cites.map((id) => factLink(id)).join(" · ") : "未记录")) : ""}
    ${section(`依赖事实 (${d.basis_facts.length})`, factRows(d.basis_facts))}`;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button"); if (!button) return;
  if (button.dataset.goal) {
    state.goal = state.goal === button.dataset.goal ? null : button.dataset.goal;
    renderGoals(); renderTimeline();
    if (state.goal) navigate({ type: "entity", id: state.goal });
    return;
  }
  if (button.dataset.step) { navigate({ type: "step", id: Number(button.dataset.step) }); return; }
  if (button.dataset.entity) { navigate({ type: "entity", id: button.dataset.entity }); return; }
  if (button.dataset.fid) { navigate({ type: "fact", id: Number(button.dataset.fid) }); return; }
  if (button.dataset.action === "clear-goal") { state.goal = null; renderGoals(); renderTimeline(); return; }
  if (button.dataset.action === "back") { const previous = state.history.pop(); $("detail-back").hidden = !state.history.length; if (previous) navigate(previous, false); return; }
  if (button.dataset.action === "retry") {
    if (!state.traces.length) loadTraces();
    else if (!state.overview) selectTrace(state.trace);
    else if (state.detail) navigate(state.detail, false);
  }
});
$("domain-select").addEventListener("change", (event) => {
  state.domain = event.target.value;
  const options = renderPicker();
  if (options.length && !options.some((x) => x.id === state.trace)) selectTrace(options[0].id);
  else if (!options.length) { state.trace = null; state.overview = null; clearPage("当前领域没有可用轨迹。"); }
});
$("trace-select").addEventListener("change", (event) => selectTrace(event.target.value));
loadTraces();
