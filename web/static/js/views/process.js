// Debugger process graph: one node per model call, one horizontal band per phase.
// TRACE has one row per manager assignment; PARSE calls fold into one group node.
import {CALL_PHASES} from "../case/calls.js";
import {factChip} from "../case/format.js";
import {esc, number, raw, short} from "../util.js";
import {routeBadge, routeDetail, routeTitle} from "./route.js";
import {managerDetail, managerTitle, traceBadge, traceDetail, traceTitle} from "./trace.js";

const W = 184, H = 80, GX = 34, LANE_GAP = 12, PAD = 14, LABEL = 132;
// Fan-out into a multi-row band runs down a bus in the label gutter and enters each row from the left.
const BUS = LABEL - 34;
const S = t => `S${String(t).padStart(2, "0")}`;
const kilo = n => n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n);
const secs = s => s == null ? "" : s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s` : `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;

export function toolSummary(tools) {
  const counts = new Map();
  tools.forEach(t => counts.set(t.name, (counts.get(t.name) || 0) + 1));
  return [...counts].map(([name, n]) => n > 1 ? `${name} ×${n}` : name).join(" · ");
}

// Phase-specific node titles, badges and side-panel sections.
const PHASE_TITLE = {ROUTE: routeTitle, MANAGER: managerTitle, TRACE: traceTitle};
const PHASE_BADGE = {ROUTE: routeBadge, TRACE: traceBadge};
const PHASE_DETAIL = {ROUTE: routeDetail, MANAGER: managerDetail, TRACE: traceDetail};

// Short node title. Phase-specific wording comes first, then a tool summary.
export function callTitle(call) {
  if (call.status === "pending") return "Waiting for model…";
  const special = PHASE_TITLE[call.phase]?.(call);
  if (special) return special;
  if (call.tools.length) return toolSummary(call.tools);
  return call.message?.content ? "Text answer" : "No output";
}

// plan: the manager's investigation plan; TRACE rows follow its assignment order.
export function layoutCalls(calls, parse, plan) {
  const assignments = new Map((plan?.assignments || []).map((a, i) => [a.agent_id, {...a, order: i}]));
  const bands = [];
  const band = phase => {
    let b = bands.find(x => x.phase === phase);
    if (!b) { b = {phase, lanes: []}; bands.push(b); }
    return b;
  };
  if (parse) band("PARSE").lanes.push({key: "parse", nodes: [{kind: "parse", id: "parse", parse}]});
  for (const call of calls) {
    const b = band(CALL_PHASES.includes(call.phase) ? call.phase : "OTHER");
    const key = call.phase === "TRACE" ? call.caseId || "?" : "main";
    let lane = b.lanes.find(l => l.key === key);
    if (!lane) { lane = {key, nodes: [], assignment: call.phase === "TRACE" ? assignments.get(key) : null}; b.lanes.push(lane); }
    lane.nodes.push({kind: "call", id: String(call.index), call});
  }
  const trace = bands.find(b => b.phase === "TRACE");
  trace?.lanes.sort((a, b) => (a.assignment?.order ?? 1e9) - (b.assignment?.order ?? 1e9));
  bands.sort((a, b) => CALL_PHASES.indexOf(a.phase) - CALL_PHASES.indexOf(b.phase));
  let y = 0, width = LABEL + W;
  for (const b of bands) {
    b.y = y;
    b.lanes.forEach((lane, li) => {
      lane.y = y + PAD + li * (H + LANE_GAP);
      lane.nodes.forEach((node, k) => { node.x = LABEL + k * (W + GX); node.y = lane.y; });
      width = Math.max(width, LABEL + lane.nodes.length * (W + GX));
    });
    b.height = PAD * 2 + b.lanes.length * H + (b.lanes.length - 1) * LANE_GAP;
    y += b.height;
  }
  // Within a lane: sequence (a retry after a rejected tool call is drawn dashed red).
  // Between consecutive bands: every lane's last node feeds every lane's first node.
  const edges = [];
  bands.forEach((b, i) => {
    b.lanes.forEach(lane => lane.nodes.slice(1).forEach((node, k) => {
      const prev = lane.nodes[k];
      edges.push({kind: "seq", from: prev, to: node, retry: Boolean(prev.call?.rejected)});
    }));
    const next = bands[i + 1];
    // Fan-out into a multi-row band enters each row from the left bus; fan-in leaves each
    // row on the right and merges on a bus past the longest row. Edges into a TRACE row
    // are labelled with the ROUTE case it was assigned.
    if (!next) return;
    const right = Math.max(...b.lanes.map(l => l.nodes.at(-1).x + W)) + 18;
    b.lanes.forEach(a => next.lanes.forEach(c =>
      edges.push({kind: "handoff", from: a.nodes[a.nodes.length - 1], to: c.nodes[0], retry: false,
                  route: next.lanes.length > 1 ? "fanout" : b.lanes.length > 1 ? "fanin" : "curve",
                  top: next.y + 7, right, label: b.phase === "MANAGER" ? c.assignment?.anchor_case_id : null})));
  });
  return {bands, edges, width: width + 8, height: y};
}

function edgePath(e) {
  const a = e.from, b = e.to;
  if (e.kind === "seq") return `M${a.x + W},${a.y + H / 2} L${b.x - 6},${b.y + H / 2}`;
  if (e.route === "fanout") return `M${a.x + W / 2},${a.y + H} V${e.top} H${BUS} V${b.y + H / 2} H${b.x - 6}`;
  if (e.route === "fanin") return `M${a.x + W},${a.y + H / 2} H${e.right} V${b.y - 16} H${b.x + W / 2} V${b.y - 6}`;
  const x1 = a.x + W / 2, y1 = a.y + H, x2 = b.x + W / 2, y2 = b.y - 6, dy = Math.max(18, (y2 - y1) / 2);
  return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
}

function nodeHtml(node, sel) {
  const pos = `left:${node.x}px;top:${node.y}px;width:${W}px;height:${H}px`;
  if (node.kind === "parse") {
    const p = node.parse;
    return `<button class="pnode phase-PARSE ${sel === "parse" ? "is-selected" : ""} ${p.pending ? "is-pending" : ""}" data-call="parse" style="${pos}">
      <span class="pn-top"><span class="mono">PARSE</span><span>${p.calls.length} call${p.calls.length === 1 ? "" : "s"}</span></span>
      <span class="pn-title">Source parsing</span>
      <span class="pn-foot mono">${kilo(p.input)} in · ${kilo(p.output)} out · ${secs(p.seconds)}</span></button>`;
  }
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

export function graphHtml(layout, sel) {
  const {bands, edges, width, height} = layout;
  return `<div class="proc-canvas" style="width:${width}px;height:${height}px">
    ${bands.map(b => `<div class="proc-band phase-${b.phase}" style="top:${b.y}px;height:${b.height}px"><span class="proc-band-label"><span class="phase-dot"></span>${b.phase}</span>
      ${b.phase === "TRACE" ? b.lanes.map(l => `<span class="proc-lane-label" style="top:${l.y - b.y + H / 2}px" title="${esc(l.assignment?.question || l.key)}"><span class="mono">${esc(short(l.key, 12))}</span></span>`).join("") : ""}</div>`).join("")}
    <svg class="proc-edges" width="${width}" height="${height}" aria-hidden="true">
      <defs><marker id="proc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
      ${edges.map(e => `<path class="proc-edge ${e.kind} ${e.retry ? "is-retry" : ""}" d="${edgePath(e)}" marker-end="url(#proc-arrow)"/>`).join("")}
    </svg>
    ${edges.filter(e => e.label).map(e => `<span class="proc-edge-label badge anchor" style="left:${(BUS + e.to.x) / 2}px;top:${e.to.y + H / 2}px" title="ROUTE case assigned to ${esc(e.to.call?.caseId || "")}">${esc(e.label)}</span>`).join("")}
    ${bands.flatMap(b => b.lanes.flatMap(l => l.nodes)).map(n => nodeHtml(n, sel)).join("")}
  </div>`;
}

// ---------- side panel ----------
function toolBlock(t, i) {
  const result = t.result?.data ?? t.result;
  const tone = t.error ? "bad" : t.committed ? "teal" : "plain";
  return `<details class="detail-block tone-${tone}" ${t.error ? "open" : ""}>
    <summary><span class="mono">${esc(t.name)}</span>${t.error ? ' <span class="badge bad">rejected</span>' : t.committed ? "" : ' <span class="badge">pending</span>'}</summary>
    ${t.error ? `<p>${esc(t.error.message || t.error.code || JSON.stringify(t.error))}</p>` : ""}
    <h4>Arguments</h4>${raw(t.args)}
    ${t.committed && !t.error ? `<h4>Result</h4>${typeof result === "string" ? `<div class="text-box">${esc(result)}</div>` : raw(result)}` : ""}
  </details>`;
}

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
  if (call === "parse") return parseDetail(ctx.parse, ctx.requests);
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
    ${call.tools.length ? `<div class="side-section"><h4>Tool calls · ${call.tools.length}</h4>${call.tools.map(toolBlock).join("")}</div>` : ""}
    ${call.steps.length ? `<div class="detail-block"><h4>Agent steps · ${call.steps.length}</h4><div class="chip-row">${call.steps.map(t => `<button class="step-chip" data-goto-step="${t}">${S(t)}</button>`).join("")}</div></div>` : ""}
    ${call.fids?.length ? `<details class="detail-block tone-violet"><summary>Facts · ${call.fids.length}</summary><div class="chip-col">${call.fids.slice(0, 40).map(fid => factChip(ctx.factsById?.get(fid))).join("")}${call.fids.length > 40 ? `<span class="muted">+${call.fids.length - 40} more</span>` : ""}</div></details>` : ""}
    ${requestBlock(call.requestFile, ctx.requests)}`;
}

export function overviewHtml(d) {
  const by = new Map();
  d.calls.forEach(c => by.set(c.phase, (by.get(c.phase) || 0) + 1));
  const tokens = d.calls.reduce((s, c) => s + (c.usage?.input_tokens || 0) + (c.usage?.output_tokens || 0), 0);
  return `<header class="side-head"><h3>Debugger process</h3></header>
    <p class="muted">Each node is one model call. Select a node to read its output and tool calls; the agent steps it touched light up below.</p>
    <dl class="kv side-kv">${d.parse ? `<dt>PARSE</dt><dd>${d.parse.calls.length} calls</dd>` : ""}${[...by].map(([p, n]) => `<dt>${esc(p)}</dt><dd>${n} call${n === 1 ? "" : "s"}</dd>`).join("")}
      <dt>tokens</dt><dd>${number(tokens)}</dd>${d.result ? `<dt>status</dt><dd>${esc(d.result.status)}</dd>` : ""}</dl>`;
}
