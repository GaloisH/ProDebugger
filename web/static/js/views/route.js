// ROUTE calls: retrieval rounds, the decision-only gate, anchor declarations (route_cases)
// and early finishes. Field names follow debugger_agent / route_context / query_trace.
import {esc, short} from "../util.js";

const S = t => `S${String(t).padStart(2, "0")}`;
export const DECISION_ONLY = 3; // route_context: rounds without new evidence before only route_cases/finish remain

const progressOf = call => call.inputs.findLast(i => i && typeof i === "object" && i.retrieval_progress)?.retrieval_progress;
const timelineOf = call => call.inputs.find(i => typeof i?.schema === "string" && i.schema.startsWith("route-timeline"));
const decision = call => call.tools.find(t => ["route_cases", "finish", "reroute"].includes(t.name));

export function routeTitle(call) {
  const d = decision(call);
  if (!d) return null;
  if (d.name === "route_cases") {
    const n = (d.args?.candidates || []).length;
    return d.error ? `Anchors rejected (${n})` : `${n} anchor case${n === 1 ? "" : "s"}`;
  }
  if (d.name === "finish") return `Finish · ${d.args?.status || "?"}`;
  return d.name;
}

export function routeBadge(call) {
  const stalled = progressOf(call)?.consecutive_rounds_without_new_evidence || 0;
  return stalled >= DECISION_ONLY ? `<span class="badge warn" title="${stalled} rounds without new evidence: only route_cases and finish were offered">decision-only</span>` : "";
}

function anchorCard(c) {
  return `<div class="detail-block anchor-card">
    <h4><span class="mono">${esc(c.candidate_id)}</span><button class="step-chip" data-goto-step="${c.issue_step}">${S(c.issue_step)}</button></h4>
    <div class="chip-row">${(c.goal_links || []).map(g => `<span class="chip mono">${esc(g)}</span>`).join("")}
      ${(c.issue_fids || []).map(fid => `<button class="mono link" data-fid="${fid}">f${fid}</button>`).join(" ")}</div>
    <details><summary>Hypothesis</summary><div class="text-box">${esc(c.hypothesis || "")}</div></details>
  </div>`;
}

function inputBlock(timeline) {
  const q = timeline.evidence_quality || {};
  const gaps = q.parse_gaps || [];
  const topics = (timeline.steps || []).filter(r => Object.values(r.statement_discovery || {}).some(m => m.topics?.length)).length;
  return `<div class="detail-block tone-info"><h4>Route timeline input</h4>
    <dl class="kv"><dt>steps</dt><dd>${timeline.step_count ?? (timeline.steps || []).length}${timeline.complete ? " · complete" : ""}</dd>
      <dt>parse gaps</dt><dd>${gaps.length ? `${gaps.length} — ${gaps.map(g => g.step ? `<button class="step-chip" data-goto-step="${g.step}">${S(g.step)}</button>` : "task").join(" ")}` : "none"}</dd>
      <dt>unmodeled goals</dt><dd>${(q.unmodeled_goals || []).map(esc).join(", ") || "none"}</dd>
      <dt>statement topics</dt><dd>${topics} step${topics === 1 ? "" : "s"}</dd></dl>
    ${gaps.length ? `<p class="muted">Parse gaps are unknowns, not agent errors; they are marked on the agent steps below.</p>` : ""}
  </div>`;
}

export function routeDetail(call) {
  const parts = [];
  const timeline = timelineOf(call);
  if (timeline) parts.push(inputBlock(timeline));
  const p = progressOf(call);
  if (p) {
    const stalled = p.consecutive_rounds_without_new_evidence || 0;
    parts.push(`<div class="detail-block ${stalled >= DECISION_ONLY ? "tone-warn" : ""}"><h4>Retrieval progress${stalled >= DECISION_ONLY ? ' <span class="badge warn">decision-only</span>' : ""}</h4>
      <dl class="kv"><dt>distinct reads</dt><dd>${p.distinct_successful_reads ?? "—"}</dd><dt>rounds without new evidence</dt><dd>${stalled} / ${DECISION_ONLY}</dd></dl>
      ${stalled >= DECISION_ONLY ? `<p class="muted">Only route_cases and finish were offered this turn; another retrieval ends ROUTE as uncertain.</p>` : ""}</div>`);
  }
  const d = decision(call);
  if (d?.name === "route_cases") {
    const cases = d.args?.candidates || [];
    parts.push(`<div class="side-section"><h4>Anchor cases · ${cases.length}${d.error ? ' <span class="badge bad">rejected</span>' : d.result?.data?.window_version ? ` <span class="badge">version ${d.result.data.window_version}</span>` : ""}</h4>
      ${d.error ? `<div class="detail-block tone-bad"><p>${esc(d.error.message || d.error.code)}</p></div>` : ""}
      ${cases.map(anchorCard).join("")}</div>`);
  } else if (d?.name === "finish") {
    parts.push(`<div class="detail-block tone-warn"><h4>Finish <span class="badge warn">${esc(d.args?.status || "?")}</span></h4><div class="text-box">${esc(d.args?.reason || "")}</div></div>`);
  }
  return parts.join("");
}

// Phase overview: the accepted anchors (or the early finish) that ROUTE handed on.
export function routeOverview(p) {
  const last = [...p.calls].reverse().map(c => ({call: c, d: decision(c)})).find(x => x.d && !x.d.error);
  const reads = p.calls.flatMap(c => c.tools).filter(t => !["route_cases", "finish", "reroute"].includes(t.name)).length;
  const head = `<p class="muted">${reads} evidence read${reads === 1 ? "" : "s"} before the decision.</p>`;
  if (!last) return head;
  const goto = `<button class="btn" data-goto-call="${last.call.index}">Open #${last.call.n}</button>`;
  if (last.d.name === "finish") return head + `<div class="detail-block tone-warn"><h4>Finish <span class="badge warn">${esc(last.d.args?.status || "?")}</span></h4><div class="text-box">${esc(last.d.args?.reason || "")}</div>${goto}</div>`;
  const cases = last.d.args?.candidates || [];
  return head + `<div class="side-section"><h4>Anchor cases · ${cases.length} ${goto}</h4>${cases.map(anchorCard).join("")}</div>`;
}

// Latest accepted anchors, keyed by step, for the agent step lane.
export function anchorsByStep(routeCandidates) {
  const versions = Array.isArray(routeCandidates) ? routeCandidates : [];
  const out = new Map();
  (versions.at(-1)?.windows || []).forEach(c => {
    if (!out.has(c.issue_step)) out.set(c.issue_step, []);
    out.get(c.issue_step).push(c);
  });
  return out;
}

export const anchorTitle = c => `${c.candidate_id}: ${short(c.hypothesis || "", 200)}`;
