"use strict";
(() => {
  const read = id => JSON.parse(document.getElementById(id).textContent);
  const C = read("case-data"), NAV = read("nav-data"), RUN = read("manifest-data");
  const app = document.getElementById("app");
  const phases = ["MAP", "ROUTE", "TRACE", "SUBMIT"];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
  const pretty = value => JSON.stringify(value ?? null, null, 2);
  const raw = value => `<pre class="raw">${esc(typeof value === "string" ? value : pretty(value))}</pre>`;
  const short = (value, n = 160) => { const s = String(value ?? "").replace(/\s+/g, " "); return s.length > n ? s.slice(0,n) + "…" : s; };
  const tag = (value, kind = "") => `<span class="tag ${esc(kind)}">${esc(value)}</span>`;
  const detail = (title, value, open = false) => `<details ${open ? "open" : ""}><summary>${esc(title)}</summary>${raw(value)}</details>`;
  const section = (title, body) => `<section class="section"><h3>${esc(title)}</h3>${body}</section>`;
  const metric = (label, value) => `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div></div>`;
  const number = v => Number(v || 0).toLocaleString("zh-CN");
  if (!C) { app.innerHTML = `<section class="wb-empty"><h1>尚无实验结果</h1><p>实验记录尚未生成。</p></section>`; return; }
  const state = {phase: "ALL", search: "", event: 0, step: 1, tab: "event"};
  const tabs = {event:"调试事件", raw:"完整记录", original:"原始轨迹", assessments:"窗口候选", result:"结论与比较", usage:"模型与 Token"};
  const usage = C.usage || {}, coverage = C.result.coverage || {};
  const reviews = C.events.filter(e => e.kind === "assessment" && e.data?.window_id).map(e => e.data);
  const completedSteps = new Set(coverage.assessed_steps || []);
  app.innerHTML = `<section class="experiment-hero"><div><div class="eyebrow">EXPERIMENT EXPLORER <span>ISOLATED PHASE CONVERSATIONS</span></div>
    <h1>沿调试过程，追溯归因依据</h1><p>浏览阶段交接、模型与工具调用，对照原始轨迹和局部判断。</p></div>
    <div class="experiment-context"><span class="eyebrow">当前实验</span><strong>${esc(C.run)}</strong><span>${esc(C.domain || "—")} · ${esc(RUN.mode || "—")} · ${esc(C.result.status)}</span></div></section>
    <section class="wb-summary">${metric("原始轨迹步骤", C.steps.length)}${metric("模型请求 / 工具调用", `${usage.model_calls || usage.replay_calls || 0} / ${usage.tool_calls || 0}`)}${metric("输入 / 输出 Token", `${number(usage.input_tokens)} / ${number(usage.output_tokens)}`)}${metric("已评估 / 窗口步骤", `${coverage.assessed_steps?.length || 0} / ${coverage.selected_steps?.length || 0}`)}</section>
    <div class="shell"><aside class="sidebar"><div class="eyebrow">01 / CASE & EVENT NAVIGATOR</div><h2 class="navigator-brand">实验与调试事件</h2>
    <label class="minor" for="case-select">轨迹</label><select id="case-select" class="control">${NAV.map(n => `<option value="${esc(n.href)}" ${n.id === C.trajectory_id ? "selected" : ""}>${esc(n.id)} · ${esc(n.status)}</option>`).join("")}</select>
    <div class="phase-filters" aria-label="阶段筛选">${["ALL", ...phases].map(p => `<button data-phase="${p}" aria-pressed="${p === "ALL"}">${p}</button>`).join("")}</div>
    <input id="event-search" class="control" type="search" placeholder="搜索工具 / 内容 / Fact ID…" aria-label="搜索调试事件"><div id="event-count" class="minor"></div><nav id="event-list" class="event-list" aria-label="调试事件"></nav></aside>
    <main class="event-panel"><div class="panel-top" id="event-header"></div><div class="tabs" role="tablist" aria-label="事件内容">${Object.entries(tabs).map(([k,v]) => `<button id="tab-${k}" role="tab" aria-selected="${k === state.tab}" data-tab="${k}">${v}</button>`).join("")}</div><div id="event-content" class="event-content" aria-live="polite"></div></main>
    <aside class="inspector" id="inspector" aria-label="归因与覆盖"></aside><section class="timeline-panel"><div class="timeline-head"><h2>阶段流程与原始步骤</h2><span class="timeline-meta">点击阶段、事件或步骤查看原文</span></div><div id="workflow" class="workflow"></div><div id="event-lane" class="lane-scroll"></div><div id="step-grid" class="step-grid"></div><div class="legend"><span class="legend-map">MAP</span><span class="legend-review">ROUTE</span><span class="legend-trace">TRACE</span><span class="legend-revise">SUBMIT</span><span>步骤：绿色已评估 · 红色存在局部错误 · 粗边为声明窗口</span></div></section></div>`;

  const content = document.getElementById("event-content");
  const facts = C.record.F || C.record.facts || [];
  function cites(ids) { return (ids || []).map(id => `<button class="process-jump" data-fid="${esc(id)}">fid ${esc(id)}</button>`).join(" "); }
  function judgementHtml(step) {
    const judged = reviews.flatMap(r => (r.candidates || []).filter(j => j.step === step).map(j => ({...j, window_id:r.window_id})));
    if (!judged.length) return `<p class="empty">第 ${esc(step)} 步${completedSteps.has(step) ? "所在窗口已完成评估，未列出该步候选；这不表示四模块均正确" : "尚无已完成的窗口评估"}。</p>`;
    return judged.map(j => section(`${j.window_id} · ${j.module} · ${j.status}`, `${tag(j.fault_class || j.status, j.status === "error" ? "bad" : "warn")}
      <p>${esc(j.proposition || "")}</p><p>${esc(j.reasoning || "")}</p><p>即时影响：${esc(j.immediate_effect || "—")}</p><p>目标：${esc((j.requirement_links || []).join(", "))}</p><p>支持：${cites(j.evidence_for)}<br>反证：${cites(j.evidence_against)}</p><p>不确定性：${esc(j.uncertainty || "—")}</p>${detail("完整判断", j)}`)).join("");
  }
  function resultHtml() {
    const r = C.result, root = r.root;
    const acceptedLabel = "直接答案结构校验通过";
    return section("最终结果", `<div class="kv">${tag(r.status, r.accepted ? "ok" : "warn")}${tag(r.accepted ? acceptedLabel : "未接受诊断")}${tag(r.policy || "window/v1")}</div><p>${esc(r.stop_reason || "")}</p>${root ? `<p>根因：步骤 ${esc(root.step)} · ${esc(root.module)} / ${esc(root.fault_class)} · ${cites([root.fid])}</p><p>${esc(root.proposition)}</p>` : "<p>没有提交根因。</p>"}<p>${esc(r.reasoning || "")}</p><p>不确定性：${esc(r.uncertainty || "—")}</p><p>建议修复：${esc(r.repair || "—")}</p><p>支持：${cites(r.supporting_evidence)}<br>反证：${cites(r.counterevidence)}</p>`) +
      section("候选比较、恢复与终局连接", detail("当前完整比较", C.comparison, true) + detail("竞争根因", r.alternatives) + detail("边界来源复核", r.boundary_reviews)) +
      section("传播与覆盖", detail("因果链（recorded / llm_inferred）", r.causal_chain, true) + detail("实际覆盖", r.coverage) + detail("完整结果", r));
  }
  function usageHtml() {
    const by = usage.by_phase || {};
    const rows = phases.map(p => {
      const u = by[p] || {}, first = C.events.find(e => e.kind === "model" && e.phase === p);
      return `<tr><td>${esc(p)}</td><td>${esc(first?.request?.requested_model || first?.usage?.response_model || "无请求")}</td><td>${number(u.model_calls || u.replay_calls)}</td><td>${number(u.input_tokens)}</td><td>${number(u.output_tokens)}</td><td>${number(u.cache_hit_input_tokens)}</td></tr>`;
    }).join("");
    return section("分阶段调用与实际使用量", `<div class="table-scroll"><table class="facts"><thead><tr><th>阶段</th><th>模型</th><th>请求</th><th>输入</th><th>输出</th><th>缓存命中</th></tr></thead><tbody>${rows}</tbody></table></div><p>请求采用各阶段独立会话；完整输入可在模型事件中展开。Token 以供应商实际 usage 为准。</p>${detail("完整使用量账本汇总", usage)}`) +
      phases.map(p => { const e = C.events.find(e => e.kind === "model" && e.phase === p); return section(`${p} prompt`, e?.request?.messages?.[0] ? detail("查看阶段系统提示词", e.request.messages[0].content) : "<p>无模型请求记录。</p>"); }).join("");
  }
  function originalHtml() {
    const step = C.steps[state.step - 1];
    return section("原始任务", raw(C.task)) + section(`原始步骤 ${state.step}`, step ? raw(step) : "<p>无原始步骤记录。</p>") + judgementHtml(state.step) + section("该步原始 Facts", raw(facts.filter(f => f.t === state.step)));
  }
  function eventHtml(e) {
    if (e?.kind === "answer") return section("SUBMIT 直接比较答案", `<p>一次模型响应直接比较 TRACE 候选，没有工具调用。接受仅代表答案结构合法。</p>${detail("原始答案", e.data.raw_answer, true)}${detail("映射结果", e.data.result)}${detail("持久化事件", e.data)}`);
    if (e?.kind === "assessment") return section("TRACE 独立窗口候选", `<p>窗口 ${esc(e.data.window_id)} 通过 assess 提交全部候选。模式：${esc(e.data.schema)}</p>${detail("原文判断与不确定性", e.data.conclusion, true)}${detail("映射到现有 Fact 的候选", e.data.candidates)}${detail("完整评估事件", e.data)}`);
    if (!e) return `<div class="empty">该运行没有模型或工具事件。可以查看原始轨迹和结果。</div>`;
    if (e.kind === "handoff") return section("阶段交接", `<p>接收阶段仅获得自己的会话与以下交接内容。</p>${detail("权威状态与过渡工具原文", e.data, true)}`);
    if (e.kind === "tool") {
      const d = e.data;
      return section("工具请求", `<p>${esc(d.tool_call_id)} · #${esc(d.ordinal)}</p>${raw(d.arguments)}`) + section("工具返回", raw(d.result));
    }
    const req = e.request || {}, response = e.response;
    const messages = req.messages || [];
    const tools = response?.tool_calls || [];
    return section("模型响应", `<div class="kv">${tag(req.requested_model || "旧记录未保存模型")}${tag(e.status)}${tag(`${messages.length} 条输入消息`)}</div><p>输入 ${number(e.usage.input_tokens)} / 输出 ${number(e.usage.output_tokens)} Token</p>${response?.content ? raw(response.content) : "<p>通过工具调用继续调查。</p>"}${response?.reasoning_content ? detail("模型 reasoning_content", response.reasoning_content) : ""}${tools.map(t => detail(`${t.function?.name} · ${t.id}`, t.function?.arguments, true)).join("")}${e.usage.error_type ? raw(e.usage) : ""}`) +
      section("发送给模型的完整输入", `<p>仅包含 ${esc(e.phase)} 阶段会话及显式交接信息。依次展开可检查实际发送的 prompt、原文和历史。</p>${messages.map((m,i) => detail(`#${i + 1} ${m.role}${m.tool_call_id ? ` · ${m.tool_call_id}` : ""}`, m, i === messages.length - 1)).join("")}${detail("本次可调用工具 schema", req.tools)}`) + section("供应商原始响应", detail("完整 assistant message", response));
  }
  function renderList() {
    const matches = C.events.filter(e => (state.phase === "ALL" || e.phase === state.phase) && (!state.search || pretty(e).toLowerCase().includes(state.search.toLowerCase())));
    document.getElementById("event-count").textContent = `${matches.length} / ${C.events.length} 个事件`;
    document.getElementById("event-list").innerHTML = matches.map(e => `<button class="event-link" data-event="${e.index}" aria-current="${state.event === e.index}"><strong>${esc(String(e.index + 1).padStart(3,"0"))} / ${esc(e.title)}</strong><small>${esc(e.phase)} · ${esc(e.kind)} · ${esc(e.status)}</small></button>`).join("") || `<p class="empty">没有匹配事件。</p>`;
    document.querySelectorAll("[data-phase]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.phase === state.phase)));
  }
  function render() {
    const e = C.events[state.event];
    document.getElementById("event-header").innerHTML = `<div class="case-context">${esc(C.trajectory_id)}</div><p class="case-task task-full">${esc(C.task)}</p><div class="eyebrow">02 / ${esc(state.tab === "event" || state.tab === "raw" ? e?.phase || "NO EVENTS" : tabs[state.tab])}</div><h2 class="event-title">${esc(state.tab === "event" || state.tab === "raw" ? e?.title || C.result.status : tabs[state.tab])}</h2><div class="top-meta">${tag(C.result.status, C.result.accepted ? "ok" : "warn")}${e ? tag(`事件 ${e.index + 1} / ${C.events.length}`) : ""}${tag(`${C.steps.length} 步原始轨迹`)}</div>`;
    document.querySelectorAll("[data-tab]").forEach(b => { const active = b.dataset.tab === state.tab; b.classList.toggle("active", active); b.setAttribute("aria-selected", String(active)); });
    if (state.tab === "raw") content.innerHTML = section("事件完整记录", raw(e));
    else if (state.tab === "original") content.innerHTML = originalHtml();
    else if (state.tab === "assessments") content.innerHTML = section("评估范围", `<p>选择下方原始步骤查看各窗口保留的 error/uncertain 候选。窗口完成不等于四模块全部正确。</p>`) + judgementHtml(state.step) + detail("所有窗口结论", reviews);
    else if (state.tab === "result") content.innerHTML = resultHtml();
    else if (state.tab === "usage") content.innerHTML = usageHtml();
    else content.innerHTML = eventHtml(e);
    content.scrollTop = 0;
    const root = C.result.root;
    document.getElementById("inspector").innerHTML = `<div class="eyebrow">03 / DIAGNOSIS & COVERAGE</div><h2>归因与窗口覆盖</h2>` + section("调试结论", `<p>${esc(C.result.stop_reason || C.result.status)}</p>${root ? `<p>步骤 ${esc(root.step)} · ${esc(root.module)} / ${esc(root.fault_class)}</p><p>${esc(root.proposition)}</p><p>${cites([root.fid])}</p>` : "<p>尚无可提交根因。</p>"}<p>${esc(C.result.repair || "")}</p>`) +
      section("当前窗口", `<p>${coverage.assessed_steps?.length || 0} 步已评估 · ${coverage.unassessed_steps?.length ?? C.steps.length} 步未评估</p>${(coverage.windows || []).map(w => `<p><strong>${esc(w.candidate_id)}</strong> · [${esc(w.lo)}, ${esc(w.hi)}]<br>${esc(w.hypothesis || "")}</p>`).join("")}${detail("窗口覆盖完整记录", coverage)}${detail("任务目标状态", C.goal_map)}`) + section(`选中步骤 ${state.step}`, judgementHtml(state.step)) + `<div id="fact-detail"></div>`;
    document.getElementById("workflow").innerHTML = C.phase_events.length ? C.phase_events.map((p,i) => `${i ? '<span class="arrow">→</span>' : ""}<button class="phase-${esc(p.to)}" data-phase="${esc(p.to)}">${esc(p.to)} · turn ${esc(p.turn)}</button>`).join("") : phases.map(p => `<button class="phase-${p}" data-phase="${p}">${p}</button>`).join('<span class="arrow">→</span>');
    document.getElementById("event-lane").innerHTML = C.events.map(e => `<button class="node phase-${esc(e.phase)} ${e.index === state.event ? "selected" : ""} ${e.status === "error" ? "error" : ""}" data-event="${e.index}" title="${esc(e.phase + ' / ' + e.title)}" aria-label="事件 ${e.index + 1} ${esc(e.title)}">${e.index + 1}</button>`).join("");
    const selected = new Set(coverage.selected_steps || []);
    document.getElementById("step-grid").innerHTML = C.steps.map((s,i) => { const n = i + 1, hasError = reviews.some(r => (r.candidates || []).some(j => j.step === n && j.status === "error")); return `<button class="node ${completedSteps.has(n) ? "assessed" : ""} ${hasError ? "has-error" : ""} ${selected.has(n) ? "in-window" : ""} ${state.step === n ? "selected" : ""}" data-step="${n}" aria-label="原始步骤 ${n}">${n}</button>`; }).join("");
    renderList();
  }
  app.addEventListener("click", event => {
    const b = event.target.closest("button"); if (!b) return;
    if (b.dataset.phase) {
      state.phase = b.dataset.phase;
      const first = C.events.find(e => state.phase === "ALL" || e.phase === state.phase);
      if (first && C.events[state.event]?.phase !== state.phase && state.phase !== "ALL") {
        state.event = first.index; state.tab = "event";
      }
      render(); return;
    }
    if (b.dataset.event != null) { state.event = Number(b.dataset.event); state.tab = "event"; }
    if (b.dataset.tab) state.tab = b.dataset.tab;
    if (b.dataset.step) { state.step = Number(b.dataset.step); state.tab = "original"; }
    if (b.dataset.fid != null) {
      const fact = facts.find(f => f.fid === Number(b.dataset.fid));
      const target = document.getElementById("fact-detail");
      target.innerHTML = section(`Fact ${b.dataset.fid}`, fact ? raw(fact) : "<p>无对应原始 Fact 记录。</p>");
      target.scrollIntoView({block:"nearest"}); return;
    }
    render();
  });
  document.getElementById("case-select").addEventListener("change", e => { location.href = e.target.value; });
  document.getElementById("event-search").addEventListener("input", e => { state.search = e.target.value; renderList(); });
  render();
})();
