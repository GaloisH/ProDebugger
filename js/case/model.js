// Normalises raw run/session files into one case model. Depends only on file formats.
import {buildCalls} from "./calls.js?v=edc30cc901";

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

export function buildCase(kind, raw) {
  const record = kind === "session" ? raw.record : raw.canonical_record;
  const dsl = normaliseDsl(record);
  const input = raw.input || {};
  const steps = (kind === "session" ? raw.steps : input.steps) || [];
  const evidenceBlock = raw.evidences?.["abstract.rule"] || record?.evidences?.["abstract.rule"];
  const calls = kind === "run" ? buildCalls(raw, dsl?.factsById) : null;
  // A rejected SUBMIT answer has no tool call to carry the error; the result names it.
  const submit = calls?.calls.filter(c => c.phase === "SUBMIT").at(-1);
  if (submit && raw.result?.status === "error" && raw.result.phase === "SUBMIT") {
    Object.assign(submit, {rejected: true, rejection: raw.result.stop_reason});
  }
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
      phaseEvents: raw.phase_events || [],
      calls: calls.calls, parse: calls.parse, managerPlan: raw.manager_plan,
      traceQueries: raw.trace_queries || [], parseAudit: raw.parse_audit || [],
      traceWindows: raw.trace_windows, traceGraph: raw.trace_graph,
      routeCandidates: raw.route_candidates, goalMap: raw.goal_map, result: raw.result, usage: raw.usage,
      manifest: raw.manifest,
    } : null,
  };
}
