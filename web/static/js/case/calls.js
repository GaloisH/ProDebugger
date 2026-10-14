// One node per model call. usage.jsonl logs each request as pending then completed
// (the completed row carries the assistant message); tool_calls.jsonl supplies the
// committed result of every tool call that message made. Depends only on file formats.
import {collectRefs} from "./model.js";

// Graph bands, in pipeline order. PARSE is folded into one group ahead of MAP.
export const CALL_PHASES = ["PARSE", "MAP", "ROUTE", "MANAGER", "TRACE", "SUBMIT"];

const parse = text => { try { return JSON.parse(text); } catch { return text; } };
const time = row => row?.timestamp_utc ? Date.parse(row.timestamp_utc) : null;

// TRACE conversations are one per manager assignment; their tool arguments name it.
function caseOf(tools) {
  for (const t of tools) {
    const id = t.args?.candidate_id ?? t.args?.window_id;
    if (typeof id === "string") return id;
  }
  return null;
}

function callsFrom(rows, {folder = "", journal = new Map(), factsById} = {}) {
  const byRequest = new Map(), calls = [];
  for (const row of rows) {
    if (!row.request_file) continue;
    let call = byRequest.get(row.request_file);
    if (row.event === "pending") {
      // A retried request reuses its file: keep the first start, count the retries.
      if (call) { call.retries += 1; continue; }
      call = {phase: row.phase, folder, requestFile: (folder ? folder + "/" : "") + row.request_file,
              model: row.requested_model, start: time(row), end: null, status: "pending",
              usage: null, message: null, tools: [], errors: [], retries: 0};
      byRequest.set(row.request_file, call);
      calls.push(call);
    } else if (call && row.event === "completed") {
      const message = row.message || {};
      const tools = (message.tool_calls || []).map(c => {
        const committed = journal.get(c.id);
        const result = committed?.result;
        return {id: c.id, name: c.function?.name, args: parse(c.function?.arguments || ""),
                result, error: result && typeof result === "object" && "error" in result ? result.error : null,
                committed: Boolean(committed)};
      });
      Object.assign(call, {status: "done", end: time(row), usage: row, message, tools});
    } else if (call && row.event === "error") {
      call.errors.push(row);
    }
  }
  calls.forEach(call => {
    call.seconds = call.start != null && call.end != null ? (call.end - call.start) / 1000 : null;
    call.rejected = call.tools.some(t => t.error);
    call.caseId = call.phase === "TRACE" ? caseOf(call.tools) : null;
    Object.assign(call, collectRefs(call.tools.map(t => ({args: t.args, data: t.result?.data})), factsById));
  });
  return calls;
}

// Debugger calls in request order, plus the folded PARSE group.
export function buildCalls(raw, factsById) {
  const journal = new Map((raw.tool_calls || []).filter(r => r.event === "committed").map(r => [r.tool_call_id, r]));
  const calls = callsFrom(raw.usage_rows || [], {journal, factsById});
  // A TRACE call without tool arguments (e.g. a malformed reply) belongs to the case before it.
  let current = null;
  calls.forEach(call => {
    if (call.phase !== "TRACE") return;
    call.caseId ??= current;
    current = call.caseId;
  });
  calls.forEach((call, i) => { call.index = i; call.n = i + 1; });
  const parseCalls = [
    ...callsFrom(raw.parse_audit_usage || [], {folder: "parsing"}),
    ...callsFrom(raw.claim_usage || [], {folder: "claim_parsing"}),
  ].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const sum = key => parseCalls.reduce((s, c) => s + (Number(c.usage?.[key]) || 0), 0);
  const parse = parseCalls.length ? {calls: parseCalls, input: sum("input_tokens"), output: sum("output_tokens"),
    seconds: parseCalls.reduce((s, c) => s + (c.seconds || 0), 0),
    pending: parseCalls.some(c => c.status === "pending")} : null;
  return {calls, parse};
}
