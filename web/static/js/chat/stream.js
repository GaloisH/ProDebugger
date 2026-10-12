// Renders chat messages incrementally: a message is redrawn only when its HTML
// changes, open <details> survive redraws, and the view follows new messages
// while the reader stays at the bottom.
import {icon} from "../case/format.js";
import {caseHref} from "../routes.js";
import {esc, number, raw, short} from "../util.js";

const PHASE_ROLE = {MAP: "Requirement map", ROUTE: "Issue anchors", TRACE: "Window judgements", SUBMIT: "Root-cause decision"};
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
                 a.tokens && `${number(a.tokens)} tokens`, m.seconds && `${Math.round(m.seconds)}s`].filter(Boolean);
  return `<span class="msg-stats">${parts.join(" · ")}${a.errors ? ` <span class="badge bad">${a.errors} error${a.errors > 1 ? "s" : ""}</span>` : ""}</span>`;
}

function activityList(m) {
  const events = m.activity?.events || [];
  if (!events.length) return "";
  return `<details class="msg-activity" data-key="act-${esc(m.id)}"><summary>Activity · ${events.length} event${events.length > 1 ? "s" : ""}</summary>
    <ol class="act-list">${events.map(e => `<li><details class="act-item kind-${e.kind} ${e.status === "error" ? "is-error" : ""}" data-key="ev-${e.index}" data-ev="${e.index}">
      <summary>${icon(e.kind)}<span class="act-title">${esc(e.title)}</span><span class="act-sub mono">${esc(short(e.subtitle, 90))}</span></summary>
      <div class="act-body"></div></details></li>`).join("")}</ol></details>`;
}

// Raw event bodies are filled only when opened: transcripts can be large.
function eventBody(e) {
  if (e.kind === "model") {
    const m = e.data;
    const calls = (m.tool_calls || []).map(c => {
      let args = c.function?.arguments;
      try { args = JSON.parse(args); } catch { /* keep text */ }
      return `<div class="call"><span class="mono call-name">${esc(c.function?.name)}</span>${raw(args)}</div>`;
    }).join("");
    return `${m.reasoning_content ? `<h5>Reasoning</h5><div class="text-box">${esc(m.reasoning_content)}</div>` : ""}
      ${m.content ? `<h5>Response</h5><div class="text-box">${esc(m.content)}</div>` : ""}${calls ? `<h5>Tool calls</h5>${calls}` : ""}`;
  }
  if (e.kind === "tool") return `<h5>Arguments</h5>${raw(e.data.arguments)}<h5>Result</h5>${raw(e.data.result?.data ?? e.data.result)}`;
  return raw(e.data);
}

function requestMessage(m) {
  const cfg = m.manifest?.config || {};
  const chat = m.chat;
  const how = chat ? (chat.mode === "replay" ? `Replay of ${esc(chat.source?.[0] || "a finished run")}` : "Live run")
    : "Started from the command line";
  const chips = [m.taskType, cfg.model, cfg.reasoning_effort && `effort ${cfg.reasoning_effort}`, cfg.window_size && `W=${cfg.window_size}`]
    .filter(Boolean).map(c => `<span class="chip">${esc(c)}</span>`).join("");
  return `<div class="msg-body">
    <div class="msg-meta"><strong>${chat ? "You" : "Request"}</strong><span>${how}</span>${chat?.launched_at ? `<span>${esc(new Date(chat.launched_at).toLocaleString("en-CA", {hour12: false}))}</span>` : ""}</div>
    <p class="msg-lead">Find the root cause in <code>${esc(m.trajectoryId || "this trajectory")}</code>.</p>
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

function anchorRows(anchors, assessed) {
  return `<ol class="anchor-list">${anchors.map(a => {
    const w = assessed?.get(a.candidate_id);
    const state = assessed ? (w ? `<span class="badge ok">${(w.candidates || []).length} candidate${(w.candidates || []).length === 1 ? "" : "s"}</span>` : `<span class="badge">pending</span>`) : "";
    return `<li><span class="mono anchor-id">${esc(a.candidate_id)}</span>${stepChip(a.issue_step)}
      <span class="muted mono">${a.lo != null ? `window ${S(a.lo)}–${S(a.hi)}` : ""}</span>${state}
      ${assessed ? "" : `<p>${esc(short(a.hypothesis, 260))}</p>`}</li>`;
  }).join("")}</ol>`;
}

function routeContent(m) {
  if (!m.anchors.length) return `<p class="muted">Following evidence and entity history to rank issue anchors…</p>`;
  return `<p>${m.anchors.length} issue anchor${m.anchors.length === 1 ? "" : "s"} selected for TRACE.</p>${anchorRows(m.anchors)}`;
}

function traceContent(m) {
  const done = m.assessed.size, total = m.anchors.length;
  return `<p>Judging ${total || "the"} window${total === 1 ? "" : "s"} against the raw trajectory text — ${done}/${total || "?"} assessed.</p>
    ${total ? anchorRows(m.anchors, m.assessed) : ""}`;
}

function windowMessage(m) {
  const w = m.window, win = w.window || {};
  const candidates = w.candidates || [];
  return `<div class="msg-body">
    <div class="msg-meta"><strong>TRACE · window ${esc(w.window_id)}</strong><span class="mono">${win.lo != null ? `${S(win.lo)}–${S(win.hi)}` : ""}</span>
      <span class="msg-stats">${candidates.length} candidate${candidates.length === 1 ? "" : "s"}</span></div>
    ${candidates.length ? candidates.map((c, i) => `<div class="cand tone-${CANDIDATE_TONE[c.status] || "plain"}">
      <div class="cand-head"><span class="badge ${CANDIDATE_TONE[c.status] || ""}">${esc(c.status)}</span>${stepChip(c.step)}
        <strong>${esc(c.module || "")}</strong><span class="mono">${esc(c.fault_class || "")}</span></div>
      ${c.output_quote ? `<blockquote>${esc(c.output_quote)}</blockquote>` : ""}
      ${clamp(c.proposition, `w-${w.window_id}-${i}`)}
    </div>`).join("") : `<p class="muted">No error candidate in this window.</p>`}
    ${w.conclusion?.uncertainty ? `<details class="msg-activity" data-key="unc-${esc(w.window_id)}"><summary>Window uncertainty</summary><div class="msg-text">${esc(w.conclusion.uncertainty)}</div></details>` : ""}
  </div>`;
}

function submitContent(m, ref) {
  const r = m.result;
  if (!r) return `<p class="muted">Comparing ${m.candidates} candidate${m.candidates === 1 ? "" : "s"}, recovery and terminal goal impact…</p>`;
  const root = r.root;
  const links = `<div class="msg-actions"><a class="btn" href="${caseHref(ref, "result")}">Open result</a><a class="btn" href="${caseHref(ref, "trajectory")}">Trajectory</a></div>`;
  if (!root) {
    return `<p><span class="badge warn">${esc(r.status || "uncertain")}</span> No candidate survived comparison.</p>
      ${clamp(r.reasoning || r.stop_reason, "submit-reasoning")}
      ${r.uncertainty ? `<details class="msg-activity" data-key="submit-unc"><summary>What is missing</summary><div class="msg-text">${esc(r.uncertainty)}</div></details>` : ""}${links}`;
  }
  return `<div class="verdict">
      <span class="eyebrow">Root cause</span>
      <div class="verdict-line">${stepChip(root.step)}<strong>${esc(root.module)}</strong><span class="mono">${esc(human(root.fault_class))}</span>${r.accepted ? '<span class="badge ok">accepted</span>' : `<span class="badge warn">${esc(r.status)}</span>`}</div>
      ${root.output_quote ? `<blockquote>${esc(root.output_quote)}</blockquote>` : ""}
    </div>
    ${clamp(root.reasoning || r.reasoning, "submit-reasoning")}
    ${r.repair ? `<details class="msg-activity" data-key="submit-repair"><summary>Suggested repair</summary><div class="msg-text">${esc(r.repair)}</div></details>` : ""}${links}`;
}

function phaseMessage(m, ref) {
  const body = {MAP: mapContent, ROUTE: routeContent, TRACE: traceContent, SUBMIT: x => submitContent(x, ref)}[m.phase](m);
  return `<div class="msg-body">
    <div class="msg-meta"><strong>${m.phase}</strong><span>${PHASE_ROLE[m.phase]}</span>${m.working ? '<span class="badge live"><span class="live-dot"></span>working</span>' : ""}${stats(m)}</div>
    <div class="msg-content">${body}</div>
    ${activityList(m)}
  </div>`;
}

function noticeMessage(m) {
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
  if (m.window) return windowMessage(m);
  return phaseMessage(m, ref);
}

function avatar(m) {
  if (m.role === "user" || m.role === "working") return "";
  if (m.role === "system") return `<span class="msg-avatar">!</span>`;
  return `<span class="msg-avatar" aria-hidden="true">${esc((m.phase || "?")[0])}</span>`;
}

export function createStream(container, scroller) {
  const nodes = new Map();   // id -> {el, html}
  const open = new Set();    // data-key of open <details>
  const full = new Set();    // expanded clamped texts
  let events = new Map();
  let ref = null;

  container.addEventListener("toggle", event => {
    const d = event.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.key) return;
    d.open ? open.add(d.dataset.key) : open.delete(d.dataset.key);
    if (d.open && d.dataset.ev) fill(d);
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
    const e = events.get(Number(d.dataset.ev));
    if (body && e && !body.childElementCount) body.innerHTML = eventBody(e);
  }

  function restore(el) {
    el.querySelectorAll("details[data-key]").forEach(d => {
      if (open.has(d.dataset.key)) { d.open = true; if (d.dataset.ev) fill(d); }
    });
    el.querySelectorAll("[data-clamp]").forEach(t => t.classList.toggle("is-full", full.has(t.dataset.clamp)));
  }

  return {
    update(messages, {caseRef, model}) {
      ref = caseRef;
      events = new Map((model?.debugger?.events || []).map(e => [e.index, e]));
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
