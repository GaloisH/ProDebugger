// Builds the Query Graph scene from one run directory: the DSL record (facts, entities,
// goals, rule evidence) plus the debugger's tool calls replayed as an event timeline.
// Every event says which DSL nodes it touched, so the renderer only has to light them.
import {getJSON, JsonlFollower} from "../api.js";
import {short} from "../util.js";

export const SLOTS = ["obs", "mem", "refl", "plan", "act", "chk"];
export const SLOT_LABEL = {obs: "observation", mem: "memory", refl: "reflection", plan: "plan", act: "action", chk: "check"};
const MODULE_SLOT = {observation: "obs", memory: "mem", reflection: "refl", plan: "plan", action: "act", check: "chk"};
// Keys whose integer values name a fact the result put in front of the debugger.
const FACT_KEYS = new Set(["fid", "fids", "refs", "issue_fids", "returned_fids"]);

const entityKey = e => e && typeof e === "object" ? `${e.kind}:${e.index}` : String(e);

async function readJsonl(ref, name) {
  const follower = new JsonlFollower(ref, name);
  let added;
  do { added = await follower.poll(); } while (added.length);
  return follower.rows;
}

export async function loadQueryScene(ref) {
  const [record, evidences, routeCandidates, result, toolCalls, traceQueries] = await Promise.all([
    getJSON(ref, "canonical_record.json"),
    getJSON(ref, "evidences.json", {}),
    getJSON(ref, "route_candidates.json", []),
    getJSON(ref, "result.json", null),
    readJsonl(ref, "tool_calls.jsonl"),
    readJsonl(ref, "trace_queries.jsonl"),
  ]);
  return buildQueryScene({record, evidences, routeCandidates, result, toolCalls, traceQueries});
}

// Collects fact ids (and evidence ids) anywhere inside a tool result.
function collectIds(value, out = {fids: new Set(), eids: new Set()}) {
  if (Array.isArray(value)) value.forEach(v => collectIds(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FACT_KEYS.has(k)) (Array.isArray(v) ? v : [v]).forEach(x => Number.isInteger(x) && out.fids.add(x));
      else if (k === "eid" && Number.isInteger(v)) out.eids.add(v);
      collectIds(v, out);
    }
  }
  return out;
}

export function buildQueryScene({record, evidences, routeCandidates, result, toolCalls, traceQueries}) {
  const facts = (record.facts || []).map(f => ({
    id: `f${f.fid}`, type: "fact", fid: f.fid, t: f.t, slot: f.slot, side: f.side, rel: f.rel,
    args: (f.args || []).map(entityKey), value: f.value, basis: f.basis || [], span: f.span || "",
  }));
  const factById = new Map(facts.map(f => [f.fid, f]));
  const steps = Math.max(1, ...facts.map(f => f.t));
  const cellFacts = (t, slot) => facts.filter(f => f.t === t && f.slot === slot);

  // Entities: every key in the record, plus any argument the record forgot to list.
  const kinds = record.kinds || {};
  const entityMap = new Map();
  const addEntity = key => {
    if (entityMap.has(key)) return entityMap.get(key);
    const [kind, ...rest] = key.split(":");
    const e = {id: `e:${key}`, type: "entity", key, kind, index: rest.join(":"), parent: kinds[kind] ?? null, facts: []};
    entityMap.set(key, e);
    return e;
  };
  Object.keys(record.entities || {}).forEach(addEntity);
  facts.forEach(f => f.args.forEach(a => addEntity(a).facts.push(f.fid)));
  const entities = [...entityMap.values()].filter(e => e.kind !== "req");

  const goals = (record.goals || []).map(g => {
    const key = `req:${g.name || `${g.rel}_${g.of_kind}`}`;
    return {
      id: `g:${key}`, type: "goal", key, name: g.name, rel: g.rel, count: g.count, ofKind: g.of_kind,
      target: entityKey(g.target), constraints: g.constraints || [],
      facts: facts.filter(f => f.args.includes(key)).map(f => f.fid),
    };
  });

  const evidence = Object.values(evidences || {}).flatMap(group => (group.items || []).map(item => ({
    id: `v${item.eid}`, type: "evidence", eid: item.eid, kind: item.kind, rule: item.rule, t: item.t,
    refs: (item.refs || []).filter(fid => factById.has(fid)), status: item.status,
    reason: item.details?.reason || "",
  })));
  const evidenceById = new Map(evidence.map(v => [v.eid, v]));

  const lastVersion = Array.isArray(routeCandidates) ? routeCandidates[routeCandidates.length - 1] : routeCandidates;
  const windows = (lastVersion?.windows || []).map(w => ({
    id: `w:${w.candidate_id}`, type: "window", caseId: w.candidate_id, step: w.issue_step,
    fids: (w.issue_fids || []).filter(fid => factById.has(fid)), goals: w.goal_links || [], hypothesis: w.hypothesis || "",
  }));
  const windowByCase = new Map(windows.map(w => [w.caseId, w]));

  // A module named at a step resolves to the facts in that (step, slot) cell.
  const moduleFact = (step, module, fid) => {
    if (factById.has(fid)) return fid;
    const cell = cellFacts(step, MODULE_SLOT[module] || module);
    return cell.length ? cell[0].fid : null;
  };

  const lanes = new Map();
  const candidates = [];
  const events = [];
  const committed = new Map();
  for (const row of toolCalls) if (row.event === "committed") committed.set(row.tool_call_id || row.ordinal, row);

  events.push({
    phase: "PARSE", name: "compile", title: "Compile the trajectory into the DSL record",
    caption: `${facts.length} facts over ${steps} steps, ${entities.length} entities and ${goals.length} goal${goals.length === 1 ? "" : "s"}: every observation, memory, reflection, plan and action becomes rel(args) = value @ t.`,
    reveal: "base", fids: [], eids: [], entities: [], goals: [],
  });

  for (const call of [...committed.values()].sort((a, b) => a.ordinal - b.ordinal)) {
    const data = call.result?.data;
    const error = call.result?.error;
    const args = call.arguments || {};
    const ev = {phase: call.phase, name: call.name, ordinal: call.ordinal, call, error, fids: [], eids: [], goals: [], windows: [], lanes: [], candidates: []};
    if (error) {
      ev.title = `${call.name} rejected`;
      ev.caption = `${call.phase} asked ${call.name}${args.spec ? `(${args.spec})` : ""}; the tool refused: ${short(error.message, 120)}`;
      events.push(ev);
      continue;
    }
    const ids = collectIds(data);
    if (call.name === "view" || call.name === "view_evidence") {
      ev.fids = [...ids.fids].filter(fid => factById.has(fid));
      ev.eids = [...ids.eids].filter(eid => evidenceById.has(eid));
      const spec = args.spec || (call.name === "view_evidence" ? "evidence" : "");
      ev.spec = spec;
      if (spec === "requirements" || spec.startsWith("entity:req:")) {
        ev.goals = goals.map(g => g.id);
        for (const g of goals) ev.fids.push(...g.facts);
      }
      ev.fids = [...new Set(ev.fids)];
      ev.title = `${call.name}("${short(spec, 48)}")`;
      ev.caption = call.phase === "MAP"
        ? `MAP reads the task contract: ${goals.map(g => g.key).join(", ") || "no structured goal"}, then hands the goal map to ROUTE.`
        : `ROUTE queries the record with ${call.name}("${short(spec, 40)}") and gets back ${ev.fids.length} fact${ev.fids.length === 1 ? "" : "s"}${ev.eids.length ? ` and ${ev.eids.length} rule findings` : ""}.`;
    } else if (call.name === "route_cases") {
      const cases = args.candidates || [];
      ev.windows = cases.map(c => `w:${c.candidate_id}`).filter(id => windows.some(w => w.id === id));
      ev.fids = [...ids.fids].filter(fid => factById.has(fid));
      ev.title = `route_cases → ${cases.map(c => `${c.candidate_id}@S${c.issue_step}`).join(", ")}`;
      ev.caption = `ROUTE closes its search and opens ${cases.length} suspect window${cases.length === 1 ? "" : "s"}: ${cases.map(c => `${c.candidate_id} at step ${c.issue_step} (${(c.issue_fids || []).length} issue facts)`).join("; ")}.`;
    } else if (call.name === "plan_trace") {
      ev.phase = "MANAGER";
      for (const a of args.assignments || []) {
        const lane = {id: `l:${a.agent_id}`, type: "lane", agent: a.agent_id, anchor: a.anchor_case_id,
                      cases: a.route_case_ids || [], question: a.question || "", rows: [], steps: [], fids: [], candidates: []};
        lanes.set(a.agent_id, lane);
        ev.lanes.push(lane.id);
        const w = windowByCase.get(a.anchor_case_id);
        if (w) ev.windows.push(w.id);
      }
      ev.title = `plan_trace → ${ev.lanes.length} lane${ev.lanes.length === 1 ? "" : "s"}`;
      ev.caption = `The manager turns each window into one investigation question and assigns it to a TRACE lane: ${[...lanes.values()].map(l => `${l.agent} ← ${l.anchor}`).join(", ")}.`;
    } else if (call.name === "query_logs") {
      const lane = lanes.get(args.candidate_id || data?.candidate_id);
      const rows = data?.rows || [];
      const fids = new Set([...ids.fids].filter(fid => factById.has(fid)));
      for (const r of rows) cellFacts(r.step, MODULE_SLOT[r.module] || r.module).forEach(f => fids.add(f.fid));
      ev.fids = [...fids];
      ev.sql = data?.query || args.sql || "";
      ev.lanes = lane ? [lane.id] : [];
      if (lane) { lane.rows = rows; lane.steps = data?.returned_steps || []; lane.fids = ev.fids; }
      ev.title = `query_logs(${lane?.agent || "?"})`;
      ev.caption = `TRACE writes one SQL query over the logs: ${rows.length} rows on ${(data?.returned_steps || []).length} steps come back as evidence for lane ${lane?.agent || "?"}.`;
    } else if (call.name === "assess") {
      const lane = lanes.get(args.window_id || data?.window_id);
      for (const [i, c] of (args.candidates || data?.candidates || []).entries()) {
        const cand = {id: `c:${lane?.agent || "?"}:${i}`, type: "candidate", lane: lane?.id, step: c.step, module: c.module,
                      fid: moduleFact(c.step, c.module, c.fid), status: c.status, faultClass: c.fault_class,
                      proposition: c.proposition || "", quote: c.output_quote || ""};
        candidates.push(cand);
        lane?.candidates.push(cand.id);
        ev.candidates.push(cand.id);
        if (cand.fid != null) ev.fids.push(cand.fid);
      }
      ev.lanes = lane ? [lane.id] : [];
      const cs = ev.candidates.map(id => candidates.find(c => c.id === id));
      ev.title = `assess(${lane?.agent || "?"})`;
      ev.caption = `TRACE judges lane ${lane?.agent || "?"} and proposes ${cs.length ? cs.map(c => `S${c.step} ${c.module} (${c.status}${c.faultClass ? `, ${c.faultClass}` : ""})`).join("; ") : "no candidate"}.`;
    } else {
      ev.fids = [...ids.fids].filter(fid => factById.has(fid));
      ev.title = call.name;
      ev.caption = `${call.phase} calls ${call.name}.`;
    }
    events.push(ev);
  }

  // Candidates written by assess without tool_calls (older logs) still come from trace_queries.
  for (const q of traceQueries || []) {
    const lane = lanes.get(q.candidate_id);
    if (lane && !lane.steps.length) lane.steps = q.returned_steps || [];
  }

  let root = null;
  const r = result?.root;
  if (r && r.step != null) {
    const fid = moduleFact(r.step, r.module, r.fid);
    const cand = candidates.find(c => c.step === r.step && (c.module === r.module || c.fid === fid));
    root = {id: "root", type: "root", step: r.step, module: r.module, fid, faultClass: r.fault_class,
            proposition: r.proposition || "", quote: r.output_quote || "", candidate: cand?.id || null,
            accepted: !!result.accepted, status: result.status};
  }
  events.push({
    phase: "SUBMIT", name: "submit", title: root ? `root = S${root.step} ${root.module}` : "no root",
    caption: root
      ? `SUBMIT compares the candidates and names the root cause: step ${root.step} ${root.module}${root.fid != null ? ` (fact ${root.fid})` : ""}, ${root.faultClass || "unclassified"}. ${short(root.proposition, 150)}`
      : `SUBMIT stops without a root (${result?.stop_reason || result?.status || "no result"}).`,
    fids: root?.fid != null ? [root.fid] : [], eids: [], goals: [], windows: [], lanes: [], candidates: root?.candidate ? [root.candidate] : [],
    root: !!root,
  });

  for (const ev of events) {
    const ents = new Set();
    for (const fid of ev.fids || []) factById.get(fid)?.args.forEach(a => entityMap.has(a) && entityMap.get(a).kind !== "req" && ents.add(`e:${a}`));
    ev.entities = [...ents];
  }

  return {
    meta: {tid: record.trajectory_id, task: record.task, taskType: record.task_type, steps,
           relations: record.relations || {}, kinds},
    facts, factById, entities, goals, evidence, windows, lanes: [...lanes.values()], candidates, root, events,
  };
}

export const factRepr = f => `[${f.fid}] t${f.t} ${f.slot}/${f.side} ${f.rel}(${f.args.join(", ")}) = ${short(typeof f.value === "string" ? JSON.stringify(f.value) : JSON.stringify(f.value), 90)}`;
