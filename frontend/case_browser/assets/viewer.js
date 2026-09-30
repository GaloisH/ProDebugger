"use strict";

const NAV = JSON.parse(document.getElementById("nav-data").textContent);
const CASE = JSON.parse(document.getElementById("case-data").textContent);
const CURRENT = JSON.parse(document.getElementById("current-id").textContent);
const ARMS = ["baseline", "four_stage"];
const GOLD = Number(CASE.gold.critical_step);
const state = {
  event: { kind: "original", arm: null, index: Number.isInteger(GOLD) && GOLD >= 1 && GOLD <= CASE.original.length ? GOLD - 1 : 0 },
  selectedOriginalStep: Number.isInteger(GOLD) && GOLD >= 1 && GOLD <= CASE.original.length ? GOLD : 1,
  tab: "summary",
  runFilter: CASE.run,
  search: "",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function pretty(value) { return JSON.stringify(value, null, 2); }
function short(value, limit = 190) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit) + "…" : text;
}
function badge(text, kind = "") { return `<span class="tag ${kind}">${escapeHtml(text)}</span>`; }
function section(title, body) {
  return `<section class="section expandable"><div class="section-head"><h3>${escapeHtml(title)}</h3>
    <button class="section-toggle" type="button" aria-expanded="false">展开</button></div>
    <div class="section-body">${body}</div></section>`;
}
function paragraph(value) { return `<p>${escapeHtml(value ?? "无记录")}</p>`; }
function armLabel(arm) { return arm === "four_stage" ? "Four stage" : "Baseline"; }
function phaseKind(label) {
  const name = String(label || "").toLowerCase();
  if (name.startsWith("map")) return "map";
  if (name.startsWith("review")) return "review";
  if (name.startsWith("trace")) return "trace";
  if (name.startsWith("repair")) return "repair";
  if (name.startsWith("revise")) return "revise";
  if (name.startsWith("final")) return "final";
  return "other";
}
function armStatus(arm) {
  const data = CASE.arms[arm];
  if (!data) return badge(`${armLabel(arm)} 缺失`);
  if (data.submission?.accepted) return badge(`${armLabel(arm)} 已提交`, "ok");
  return badge(`${armLabel(arm)} 未提交`, "warn");
}

document.getElementById("app").innerHTML = `
<div class="shell">
  <aside class="sidebar">
    <div class="brand">Run Navigator</div>
    <div class="hint">离线浏览所有实验与 case</div>
    <label class="minor" for="run-select">实验运行</label>
    <select class="control" id="run-select"></select>
    <input class="control" id="case-search" type="search" placeholder="搜索轨迹 ID / 模型…" aria-label="搜索案例">
    <div class="minor" id="case-count"></div>
    <nav class="case-list" id="case-list" aria-label="案例列表"></nav>
  </aside>
  <main class="event-panel">
    <div class="panel-top" id="event-header"></div>
    <div class="tabs" role="tablist" aria-label="事件内容">
      <button id="tab-summary" class="active" type="button" role="tab" aria-selected="true">摘要与结构</button>
      <button id="tab-raw" type="button" role="tab" aria-selected="false">完整内容</button>
    </div>
    <div class="event-content" id="event-content" aria-live="polite"></div>
  </main>
  <aside class="inspector" id="inspector" aria-label="归因与局部判断"></aside>
  <section class="timeline-panel">
    <div class="timeline-head"><h2>轨迹与局部判断</h2><div class="timeline-meta" id="timeline-meta"></div></div>
    <div class="lanes" id="lanes"></div>
    <div class="legend"><span><b>★</b> 人工标注</span><span><b class="legend-error">X</b>：CLI 非零退出</span>
      <span><b class="legend-retry">↻</b>：失败后重试</span><span class="legend-map">MAP</span>
      <span class="legend-review">REVIEW</span><span class="legend-trace">TRACE</span>
      <span class="legend-repair">REPAIR</span><span class="legend-revise">REVISE / FINAL</span></div>
  </section>
  <section class="attribution-panel" id="attribution-panel" aria-label="归因过程与结论"></section>
</div>`;

const runSelect = document.getElementById("run-select");
const searchInput = document.getElementById("case-search");
const caseList = document.getElementById("case-list");
const lanes = document.getElementById("lanes");
const eventHeader = document.getElementById("event-header");
const eventContent = document.getElementById("event-content");
const inspector = document.getElementById("inspector");
const attributionPanel = document.getElementById("attribution-panel");

function renderRunSelect() {
  runSelect.innerHTML = `<option value="*">全部实验</option>` + NAV.runs.map(run =>
    `<option value="${escapeHtml(run)}" ${run === state.runFilter ? "selected" : ""}>${escapeHtml(run)}</option>`
  ).join("");
}
function caseState(item) {
  const present = ARMS.filter(arm => item.arms[arm]?.present).length;
  const submitted = ARMS.filter(arm => item.arms[arm]?.submitted).length;
  return submitted === 2 ? ["双方案完成", "ok"] : submitted ? ["部分完成", "warn"] : present ? ["未提交", "bad"] : ["无数据", "bad"];
}
function renderCases() {
  const search = state.search.toLowerCase();
  const visible = NAV.cases.filter(item =>
    (state.runFilter === "*" || item.run === state.runFilter) &&
    `${item.run} ${item.tid} ${item.llm_model} ${item.task_type}`.toLowerCase().includes(search)
  );
  document.getElementById("case-count").textContent = `显示 ${visible.length} / ${NAV.cases.length} 个 case`;
  if (!visible.length) { caseList.innerHTML = `<div class="empty">没有匹配的 case</div>`; return; }
  let previousRun = null;
  caseList.innerHTML = visible.map(item => {
    const heading = item.run !== previousRun ? `<div class="run-heading">${escapeHtml(item.run)}</div>` : "";
    previousRun = item.run;
    const [status, kind] = caseState(item);
    const commands = ARMS.reduce((sum, arm) => sum + (item.arms[arm]?.commands || 0), 0);
    return `${heading}<a class="case-link" href="${escapeHtml(item.href)}" ${item.id === CURRENT ? 'aria-current="page"' : ""}>
      <span class="case-title" title="${escapeHtml(item.tid)}">${escapeHtml(item.tid)}</span>
      <span class="case-meta">${escapeHtml(item.task_type || "—")} · ${escapeHtml(item.llm_model || "—")} ${badge(status, kind)}</span>
      <span class="case-meta">${commands} 条调试命令 · 标注步 #${escapeHtml(item.gold_step ?? "—")}</span>
    </a>`;
  }).join("");
}
renderRunSelect();
renderCases();
runSelect.addEventListener("change", () => { state.runFilter = runSelect.value; renderCases(); });
searchInput.addEventListener("input", () => { state.search = searchInput.value; renderCases(); });

function node(kind, arm, index, label, classes = "", title = "") {
  const selected = state.event.kind === kind && state.event.arm === arm && state.event.index === index;
  return `<button class="node ${classes} ${selected ? "selected" : ""}" type="button"
    data-kind="${kind}" data-arm="${arm ?? ""}" data-index="${index}"
    title="${escapeHtml(title || label)}" aria-label="${escapeHtml(title || label)}">${escapeHtml(label)}</button>`;
}
function lane(label, events, renderNode) {
  return `<div class="lane"><div class="lane-label">${label}<small>${events.length} 个节点</small></div>
    <div class="lane-scroll">${events.length ? events.map(renderNode).join("") : '<span class="empty">无保存记录</span>'}</div></div>`;
}
function judgementAtStep(arm, step) {
  const row = CASE.arms[arm]?.assessments[String(step)];
  if (!row) return {kind: "missing", findings: []};
  const findings = Object.entries(row).filter(([, value]) => value && typeof value === "object" &&
    (value.status === "error" || value.status === "uncertain"));
  const kind = findings.some(([, value]) => value.status === "error") ? "error"
    : findings.length ? "uncertain" : "clean";
  return {kind, findings};
}
function matrixCell(step, label, className, title) {
  return `<button class="matrix-cell ${className} ${state.selectedOriginalStep === step ? "focused" : ""}" type="button"
    data-kind="original" data-index="${step - 1}" data-step="${step}"
    title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(label)}</button>`;
}
function renderOriginalMatrix() {
  const steps = CASE.original;
  const ticks = steps.map(step => `<span class="matrix-tick">${step.n === 1 || step.n === steps.length || step.n === GOLD || step.n % 5 === 0 ? step.n : ""}</span>`).join("");
  const actions = steps.map(step => matrixCell(step.n, String(step.n),
    `action-${step.action_trace?.kind || "missing"} ${step.n === GOLD ? "gold-step" : ""}`,
    `原始动作 #${step.n}: ${short(step.action_trace?.text || step.modules.action, 120)}`)).join("");
  const gold = steps.map(step => step.annotations?.length || step.n === GOLD
    ? matrixCell(step.n, "★", `gold-marker ${step.n === GOLD ? "gold-step" : ""}`, `人工标注步骤 #${step.n}`)
    : `<span class="matrix-cell marker-blank" aria-hidden="true"></span>`).join("");
  const methods = ARMS.map(arm => {
    const cells = steps.map(step => {
      const judgement = judgementAtStep(arm, step.n);
      return matrixCell(step.n, String(step.n), `judgement-${judgement.kind} ${step.n === GOLD ? "gold-step" : ""}`,
        `${armLabel(arm)} 步骤 #${step.n}: ${judgement.kind}`);
    }).join("");
    return `<div class="matrix-row"><strong class="matrix-label">${escapeHtml(armLabel(arm))}</strong>${cells}</div>`;
  }).join("");
  const width = 105 + steps.length * 39;
  return `<div class="original-matrix"><h3>原始轨迹与局部错误判断</h3>
    <p class="matrix-help">每列对应一个原始步骤；红色 error、橙色 uncertain、绿色无错误判断、灰色未评估。点击方格查看原始动作和两种方法的判断。</p>
    <div class="matrix-scroll"><div class="matrix-grid" style="grid-template-columns:105px repeat(${steps.length},minmax(36px,1fr));min-width:${width}px">
      <div class="matrix-row ticks"><span class="matrix-label"></span>${ticks}</div>
      <div class="matrix-row"><strong class="matrix-label">原始动作</strong>${actions}</div>
      <div class="matrix-row"><strong class="matrix-label">原始标注</strong>${gold}</div>
      ${methods}</div></div><div class="step-detail" id="step-detail"></div></div>`;
}
function renderStepDetail() {
  const target = document.getElementById("step-detail");
  if (!target) return;
  const step = CASE.original[state.selectedOriginalStep - 1];
  if (!step) return;
  const trace = step.action_trace || {};
  let body = `<div class="step-detail-title">原始步骤 ${step.n} · ${escapeHtml(trace.kind || "missing")}
    ${trace.fid != null ? `· fid ${escapeHtml(trace.fid)}` : ""}</div>
    <div class="step-action">${escapeHtml(trace.text || step.modules.action || "未记录 action")}</div>`;
  if (trace.source_command) body += `<div class="minor">动作 fid 来源：${escapeHtml(armLabel(trace.source_arm))} CLI #${trace.source_command}</div>`;
  if (step.annotations?.length) body += `<div class="step-gold">人工标注：${escapeHtml(short(pretty(step.annotations), 350))}</div>`;
  body += `<div class="step-judgements">${ARMS.map(arm => {
    const {kind, findings} = judgementAtStep(arm, step.n);
    const detail = kind === "missing" ? "未评估" : findings.length ? findings.map(([module, item]) =>
      `${module}: ${item.status}${item.primary_fid != null ? ` · fid ${item.primary_fid}` : ""}${item.fault_class ? ` · ${item.fault_class}` : ""}${item.reasoning ? ` — ${short(item.reasoning, 200)}` : ""}`).join("\n") : "无 error/uncertain 判断";
    return `<div><strong>${escapeHtml(armLabel(arm))}</strong><p>${escapeHtml(detail)}</p></div>`;
  }).join("")}</div>`;
  target.innerHTML = body;
}
function renderTimeline() {
  let output = renderOriginalMatrix();
  for (const arm of ARMS) {
    const data = CASE.arms[arm];
    if (!data) continue;
    output += lane(`${armLabel(arm)} CLI`, data.commands, (command, index) => node(
      "command", arm, index, `#${command.n}`,
      `command phase-${phaseKind(command.phase)} ${command.exit_code !== 0 ? "failed" : ""} ${command.retry_of != null ? "retry" : ""} ${command.operator === "submit" ? "submit" : ""}`,
      `${armLabel(arm)} 命令 #${command.n} · ${command.operator} · ${command.phase} · exit ${command.exit_code}${command.retry_of != null ? ` · 重试失败命令 #${command.retry_of}` : ""}`));
    output += lane(`${armLabel(arm)} 阶段`, data.phase_events, (event, index) => node(
      "phase", arm, index, `${event.label}`, `phase phase-${phaseKind(event.label)}`,
      `${armLabel(arm)} 阶段输出 · ${event.label}`));
  }
  lanes.innerHTML = output;
  renderStepDetail();
  const commands = ARMS.reduce((sum, arm) => sum + (CASE.arms[arm]?.commands.length || 0), 0);
  const failures = ARMS.reduce((sum, arm) => sum + (CASE.arms[arm]?.commands.filter(c => c.exit_code !== 0).length || 0), 0);
  document.getElementById("timeline-meta").textContent = `${CASE.original.length} 原始步 · ${commands} CLI 命令 · ${failures} 次非零退出`;
}
lanes.addEventListener("click", event => {
  const button = event.target.closest("button[data-kind]");
  if (!button) return;
  if (button.dataset.step) {
    state.selectedOriginalStep = Number(button.dataset.step);
    lanes.querySelectorAll(".matrix-cell.focused").forEach(cell => cell.classList.remove("focused"));
    lanes.querySelectorAll(`.matrix-cell[data-step="${state.selectedOriginalStep}"]`).forEach(cell => cell.classList.add("focused"));
    renderStepDetail();
  }
  state.event = {kind: button.dataset.kind, arm: button.dataset.arm || null, index: Number(button.dataset.index)};
  state.tab = "summary";
  document.querySelectorAll(".node.selected").forEach(item => item.classList.remove("selected"));
  button.classList.add("selected");
  renderSelected();
  eventContent.scrollTop = 0;
  inspector.scrollTop = 0;
});

function selectedRecord() {
  const {kind, arm, index} = state.event;
  if (kind === "original") return CASE.original[index];
  if (!CASE.arms[arm]) return null;
  if (kind === "command") return CASE.arms[arm].commands[index];
  return kind === "phase" ? CASE.arms[arm].phase_events[index] : CASE.arms[arm].model_events[index];
}
function rawData() {
  const record = selectedRecord();
  if (state.event.kind === "original") return {
    step: record.n, user_message: record.user_message, agent_message: record.agent_message,
    parsed_modules: record.modules, annotations: record.annotations,
  };
  return record;
}
function originalSummary(step) {
  let html = section("环境观察", paragraph(step.observation || step.user_message));
  for (const module of TAGS) {
    const text = step.modules[module];
    html += section(module[0].toUpperCase() + module.slice(1), paragraph(text || "该模块在原始消息中未单独标记"));
  }
  if (step.annotations?.length) html += section("该步人工标注", `<pre class="raw">${escapeHtml(pretty(step.annotations))}</pre>`);
  return html;
}
const TAGS = ["memory", "reflection", "plan", "action"];
function commandSummary(command) {
  let html = `<div class="kv">${badge(command.phase, `phase-${phaseKind(command.phase)}`)} ${badge(`exit ${command.exit_code}`, command.exit_code ? "bad" : "ok")}
    ${command.retry_of != null ? badge(`重试失败命令 #${command.retry_of}`, "warn") : ""}</div>`;
  html += section("输入参数", `<pre class="raw">${escapeHtml(pretty(command.args))}</pre>`);
  if (command.operator === "assess" && command.args.length > 1) {
    try {
      const assessment = JSON.parse(command.args[1]);
      const rows = TAGS.map(module => {
        const value = assessment[module];
        return value ? `${module}: ${value.status || "?"}${value.fault_class ? ` / ${value.fault_class}` : ""}${value.primary_fid != null ? ` / fid ${value.primary_fid}` : ""}` : null;
      }).filter(Boolean);
      if (rows.length) html += section("局部判断摘要", paragraph(rows.join("\n")));
    } catch (_) { /* Invalid JSON is visible in raw parameters and debugger output. */ }
  }
  const output = command.output;
  const compact = pretty(output);
  html += section(command.exit_code ? "失败返回" : "返回摘要", `<pre class="raw">${escapeHtml(short(compact, 2800))}</pre>`);
  return html;
}
function modelSummary(event) {
  if (event.kind === "assistant") {
    let html = section("助手消息", paragraph(event.content || "本轮未返回可见文本"));
    if (event.reasoning_content) html += section("保存的 reasoning_content", paragraph(event.reasoning_content));
    if (event.tool_calls?.length) html += section("工具调用", `<pre class="raw">${escapeHtml(pretty(event.tool_calls))}</pre>`);
    return html;
  }
  if (event.kind === "user_reminder") return section("提醒", paragraph(event.content));
  return section("阶段输出", `<pre class="raw">${escapeHtml(short(pretty(event.content), 5000))}</pre>`);
}
function relevantStep() {
  if (state.event.kind === "original") return selectedRecord().n;
  if (state.event.kind === "command") {
    const command = selectedRecord();
    if (command.operator === "assess" && command.args.length) {
      const step = Number(command.args[0]);
      if (Number.isInteger(step)) return step;
    }
  }
  return null;
}
function renderHeader() {
  const record = selectedRecord();
  const {kind, arm} = state.event;
  let eyebrow, title, subtitle, tags = "";
  if (kind === "original") {
    eyebrow = "Original trajectory";
    title = `#${record.n} 原始 Agent 步骤`;
    subtitle = "core/data/train.parquet → full_trajectory → messages";
    tags = `${badge(record.n === GOLD ? "关键错误标注" : record.annotations?.length ? "人工标注" : "普通步骤", record.n === GOLD ? "warn" : "")}`;
  } else if (kind === "command") {
    eyebrow = `${armLabel(arm)} · Debug CLI`;
    title = `#${record.n} ${record.operator}`;
    subtitle = CASE.arms[arm].sources.case + ` → commands[${record.n - 1}]`;
    tags = badge(`exit ${record.exit_code}`, record.exit_code ? "bad" : "ok")
      + badge(record.phase, `phase-${phaseKind(record.phase)}`)
      + (record.retry_of != null ? badge(`↻ #${record.retry_of}`, "warn") : "");
  } else {
    eyebrow = `${armLabel(arm)} · ${kind === "phase" ? "Stage output" : "Model event"}`;
    title = `#${record.n} ${record.label}`;
    subtitle = kind === "phase" ? CASE.arms[arm].sources.case + ` → model.${record.label}`
      : (CASE.arms[arm].sources.messages || "未保存消息文件");
    tags = kind === "phase" ? badge(record.kind, `phase-${phaseKind(record.label)}`) : badge(record.kind);
  }
  eventHeader.innerHTML = `<div class="case-context">${escapeHtml(CASE.run)} · ${escapeHtml(CASE.trajectory_id)}</div>
    <div class="case-task">${escapeHtml(CASE.task || "任务描述未提取")}</div>
    <div class="eyebrow">${escapeHtml(eyebrow)}</div><div class="event-title">${escapeHtml(title)}</div>
    <div class="event-sub">${escapeHtml(subtitle)}</div><div class="top-meta">${tags} ${armStatus("baseline")} ${armStatus("four_stage")}</div>`;
}
function renderContent() {
  const record = selectedRecord();
  if (state.tab === "raw") {
    eventContent.innerHTML = `<section class="section"><h3>完整保存内容</h3><pre class="raw" id="raw-content"></pre></section>`;
    document.getElementById("raw-content").textContent = pretty(rawData());
  } else if (state.event.kind === "original") {
    eventContent.innerHTML = originalSummary(record);
  } else if (state.event.kind === "command") {
    eventContent.innerHTML = commandSummary(record);
  } else {
    eventContent.innerHTML = modelSummary(record);
  }
  document.getElementById("tab-summary").classList.toggle("active", state.tab === "summary");
  document.getElementById("tab-raw").classList.toggle("active", state.tab === "raw");
  document.getElementById("tab-summary").setAttribute("aria-selected", String(state.tab === "summary"));
  document.getElementById("tab-raw").setAttribute("aria-selected", String(state.tab === "raw"));
  syncExpanders(eventContent);
}
function syncExpanders(root) {
  root.querySelectorAll(".section.expandable").forEach(card => {
    const body = card.querySelector(".section-body");
    const overflow = body.scrollHeight > body.clientHeight + 2;
    card.classList.toggle("has-overflow", overflow);
    card.querySelector(".section-toggle").hidden = !overflow;
  });
}
for (const root of [eventContent, inspector]) {
  root.addEventListener("click", event => {
    const button = event.target.closest(".section-toggle");
    if (!button || !root.contains(button)) return;
    const card = button.closest(".section.expandable");
    const expanded = card.classList.toggle("expanded");
    button.textContent = expanded ? "收起" : "展开";
    button.setAttribute("aria-expanded", String(expanded));
  });
}
function judgementHtml(arm, step) {
  const data = CASE.arms[arm];
  if (!data) return section(armLabel(arm), paragraph("该方法没有 case 记录"));
  const row = data.assessments[String(step)];
  if (!row) return section(armLabel(arm), paragraph("该步尚未保存局部评估"));
  let body = "";
  for (const module of TAGS) {
    const item = row[module];
    if (!item) continue;
    const status = item.status || "unknown";
    const color = status === "error" ? "status-error" : status === "uncertain" ? "status-uncertain" : status === "correct" ? "status-correct" : "status-none";
    body += `<div class="judgement"><div class="judgement-head"><span>${module} ${item.primary_fid == null ? "" : `· fid ${escapeHtml(item.primary_fid)}`}</span><span class="${color}">${escapeHtml(status)}</span></div>
      ${item.fault_class ? `<div class="minor">${escapeHtml(item.fault_class)}</div>` : ""}
      ${item.reasoning ? `<p class="minor">${escapeHtml(item.reasoning)}</p>` : ""}
      ${(item.evidence_for || []).length ? `<div class="minor">证据 fid：${escapeHtml(item.evidence_for.join(", "))}</div>` : ""}</div>`;
  }
  return section(`${armLabel(arm)} 局部评估`, body || paragraph("无模块判断"));
}
function renderInspector() {
  const step = relevantStep();
  const gold = CASE.gold;
  const annotation = (gold.step_annotations || []).filter(item => item.step === step);
  let body = `<h2>Diagnosis</h2><div class="eyebrow">本 case 统计 · ${CASE.original.length} 个原始步骤</div>`;
  for (const arm of ARMS) {
    const data = CASE.arms[arm];
    if (!data) { body += `<div class="overview-card">${escapeHtml(armLabel(arm))} · 无日志</div>`; continue; }
    const failed = data.commands.filter(command => command.exit_code !== 0).length;
    body += `<div class="overview-card"><strong>${escapeHtml(armLabel(arm))}</strong>
      <span>${data.commands.length} 条 CLI · <em>${failed} 次非零退出</em></span>
      <span>${data.usage.calls} 次 API 调用 · $${Number(data.usage.usd).toFixed(4)}</span>
      <span>${Object.keys(data.assessments).length} 步局部评估 · ${data.submission ? `提交 #${escapeHtml(data.submission.step)}` : "未提交"}</span></div>`;
  }
  const operators = [...new Set(ARMS.flatMap(arm => (CASE.arms[arm]?.commands || []).map(command => command.operator || "unknown")))].sort();
  if (operators.length) {
    const counts = Object.fromEntries(ARMS.map(arm => [arm, Object.fromEntries(operators.map(operator => [operator,
      (CASE.arms[arm]?.commands || []).filter(command => (command.operator || "unknown") === operator).length]))]));
    const maximum = Math.max(1, ...ARMS.flatMap(arm => Object.values(counts[arm])));
    body += `<details class="operator-details"><summary>CLI 操作类型分布</summary>${operators.map(operator =>
      `<div class="operator-row"><b>${escapeHtml(operator)}</b>${ARMS.map(arm =>
        `<div class="operator-bar ${arm}" title="${escapeHtml(armLabel(arm))}: ${counts[arm][operator]}"><i style="width:${100 * counts[arm][operator] / maximum}%"></i><span>${counts[arm][operator]}</span></div>`
      ).join("")}</div>`).join("")}</details>`;
  }
  body += `<div class="eyebrow gold-heading">原始人工标注</div>
    <h2>${escapeHtml((gold.types || []).join(", ") || "未标注类型")}</h2>
    <div class="kv">${badge(`步骤 #${gold.critical_step ?? "—"}`, "warn")}${badge(gold.module || "—")}</div>
    <button class="jump" id="jump-gold" type="button">查看标注错误步 #${escapeHtml(gold.critical_step ?? "—")}</button>
    ${section("标注理由", paragraph((gold.reasonings || []).join("\n") || "未保存理由"))}`;
  if (annotation.length) body += section("该步完整标注", `<pre class="raw">${escapeHtml(pretty(annotation))}</pre>`);
  body += `<h3>调试结论</h3>`;
  for (const arm of ARMS) {
    const data = CASE.arms[arm];
    if (!data) { body += `<p>${armLabel(arm)}：无 case 记录</p>`; continue; }
    const s = data.submission;
    body += `<div class="section"><h3>${armLabel(arm)}</h3>${s ? `<p>第 ${escapeHtml(s.step)} 步 · ${escapeHtml(s.module)} / ${escapeHtml(s.fault_class)} · fid ${escapeHtml(s.fid)}</p>${badge(s.accepted ? "接口接受" : "未接受", s.accepted ? "ok" : "bad")}` : `<p>尚未提交${data.case_error ? `；${escapeHtml(short(data.case_error, 170))}` : ""}</p>`}</div>`;
  }
  if (step != null) {
    body += `<h3>原始步骤 #${step} 的局部评估</h3>`;
    for (const arm of ARMS) body += judgementHtml(arm, step);
  }
  if (state.event.kind === "command") {
    const command = selectedRecord();
    if (command.exit_code !== 0) body += section("该命令失败", `<pre class="raw">${escapeHtml(short(pretty(command.output), 2200))}</pre>`);
  }
  inspector.innerHTML = body;
  syncExpanders(inspector);
  document.getElementById("jump-gold").addEventListener("click", () => {
    if (!Number.isInteger(GOLD) || GOLD < 1 || GOLD > CASE.original.length) return;
    state.event = {kind: "original", arm: null, index: GOLD - 1}; state.tab = "summary";
    state.selectedOriginalStep = GOLD;
    renderTimeline(); renderSelected();
  });
}
function processDetail(title, value, preview = "") {
  const full = typeof value === "string" ? value : pretty(value);
  return `<details class="process-detail"><summary>${escapeHtml(title)}${preview ? `<span>${escapeHtml(short(preview, 130))}</span>` : ""}</summary>
    <pre class="raw">${escapeHtml(full ?? "无保存内容")}</pre></details>`;
}
function commandJump(arm, command) {
  return `<button class="process-jump" type="button" data-process-arm="${arm}" data-process-index="${command.n - 1}">
    ${escapeHtml(command.operator)} #${command.n}${command.exit_code !== 0 ? " · X" : ""}</button>`;
}
function localCandidates(data) {
  const entries = [];
  for (const [step, row] of Object.entries(data.assessments)) {
    for (const [module, value] of Object.entries(row)) {
      if (value && (value.status === "error" || value.status === "uncertain"))
        entries.push({step: Number(step), module, ...value});
    }
  }
  return entries.sort((a, b) => a.step - b.step);
}
function renderAttributionCard(arm) {
  const data = CASE.arms[arm];
  if (!data) return `<article class="attribution-card"><h3>${escapeHtml(armLabel(arm))}</h3><p>该方法没有保存 case 日志。</p></article>`;
  const candidates = localCandidates(data);
  const errors = candidates.filter(item => item.status === "error");
  const evidence = data.commands.filter(item => ["global", "hold", "contrast", "check", "submit"].includes(item.operator));
  const last = operator => [...data.commands].reverse().find(item => item.operator === operator && item.exit_code === 0);
  const global = last("global"), hold = last("hold"), contrast = last("contrast"), check = last("check"), submit = last("submit");
  const ledger = Array.isArray(global?.output?.local_error_ledger) ? global.output.local_error_ledger : [];
  const trace = data.phase_events.find(item => item.label === "trace_propose")?.content;
  const revise = data.phase_events.find(item => item.label === "revise_submit")?.content;
  const assistantTurns = data.model_events.filter(item => item.kind === "assistant");
  const assistant = assistantTurns.filter(item => typeof item.content === "string" && item.content.trim());
  const finalText = assistant.length ? assistant[assistant.length - 1].content : "";
  const submission = data.submission;
  const matchesGold = submission && submission.step === GOLD && submission.module === CASE.gold.module &&
    (CASE.gold.types || []).includes(submission.fault_class);
  const outcome = !submission ? badge("未提交", "warn") : matchesGold ? badge("与标注三项一致", "ok") : badge("与标注三项不一致", "bad");
  const stages = [
    ["局部候选", `${Object.keys(data.assessments).length}/${CASE.original.length} 步评估 · ${errors.length} 项 error · ${candidates.length - errors.length} 项 uncertain`],
    ["全局比较", `${ledger.length} 项全局 ledger · ${Array.isArray(hold?.output) ? hold.output.length : 0} 个保留 fid`],
    ["追溯", trace?.selected_fid != null ? `结构化候选 fid ${trace.selected_fid}` : check?.output?.verdict ? `check: ${check.output.verdict}` : "未保存结构化追溯"],
    ["修订", revise?.revision_1 || revise?.revision_2 ? "保存了修订结论" : "无结构化修订记录"],
    ["提交", submission ? `步骤 ${submission.step} · ${submission.module}/${submission.fault_class} · fid ${submission.fid}` : "未提交"],
  ];
  let html = `<article class="attribution-card"><div class="attribution-card-head"><h3>${escapeHtml(armLabel(arm))}</h3>${outcome}</div>
    <div class="process-path">${stages.map(([title, value]) => `<div class="process-step"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(value)}</span></div>`).join("")}</div>`;
  html += `<div class="process-main"><h4>已记录的归因结论</h4>`;
  if (trace?.harmful_proposition) html += `<p><strong>错误命题：</strong>${escapeHtml(trace.harmful_proposition)}</p>`;
  if (trace?.producer_consumer_chain) html += `<p><strong>传播链：</strong>${escapeHtml(trace.producer_consumer_chain)}</p>`;
  if (trace?.terminal_link) html += `<p><strong>最终失败：</strong>${escapeHtml(trace.terminal_link)}</p>`;
  if (revise?.revision_1) html += `<p><strong>修订 1：</strong>${escapeHtml(short(revise.revision_1, 500))}</p>`;
  if (revise?.revision_2) html += `<p><strong>修订 2：</strong>${escapeHtml(short(revise.revision_2, 500))}</p>`;
  if (!trace && finalText) html += `<p><strong>最后可见的助手结论：</strong>${escapeHtml(finalText)}</p>`;
  if (!trace && !finalText) html += `<p class="minor">没有保存可提取的结构化追溯或助手结论。</p>`;
  if (submit?.args?.[4]) html += `<p><strong>提交理由：</strong>${escapeHtml(submit.args[4])}</p>`;
  if (submission) html += `<p><strong>最终提交：</strong>步骤 ${escapeHtml(submission.step)} · ${escapeHtml(submission.module)}/${escapeHtml(submission.fault_class)} · fid ${escapeHtml(submission.fid)}；接口${submission.accepted ? "接受" : "未接受"}。按当前人工标注，步骤/模块/类型${matchesGold ? "全部一致" : "未全部一致"}。</p>`;
  else html += `<p><strong>最终提交：</strong>无${data.case_error ? `；运行错误：${escapeHtml(short(data.case_error, 300))}` : ""}。</p>`;
  html += `</div><div class="process-evidence"><h4>候选与命令证据</h4>
    <div class="process-links">${evidence.length ? evidence.map(item => commandJump(arm, item)).join("") : "无 global / hold / contrast / check / submit 命令"}</div>`;
  if (ledger.length) html += `<p>全局 ledger：${escapeHtml(ledger.map(item => `#${item.step} ${item.module || item.slot || "?"} fid ${item.primary_fid ?? item.fid ?? "?"}`).join("；"))}</p>`;
  if (Array.isArray(hold?.output)) html += `<p>保留候选 fid：${escapeHtml(hold.output.join(", "))}</p>`;
  if (Array.isArray(contrast?.output?.rows)) html += `<p>比较结果：${escapeHtml(contrast.output.rows.map(item => `fid ${item.fid}: ${item.verdict ?? "?"}`).join("；"))}</p>`;
  if (check?.output?.verdict) html += `<p>最终 check：${escapeHtml(check.output.verdict)}${check.output.reason ? ` · ${escapeHtml(check.output.reason)}` : ""}</p>`;
  html += `</div><div class="process-records"><h4>完整保存记录</h4>`;
  if (candidates.length) html += processDetail(`局部 error/uncertain 判断（${candidates.length} 项）`, candidates);
  if (trace) html += processDetail("结构化 trace_propose", trace, trace.harmful_proposition || "");
  if (revise) html += processDetail("结构化 revise_submit", revise, revise.revision_2 || revise.revision_1 || "");
  if (data.phase_events.length) html += processDetail(`全部阶段输出（${data.phase_events.length} 项）`, data.phase_events.map(item => ({phase: item.label, content: item.content})));
  if (assistantTurns.length) html += processDetail(`全部已保存模型轮次（${assistantTurns.length} 轮）`, assistantTurns);
  if (!candidates.length && !trace && !revise && !data.phase_events.length && !assistantTurns.length) html += `<p class="minor">没有保存过程结论。</p>`;
  return html + `</div></article>`;
}
function renderAttribution() {
  attributionPanel.innerHTML = `<div class="attribution-intro"><h2>归因过程与结论</h2>
    <p>以下内容来自已保存的局部评估、CLI 返回、阶段输出和助手文本；接口接受表示提交通过校验，与人工标注是否一致单独比较。</p>
    <div class="kv">${badge(`人工标注：步骤 #${CASE.gold.critical_step}`, "warn")}${badge(CASE.gold.module || "—")}${badge((CASE.gold.types || []).join(", ") || "未标注类型")}</div></div>
    <div class="attribution-grid">${ARMS.map(renderAttributionCard).join("")}</div>`;
}
attributionPanel.addEventListener("click", event => {
  const button = event.target.closest("button[data-process-index]");
  if (!button) return;
  const arm = button.dataset.processArm;
  const index = Number(button.dataset.processIndex);
  state.event = {kind: "command", arm, index}; state.tab = "summary";
  renderSelected();
  document.querySelectorAll(".node.selected").forEach(item => item.classList.remove("selected"));
  const target = lanes.querySelector(`.node[data-kind="command"][data-arm="${arm}"][data-index="${index}"]`);
  if (target) { target.classList.add("selected"); target.scrollIntoView({block: "nearest", inline: "center"}); }
});
function renderSelected() { renderHeader(); renderContent(); renderInspector(); }
document.getElementById("tab-summary").addEventListener("click", () => { state.tab = "summary"; renderContent(); });
document.getElementById("tab-raw").addEventListener("click", () => { state.tab = "raw"; renderContent(); });

renderTimeline();
renderSelected();
renderAttribution();
