// MANAGER and TRACE calls: the investigation plan (plan_trace), one element SQL query per
// assignment (query_logs) and its single-step assessment (assess). Field names follow
// trace_manager / query_trace / window_trace.
import {esc, short} from "../util.js?v=d7ea551f31";

const S = t => `S${String(t).padStart(2, "0")}`;
const stepOfSource = id => Number(String(id || "").split(":")[1]) || null; // "source:7:plan" -> 7
const ok = (call, name) => call.tools.find(t => t.name === name && !t.error);
const tried = (call, name) => call.tools.find(t => t.name === name);

export const planOf = call => ok(call, "plan_trace")?.result?.data || null;
export const queryOf = call => ok(call, "query_logs")?.result?.data || null;
export const assessOf = call => ok(call, "assess")?.result?.data || null;

// ---------- node titles ----------
export function managerTitle(call) {
  const plan = planOf(call);
  if (plan) return `${plan.assignments.length} assignment${plan.assignments.length === 1 ? "" : "s"} · ${(plan.decision_rules || []).length} rules`;
  return tried(call, "plan_trace") ? "Plan rejected" : null;
}

export function traceTitle(call) {
  const q = queryOf(call);
  if (q) return `SQL · ${q.returned_rows ?? q.rows?.length ?? 0} rows · ${(q.returned_steps || []).length} steps`;
  const a = assessOf(call);
  if (a) {
    const c = a.candidates || [];
    if (!c.length) return "No candidate";
    const steps = [...new Set(c.map(x => x.step))];
    return `${steps.map(S).join(" ")} · ${[...new Set(c.map(x => x.module))].join("/")}`;
  }
  if (tried(call, "query_logs")) return "Query rejected";
  if (tried(call, "assess")) return "Assessment rejected";
  return null;
}

export function traceBadge(call) {
  const q = queryOf(call);
  if (q && (q.function_errors?.length || q.partial || q.truncated)) return `<span class="badge warn" title="Partial result: failed branches are unavailable, not zero matches">partial</span>`;
  const a = assessOf(call);
  if (a?.candidates?.some(c => c.is_root_cause === false)) return `<span class="badge" title="An error that TRACE judged not to be the root cause">not root</span>`;
  return "";
}

// ---------- MANAGER ----------
export function assignmentCard(a) {
  const crit = a.criteria || {};
  return `<div class="detail-block assignment">
    <h4><span class="mono">${esc(a.agent_id)}</span><span class="chip-row"><span class="badge anchor" title="anchor case">${esc(a.anchor_case_id)}</span>${(a.route_case_ids || []).filter(id => id !== a.anchor_case_id).map(id => `<span class="badge">${esc(id)}</span>`).join("")}</span></h4>
    <p>${esc(a.question || "")}</p>
    ${(a.evidence || []).length ? `<div class="quote-list">${a.evidence.map(e => {
      const t = stepOfSource(e.source_id);
      return `<div class="quote-row">${t ? `<button class="step-chip" data-goto-step="${t}">${S(t)}</button>` : ""}<span class="mono muted">${esc(String(e.source_id || "").split(":").slice(2).join(":"))}</span><q>${esc(e.quote)}</q></div>`;
    }).join("")}</div>` : ""}
    <details><summary>Criteria</summary><dl class="kv criteria">${["supported", "refuted", "unknown"].map(k => crit[k] ? `<dt><span class="badge ${k === "supported" ? "bad" : k === "refuted" ? "ok" : ""}">${k}</span></dt><dd>${esc(crit[k])}</dd>` : "").join("")}</dl></details>
    ${(a.search_targets || []).length ? `<details><summary>Search targets · ${a.search_targets.length}</summary><ol class="target-list">${a.search_targets.map(s => `<li>${esc(s)}</li>`).join("")}</ol></details>` : ""}
  </div>`;
}

export function ruleRow(r) {
  return `<div class="rule-row">
    <div class="rule-if">${(r.conditions || []).map(c => `<span class="cond" title="${esc(c.finding || "")}"><span class="mono">${esc(c.agent_id)}</span> = <span class="badge ${c.outcome === "supported" ? "bad" : c.outcome === "refuted" ? "ok" : ""}">${esc(c.outcome)}</span></span>`).join('<span class="muted">and</span>')}</div>
    <div class="rule-then"><span class="muted">→</span> ${esc(r.conclusion || "")}</div>
    ${r.caveat ? `<details><summary>Caveat · <span class="mono">${esc(r.rule_id)}</span></summary><p>${esc(r.caveat)}</p></details>` : ""}
  </div>`;
}

export function managerDetail(call) {
  const plan = planOf(call);
  const t = tried(call, "plan_trace");
  if (!plan) return t?.error ? `<div class="detail-block tone-bad"><h4>Plan rejected</h4><p>${esc(t.error.message || t.error.code)}</p></div>` : "";
  return `<div class="side-section"><h4>Assignments · ${plan.assignments.length}</h4>${plan.assignments.map(assignmentCard).join("")}</div>
    ${(plan.decision_rules || []).length ? `<div class="side-section"><h4>Decision rules · ${plan.decision_rules.length}</h4><div class="detail-block rule-table">${plan.decision_rules.map(ruleRow).join("")}</div></div>` : ""}
    ${plan.uncertainty ? `<details class="detail-block"><summary>Plan uncertainty</summary><div class="text-box">${esc(plan.uncertainty)}</div></details>` : ""}`;
}

// ---------- TRACE ----------
const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|WITH|AS|AND|OR|NOT|IN|IS|NULL|UNION|ALL|BY|NAME|ORDER|GROUP|LIMIT|JOIN|LEFT|ON|DISTINCT|CASE|WHEN|THEN|ELSE|END|LIKE|ASC|DESC)\b/g;

export function sqlHtml(sql) {
  return String(sql || "").split("\n").map(line => {
    const at = line.indexOf("--");
    const code = at < 0 ? line : line.slice(0, at), comment = at < 0 ? "" : line.slice(at);
    const body = esc(code).replace(/(&#39;|')([^']*?)(&#39;|')/g, '<span class="sql-str">$1$2$3</span>')
      .replace(SQL_KEYWORDS, '<span class="sql-kw">$1</span>')
      .replace(/\b([A-Z_]{3,})(?=\()/g, '<span class="sql-fn">$1</span>');
    return body + (comment ? `<span class="sql-comment">${esc(comment)}</span>` : "");
  }).join("\n");
}

function rowsByStep(rows) {
  const groups = new Map();
  rows.forEach(r => {
    const t = Number(r.step);
    const key = Number.isFinite(t) && r.step != null ? t : "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  return [...groups].sort((a, b) => (a[0] === "other") - (b[0] === "other") || a[0] - b[0]);
}

function rowText(r) {
  if (r.text != null) return r.text;
  const rest = Object.entries(r).filter(([k, v]) => !["step", "module", "source_id", "fid"].includes(k) && v != null);
  return rest.map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ");
}

export function queryDetail(q, sql) {
  const issues = [
    q.truncated && "result truncated", q.engine_truncated && "engine truncated", q.partial && "partial",
    ...(q.function_errors || []).map(e => `function error: ${typeof e === "string" ? e : e.function || e.message || JSON.stringify(e)}`),
    ...(q.skipped_branches || []).map(b => `skipped branch: ${typeof b === "string" ? b : JSON.stringify(b)}`),
  ].filter(Boolean);
  const groups = rowsByStep(q.rows || []);
  return `<div class="detail-block"><h4>SQL query</h4><pre class="sql">${sqlHtml(sql)}</pre></div>
    <div class="side-section"><h4>Result · ${q.returned_rows ?? (q.rows || []).length} rows · ${(q.returned_steps || []).length} steps</h4>
      ${issues.length ? `<div class="detail-block tone-warn">${issues.map(i => `<p>${esc(i)}</p>`).join("")}<p class="muted">Failed branches are unavailable, not zero matches.</p></div>` : ""}
      ${groups.map(([t, rows]) => `<details class="detail-block step-rows">
        <summary>${t === "other" ? "No step" : `<button class="step-chip" data-goto-step="${t}">${S(t)}</button>`} <span class="muted">${rows.length} row${rows.length === 1 ? "" : "s"} · ${[...new Set(rows.map(r => r.module).filter(Boolean))].join(", ")}</span></summary>
        ${rows.map(r => `<div class="sql-row"><span class="mono muted">${esc(r.module || r.source_kind || "")}</span>${r.fid != null ? `<button class="mono link" data-fid="${r.fid}">f${r.fid}</button>` : ""}<div class="sql-text">${esc(short(String(rowText(r)), 600))}</div></div>`).join("")}
      </details>`).join("")}
    </div>`;
}

export function candidateCard(c) {
  const tone = c.status === "error" ? "bad" : "warn";
  return `<div class="detail-block candidate tone-${tone}">
    <h4><span class="chip-row"><span class="badge ${tone}">${esc(c.status)}</span><button class="step-chip" data-goto-step="${c.step}">${S(c.step)}</button><strong>${esc(c.module || "")}</strong><span class="mono">${esc(c.fault_class || "")}</span></span>
      ${c.is_root_cause === false ? '<span class="badge" title="The error holds but TRACE judged it not to be the root cause">not root</span>' : c.is_root_cause ? '<span class="badge bad">root</span>' : ""}</h4>
    ${c.output_quote ? `<blockquote>${esc(c.output_quote)}</blockquote>` : ""}
    <p>${esc(c.proposition || "")}</p>
    <details><summary>Reasoning and effect</summary><p>${esc(c.reasoning || "")}</p>${c.immediate_effect ? `<p><span class="muted">Immediate effect:</span> ${esc(c.immediate_effect)}</p>` : ""}${c.uncertainty ? `<p><span class="muted">Uncertainty:</span> ${esc(c.uncertainty)}</p>` : ""}</details>
  </div>`;
}

export function traceDetail(call, ctx) {
  const plan = ctx.managerPlan;
  const assignment = plan?.assignments?.find(a => a.agent_id === call.caseId);
  const head = assignment ? `<div class="detail-block tone-info"><h4>Assignment <span class="mono">${esc(assignment.agent_id)}</span><span class="badge anchor">${esc(assignment.anchor_case_id)}</span></h4><p>${esc(assignment.question || "")}</p></div>` : "";
  const q = queryOf(call);
  if (q) return head + queryDetail(q, ok(call, "query_logs").args?.sql);
  const a = assessOf(call);
  if (a) {
    const c = a.candidates || [];
    return head + `<div class="side-section"><h4>Assessment · ${c.length} candidate${c.length === 1 ? "" : "s"}</h4>${c.map(candidateCard).join("") || `<p class="muted">No candidate: the evidence did not support an error at a single step.</p>`}</div>
      ${a.conclusion?.uncertainty ? `<details class="detail-block"><summary>Uncertainty</summary><div class="text-box">${esc(a.conclusion.uncertainty)}</div></details>` : ""}`;
  }
  const t = tried(call, "query_logs") || tried(call, "assess");
  return head + (t?.error ? `<div class="detail-block tone-bad"><h4>${esc(t.name)} rejected</h4><p>${esc(t.error.message || t.error.code)}</p></div>` : "");
}

// ---------- phase cards ----------
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const laneCandidates = lane => lane.nodes.flatMap(n => assessOf(n.call)?.candidates || []);

export function traceSummary(p) {
  const n = p.lanes.reduce((s, l) => s + laneCandidates(l).length, 0);
  return `${plural(p.lanes.length, "assignment")} · ${plural(n, "candidate")}`;
}

export function managerOverview(p) {
  const call = [...p.calls].reverse().find(planOf);
  const plan = call && planOf(call);
  if (!plan) return "";
  return `<div class="side-section"><h4>Assignments · ${plan.assignments.length} <button class="btn" data-goto-call="${call.index}">Open #${call.n}</button></h4>
    ${plan.assignments.map(a => `<div class="detail-block"><h4><span class="mono">${esc(a.agent_id)}</span><span class="badge anchor" title="anchor case">${esc(a.anchor_case_id)}</span></h4><p>${esc(short(a.question || "", 220))}</p></div>`).join("")}
    ${(plan.decision_rules || []).length ? `<p class="muted">${plural(plan.decision_rules.length, "decision rule")}; open the call to read them.</p>` : ""}</div>`;
}

export function traceOverview(p) {
  return `<div class="side-section"><h4>Assignments · ${p.lanes.length}</h4>${p.lanes.map(lane => {
    const assessed = lane.nodes.map(n => n.call).filter(assessOf).at(-1);
    const cands = assessed ? assessOf(assessed).candidates || [] : [];
    return `<div class="detail-block"><h4><span class="mono">${esc(lane.key)}</span>${lane.assignment?.anchor_case_id ? `<span class="badge anchor">${esc(lane.assignment.anchor_case_id)}</span>` : ""}</h4>
      ${!assessed ? `<p class="muted">Not assessed yet.</p>` : cands.length ? cands.map(c => `<div class="cand-row"><span class="badge ${c.status === "error" ? "bad" : "warn"}">${esc(c.status)}</span><button class="step-chip" data-goto-step="${c.step}">${S(c.step)}</button><strong>${esc(c.module || "")}</strong><span class="mono muted">${esc(c.fault_class || "")}</span>${c.is_root_cause === false ? '<span class="badge">not root</span>' : ""}</div>`).join("")
        : `<p class="muted">No candidate.</p>`}
      ${assessed ? `<button class="link" data-goto-call="${assessed.index}">Assessment #${assessed.n}</button>` : ""}</div>`;
  }).join("")}</div>`;
}

// Latest TRACE candidates by step, for the agent step lane.
export function candidatesByStep(calls) {
  const out = new Map();
  calls.forEach(call => (assessOf(call)?.candidates || []).forEach(c => {
    if (!out.has(c.step)) out.set(c.step, []);
    out.get(c.step).push({...c, caseId: call.caseId});
  }));
  return out;
}

// SUBMIT refers to TRACE candidates as trace-window:<assignment>:<1-based index>.
export function candidateIndex(calls) {
  const out = new Map();
  calls.forEach(call => (assessOf(call)?.candidates || []).forEach((c, i) =>
    out.set(`trace-window:${call.caseId}:${i + 1}`, {candidate: c, call, caseId: call.caseId})));
  return out;
}
