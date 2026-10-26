// Renders chat messages incrementally: a message is redrawn only when its HTML
// changes, open <details> survive redraws, and the view follows new messages
// while the reader stays at the bottom.
import {icon} from "../case/format.js?v=edc30cc901";
import {caseHref} from "../routes.js?v=edc30cc901";
import {esc, number, raw, short} from "../util.js?v=edc30cc901";
import {callTitle} from "../views/process.js?v=edc30cc901";

const PHASE_ROLE = {MAP: "Requirement map", ROUTE: "Anchor cases", MANAGER: "Investigation plan", TRACE: "Investigation", SUBMIT: "Candidate selection"};
const S = t => `S${String(t).padStart(2, "0")}`;
const stepChip = t => `<span class="step-chip">${S(t)}</span>`;
const human = s => String(s || "").replace(/_/g, " ");
const CANDIDATE_TONE = {error: "bad", uncertain: "warn"};
const REQ_TONE = {met: "ok", unmet: "bad", unknown: "warn"};

function clamp(text, key) {
  return text ? `<div class="msg-text" data-clamp="${esc(key)}">${esc(text)}</div>` : "";
}

function stats(m) {
  const a = m.activity;
  if (!a) return "";
  const parts = [a.turns && `${a.turns} model turn${a.turns > 1 ? "s" : ""}`, a.tools && `${a.tools} tool call${a.tools > 1 ? "s" : ""}`,
                 a.tokens && `${number(a.tokens)} tokens`, a.seconds && `${Math.round(a.seconds)}s`].filter(Boolean);
  return `<span class="msg-stats">${parts.join(" · ")}${a.errors ? ` <span class="badge bad">${a.errors} error${a.errors > 1 ? "s" : ""}</span>` : ""}</span>`;
}

// One row per model call; bodies are filled only when opened: transcripts can be large.
function activityList(m) {
  const calls = m.activity?.calls || [];
  if (!calls.length) return "";
  return `<details class="msg-activity" data-key="act-${esc(m.id)}"><summary>Activity · ${calls.length} model call${calls.length > 1 ? "s" : ""}</summary>
    <ol class="act-list">${calls.map(c => `<li><details class="act-item kind-model ${c.rejected ? "is-error" : ""}" data-key="call-${c.index}" data-call="${c.index}">
      <summary>${icon("model")}<span class="act-title">#${c.n}</span><span class="act-sub mono">${esc(short(callTitle(c), 90))}</span></summary>
      <div class="act-body"></div></details></li>`).join("")}</ol></details>`;
}

function callBody(c) {
  const m = c.message || {};
  const tools = c.tools.map(t => `<div class="call"><span class="mono call-name">${esc(t.name)}</span>${t.error ? ' <span class="badge bad">rejected</span>' : ""}
    ${raw(t.args)}${t.committed ? `<h5>Result</h5>${raw(t.result?.data ?? t.result)}` : ""}</div>`).join("");
  return `${m.reasoning_content ? `<h5>Reasoning</h5><div class="text-box">${esc(m.reasoning_content)}</div>` : ""}
    ${m.content ? `<h5>Response</h5><div class="text-box">${esc(m.content)}</div>` : ""}${tools ? `<h5>Tool calls</h5>${tools}` : ""}`;
}

function requestMessage(m) {
  const cfg = m.manifest?.config || {};
  const chat = m.chat;
  const how = chat ? (chat.mode === "replay" ? `Replay of ${esc(chat.source?.[0] || "a finished run")}` : "Live run")
    : "Started from the command line";
  const chips = [m.taskType, cfg.model, cfg.reasoning_effort && `effort ${cfg.reasoning_effort}`]
    .filter(Boolean).map(c => `<span class="chip">${esc(c)}</span>`).join("");
  return `<div class="msg-body">
    <div class="msg-meta"><strong>${chat ? "You" : "Request"}</strong><span>${how}</span>${chat?.launched_at ? `<span>${esc(new Date(chat.launched_at).toLocaleString("en-CA", {hour12: false}))}</span>` : ""}</div>
    <p class="msg-lead">Investigate the failure in <code>${esc(m.trajectoryId || "this trajectory")}</code>.</p>
    ${m.task ? `<blockquote class="msg-task">${esc(m.task)}</blockquote>` : ""}
    <div class="chip-row">${chips}</div>
  </div>`;
}

function mapContent(m) {
  const g = m.goalMap;
  if (!g) return `<p class="muted">Reading the task contract…</p>`;
  const reqs = g.requirements || [];
  return `<p>${reqs.length} requirement${reqs.length === 1 ? "" : "s"} tracked for <q>${esc(g.task_contract?.verbatim || "")}</q>.</p>
    <ul class="req-list">${reqs.map(r => {
      const st = r.status || {};
      return `<li><span class="badge ${REQ_TONE[st.state] || ""}">${esc(st.state || "—")}</span><span class="mono">${esc(r.entity?.id || "")}</span>
        <span class="muted">${esc(st.reason || "")}</span>${(st.qualifying_steps || []).length ? `<span class="chip-row">${st.qualifying_steps.map(stepChip).join("")}</span>` : ""}</li>`;
    }).join("")}</ul>`;
}

function anchorRows(anchors) {
  return `<ol class="anchor-list">${anchors.map(a => `<li><span class="mono anchor-id">${esc(a.candidate_id)}</span>${stepChip(a.issue_step)}
      <span class="muted mono">${(a.goal_links || []).map(esc).join(" · ")}</span>
      <p>${esc(short(a.hypothesis, 260))}</p></li>`).join("")}</ol>`;
}

function routeContent(m) {
  if (m.finish) return `<p><span class="badge warn">${esc(m.finish.status || "finished")}</span> ROUTE ended without anchor cases.</p>${clamp(m.finish.reason, "route-finish")}`;
  if (!m.anchors.length) return `<p class="muted">Reading the timeline and original modules to find anchor cases…</p>`;
  return `<p>${m.anchors.length} anchor case${m.anchors.length === 1 ? "" : "s"} handed to the TRACE manager.</p>${anchorRows(m.anchors)}`;
}

function managerContent(m) {
  const plan = m.plan;
  if (!plan) return `<p class="muted">Reading the anchor cases and the full action–observation timeline to allocate investigations…</p>`;
  const rules = plan.decision_rules || [];
  return `<p>${plan.assignments.length} investigation${plan.assignments.length === 1 ? "" : "s"} allocated from ${m.anchors.length} anchor case${m.anchors.length === 1 ? "" : "s"}, with ${rules.length} conditional rule${rules.length === 1 ? "" : "s"} for SUBMIT.</p>
    <ol class="anchor-list">${plan.assignments.map(a => `<li><span class="mono anchor-id">${esc(a.agent_id)}</span><span class="badge">${esc(a.anchor_case_id)}</span>
      <p>${esc(short(a.question, 260))}</p></li>`).join("")}</ol>
    ${rules.length ? `<details class="msg-activity" data-key="mgr-rules"><summary>Decision rules · ${rules.length}</summary><ul class="rule-list">${rules.map(r =>
      `<li><span class="mono">${(r.conditions || []).map(c => `${esc(c.agent_id)}=${esc(c.outcome)}`).join(" ∧ ")}</span> → ${esc(r.conclusion || "")}</li>`).join("")}</ul></details>` : ""}`;
}

function traceContent(m) {
  const a = m.assignment, q = m.query, r = m.assessment;
  const issues = q && (q.function_errors?.length || q.partial || q.truncated);
  const parts = [`<p>${esc(a.question || "")}</p>`];
  if (!m.started) parts.push(`<p class="muted">Waiting for its turn.</p>`);
  if (q) parts.push(`<p class="muted mono">SQL · ${q.returned_rows ?? (q.rows || []).length} rows over ${(q.returned_steps || []).length} steps${issues ? ' · <span class="badge warn">partial</span>' : ""}</p>`);
  else if (m.started) parts.push(`<p class="muted">Writing one element-scoped SQL query…</p>`);
  if (r) {
    const cands = r.candidates || [];
    parts.push(cands.length ? cands.map((c, i) => `<div class="cand tone-${CANDIDATE_TONE[c.status] || "plain"}">
      <div class="cand-head"><span class="badge ${CANDIDATE_TONE[c.status] || ""}">${esc(c.status)}</span>${stepChip(c.step)}
        <strong>${esc(c.module || "")}</strong><span class="mono">${esc(c.fault_class || "")}</span>${c.is_root_cause === false ? '<span class="badge">not root</span>' : ""}</div>
      ${c.output_quote ? `<blockquote>${esc(c.output_quote)}</blockquote>` : ""}
      ${clamp(c.proposition, `t-${a.agent_id}-${i}`)}
    </div>`).join("") : `<p class="muted">No candidate: the evidence did not support an error at a single step.</p>`);
    if (r.conclusion?.uncertainty) parts.push(`<details class="msg-activity" data-key="unc-${esc(a.agent_id)}"><summary>Uncertainty</summary><div class="msg-text">${esc(r.conclusion.uncertainty)}</div></details>`);
  } else if (q) parts.push(`<p class="muted">Assessing one step from the query evidence…</p>`);
  return parts.join("");
}

function submitContent(m, ref) {
  const r = m.result;
  if (!r) return `<p class="muted">Comparing ${m.candidates} candidate${m.candidates === 1 ? "" : "s"}, recovery and terminal goal impact…</p>`;
  const root = r.root;
  const links = `<div class="msg-actions"><a class="btn" href="${caseHref(ref, "result")}">Open result</a><a class="btn" href="${caseHref(ref, "trajectory")}">Trajectory</a></div>`;
  if (!root) {
    const why = r.status === "error" ? "The SUBMIT answer was rejected by validation." : "No candidate survived comparison.";
    return `<p><span class="badge ${r.status === "error" ? "bad" : "warn"}">${esc(r.status || "uncertain")}</span> ${why}</p>
      ${clamp(r.reasoning || r.stop_reason, "submit-reasoning")}
      ${r.uncertainty ? `<details class="msg-activity" data-key="submit-unc"><summary>What is missing</summary><div class="msg-text">${esc(r.uncertainty)}</div></details>` : ""}${links}`;
  }
  return `<div class="verdict">
      <span class="eyebrow">Selected hypothesis</span>
      <div class="verdict-line">${stepChip(root.step)}<strong>${esc(root.module)}</strong><span class="mono">${esc(human(root.fault_class))}</span>${r.accepted ? '<span class="badge ok">accepted</span>' : `<span class="badge warn">${esc(r.status)}</span>`}</div>
      ${root.output_quote ? `<blockquote>${esc(root.output_quote)}</blockquote>` : ""}
    </div>
    ${clamp(root.reasoning || r.reasoning, "submit-reasoning")}
    ${r.repair ? `<details class="msg-activity" data-key="submit-repair"><summary>Suggested repair</summary><div class="msg-text">${esc(r.repair)}</div></details>` : ""}${links}`;
}

function phaseMessage(m, ref) {
  const body = {MAP: mapContent, ROUTE: routeContent, MANAGER: managerContent, TRACE: traceContent, SUBMIT: x => submitContent(x, ref)}[m.phase](m);
  const role = m.phase === "TRACE" ? `${PHASE_ROLE.TRACE} <span class="mono">${esc(m.assignment.agent_id)}</span>${m.assignment.anchor_case_id ? ` · ${esc(m.assignment.anchor_case_id)}` : ""}` : PHASE_ROLE[m.phase];
  return `<div class="msg-body">
    <div class="msg-meta"><strong>${m.phase}</strong><span>${role}</span>${m.working ? '<span class="badge live"><span class="live-dot"></span>working</span>' : ""}${stats(m)}</div>
    <div class="msg-content">${body}</div>
    ${activityList(m)}
  </div>`;
}

function referenceMessage(m) {
  const ref = m.reference, root = m.result.root;
  const rows = [
    ["Step", root ? S(root.step) : "—", S(ref.step), root?.step === ref.step],
    ["Module", root?.module || "—", ref.module, root?.module === ref.module],
    ["Error type", root ? human(root.fault_class) : "—", (ref.types || []).map(human).join(", "), Boolean(root) && (ref.types || []).includes(root.fault_class)],
  ];
  const all = rows.every(r => r[3]);
  return `<div class="msg-body">
    <div class="msg-meta"><strong>REFERENCE</strong><span>Benchmark label · shown after the run, never given to the debugger</span>
      <span class="msg-stats">${all ? '<span class="badge ok">all correct</span>' : `<span class="badge ${root ? "bad" : "warn"}">${rows.filter(r => r[3]).length}/3 match</span>`}</span></div>
    <table class="ref-table"><thead><tr><th></th><th>Debugger</th><th>Reference</th><th></th></tr></thead>
      <tbody>${rows.map(([k, p, g, ok]) => `<tr class="${ok ? "is-ok" : "is-miss"}"><th>${k}</th><td class="mono">${esc(p)}</td><td class="mono">${esc(g)}</td><td>${ok ? "✓" : "✗"}</td></tr>`).join("")}</tbody></table>
  </div>`;
}

function noticeMessage(m) {
  if (m.outcome) return `<div class="msg-body"><p><span class="badge warn">no candidate</span> Every investigation finished without an error at a single step, so SUBMIT was skipped.</p>${clamp(m.outcome.stop_reason, "outcome")}</div>`;
  if (m.incomplete) return `<div class="msg-body"><p>This run stopped before SUBMIT wrote a result.</p></div>`;
  const c = m.chat;
  const log = (c.log || []).filter(Boolean);
  return `<div class="msg-body"><p>${c.state === "stopped" ? "Run stopped." : `Run failed (exit code ${esc(c.returncode)}).`}</p>
    ${log.length ? `<details class="msg-activity" data-key="notice-log" ${c.state === "failed" ? "open" : ""}><summary>Process output</summary>${raw(log.join("\n"))}</details>` : ""}</div>`;
}

function workingMessage(m) {
  return `<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span>
    <span><strong>${esc(m.phase)}</strong> ${m.waiting ? `is waiting for ${esc(m.model || "the model")}…` : "is working…"}</span>`;
}

function renderMessage(m, ref) {
  if (m.role === "user") return requestMessage(m);
  if (m.role === "working") return workingMessage(m);
  if (m.role === "system") return noticeMessage(m);
  if (m.role === "reference") return referenceMessage(m);
  return phaseMessage(m, ref);
}

function avatar(m) {
  if (m.role === "user" || m.role === "working") return "";
  if (m.role === "system") return `<span class="msg-avatar">!</span>`;
  if (m.role === "reference") return `<span class="msg-avatar" aria-hidden="true">✓</span>`;
  return `<span class="msg-avatar" aria-hidden="true">${esc((m.phase || "?")[0])}</span>`;
}

export function createStream(container, scroller) {
  const nodes = new Map();   // id -> {el, html}
  const open = new Set();    // data-key of open <details>
  const full = new Set();    // expanded clamped texts
  let calls = [];
  let ref = null;

  container.addEventListener("toggle", event => {
    const d = event.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.key) return;
    d.open ? open.add(d.dataset.key) : open.delete(d.dataset.key);
    if (d.open && d.dataset.call) fill(d);
  }, true);
  container.addEventListener("click", event => {
    const text = event.target.closest("[data-clamp]");
    if (!text) return;
    const key = text.dataset.clamp;
    full.has(key) ? full.delete(key) : full.add(key);
    text.classList.toggle("is-full", full.has(key));
  });

  function fill(d) {
    const body = d.querySelector(".act-body");
    const c = calls[Number(d.dataset.call)];
    if (body && c && !body.childElementCount) body.innerHTML = callBody(c);
  }

  function restore(el) {
    el.querySelectorAll("details[data-key]").forEach(d => {
      if (open.has(d.dataset.key)) { d.open = true; if (d.dataset.call) fill(d); }
    });
    el.querySelectorAll("[data-clamp]").forEach(t => t.classList.toggle("is-full", full.has(t.dataset.clamp)));
  }

  return {
    update(messages, {caseRef, model}) {
      ref = caseRef;
      calls = model?.debugger?.calls || [];
      const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
      const ids = new Set(messages.map(m => m.id));
      nodes.forEach((n, id) => { if (!ids.has(id)) { n.el.remove(); nodes.delete(id); } });
      let previous = null;
      let changed = false;
      for (const m of messages) {
        const html = avatar(m) + renderMessage(m, ref);
        let node = nodes.get(m.id);
        if (!node) {
          const el = document.createElement("article");
          node = {el, html: null};
          nodes.set(m.id, node);
        }
        node.el.className = `msg msg-${m.role} ${m.phase ? `phase-${m.phase}` : ""} ${m.tone ? `tone-${m.tone}` : ""} ${node.html === null ? "is-new" : ""}`;
        node.el.dataset.msg = m.id;
        if (node.html !== html) { node.el.innerHTML = html; node.html = html; restore(node.el); changed = true; }
        // Keep DOM order equal to message order (a window may arrive before the working indicator).
        const anchor = previous ? previous.nextSibling : container.firstChild;
        if (node.el !== anchor) container.insertBefore(node.el, anchor);
        previous = node.el;
      }
      if (changed && atBottom) scroller.scrollTo({top: scroller.scrollHeight, behavior: "smooth"});
    },
    reset() {
      nodes.clear(); open.clear(); full.clear();
      container.innerHTML = "";
    },
  };
}
