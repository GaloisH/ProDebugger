// Debugger process: one card per phase that expands in place into its model calls
// (one node per call). TRACE has one row per manager assignment; PARSE is a single card.
import {CALL_PHASES} from "../case/calls.js";
import {factChip} from "../case/format.js";
import {esc, number, raw, short} from "../util.js";
import {routeBadge, routeDetail, routeOverview, routeTitle} from "./route.js";
import {managerDetail, managerOverview, managerTitle, traceBadge, traceDetail, traceOverview, traceSummary, traceTitle} from "./trace.js";
import {submitDetail, submitOverview, submitTitle} from "./submit.js";
import {toolList} from "./tools.js";

// Node size and gaps; TRACE rows keep a gutter on the left for the assignment label.
const W = 184, H = 80, GX = 34, LANE_GAP = 12, GUTTER = 120;
const S = t => `S${String(t).padStart(2, "0")}`;
const kilo = n => n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n);
const secs = s => s == null ? "" : s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s` : `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;

export function toolSummary(tools) {
  const counts = new Map();
  tools.forEach(t => counts.set(t.name, (counts.get(t.name) || 0) + 1));
  return [...counts].map(([name, n]) => n > 1 ? `${name} ×${n}` : name).join(" · ");
}

// Phase-specific node titles, badges and side-panel sections.
const PHASE_TITLE = {ROUTE: routeTitle, MANAGER: managerTitle, TRACE: traceTitle, SUBMIT: submitTitle};
const PHASE_BADGE = {ROUTE: routeBadge, TRACE: traceBadge};
const PHASE_DETAIL = {ROUTE: routeDetail, MANAGER: managerDetail, TRACE: traceDetail, SUBMIT: submitDetail};

// Short node title. Phase-specific wording comes first, then a tool summary.
export function callTitle(call) {
  if (call.status === "pending") return "Waiting for model…";
  const special = PHASE_TITLE[call.phase]?.(call);
  if (special) return special;
  if (call.tools.length) return toolSummary(call.tools);
  return call.message?.content ? "Text answer" : "No output";
}

// One card per phase, in pipeline order. Each phase lays out its own calls left to right;
// TRACE has one row per manager assignment, in the plan's order. PARSE is a single card.
// plan: the manager's investigation plan.
export function layoutPhases(calls, parse, plan) {
  const assignments = new Map((plan?.assignments || []).map((a, i) => [a.agent_id, {...a, order: i}]));
  const phases = [];
  const phase = name => {
    let p = phases.find(x => x.phase === name);
    if (!p) { p = {phase: name, lanes: [], calls: []}; phases.push(p); }
    return p;
  };
  if (parse) phase("PARSE").parse = parse;
  for (const call of calls) {
    const p = phase(CALL_PHASES.includes(call.phase) ? call.phase : "OTHER");
    const key = call.phase === "TRACE" ? call.caseId || "?" : "main";
    let lane = p.lanes.find(l => l.key === key);
    if (!lane) { lane = {key, nodes: [], assignment: call.phase === "TRACE" ? assignments.get(key) : null}; p.lanes.push(lane); }
    lane.nodes.push({call});
    p.calls.push(call);
  }
  phases.find(p => p.phase === "TRACE")?.lanes.sort((a, b) => (a.assignment?.order ?? 1e9) - (b.assignment?.order ?? 1e9));
  const rank = p => { const i = CALL_PHASES.indexOf(p.phase); return i < 0 ? 1e9 : i; };
  phases.sort((a, b) => rank(a) - rank(b));
  for (const p of phases) {
    const left = p.phase === "TRACE" ? GUTTER : 0;
    p.lanes.forEach((lane, li) => {
      lane.y = li * (H + LANE_GAP);
      lane.nodes.forEach((node, k) => { node.x = left + k * (W + GX); node.y = lane.y; });
    });
    p.width = left + Math.max(0, ...p.lanes.map(l => l.nodes.length)) * (W + GX) - GX;
    p.height = p.lanes.length * H + Math.max(0, p.lanes.length - 1) * LANE_GAP;
    // Sequence within a row; a retry after a rejected tool call is drawn dashed red.
    p.edges = p.lanes.flatMap(lane => lane.nodes.slice(1).map((node, k) =>
      ({from: lane.nodes[k], to: node, retry: Boolean(lane.nodes[k].call.rejected)})));
  }
  return phases;
}

function nodeHtml(node, sel) {
  const pos = `left:${node.x}px;top:${node.y}px;width:${W}px;height:${H}px`;
  const c = node.call;
  const errors = c.tools.filter(t => t.error).length;
  const cls = ["pnode", `phase-${c.phase}`, sel === String(c.index) && "is-selected", c.status === "pending" && "is-pending",
               c.rejected && "is-rejected"].filter(Boolean).join(" ");
  return `<button class="${cls}" data-call="${c.index}" style="${pos}" title="${esc(callTitle(c))}">
    <span class="pn-top"><span class="mono">#${c.n}</span><span>${esc(c.caseId ? short(c.caseId, 18) : c.phase)}</span>
      ${c.status === "pending" ? '<span class="live-dot"></span>' : `${PHASE_BADGE[c.phase]?.(c) || ""}${errors ? `<span class="badge bad">${errors} error${errors === 1 ? "" : "s"}</span>` : ""}`}</span>
    <span class="pn-title">${esc(short(callTitle(c), 44))}</span>
    <span class="pn-foot mono">${c.status === "pending" ? esc(c.model || "") : `${kilo(c.usage?.input_tokens)} in · ${kilo(c.usage?.output_tokens)} out · ${secs(c.seconds)}`}</span>
  </button>`;
}

function canvasHtml(p, sel) {
  return `<div class="proc-canvas" style="width:${p.width}px;height:${p.height}px">
    ${p.phase === "TRACE" ? p.lanes.map(l => `<span class="proc-lane-label" style="top:${l.y + H / 2}px" title="${esc(l.assignment?.question || l.key)}"><span class="mono">${esc(short(l.key, 16))}</span>${l.assignment?.anchor_case_id ? `<span class="badge anchor" title="ROUTE anchor case">${esc(l.assignment.anchor_case_id)}</span>` : ""}</span>`).join("") : ""}
    <svg class="proc-edges" width="${p.width}" height="${p.height}" aria-hidden="true">
      <defs><marker id="proc-arrow-${p.phase}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
      ${p.edges.map(e => `<path class="proc-edge ${e.retry ? "is-retry" : ""}" d="M${e.from.x + W},${e.from.y + H / 2} L${e.to.x - 6},${e.to.y + H / 2}" marker-end="url(#proc-arrow-${p.phase})"/>`).join("")}
    </svg>
    ${p.lanes.flatMap(l => l.nodes).map(n => nodeHtml(n, sel)).join("")}
  </div>`;
}

// ---------- phase cards ----------
// Phase-wide conclusion lines; other phases use the latest call with a phase-specific title.
const PHASE_SUMMARY = {TRACE: traceSummary};

function phaseSummary(p) {
  if (p.phase === "PARSE") return "Source parsing";
  const own = PHASE_SUMMARY[p.phase]?.(p);
  if (own) return own;
  for (const call of [...p.calls].reverse()) {
    const title = call.status === "pending" ? null : PHASE_TITLE[p.phase]?.(call);
    if (title) return title;
  }
  const tools = p.calls.flatMap(c => c.tools);
  return tools.length ? toolSummary(tools) : p.calls.at(-1) ? callTitle(p.calls.at(-1)) : "";
}

export function phaseStats(p) {
  if (p.parse) return {calls: p.parse.calls.length, input: p.parse.input, output: p.parse.output, seconds: p.parse.seconds, rejected: 0, pending: p.parse.pending};
  const sum = key => p.calls.reduce((s, c) => s + (Number(c.usage?.[key]) || 0), 0);
  // Wall time: TRACE assignments run in parallel, so summing call durations would overstate it.
  const starts = p.calls.map(c => c.start).filter(t => t != null), ends = p.calls.map(c => c.end).filter(t => t != null);
  return {calls: p.calls.length, input: sum("input_tokens"), output: sum("output_tokens"),
          seconds: starts.length && ends.length ? (Math.max(...ends) - Math.min(...starts)) / 1000 : null,
          rejected: p.calls.filter(c => c.rejected).length, pending: p.calls.some(c => c.status === "pending")};
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const expandable = p => !p.parse && p.calls.length > 0;

// open: the expanded phase; selPhase: the phase the selection is in.
function phaseCard(p, {open, sel, selPhase}) {
  const s = phaseStats(p);
  const isOpen = open === p.phase && expandable(p);
  const selected = selPhase === p.phase && (sel == null || !isOpen);
  const cls = ["ph-card", `phase-${p.phase}`, isOpen && "is-open", selected && "is-selected", s.pending && "is-pending"].filter(Boolean).join(" ");
  const summary = phaseSummary(p);
  return `<article class="${cls}" data-phase="${p.phase}">
    <div class="ph-meta">
      <div class="ph-top"><span class="phase-dot"></span><span class="ph-name mono">${esc(p.phase)}</span>
        ${s.pending ? '<span class="live-dot" title="In progress"></span>' : ""}
        ${expandable(p) ? `<button class="card-toggle" data-toggle-phase="${p.phase}" aria-expanded="${isOpen}" aria-label="${isOpen ? "Collapse" : "Expand"} ${esc(p.phase)}">${isOpen ? "−" : "+"}</button>` : ""}</div>
      <span class="ph-count">${plural(s.calls, "call")}${p.phase === "TRACE" ? ` · ${plural(p.lanes.length, "row")}` : ""}</span>
      <h3 class="ph-title" title="${esc(summary)}">${esc(summary)}</h3>
      <div class="ph-foot">${s.rejected ? `<span class="badge bad">${s.rejected} rejected</span>` : ""}<span class="mono">${kilo(s.input)} in · ${kilo(s.output)} out${s.seconds != null ? ` · ${secs(s.seconds)}` : ""}</span></div>
    </div>
    ${isOpen ? `<div class="ph-body">${canvasHtml(p, sel)}</div>` : ""}
  </article>`;
}

export function phasesHtml(phases, view) {
  return `<div class="ph-track">${phases.map(p => phaseCard(p, view)).join("")}</div>`;
}

// ---------- side panel ----------
function requestBlock(file, requests) {
  if (!file) return "";
  return `<div class="detail-block"><h4>Request</h4><button class="btn" data-request="${esc(file)}">Load full request</button>
    <div class="request-box" data-request-box="${esc(file)}">${requestHtml(file, requests)}</div></div>`;
}

export function requestHtml(file, requests) {
  const r = requests.get(file);
  if (!r) return "";
  if (r === "loading") return `<p class="muted">Loading…</p>`;
  if (r.error) return `<p class="error-box">${esc(r.error)}</p>`;
  const messages = r.messages || [];
  return `<p class="muted">${messages.length} messages · ${esc(r.requested_model || "")}</p>${messages.map((m, i) =>
    `<details><summary>#${i + 1} ${esc(m.role)}${m.tool_call_id ? ` · ${esc(m.tool_call_id)}` : ""}</summary>${raw(m.content ?? m)}</details>`).join("")}`;
}

function parseDetail(p, requests) {
  return `<header class="side-head"><span class="phase-dot phase-PARSE"></span><h3>Source parsing</h3></header>
    <p class="muted">Model backoff for task/observation parsing and statement parsing. ${p.calls.length} call${p.calls.length === 1 ? "" : "s"} · ${number(p.input)} in · ${number(p.output)} out.</p>
    ${p.calls.map((c, i) => `<details class="detail-block"><summary><span class="mono">${esc(c.folder)} #${i + 1}</span> · ${kilo(c.usage?.input_tokens)} in · ${secs(c.seconds)}</summary>
      ${c.message?.content ? `<div class="text-box">${esc(c.message.content)}</div>` : ""}${requestBlock(c.requestFile, requests)}</details>`).join("")}`;
}

export function callDetail(call, ctx) {
  const u = call.usage || {}, m = call.message || {};
  const extra = PHASE_DETAIL[call.phase]?.(call, ctx) || "";
  return `<header class="side-head"><span class="phase-dot phase-${call.phase}"></span><h3>#${call.n} · ${esc(call.phase)}${call.caseId ? ` · ${esc(call.caseId)}` : ""}</h3>
      ${call.status === "pending" ? '<span class="badge live"><span class="live-dot"></span>waiting</span>' : call.rejected ? '<span class="badge bad">rejected tool call</span>' : ""}</header>
    <dl class="kv side-kv"><dt>model</dt><dd>${esc(u.response_model || call.model || "—")}</dd>
      <dt>tokens</dt><dd>${number(u.input_tokens)} in · ${number(u.output_tokens)} out${u.reasoning_tokens ? ` · ${number(u.reasoning_tokens)} reasoning` : ""}</dd>
      <dt>time</dt><dd>${call.start ? new Date(call.start).toISOString().slice(11, 19) : "—"}${call.seconds != null ? ` · ${secs(call.seconds)}` : ""}${call.retries ? ` · ${call.retries} retr${call.retries === 1 ? "y" : "ies"}` : ""}</dd>
      ${u.finish_reason ? `<dt>finish</dt><dd>${esc(u.finish_reason)}</dd>` : ""}</dl>
    ${extra}
    ${m.reasoning_content ? `<details class="detail-block tone-violet"><summary>Reasoning</summary><div class="text-box">${esc(m.reasoning_content)}</div></details>` : ""}
    ${m.content ? `<details class="detail-block tone-info" open><summary>Response</summary><div class="text-box">${esc(m.content)}</div></details>` : ""}
    ${call.tools.length ? `<div class="side-section"><h4>Tool calls · ${call.tools.length}</h4>${toolList(call.tools, {facts: ctx.factsById})}</div>` : ""}
    ${call.steps.length ? `<div class="detail-block"><h4>Agent steps · ${call.steps.length}</h4><div class="chip-row">${call.steps.map(t => `<button class="step-chip" data-goto-step="${t}">${S(t)}</button>`).join("")}</div></div>` : ""}
    ${call.fids?.length ? `<details class="detail-block tone-violet"><summary>Facts · ${call.fids.length}</summary><div class="chip-col">${call.fids.slice(0, 40).map(fid => factChip(ctx.factsById?.get(fid))).join("")}${call.fids.length > 40 ? `<span class="muted">+${call.fids.length - 40} more</span>` : ""}</div></details>` : ""}
    ${requestBlock(call.requestFile, ctx.requests)}`;
}

// ---------- phase overview (a phase card is selected, no call) ----------
const PHASE_OVERVIEW = {ROUTE: routeOverview, MANAGER: managerOverview, TRACE: traceOverview, SUBMIT: submitOverview};

const callRow = c => `<button class="call-row ${c.rejected ? "is-rejected" : ""}" data-goto-call="${c.index}">
  <span class="mono muted">#${c.n}</span><span class="call-row-title">${esc(callTitle(c))}</span>
  ${c.status === "pending" ? '<span class="live-dot"></span>' : c.rejected ? '<span class="badge bad">rejected</span>' : ""}
  <small class="mono">${kilo(c.usage?.input_tokens)}${c.seconds != null ? ` · ${secs(c.seconds)}` : ""}</small></button>`;

export function phaseDetail(p, ctx) {
  if (p.parse) return parseDetail(p.parse, ctx.requests);
  const s = phaseStats(p);
  const rows = p.lanes.length > 1
    ? p.lanes.map(l => `<div class="call-group"><span class="eyebrow mono">${esc(l.key)}</span>${l.nodes.map(n => callRow(n.call)).join("")}</div>`).join("")
    : p.calls.map(callRow).join("");
  return `<header class="side-head"><span class="phase-dot phase-${p.phase}"></span><h3>${esc(p.phase)}</h3>
      ${s.pending ? '<span class="badge live"><span class="live-dot"></span>running</span>' : ""}</header>
    <dl class="kv side-kv"><dt>calls</dt><dd>${s.calls}${s.rejected ? ` · <span class="badge bad">${s.rejected} rejected</span>` : ""}</dd>
      <dt>tokens</dt><dd>${number(s.input)} in · ${number(s.output)} out</dd>
      ${s.seconds != null ? `<dt>time</dt><dd>${secs(s.seconds)}</dd>` : ""}</dl>
    ${PHASE_OVERVIEW[p.phase]?.(p, ctx) || ""}
    <div class="side-section"><h4>Calls · ${p.calls.length}</h4><div class="call-list">${rows}</div></div>`;
}

export function overviewHtml(d, phases) {
  const tokens = d.calls.reduce((s, c) => s + (c.usage?.input_tokens || 0) + (c.usage?.output_tokens || 0), 0);
  return `<header class="side-head"><h3>Debugger process</h3></header>
    <p class="muted">Each card is one phase. Open a card to see its model calls, one node per call; select a phase or a call to read it here. The agent steps it touched light up below.</p>
    <dl class="kv side-kv">${phases.map(p => `<dt><button class="link" data-goto-phase="${p.phase}">${esc(p.phase)}</button></dt><dd>${esc(short(phaseSummary(p), 60))}</dd>`).join("")}
      <dt>tokens</dt><dd>${number(tokens)}</dd>${d.result ? `<dt>status</dt><dd>${esc(d.result.status)}</dd>` : ""}</dl>`;
}
