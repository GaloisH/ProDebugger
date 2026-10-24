// Groups the scene into point clouds: the whole DSL record as one core, then one cloud per
// debugger access (a ROUTE view, a suspect window, a TRACE lane's SQL result), plus the
// candidate and root markers. A cloud expands into entity groups, a group into its facts.
import {short} from "../util.js";

const MAX_GROUPS = 12;

export function buildClusters(scene) {
  const clusters = [];
  const add = c => { clusters.push({links: [], ...c}); return c; };
  add({id: "core", tier: 0, kind: "core", event: 0, fids: scene.facts.map(f => f.fid),
       label: "DSL record", detail: `${scene.facts.length} facts · ${scene.entities.length} entities`});

  scene.events.forEach((ev, i) => {
    if (ev.phase === "MAP" || (ev.phase === "ROUTE" && ev.name !== "route_cases")) {
      ev.cluster = `q${ev.ordinal}`;
      add({id: ev.cluster, tier: 1, kind: "query", event: i, fids: ev.fids, error: ev.error, phase: ev.phase,
           label: ev.error ? `${ev.name} · rejected` : ev.spec || ev.name, detail: `${ev.fids.length} facts`});
    } else if (ev.name === "route_cases") {
      ev.cluster = ev.windows[0];
      for (const id of ev.windows) {
        const w = scene.windows.find(x => x.id === id);
        add({id, tier: 2, kind: "window", event: i, fids: w.fids, ref: w, label: `${w.caseId} · S${w.step}`, detail: `${w.fids.length} issue facts`});
      }
    } else if (ev.name === "plan_trace") {
      ev.cluster = ev.lanes[0];
      for (const id of ev.lanes) {
        const l = scene.lanes.find(x => x.id === id);
        add({id, tier: 3, kind: "lane", event: i, fill: null, fids: l.fids, ref: l, label: l.agent, detail: `← ${l.anchor}`});
      }
    } else if (ev.name === "query_logs" && ev.lanes[0]) {
      ev.cluster = ev.lanes[0];
      const c = clusters.find(x => x.id === ev.lanes[0]);
      if (c) { c.fill = i; c.fids = ev.fids; c.detail = `${ev.fids.length} facts · ${c.ref.rows.length} SQL rows`; }
    } else if (ev.name === "assess") {
      ev.cluster = ev.candidates[0] || ev.lanes[0];
      for (const id of ev.candidates) {
        const cand = scene.candidates.find(x => x.id === id);
        add({id, tier: 4, kind: "candidate", event: i, fids: cand.fid != null ? [cand.fid] : [], ref: cand,
             label: `S${cand.step} ${cand.module}`, detail: cand.faultClass || cand.status});
      }
    } else if (ev.name === "submit" && scene.root) {
      ev.cluster = "root";
      add({id: "root", tier: 5, kind: "root", event: i, fids: scene.root.fid != null ? [scene.root.fid] : [], ref: scene.root,
           label: `ROOT · S${scene.root.step} ${scene.root.module}`, detail: scene.root.faultClass || ""});
    }
  });
  // Lanes with no SQL result keep the plan_trace event as their fill.
  for (const c of clusters) if (c.kind === "lane" && c.fill == null) c.fill = c.event;
  for (const c of clusters) if (c.fill == null) c.fill = c.event;

  // Links: the core feeds every query; queries that saw a window's issue facts feed it;
  // a window feeds its lanes, a lane its candidates, the chosen candidate the root.
  // Each link carries a short "what happened" label for the edge.
  const byId = new Map(clusters.map(c => [c.id, c]));
  const link = (a, b, label, weight = 1) => { if (byId.has(a) && byId.has(b)) byId.get(b).links.push({from: a, label, weight}); };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  for (const c of clusters) {
    if (c.kind === "query") link("core", c.id, c.error ? "rejected" : `pulls ${plural(c.fids.length, "fact")}`);
    if (c.kind === "window") {
      const own = new Set(c.fids);
      for (const q of clusters.filter(x => x.kind === "query")) {
        const n = q.fids.filter(fid => own.has(fid)).length;
        if (n) link(q.id, c.id, `${n}/${own.size} clues → S${c.ref.step}`, n / own.size);
      }
    }
    if (c.kind === "lane") link(`w:${c.ref.anchor}`, c.id, "assigned to TRACE");
    if (c.kind === "candidate") link(c.ref.lane, c.id, `SQL ${plural(byId.get(c.ref.lane)?.ref.rows.length || 0, "row")} → ${c.ref.status}`);
    if (c.kind === "root") link(c.ref.candidate || clusters.find(x => x.kind === "lane")?.id, c.id, "chosen as root cause");
  }
  const PHASE = {core: "PARSE", window: "ROUTE", lane: "TRACE", candidate: "TRACE", root: "SUBMIT"};
  for (const c of clusters) c.phaseKey = c.kind === "query" ? c.phase : PHASE[c.kind];

  for (const c of clusters) c.groups = groupByEntity(c.fids, scene);
  return {clusters, byId};
}

// The entity a fact is mostly about: its first non-agent argument, else its first one.
export function primaryEntity(f) {
  return f.args.find(a => !a.startsWith("agent:") && !a.startsWith("req:")) || f.args[0] || "(none)";
}

function groupByEntity(fids, scene) {
  const groups = new Map();
  for (const fid of fids) {
    const f = scene.factById.get(fid);
    if (!f) continue;
    const key = primaryEntity(f);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fid);
  }
  let list = [...groups].map(([key, list]) => ({key, fids: list.sort((a, b) => scene.factById.get(a).t - scene.factById.get(b).t)}))
    .sort((a, b) => b.fids.length - a.fids.length);
  if (list.length > MAX_GROUPS) {
    const rest = list.slice(MAX_GROUPS - 1);
    list = [...list.slice(0, MAX_GROUPS - 1), {key: `+${rest.length} more entities`, other: true, fids: rest.flatMap(g => g.fids)}];
  }
  return list;
}

// Evidence roles a fact can earn, each tied to the cloud that gives it; the stage shows a role
// only once that cloud is on screen. Later roles win: issue < candidate < root.
export const ROLE_ORDER = ["issue", "candidate", "root"];
export function factRoles(clusters) {
  const roles = new Map();
  const give = (fid, role, id) => { if (!roles.has(fid)) roles.set(fid, []); roles.get(fid).push({role, id}); };
  for (const c of clusters) {
    const role = c.kind === "window" ? "issue" : c.kind === "candidate" ? "candidate" : c.kind === "root" ? "root" : null;
    if (role) c.fids.forEach(fid => give(fid, role, c.id));
  }
  return roles;
}

export const factLabel = f => `${f.rel}(${f.args.join(", ")}) = ${short(typeof f.value === "string" ? f.value : JSON.stringify(f.value), 46)}  @S${f.t}`;
