import {buildEvidence} from "./evidence.js?v=chain-1";

const clip = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; };
const lower = t => t ? t[0].toLowerCase() + t.slice(1) : t;

const SOURCE = {obs: "world", chk: "check"};

export function buildChain(scene) {
  const own = scene.source?.chain;
  const chain = own?.steps?.length && own.verdict ? own : autoChain(scene);
  if (!chain) return null;
  const facts = new Map(Object.entries(chain.facts).map(([id, f]) => {
    const fids = (f.fids || []).filter(fid => scene.factById.has(fid));
    const slot = fids.length ? scene.factById.get(fids[0]).slot : null;
    return [id, {id, ...f, fids, src: SOURCE[slot] || "agent"}];
  }));
  const nodes = [...chain.steps, {id: "verdict", ...chain.verdict, verdict: true}];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const factsOf = (id, seen = new Set()) => {
    if (seen.has(id)) return [];
    seen.add(id);
    if (facts.has(id)) return [id];
    return (byId.get(id)?.from || []).flatMap(x => factsOf(x, seen));
  };
  for (const n of nodes) {
    n.own = (n.from || []).filter(x => facts.has(x));
    n.under = [...new Set(factsOf(n.id))];
  }
  return {facts, nodes, byId};
}

function autoChain(scene) {
  const ev = buildEvidence(scene), r = scene.root;
  if (!ev?.rows.length || !r) return null;
  const facts = {};
  const put = (id, fids, label, at) => { if (fids.length) facts[id] = {fids, label: clip(label, 22), at}; return fids.length ? id : null; };
  const task = put("task", scene.facts.filter(f => f.rel === "satisfied" && f.t === 0).map(f => f.fid).slice(0, 1), "What the task asks", "the task");
  const failed = scene.facts.filter(f => f.rel === "satisfied" && f.value === false && f.t > 0).sort((a, b) => a.t - b.t);
  const fail = put("fail", failed.slice(0, 1).map(f => f.fid), "Goal not met", failed[0] ? `step ${failed[0].t} · check` : "");
  const rowId = new Map(ev.rows.map((row, k) => [row, put(`r${k}`, row.fids.slice(0, 2), row.quote ? (row.slot === "obs" || row.slot === "act" ? row.quote : `“${row.quote.replace(/^…/, "")}”`) : row.reading, `step ${row.step} · ${row.module}`)]));
  const ids = rows => rows.map(x => rowId.get(x)).filter(Boolean);
  const say = rows => clip(rows.map(x => x.reading.replace(/[.…]+$/, "")).join("; "), 200);

  const rootRow = ev.rows.find(x => x.role === "root");
  const before = ev.rows.filter(x => x !== rootRow && x.step <= r.step && ["world", "context"].includes(x.role));
  const after = ev.rows.filter(x => x.step > r.step && ["effect", "world"].includes(x.role));
  const later = ev.rows.filter(x => ["correction", "repeat", "rival"].includes(x.role));
  const steps = [];
  steps.push({id: "n1", title: `What step ${r.step} got wrong`, sub: ev.verdict.fault || r.module, from: [task, ...ids(before), ...ids([rootRow].filter(Boolean))].filter(Boolean),
              because: before.length ? `${say(before)}.` : `${rootRow?.reading || ev.verdict.say}`, so: `${clip(rootRow?.reading || ev.verdict.say, 200)}`});
  if (after.length) steps.push({id: "n2", title: "The run followed it", sub: "acted on", from: ["n1", ...ids(after)],
              because: `${say(after)}.`, so: `Step ${r.step}'s ${r.module} was carried out, not just thought.`});
  if (later.length || ev.rival) steps.push({id: "n3", title: ev.rival ? `Step ${ev.rival.step} only follows it` : "Later steps follow it", sub: "the rival is ruled out",
              from: [...ids(later), "n1"], because: ev.rival?.claim ? `${ev.rival.claim}` : `${say(later)}.`,
              so: clip(ev.rival?.why || `None of the later steps starts a new mistake; step ${r.step} stays the origin.`, 220)});
  const tops = steps.length > 1 ? steps.slice(1).map(s => s.id) : ["n1"];
  return {facts, steps, verdict: {title: `Root cause: step ${r.step} ${r.module}`, sub: "explains the failure", from: tops, explains: fail ? [fail] : [],
          because: `Everything the evidence shows goes back to step ${r.step}'s ${r.module}: ${lower(clip(ev.verdict.say, 160))}`,
          so: fail ? "That is the root cause, and it is why the goal check says not met." : "That is the root cause."}};
}
