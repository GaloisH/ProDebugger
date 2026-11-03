
const FID_KEYS = new Set(["fid", "fids", "issue_fids", "cites", "refs", "evidence_for", "evidence_against", "supporting_evidence", "counterevidence", "start_refs"]);
const STEP_KEYS = new Set(["step", "issue_step", "event_step"]);

function collectRefs(value, factsById, limit = 4000) {
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

const SQL_TOOLS = new Set(["query_logs"]);

function sqlSteps(sql) {
  const steps = new Set();
  const code = String(sql || "").replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
  for (const m of code.matchAll(/\bstep\s*=\s*(\d+)/gi)) steps.add(Number(m[1]));
  for (const m of code.matchAll(/\bstep\s+IN\s*\(\s*(\d+(?:\s*,\s*\d+)*)\s*\)/gi)) m[1].split(",").forEach(n => steps.add(Number(n)));
  return [...steps].filter(t => t > 0);
}

function caseWindowSteps(caseId, raw) {
  const windows = new Map(((Array.isArray(raw.route_candidates) ? raw.route_candidates.at(-1) : raw.route_candidates)?.windows || [])
    .map(w => [w.candidate_id, w]));
  const assignment = (raw.manager_plan?.assignments || []).find(a => a.agent_id === caseId);
  const ids = assignment?.route_case_ids || (assignment?.anchor_case_id ? [assignment.anchor_case_id] : [caseId]);
  return ids.flatMap(id => {
    const w = windows.get(id);
    if (!w) return [];
    const lo = Number(w.lo ?? w.issue_step), hi = Number(w.hi ?? w.issue_step);
    return Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo ? Array.from({length: hi - lo + 1}, (_, i) => lo + i) : [];
  });
}

export const CALL_PHASES = ["PARSE", "MAP", "ROUTE", "MANAGER", "TRACE", "SUBMIT"];

const parse = text => { try { return JSON.parse(text); } catch { return text; } };
const time = row => row?.timestamp_utc ? Date.parse(row.timestamp_utc) : null;

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
    const refs = collectRefs(call.tools.map(t => SQL_TOOLS.has(t.name) ? {args: t.args} : {args: t.args, data: t.result?.data}), factsById);
    const named = call.tools.filter(t => SQL_TOOLS.has(t.name)).flatMap(t => sqlSteps(t.args?.sql));
    Object.assign(call, refs, {steps: [...new Set([...refs.steps, ...named])].sort((a, b) => a - b)});
  });
  return calls;
}

const replyKey = m => (m?.tool_calls || []).map(c => c.id).join(",") || String(m?.content || "").slice(0, 400);

function inputsByReply(messages) {
  const out = new Map();
  let pending = [];
  for (const row of messages) {
    const m = row.message || row;
    if (m.role === "user") pending.push(parse(m.content || ""));
    else if (m.role === "assistant") { out.set(replyKey(m), pending); pending = []; }
  }
  return out;
}

export function buildCalls(raw, factsById) {
  const journal = new Map((raw.tool_calls || []).filter(r => r.event === "committed").map(r => [r.tool_call_id, r]));
  const calls = callsFrom(raw.usage_rows || [], {journal, factsById});
  const inputs = inputsByReply(raw.messages || []);
  calls.forEach(call => { call.inputs = call.message ? inputs.get(replyKey(call.message)) || [] : []; });
  const order = (raw.manager_plan?.assignments || []).map(a => a.agent_id);
  let current = null, assessed = false;
  calls.forEach(call => {
    if (call.phase !== "TRACE") return;
    if (call.caseId == null) call.caseId = current == null || assessed ? order[order.indexOf(current) + 1] ?? current : current;
    assessed = call.tools.some(t => t.name === "assess" && !t.error);
    current = call.caseId;
    if (call.tools.some(t => SQL_TOOLS.has(t.name)) && call.caseId != null) {
      call.steps = [...new Set([...call.steps, ...caseWindowSteps(call.caseId, raw)])].sort((a, b) => a - b);
    }
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
