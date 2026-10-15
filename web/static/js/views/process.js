// Debugger process: one column per phase, left to right, on a single canvas. Each phase is a
// card that expands downwards into its model calls (one node per call), several at once.
// Handoff edges join consecutive phases: from every column's last node (or the collapsed card)
// to every column's first node (or the card). TRACE has one column per manager assignment.
import {CALL_PHASES} from "../case/calls.js";
import {factChip} from "../case/format.js";
import {esc, loader, number, raw, short} from "../util.js";
import {routeBadge, routeDetail, routeOverview, routeTitle} from "./route.js";
import {managerDetail, managerOverview, managerTitle, traceBadge, traceDetail, traceOverview, traceSummary, traceTitle} from "./trace.js";
import {submitDetail, submitOverview, submitTitle} from "./submit.js";
import {toolList} from "./tools.js";

// Card (collapsed, and the header of an open card), node size and gaps.
const CW = 216, CH = 124, W = 184, H = 80, GY = 34, LANE_GAP = 12, BAND_GAP = 44, PAD = 20;
// Where an open card's nodes start. TRACE columns: assignment label, then the fan-out bus
// carrying the MANAGER handoff, then the anchor-case label on the edge into each column.
const NODE_Y = CH + 24, LANE_LABEL_Y = CH + 10, BUS = CH + 40, TRACE_Y = CH + 78;
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

// Phases in pipeline order, each with its calls grouped into columns: TRACE has one column per
// manager assignment, in the plan's order. PARSE is a single card without rows.
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
  return phases;
}

export const expandable = p => !p.parse && p.calls.length > 0;

// Positions every card and node on one canvas. open: the set of expanded phases.
export function layoutProcess(phases, open) {
  const edges = [];
  let x = 0, height = CH;
  for (const p of phases) {
    p.open = open.has(p.phase) && expandable(p);
    p.x = x;
    if (p.open) {
      const y0 = p.phase === "TRACE" ? TRACE_Y : NODE_Y;
      const span = p.lanes.length * W + (p.lanes.length - 1) * LANE_GAP;
      p.width = Math.max(CW, span + PAD * 2);
      p.lanes.forEach((lane, li) => {
        lane.x = x + (p.width - span) / 2 + li * (W + LANE_GAP);
        lane.nodes.forEach((node, k) => Object.assign(node, {x: lane.x, y: y0 + k * (H + GY), w: W, h: H}));
        // Sequence within a column; a retry after a rejected tool call is drawn dashed red.
        lane.nodes.slice(1).forEach((node, k) => edges.push({kind: "seq", from: lane.nodes[k], to: node, retry: Boolean(lane.nodes[k].call.rejected)}));
      });
      p.height = y0 + Math.max(...p.lanes.map(l => l.nodes.length)) * (H + GY) - GY + PAD;
      p.entries = p.lanes.map(l => l.nodes[0]);
      p.exits = p.lanes.map(l => l.nodes.at(-1));
    } else {
      p.width = CW; p.height = CH;
      p.entries = p.exits = [{x, y: 0, w: CW, h: CH}];
    }
    height = Math.max(height, p.height);
    x += p.width + BAND_GAP;
  }
  // Fan-out into a multi-column phase runs along the gap before it, across the bus and into
  // each column from above; fan-in leaves each column at the bottom and merges below the
  // longest one. Edges into a TRACE column are labelled with the ROUTE case it was assigned.
  phases.forEach((p, i) => {
    const next = phases[i + 1];
    if (!next) return;
    const bottom = Math.max(...p.exits.map(a => a.y + a.h)) + 12;
    const route = next.entries.length > 1 ? "fanout" : p.exits.length > 1 ? "fanin" : "curve";
    next.entries.forEach((b, j) => p.exits.forEach((a, k) => edges.push({kind: "handoff", from: a, to: b, route, bottom, gap: next.x - BAND_GAP / 2,
      label: k === 0 && p.phase === "MANAGER" && next.open ? next.lanes[j].assignment?.anchor_case_id : null})));
  });
  return {phases, edges, width: Math.max(0, x - BAND_GAP), height: height + 8};
}

function edgePath(e) {
  const a = e.from, b = e.to;
  if (e.kind === "seq") return `M${a.x + a.w / 2},${a.y + a.h} L${b.x + b.w / 2},${b.y - 6}`;
  if (e.route === "fanout") return `M${a.x + a.w},${a.y + a.h / 2} H${e.gap} V${BUS} H${b.x + b.w / 2} V${b.y - 6}`;
  if (e.route === "fanin") return `M${a.x + a.w / 2},${a.y + a.h} V${e.bottom} H${e.gap} V${b.y + b.h / 2} H${b.x - 6}`;
  const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x - 6, y2 = b.y + b.h / 2, dx = Math.max(18, (x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
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

// sel: the selected call; selPhase: the phase the selection is in.
function phaseCard(p, {sel, selPhase}) {
  const s = phaseStats(p);
  const selected = selPhase === p.phase && (sel == null || !p.open);
  const cls = ["ph-card", `phase-${p.phase}`, p.open && "is-open", selected && "is-selected", s.pending && "is-pending"].filter(Boolean).join(" ");
  const summary = phaseSummary(p);
  return `<article class="${cls}" data-phase="${p.phase}" style="left:${p.x}px;top:0;width:${p.width}px;height:${p.height}px">
    <div class="ph-meta" style="height:${CH}px">
      <div class="ph-top"><span class="phase-dot"></span><span class="ph-name mono">${esc(p.phase)}</span>
        ${s.pending ? '<span class="live-dot" title="In progress"></span>' : ""}${s.rejected ? `<span class="badge bad" title="Calls with a rejected tool call">${s.rejected} rejected</span>` : ""}</div>
      <span class="ph-count">${plural(s.calls, "call")}${p.phase === "TRACE" ? ` · ${plural(p.lanes.length, "column")}` : ""}</span>
      <h3 class="ph-title" title="${esc(summary)}">${esc(summary)}</h3>
      <div class="ph-foot mono">${kilo(s.input)} in · ${kilo(s.output)} out${s.seconds != null ? ` · ${secs(s.seconds)}` : ""}</div>
      ${expandable(p) ? `<button class="card-toggle" data-toggle-phase="${p.phase}" aria-expanded="${p.open}" aria-label="${p.open ? "Collapse" : "Expand"} ${esc(p.phase)}">${p.open ? "−" : "+"}</button>` : ""}
    </div>
  </article>`;
}

export function processHtml(layout, view) {
  const {phases, edges, width, height} = layout;
  const open = phases.filter(p => p.open);
  return `<div class="proc-canvas" style="width:${width}px;height:${height}px">
    ${phases.map(p => phaseCard(p, view)).join("")}
    ${open.filter(p => p.phase === "TRACE").flatMap(p => p.lanes).map(l => `<span class="proc-lane-label" style="left:${l.x + W / 2}px;top:${LANE_LABEL_Y}px;max-width:${W}px" title="${esc(l.assignment?.question || l.key)}"><span class="mono">${esc(short(l.key, 14))}</span></span>`).join("")}
    <svg class="proc-edges" width="${width}" height="${height}" aria-hidden="true">
      <defs><marker id="proc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
      ${edges.map(e => `<path class="proc-edge ${e.kind} ${e.retry ? "is-retry" : ""}" d="${edgePath(e)}" marker-end="url(#proc-arrow)"/>`).join("")}
    </svg>
    ${edges.filter(e => e.label).map(e => `<span class="proc-edge-label badge anchor" style="left:${e.to.x + W / 2}px;top:${(BUS + e.to.y) / 2}px" title="ROUTE case assigned to ${esc(e.to.call?.caseId || "")}">${esc(e.label)}</span>`).join("")}
    ${open.flatMap(p => p.lanes.flatMap(l => l.nodes)).map(n => nodeHtml(n, view.sel)).join("")}
  </div>`;
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
  if (r === "loading") return loader("Loading request…", true);
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
