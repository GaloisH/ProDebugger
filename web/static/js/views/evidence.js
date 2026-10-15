// Result graph: how the evidence led to the answer. One lane per MANAGER assignment and
// six layers left to right: ROUTE issue facts → anchor cases → MANAGER questions → TRACE SQL
// findings → TRACE candidates → SUBMIT answer. Edge labels carry structured facts only
// (requirements, step moves, selected or not); free-text reasoning stays in the side panel.
import {factText} from "../case/format.js";
import {esc, short} from "../util.js";
import {anchorCard} from "./route.js";
import {answerOf} from "./submit.js";
import {assessOf, assignmentCard, candidateCard, planOf, queryDetail, queryOf, ruleRow} from "./trace.js";

const S = t => `S${String(t).padStart(2, "0")}`;
const human = s => String(s || "").replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const SLOT = {obs: "observation", mem: "memory", refl: "reflection", plan: "plan", act: "action"};

export const LAYERS = [["Evidence", "ROUTE facts"], ["ROUTE", "Anchors"], ["MANAGER", "Questions"],
  ["TRACE", "SQL findings"], ["TRACE", "Candidates"], ["SUBMIT", "Answer"]];

// "S02–S03, S22 +1": consecutive steps folded into ranges, at most `max` ranges shown.
export function stepRanges(steps, max = 2) {
  const sorted = [...new Set(steps)].sort((a, b) => a - b), ranges = [];
  sorted.forEach(t => {
    const last = ranges.at(-1);
    if (last && t === last[1] + 1) last[1] = t; else ranges.push([t, t]);
  });
  const text = ranges.slice(0, max).map(([a, b]) => a === b ? S(a) : `${S(a)}–${S(b)}`).join(", ");
  return ranges.length > max ? `${text} +${ranges.length - max}` : text;
}

const purposeOf = sql => String(sql || "").match(/--\s*Purpose:\s*([^\n]*)/i)?.[1]?.trim() || "";

// Nodes carry {id, layer, lane, kind, label, sub, badge, title, goto, cls} plus what the side
// panel needs; edges carry {from, to, label, cls}. `stop` describes a run without a root.
export function buildEvidence(model, stop) {
  const d = model.debugger, r = d.result || {};
  const facts = model.dsl?.factsById;
  const windows = (Array.isArray(d.routeCandidates) ? d.routeCandidates.at(-1) : d.routeCandidates)?.windows || [];
  const planCall = [...d.calls].reverse().find(planOf);
  const plan = d.managerPlan || (planCall && planOf(planCall));
  const assignments = plan?.assignments || [];
  const nodes = new Map(), edges = [];
  const add = n => { nodes.set(n.id, n); return n; };
  const link = (from, to, extra = {}) => { if (nodes.has(from) && nodes.has(to)) edges.push({from, to, ...extra}); };
  const windowOf = id => windows.find(w => w.candidate_id === id);

  // Anchors sit over the lanes they anchor, else over the lanes that also route them.
  const lanesOf = id => {
    const own = assignments.map((a, i) => a.anchor_case_id === id ? i : null).filter(i => i != null);
    return own.length ? own : assignments.map((a, i) => (a.route_case_ids || []).includes(id) ? i : null).filter(i => i != null);
  };
  let spare = assignments.length;
  windows.forEach(w => {
    const lanes = lanesOf(w.candidate_id);
    const lo = w.lo ?? w.issue_step, hi = w.hi ?? w.issue_step;
    add({id: `a:${w.candidate_id}`, layer: 1, kind: "anchor", lane: lanes.length ? mean(lanes) : spare++,
      label: `Anchor ${w.candidate_id} · ${S(w.issue_step)}`, sub: lo === hi ? `window ${S(lo)}` : `window ${S(lo)}–${S(hi)}`,
      title: short(w.hypothesis || "", 300), window: w, goto: {step: w.issue_step}});
    // The anchor's issue facts, folded into one evidence node so the top layer stays as
    // narrow as the anchors; the side panel lists every fact.
    const list = (w.issue_fids || []).map(fid => facts?.get(Number(fid))).filter(Boolean);
    if (!list.length) return;
    const steps = [...new Set(list.map(f => f.t))];
    const slots = [...new Set(list.map(f => f.slot || "fact"))];
    const reqs = (w.goal_links || []).map(g => String(g).replace(/^req:/, ""));
    add({id: `f:${w.candidate_id}`, layer: 0, kind: "fact", lane: nodes.get(`a:${w.candidate_id}`).lane, facts: list,
      label: steps.length === 1 ? `${S(steps[0])} · ${slots.join(", ")}` : `${stepRanges(steps)} · ${plural(list.length, "fact")}`,
      sub: short(list.map(f => `f${f.fid}`).join(", "), 25), title: list.map(f => `f${f.fid} ${factText(f)}`).join("\n"), goto: {step: w.issue_step}});
    link(`f:${w.candidate_id}`, `a:${w.candidate_id}`, reqs.length ? {label: `violates ${reqs.join(", ")}`} : {});
  });


  // Per assignment: question → SQL findings → candidates.
  const candidates = new Map(); // trace-window id -> node
  assignments.forEach((a, lane) => {
    const anchor = windowOf(a.anchor_case_id);
    add({id: `q:${a.agent_id}`, layer: 2, kind: "question", lane, label: a.agent_id,
      sub: anchor ? `about ${S(anchor.issue_step)}` : "question", title: short(a.question || "", 300),
      assignment: a, goto: planCall ? {call: planCall.n} : null});
    link(`a:${a.anchor_case_id}`, `q:${a.agent_id}`);
    (a.route_case_ids || []).filter(id => id !== a.anchor_case_id).forEach(id => link(`a:${id}`, `q:${a.agent_id}`, {cls: "ev-shared", label: "shared case"}));

    const calls = d.calls.filter(c => c.phase === "TRACE" && c.caseId === a.agent_id);
    const queries = calls.filter(queryOf), tried = calls.filter(c => c.tools.some(t => t.name === "query_logs"));
    let from = `q:${a.agent_id}`;
    if (tried.length) {
      const data = queries.map(queryOf);
      const steps = data.flatMap(q => q.returned_steps || []);
      const rows = data.reduce((s, q) => s + (q.returned_rows ?? (q.rows || []).length), 0);
      add({id: `sql:${a.agent_id}`, layer: 3, kind: "sql", lane, cls: queries.length ? "" : "ev-warn",
        label: steps.length ? stepRanges(steps) : queries.length ? "No matching rows" : "Queries rejected",
        sub: `${plural(queries.length, "SQL")} · ${plural(rows, "row")}${tried.length > queries.length ? ` · ${tried.length - queries.length} rejected` : ""}`,
        title: queries.map(c => purposeOf(c.tools.find(t => t.name === "query_logs" && !t.error)?.args?.sql)).filter(Boolean).join("\n"),
        calls: tried, goto: {call: (queries.at(-1) || tried.at(-1)).n}});
      link(from, `sql:${a.agent_id}`);
      from = `sql:${a.agent_id}`;
    }
    const assessed = calls.filter(assessOf).at(-1);
    if (!assessed) return;
    const list = assessOf(assessed).candidates || [];
    if (!list.length) {
      add({id: `none:${a.agent_id}`, layer: 4, kind: "none", lane, cls: "ev-muted", label: "No candidate", sub: "nothing at one step", call: assessed, goto: {call: assessed.n}});
      link(from, `none:${a.agent_id}`);
      return;
    }
    list.forEach((c, i) => {
      const id = `trace-window:${a.agent_id}:${i + 1}`;
      const n = add({id: `c:${id}`, layer: 4, kind: "candidate", lane, slot: i, slots: list.length,
        label: `${S(c.step)} ${c.module || ""}`.trim(), sub: human(c.fault_class), badge: c.is_root_cause === false ? "not root" : null,
        title: short(c.proposition || "", 300), candidate: c, candidateId: id, call: assessed, goto: {call: assessed.n}});
      candidates.set(id, n);
      link(from, n.id, anchor && c.step !== anchor.issue_step ? {label: `${S(anchor.issue_step)} → ${S(c.step)}`} : {});
    });
  });

  // SUBMIT: the selected candidate feeds the answer, the rest one "ruled out" node.
  const submit = d.calls.filter(c => c.phase === "SUBMIT").at(-1);
  const answer = submit ? answerOf(submit) : null;
  const comparisons = new Map([...(answer?.comparisons || []), ...(r.candidate_comparisons || [])].map(c => [c.candidate_id, c.reasoning]));
  candidates.forEach((n, id) => { n.comparison = comparisons.get(id) || ""; });
  const rc = r.root;
  if (rc) {
    const chosen = candidates.get(rc.root_id);
    add({id: "answer", layer: 5, kind: "answer", lane: chosen ? chosen.lane : mean(assignments.map((_, i) => i)),
      label: `${S(rc.step)} ${rc.module || ""}`.trim(), sub: human(rc.fault_class), badge: "answer", title: short(rc.proposition || "", 300),
      root: rc, result: r, plan, goto: {step: rc.step}, submit});
    if (chosen) link(chosen.id, "answer", {cls: "ev-chosen", label: "selected", hot: true});
    const out = [...candidates.values()].filter(n => n !== chosen);
    if (out.length) {
      add({id: "out", layer: 5, kind: "out", lane: mean(out.map(n => n.lane)), cls: "ev-muted",
        label: `Ruled out · ${out.length}`, sub: "not selected by SUBMIT", out, goto: submit ? {call: submit.n} : null});
      const seen = new Set(chosen ? [key(chosen.candidate)] : []);
      [...candidates.values()].forEach(n => {
        if (n === chosen) return;
        const dup = seen.has(key(n.candidate));
        seen.add(key(n.candidate));
        link(n.id, "out", {cls: "ev-ruled", label: dup ? "duplicate" : n.candidate.is_root_cause === false ? "not root" : "not selected"});
      });
    }
  } else if (stop) {
    const layer = stop.phase === "ROUTE" ? 1 : 5;
    const ends = [...nodes.values()].filter(n => n.layer < layer && !edges.some(e => e.from === n.id));
    add({id: "stop", layer, kind: "stop", cls: "ev-stop", lane: ends.length ? mean(ends.map(n => n.lane)) : 0,
      label: stop.label, sub: human(r.status), title: r.stop_reason || stop.title, stop, result: r, goto: stop.call ? {call: stop.call.n} : null});
    ends.filter(n => n.layer >= 3).forEach(n => link(n.id, "stop", {cls: "ev-ruled"}));
  }

  markChain(nodes, edges);
  return {nodes: [...nodes.values()], edges};
}

const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
const key = c => `${c.step}|${c.module}|${c.fault_class}`;

// Every solid edge on a path into the answer is part of the "because" chain; shared-case and
// ruled-out edges (dashed) never are.
function markChain(nodes, edges) {
  if (!nodes.has("answer")) return;
  const into = new Set(["answer"]);
  for (let grew = true; grew;) {
    grew = false;
    edges.forEach(e => { if (into.has(e.to) && !into.has(e.from) && !/ev-(shared|ruled)/.test(e.cls || "")) { into.add(e.from); grew = true; } });
  }
  edges.forEach(e => { if (into.has(e.to) && into.has(e.from)) e.chain = true; });
  into.forEach(id => { nodes.get(id).chain = true; });
}

// ---------- layout ----------
// Left to right: one column per layer, one row per lane. The gaps between columns hold the
// edge labels, wrapped to fit.
const NW = 168, NH = 50, GX = 104, GY = 22, LABEL_CHARS = 16;

function wrap(text) {
  const lines = [];
  String(text).split(" ").forEach(word => {
    if (lines.length && (lines.at(-1) + " " + word).length <= LABEL_CHARS) lines[lines.length - 1] += " " + word;
    else lines.push(word);
  });
  return lines;
}

export function layoutEvidence({nodes, edges}) {
  const used = [...new Set(nodes.map(n => n.layer))].sort((a, b) => a - b);
  const col = new Map(used.map((l, i) => [l, i]));
  // Lane heights fit their tallest column (usually the candidates).
  const laneCount = Math.max(1, Math.ceil(Math.max(0, ...nodes.map(n => n.lane)) + 1));
  const heights = Array.from({length: laneCount}, (_, i) => Math.max(1, ...nodes.filter(n => n.lane === i && n.slots).map(n => n.slots)) * (NH + GY));
  const starts = heights.map((_, i) => heights.slice(0, i).reduce((s, h) => s + h, 0));
  const centre = lane => {
    const lo = Math.floor(lane), hi = Math.min(laneCount - 1, Math.ceil(lane)), f = lane - lo;
    const c = i => starts[Math.min(i, laneCount - 1)] + heights[Math.min(i, laneCount - 1)] / 2;
    return c(lo) * (1 - f) + c(hi) * f;
  };
  used.forEach(layer => {
    const items = nodes.filter(n => n.layer === layer);
    items.forEach(n => { n.want = centre(n.lane) + (n.slots ? (n.slot - (n.slots - 1) / 2) * (NH + GY) : 0); });
    items.sort((a, b) => a.want - b.want);
    items.forEach((n, i) => { n.cy = i ? Math.max(n.want, items[i - 1].cy + NH + GY) : n.want; });
    const drift = mean(items.map(n => n.cy - n.want));
    items.forEach(n => Object.assign(n, {x: col.get(layer) * (NW + GX), y: n.cy - drift - NH / 2, w: NW, h: NH}));
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  const labels = [];
  const paths = edges.map(e => {
    const a = byId.get(e.from), b = byId.get(e.to);
    const ax = a.x + a.w, ay = a.y + a.h / 2, bx = b.x, by = b.y + b.h / 2, mx = (ax + bx) / 2;
    if (e.label) {
      // Crossing shared-case edges meet halfway, so their labels sit near the target instead.
      const t = e.cls === "ev-shared" ? .68 : .5, u = 1 - t;
      const x = u ** 3 * ax + 3 * u * t * mx + t ** 3 * bx, y = (u ** 3 + 3 * u * u * t) * ay + (3 * u * t * t + t ** 3) * by;
      const lines = wrap(e.label), top = y - 6 - (lines.length - 1) * 13;
      lines.forEach((text, i) => labels.push({x, y: top + i * 13, text, anchor: "middle", cls: `edge-label ${e.cls || ""} ${e.chain ? "on-chain" : ""}`}));
    }
    return {...e, path: `M${ax},${ay} C${mx},${ay} ${mx},${by} ${bx - 2},${by}`,
      cls: [e.cls, e.chain && "ev-chain"].filter(Boolean).join(" "), hot: e.hot || e.chain};
  });
  // One faint band per layer with its name on top (the band also keeps Fit from clipping it).
  const top = Math.min(...nodes.map(n => n.y)) - 20, bottom = Math.max(...nodes.map(n => n.y + n.h)) + 14;
  const groups = used.map(layer => {
    const x = col.get(layer) * (NW + GX);
    labels.push({x: x + NW / 2, y: top - 22, text: LAYERS[layer][0], anchor: "middle", cls: "band-label"});
    labels.push({x: x + NW / 2, y: top - 7, text: LAYERS[layer][1], anchor: "middle", cls: "band-sub"});
    return {x: x - 12, y: top - 44, w: NW + 24, h: bottom - top + 44, cls: "band-sep ev-band"};
  });
  return {
    nodes: nodes.map(n => ({id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, label: n.label, sub: n.sub, badge: n.badge, title: n.title,
      cls: [`ev-${n.kind}`, n.cls, n.chain && "on-chain"].filter(Boolean).join(" ")})),
    edges: paths, labels, groups,
  };
}

// ---------- side panel ----------
const callButton = (call, text) => call ? `<button class="btn" data-call="${call.n}">${esc(text || `Open call #${call.n}`)} →</button>` : "";

export function evidenceDetail(n, model) {
  const head = (eyebrow, title, extra = "") => `<div class="insp-head"><div class="eyebrow">${esc(eyebrow)}</div><h3>${esc(title)}</h3>${extra}</div>`;
  switch (n.kind) {
    case "fact":
      return head("ROUTE issue facts", n.label) + n.facts.map(f => `<div class="detail-block">
        <h4>${esc(`${S(f.t)} ${SLOT[f.slot] || f.slot || ""}`)}</h4>
        <h4 class="muted"><span class="mono">f${f.fid}</span><span class="chip-row"><button class="step-chip" data-goto-step="${f.t}">${S(f.t)}</button><button class="link" data-fid="${f.fid}">in fact graph ↗</button></span></h4>
        <p class="mono">${esc(factText(f))}</p>${f.span ? `<div class="text-box">${esc(f.span)}</div>` : ""}</div>`).join("");
    case "anchor":
      return head("ROUTE anchor case", n.label) + anchorCard(n.window).replace("<details>", "<details open>");
    case "question":
      return head("MANAGER question", n.assignment.agent_id) + assignmentCard(n.assignment) +
        (n.goto?.call ? `<p>${callButton({n: n.goto.call}, "Open the MANAGER call")}</p>` : "");
    case "sql":
      return head("TRACE SQL findings", n.label, `<p class="muted">${esc(n.sub)}</p>`) + n.calls.map(call => {
        const t = call.tools.find(x => x.name === "query_logs" && !x.error) || call.tools.find(x => x.name === "query_logs");
        const q = queryOf(call), purpose = purposeOf(t?.args?.sql);
        return `<div class="side-section"><h4>Query · call #${call.n} ${callButton(call, "Open")}</h4>${purpose ? `<p>${esc(purpose)}</p>` : ""}
          ${q ? queryDetail(q, t.args?.sql) : `<div class="detail-block tone-bad"><p>${esc(t?.error?.message || t?.error?.code || "rejected")}</p></div>`}</div>`;
      }).join("");
    case "candidate":
      return head(`TRACE candidate · ${n.candidateId.replace(/^trace-window:/, "")}`, n.label) + candidateCard(n.candidate) +
        (n.comparison ? `<div class="detail-block tone-info"><h4>SUBMIT comparison</h4><p>${esc(n.comparison)}</p></div>` : "") +
        `<p>${callButton(n.call, "Open the assessment")}</p>`;
    case "none":
      return head("TRACE assessment", "No candidate") + `<p class="muted">The evidence did not support an error at a single step.</p><p>${callButton(n.call)}</p>`;
    case "answer": {
      const rc = n.root, r = n.result;
      return head("SUBMIT answer", `${S(rc.step)} · ${human(rc.fault_class)}`, `<div class="chip-row"><span class="badge ${r.accepted ? "ok" : "warn"}">${r.accepted ? "accepted" : esc(r.status)}</span><span class="badge">${esc(rc.module || "")}</span></div>`) +
        `<div class="detail-block tone-bad">${rc.output_quote ? `<blockquote>${esc(rc.output_quote)}</blockquote>` : ""}<p>${esc(rc.proposition || "")}</p>
          <details><summary>Reasoning</summary><p>${esc(rc.reasoning || r.reasoning || "")}</p></details></div>` +
        (r.repair ? `<div class="detail-block tone-ok"><h4>Suggested repair</h4><p>${esc(r.repair)}</p></div>` : "") +
        ((n.plan?.decision_rules || []).length ? `<div class="side-section"><h4>Decision rules · ${n.plan.decision_rules.length}</h4><div class="detail-block rule-table">${n.plan.decision_rules.map(ruleRow).join("")}</div></div>` : "") +
        `<p><button class="btn primary" data-goto-step="${rc.step}">Inspect ${S(rc.step)} →</button> ${callButton(n.submit, "Open SUBMIT")}</p>`;
    }
    case "out":
      return head("SUBMIT", n.label) + n.out.map(c => `<div class="detail-block">
        <h4><span class="mono">${esc(c.candidateId.replace(/^trace-window:/, ""))}</span><span class="chip-row"><button class="step-chip" data-goto-step="${c.candidate.step}">${S(c.candidate.step)}</button><strong>${esc(c.candidate.module || "")}</strong></span></h4>
        <p>${esc(c.comparison || "No comparison recorded.")}</p></div>`).join("");
    case "stop": {
      const s = n.stop, r = n.result;
      return head("Failure attribution", s.title) + `<div class="detail-block tone-warn">${s.text ? `<p>${esc(s.text)}</p>` : ""}
        <dl class="kv"><dt>stop reason</dt><dd>${esc(r.stop_reason || "—")}</dd></dl></div>` +
        (r.uncertainty && r.uncertainty !== r.stop_reason ? `<details class="detail-block"><summary>Uncertainty</summary><p>${esc(r.uncertainty)}</p></details>` : "") +
        `<p>${callButton(s.call, "Open the call")}</p>`;
    }
    default: return "";
  }
}
