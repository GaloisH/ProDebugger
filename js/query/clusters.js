// Groups the scene into point clouds: the whole DSL record as one core, then one cloud per
// debugger access (a ROUTE view, a suspect window, a TRACE lane's SQL result), plus the
// candidate and root markers. A cloud expands into entity groups, a group into its facts.
import {short} from "../util.js?v=edc30cc901";
import {SIGNAL_LABEL, SLOT_LABEL} from "./model.js?v=edc30cc901";
import {agentWords, factName, sayEnd, sayStop, START_SAY} from "./narrate.js?v=edc30cc901";

const MAX_GROUPS = 12;

export function buildClusters(scene) {
  const clusters = [];
  const add = c => { clusters.push({links: [], ...c}); return c; };
  add({id: "core", tier: 0, kind: "core", event: 0, fids: scene.facts.map(f => f.fid),
       label: "DSL record", detail: `${scene.facts.length} facts · ${scene.entities.length} entities`});

  scene.events.forEach((ev, i) => {
    if (ev.phase === "MAP" || (ev.phase === "ROUTE" && ev.name !== "route_cases")) {
      ev.cluster = `q${ev.ordinal}`;
      add({id: ev.cluster, tier: 1, kind: "query", event: i, fids: ev.fids, error: ev.error, phase: ev.phase, intent: ev.intent,
           label: ev.error ? `${ev.name} · rejected` : ev.name === "inspect" ? ev.intent : ev.spec || ev.name, detail: `${ev.fids.length} facts`});
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
  // Each link says what happened along it: a title (what was asked), a detail line (what came
  // back) and a card of rows for the hover.
  const byId = new Map(clusters.map(c => [c.id, c]));
  const link = (a, b, desc, weight = 1) => { if (byId.has(a) && byId.has(b)) byId.get(b).links.push({from: a, weight, ...desc}); };
  const seen = new Set();
  for (const c of clusters) {
    if (c.kind === "query") {
      const ev = scene.events[c.event];
      const fresh = c.fids.filter(fid => !seen.has(fid)).length;
      c.fids.forEach(fid => seen.add(fid));
      link("core", c.id, queryEdge(ev, c, fresh, scene));
    }
    if (c.kind === "window") {
      const own = new Set(c.fids);
      for (const q of clusters.filter(x => x.kind === "query")) {
        const shared = q.fids.filter(fid => own.has(fid));
        if (!shared.length) continue;
        const slots = [...new Set(shared.map(fid => scene.factById.get(fid).slot))].map(s => SLOT_LABEL[s]);
        link(q.id, c.id, {title: `${shared.length}/${own.size} clues → S${c.ref.step}`, detail: slots.join(" · "),
                          card: [["clues", shared.map(fid => `f${fid}`).join(" ")], ["window", `${c.ref.caseId} at step ${c.ref.step}`]]}, shared.length / own.size);
      }
    }
    if (c.kind === "lane") {
      const l = c.ref;
      link(`w:${l.anchor}`, c.id, {title: `assign ${l.agent}`, detail: `“${short(l.question, 44)}”`,
        card: [["question", l.question], ["targets", `${l.targets.length} search targets`]]});
    }
    if (c.kind === "candidate") {
      const lane = byId.get(c.ref.lane)?.ref;
      const mods = countBy(lane?.rows || [], r => r.module).slice(0, 3).map(([m, n]) => `${m} ${n}`).join(" · ");
      link(c.ref.lane, c.id, {
        title: lane?.purpose ? short(lane.purpose.replace(/^test whether /i, "tests: "), 46) : "one SQL query",
        detail: `${lane?.rows.length || 0} rows${mods ? ` · ${mods}` : ""} → ${c.ref.status}`,
        card: [["purpose", lane?.purpose || "—"], ["rows", `${lane?.rows.length || 0} on ${lane?.steps.length || 0} steps`],
               ["by module", countBy(lane?.rows || [], r => r.module).map(([m, n]) => `${m} ${n}`).join(" · ")],
               ["verdict", `S${c.ref.step} ${c.ref.module} · ${c.ref.status}${c.ref.faultClass ? ` · ${c.ref.faultClass}` : ""}`]],
      });
    }
    if (c.kind === "root") {
      const r = c.ref, rule = r.rule;
      link(r.candidate || clusters.find(x => x.kind === "lane")?.id, c.id, {
        title: "chosen as root cause",
        detail: rule?.id ? `rule ${rule.id}` : `${r.faultClass || "root"}`,
        card: [["rule", rule?.id ? `${rule.id} (of ${rule.count})` : "—"], ["conclusion", rule?.conclusion || "—"],
               ["fault", r.faultClass || "—"], ["claim", r.proposition]],
      });
    }
  }
  const PHASE = {core: "PARSE", window: "ROUTE", lane: "TRACE", candidate: "TRACE", root: "SUBMIT"};
  for (const c of clusters) c.phaseKey = c.kind === "query" ? c.phase : PHASE[c.kind];

  for (const c of clusters) {
    c.groups = groupByEntity(c.fids, scene);
    c.structure = structureOf(c.fids, scene);
  }
  return {clusters, byId};
}

// Inside a cloud the DSL itself ties the facts together: every fact hangs off the entities it
// names (a hub per entity with two or more facts here), and facts of one mutable relation on
// the same key — at(agent:self, ·), open(cabinet:1) — form a thread through time.
function structureOf(fids, scene) {
  const relations = scene.meta.relations || {};
  const named = new Map(), keyed = new Map();
  for (const fid of fids) {
    const f = scene.factById.get(fid);
    if (!f) continue;
    for (const a of new Set(f.args)) {
      if (a.startsWith("req:") || a.startsWith("int:")) continue;
      if (!named.has(a)) named.set(a, []);
      named.get(a).push(fid);
    }
    const rel = relations[f.rel];
    if (rel && !rel.props?.includes("mutable")) continue;
    const key = `${f.rel}(${(rel?.key || [0]).map(i => f.args[i] ?? "").join(", ")})`;
    if (!keyed.has(key)) keyed.set(key, []);
    keyed.get(key).push(f);
  }
  const hubs = [...named].filter(([, list]) => list.length > 1).map(([key, list]) => ({key, fids: list}))
    .sort((a, b) => b.fids.length - a.fids.length);
  const spokes = hubs.flatMap((h, j) => h.fids.map(fid => [fid, j]));
  const threads = [];
  for (const [key, list] of keyed) {
    list.sort((a, b) => a.t - b.t || a.fid - b.fid);
    for (let k = 1; k < list.length; k++) threads.push([list[k - 1].fid, list[k].fid, key]);
  }
  return {hubs, spokes, threads};
}

// Everything upstream and downstream of a cloud along its links: for the root, the candidate,
// lane, window, the queries that found its clues and the record; for a query, what it fed.
export function chainOf({clusters, byId}, id) {
  const down = new Map(clusters.map(c => [c.id, []]));
  for (const c of clusters) for (const l of c.links) down.get(l.from)?.push(c.id);
  const chain = new Set([id]);
  const walk = (start, next) => {
    const stack = [start];
    while (stack.length) for (const n of next(stack.pop())) if (!chain.has(n)) { chain.add(n); stack.push(n); }
  };
  walk(id, x => byId.get(x)?.links.map(l => l.from) || []);
  walk(id, x => down.get(x) || []);
  return chain;
}

// The chain a click lights, made readable: when several queries fed one window, only the one
// that gave it most clues stays on the chain (the clicked one, if it is among them) and the rest
// are listed as extra; `all` keeps them. Its edges come numbered from the record up to the root.
export function chainPath(model, id, all = false) {
  const {clusters, byId} = model;
  const chain = chainOf(model, id), extra = new Map();
  if (!all) for (const c of clusters) {
    if (c.kind !== "window" || !chain.has(c.id)) continue;
    const feeds = c.links.filter(l => chain.has(l.from) && byId.get(l.from)?.kind === "query");
    if (feeds.length < 2) continue;
    const keep = feeds.find(l => l.from === id) || feeds.reduce((a, b) => b.weight > a.weight ? b : a);
    const drop = feeds.filter(l => l !== keep).map(l => l.from);
    drop.forEach(q => chain.delete(q));
    extra.set(c.id, drop);
  }
  const edges = [];
  for (const c of clusters) if (chain.has(c.id)) for (const l of c.links) if (chain.has(l.from)) edges.push({from: l.from, to: c.id, link: l});
  const at = e => byId.get(e.to);
  edges.sort((a, b) => at(a).tier - at(b).tier || at(a).event - at(b).event || a.from.localeCompare(b.from));
  return {id, chain, edges, extra, all};
}

const countBy = (list, key) => {
  const m = new Map();
  for (const x of list) m.set(key(x), (m.get(key(x)) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

// A ROUTE edge: what the view asked, then what it turned up (trouble signals first, else the
// goal's state, else a count).
function queryEdge(ev, c, fresh, scene) {
  const facts = c.fids.map(fid => scene.factById.get(fid));
  const ts = facts.map(f => f.t);
  const signals = (ev.signals || []).map(([s, n]) => `${SIGNAL_LABEL[s]} ×${n}`);
  let detail;
  if (ev.name === "inspect") detail = ev.verdicts.length ? ev.verdicts.map(([v, n]) => `${v} ${n}`).join(" · ")
    : ts.length ? `S${Math.min(...ts)}–S${Math.max(...ts)}` : `${ev.calls.length} calls`;
  else if (ev.error) detail = `rejected · ${ev.error.code || "error"}`;
  else if (signals.length) detail = signals.slice(0, 2).join(" · ");
  else if (ev.goal) detail = `goal ${ev.goal.state}${ev.goal.decided.length ? ` · decided at S${ev.goal.decided.join(", S")}` : ""}`;
  else if (ev.changes != null) detail = `${ev.changes} state changes`;
  else detail = `${c.fids.length} facts`;
  const card = [
    ["asked", `${ev.name}(${JSON.stringify(ev.spec ?? ev.call?.arguments?.spec ?? "")})`],
    ["steps", ts.length ? `S${Math.min(...ts)}–S${Math.max(...ts)}` : "—"],
    ["returned", `${c.fids.length} facts · ${fresh} new`],
    ["modules", countBy(facts, f => f.slot).map(([s, n]) => `${s} ${n}`).join(" · ") || "—"],
  ];
  if (signals.length) card.push(["signals", signals.join(" · ")]);
  if (ev.goal) card.push(["goal", detail]);
  if (ev.error) card.push(["error", ev.error.message]);
  if (ev.name === "inspect") {
    card[0] = ["asked", ev.spec];
    if (ev.verdicts.length) card.push(["verdicts", ev.verdicts.map(([v, n]) => `${v} ${n}`).join(" · ")]);
    if (ev.errors) card.push(["rejected", `${ev.errors} calls`]);
  }
  return {title: ev.intent || ev.name, detail, card};
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

// The facts that earned each role, furthest-reaching first: a clue that went on to be the root
// leads the clue list.
export function roleFacts(clusters) {
  const roles = factRoles(clusters);
  const reach = fid => Math.max(...roles.get(fid).map(r => ROLE_ORDER.indexOf(r.role)));
  const out = new Map(ROLE_ORDER.map(r => [r, []]));
  for (const [fid, list] of roles) for (const r of new Set(list.map(x => x.role))) out.get(r).push(fid);
  for (const list of out.values()) list.sort((a, b) => reach(b) - reach(a) || a - b);
  return {byRole: out, reach: fid => roles.has(fid) ? ROLE_ORDER[reach(fid)] : null};
}

// One fact's way from the record to its verdict: every cloud that returned it, climbing the
// tiers in call order, each stop saying what that step made of the fact. Where the way stops
// short of the root, or starts above ROUTE, a note says why. Each stop and note also comes in
// plain English (narrate.js) for readers who do not know the DSL.
export function journeyOf(scene, {clusters, byId}, fid) {
  const f = scene.factById.get(fid);
  const at = c => c.kind === "lane" ? c.fill : c.event;
  const clouds = clusters.filter(c => c.kind !== "core" && c.fids.includes(fid)).sort((a, b) => at(a) - at(b) || a.tier - b.tier);
  const stops = [{id: "core", kind: "core", event: 0, phase: "PARSE", outcome: `compiled from S${f.t} ${SLOT_LABEL[f.slot]}`, ...sayStop("core", {f})}];
  let seen = 0;
  for (const c of clouds) {
    const ev = scene.events[at(c)];
    let outcome, verdict;
    const plain = sayStop(c.kind, {f, c, ev, seen, verdict: verdict = (ev.calls || []).find(e => e.call?.arguments?.fid === fid && e.verdict)?.verdict});
    if (c.kind === "query") {
      outcome = `${seen++ ? "returned again" : "first returned"}${verdict ? ` · check → ${verdict}` : ""}`;
    } else if (c.kind === "window") outcome = `clue of suspect window ${c.ref.caseId} at S${c.ref.step}`;
    else if (c.kind === "lane") {
      const own = c.ref.rows.some(r => r.step === f.t && r.module === SLOT_LABEL[f.slot]);
      outcome = own ? `SQL returned its row (S${f.t} ${SLOT_LABEL[f.slot]})` : c.ref.rows.some(r => r.step === f.t) ? `SQL returned step S${f.t}` : "SQL returned it";
    } else if (c.kind === "candidate") outcome = `blamed: S${c.ref.step} ${c.ref.module} · ${c.ref.status}${c.ref.faultClass ? ` · ${c.ref.faultClass}` : ""}`;
    else if (c.kind === "root") outcome = `chosen as root cause${c.ref.rule?.id ? ` by rule ${c.ref.rule.id}` : ""}`;
    stops.push({id: c.id, kind: c.kind, event: at(c), phase: c.phaseKey, outcome, ...plain});
  }

  // Why it stops: judged at the highest tier it reached; in parallel lanes, by all of them.
  const first = clouds[0], top = Math.max(-1, ...clouds.map(c => c.tier)), last = clouds.findLast(c => c.tier === top);
  const start = !first || first.kind === "query" ? null
    : first.kind === "window" ? "put in a window without a ROUTE view returning it"
    : first.kind === "lane" ? "found by TRACE's SQL directly, not via ROUTE"
    : first.kind === "candidate" ? "named by TRACE's assess directly" : "named by SUBMIT directly";
  let end = null, why = null;
  if (!last) { end = "no debugger call returned it"; why = {kind: "unread"}; }
  else if (last.kind === "query") { end = "ROUTE read it but put it in no suspect window"; why = {kind: "read"}; }
  else if (last.kind === "window") {
    const lanes = clusters.filter(c => c.kind === "lane" && (c.ref.anchor === last.ref.caseId || c.ref.cases.includes(last.ref.caseId)));
    end = lanes.length ? `the SQL of ${lanes.map(l => l.ref.agent).join(", ")} did not return it` : `window ${last.ref.caseId} got no TRACE lane`;
    why = lanes.length ? {kind: "missed"} : {kind: "unassigned", step: last.ref.step};
  } else if (last.kind === "lane") {
    const lanes = new Set(clouds.filter(c => c.kind === "lane").map(c => c.id));
    const seenBlame = new Set();
    const blamed = clusters.filter(c => c.kind === "candidate" && lanes.has(c.ref.lane)).map(c => c.ref)
      .filter(r => !seenBlame.has(`${r.step} ${r.module}`) && seenBlame.add(`${r.step} ${r.module}`));
    end = blamed.length ? `TRACE blamed ${blamed.map(r => `S${r.step} ${r.module}`).join(", ")} instead` : `TRACE blamed no step in ${last.ref.agent}`;
    why = blamed.length ? {kind: "blamedOther", blamed} : {kind: "noBlame"};
  } else if (last.kind === "candidate") {
    const root = byId.get("root")?.ref;
    end = root ? `SUBMIT chose S${root.step} ${root.module} instead` : "SUBMIT named no root";
    why = root ? {kind: "otherRoot", root} : {kind: "noRoot"};
  }
  return {fid, fact: f, stops, start, end, name: factName(f), words: agentWords(f),
          startSay: first ? START_SAY[first.kind] || null : null, endSay: why ? sayEnd(why) : null};
}

export const factLabel = f => `${f.rel}(${f.args.join(", ")}) = ${short(typeof f.value === "string" ? f.value : JSON.stringify(f.value), 46)}  @S${f.t}`;
