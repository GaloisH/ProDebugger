// Normalises raw run/session files into one case model. Depends only on file formats.
import {buildCalls} from "./calls.js";

export const PHASES = ["MAP", "ROUTE", "TRACE", "SUBMIT"];
export const entityId = e => e ? `${e.kind}:${e.index}` : "";

function asDict(value, key) {
  if (!value) return {};
  if (!Array.isArray(value)) return value;
  return Object.fromEntries(value.map(item => [key(item), item]));
}

// Run dirs store canonical_record.json (dicts); compiled sessions store record.json (lists).
export function normaliseDsl(record) {
  if (!record) return null;
  const kinds = Array.isArray(record.kinds)
    ? Object.fromEntries(record.kinds.map(k => [k.name, k.parent ?? null])) : (record.kinds || {});
  const relations = asDict(record.relations, r => r.name);
  const entities = asDict(record.entities, entityId);
  const facts = record.facts || [];
  const factsById = new Map(facts.map(f => [f.fid, f]));
  return {kinds, relations, entities, goals: record.goals || [], facts, factsById,
          intentions: record.intentions || {}, processNotes: record.process_notes || {},
          maxT: facts.reduce((m, f) => Math.max(m, f.t || 0), 0)};
}

const FID_KEYS = new Set(["fid", "fids", "issue_fids", "cites", "refs", "evidence_for", "evidence_against", "supporting_evidence", "counterevidence", "start_refs"]);
const STEP_KEYS = new Set(["step", "issue_step", "event_step"]);

// Original steps and Facts an event points at, found by walking ids in its arguments/results.
export function collectRefs(value, factsById, limit = 4000) {
  const steps = new Set(), fids = new Set();
  let budget = limit;
  const addFid = fid => { const f = factsById?.get(Number(fid)); if (!f) return; fids.add(f.fid); if (f.t) steps.add(f.t); };
  (function walk(node, key, depth) {
    if (budget-- <= 0 || depth > 7 || node == null) return;
    if (Array.isArray(node)) { node.forEach(v => walk(v, key, depth + 1)); return; }
    if (typeof node === "object") { for (const [k, v] of Object.entries(node)) walk(v, k, depth + 1); return; }
    if (typeof node !== "number" && !(typeof node === "string" && /^\d+$/.test(node))) return;
    if (FID_KEYS.has(key)) addFid(node);
    else if (STEP_KEYS.has(key) && Number(node) > 0) steps.add(Number(node));
  })(value, "", 0);
  const sort = set => [...set].sort((a, b) => a - b);
  return {steps: sort(steps), fids: sort(fids)};
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function summariseArgs(args) {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args).filter(([k]) => k !== "scope")
    .map(([k, v]) => `${k}=${typeof v === "object" ? (Array.isArray(v) ? `[${v.length}]` : "{…}") : v}`).join(" ");
}

// Builds the ordered debugger event list from the transcript and logs (mirrors report.py).
export function buildEvents(raw, factsById) {
  const tools = new Map(raw.tool_calls.filter(r => r.event === "committed").map(r => [r.tool_call_id, r]));
  const pending = new Map(raw.tool_calls.filter(r => r.event === "pending").map(r => [r.tool_call_id, r]));
  const completedUsage = raw.usage_rows.filter(r => r.event === "completed");
  const windows = new Map(raw.window_trace.map(r => [r.response_turn, r]));
  const answers = new Map(raw.direct_submit.map(r => [r.response_turn, r]));
  const events = [];
  const used = new Set();
  let assistantIndex = 0;
  const push = event => {
    event.index = events.length;
    Object.assign(event, collectRefs(event.refsSource ?? event.data, factsById));
    delete event.refsSource;
    events.push(event);
  };

  for (const row of raw.messages) {
    const m = row.message || row;
    const phase = row.phase || "UNKNOWN";
    if (m.role === "user") {
      const content = parseJson(m.content || "");
      if (content?.schema === "debugger-handoff/v1") {
        push({kind: "handoff", phase: content.to || phase, turn: row.turn, title: `${content.from || "START"} → ${content.to}`,
              subtitle: "Phase handoff", data: content, refsSource: null});
      }
    } else if (m.role === "assistant") {
      const usage = completedUsage[assistantIndex++] || {};
      const calls = m.tool_calls || [];
      push({kind: "model", phase, turn: row.turn, title: `Model turn ${row.turn ?? "?"}`,
            subtitle: calls.length ? calls.map(c => c.function?.name).join(", ") : (m.content ? "text response" : "—"),
            data: m, usage, refsSource: calls.map(c => parseJson(c.function?.arguments || "") || {})});
      const review = windows.get(row.turn);
      if (review) push({kind: "assessment", phase: "TRACE", turn: row.turn, title: `Window ${review.window_id}`,
                        subtitle: `${(review.candidates || []).length} candidate(s)`, data: review,
                        refsSource: {window: review.window, candidates: review.candidates}});
      const answer = answers.get(row.turn);
      if (answer) push({kind: "answer", phase: "SUBMIT", turn: row.turn, title: "Submit decision",
                        subtitle: answer.result?.status || "answer", data: answer, refsSource: answer.result});
    } else if (m.role === "tool") {
      const call = tools.get(m.tool_call_id) || pending.get(m.tool_call_id);
      if (!call) continue;
      used.add(call.tool_call_id);
      const error = call.result && typeof call.result === "object" && "error" in call.result;
      push({kind: "tool", phase: call.phase || phase, turn: row.turn, title: call.name, subtitle: summariseArgs(call.arguments),
            status: error ? "error" : call.event, data: call, refsSource: {args: call.arguments, data: call.result?.data}});
    }
  }
  // Tool calls committed without a transcript row yet (live run, between appends).
  for (const call of tools.values()) {
    if (used.has(call.tool_call_id)) continue;
    push({kind: "tool", phase: call.phase, title: call.name, subtitle: summariseArgs(call.arguments), status: "committed",
          data: call, refsSource: {args: call.arguments, data: call.result?.data}});
  }
  // Failed/retried model attempts have no assistant message.
  raw.usage_rows.filter(r => r.event && !["completed", "pending", "started"].includes(r.event)).forEach(r =>
    push({kind: "attempt", phase: r.phase, title: `Model attempt · ${r.event}`, subtitle: r.error_type || "", status: "error", data: r, refsSource: null}));
  // A request still waiting for the provider (live runs): pending rows outnumber completed ones.
  const open = new Map();
  raw.usage_rows.forEach(r => {
    if (!r.request_file) return;
    if (r.event === "pending") open.set(r.request_file, r);
    else open.delete(r.request_file);
  });
  [...open.values()].forEach(r =>
    push({kind: "inflight", phase: r.phase, title: "Waiting for model", subtitle: r.requested_model || "", status: "pending", data: r, refsSource: null}));
  return events;
}

export function phaseSpans(events) {
  const spans = [];
  for (const e of events) {
    const last = spans[spans.length - 1];
    if (last && last.phase === e.phase) last.end = e.index;
    else spans.push({phase: e.phase, start: e.index, end: e.index});
  }
  return spans;
}

export function buildCase(kind, raw) {
  const record = kind === "session" ? raw.record : raw.canonical_record;
  const dsl = normaliseDsl(record);
  const input = raw.input || {};
  const steps = (kind === "session" ? raw.steps : input.steps) || [];
  const evidenceBlock = raw.evidences?.["abstract.rule"] || record?.evidences?.["abstract.rule"];
  const debuggerRaw = {messages: raw.messages || [], tool_calls: raw.tool_calls || [], usage_rows: raw.usage_rows || [],
                       window_trace: raw.window_trace || [], direct_submit: raw.direct_submit || []};
  const events = kind === "run" ? buildEvents(debuggerRaw, dsl?.factsById) : [];
  const calls = kind === "run" ? buildCalls(raw, dsl?.factsById) : null;
  return {
    kind,
    trajectoryId: record?.trajectory_id || input.trajectory_id,
    task: record?.task || input.task || "",
    taskType: record?.task_type || input.task_type || "",
    steps,
    dsl,
    rules: raw.rules || record?.rules || [],
    evidences: evidenceBlock?.items || [],
    evaluations: raw.evaluations || record?.evaluations || [],
    debugger: kind === "run" ? {
      events, spans: phaseSpans(events), phaseEvents: raw.phase_events || [],
      calls: calls.calls, parse: calls.parse, managerPlan: raw.manager_plan,
      traceQueries: raw.trace_queries || [], parseAudit: raw.parse_audit || [],
      windows: raw.window_trace || [], traceWindows: raw.trace_windows, traceGraph: raw.trace_graph,
      routeCandidates: raw.route_candidates, goalMap: raw.goal_map, result: raw.result, usage: raw.usage,
      manifest: raw.manifest,
    } : null,
  };
}
