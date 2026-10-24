// Turns a position on the event timeline (event index + progress inside it) into a frame for
// the stage: what is visible, what the current call lights up, the beams it fires, the
// structural edges built so far and where the tour camera should look.
import {LAYER_H} from "./layout.js";

const DURATION = {compile: 5.5, view: 2.6, view_evidence: 2.6, route_cases: 4.5, plan_trace: 4.5, query_logs: 5, assess: 4.5, submit: 7};
export const eventDuration = ev => ev.error ? 1.6 : (ev.phase === "MAP" ? 4 : DURATION[ev.name] || 3);

const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));

export function createTour(scene, layout, colors) {
  const {events} = scene;
  const pos = id => layout.pos.get(id);
  const phaseColor = ev => colors()[{PARSE: "parse", MAP: "map", ROUTE: "route", MANAGER: "manager", TRACE: "trace", SUBMIT: "submit"}[ev.phase] || "route"];

  // When each structural node first appears.
  const firstSeen = new Map();
  events.forEach((ev, i) => {
    if (ev.probe) firstSeen.set(ev.probe, i);
    for (const id of [...ev.windows || [], ...ev.lanes || [], ...ev.candidates || []]) if (!firstSeen.has(id)) firstSeen.set(id, i);
    if (ev.root) firstSeen.set("root", i);
  });
  // A window opened by route_cases appears with it; its lane may name it again later.
  const baseIds = [...scene.facts, ...scene.entities, ...scene.goals, ...scene.evidence].map(n => n.id);

  // Visit counts before each event, so a frame never has to replay the history.
  const heatBefore = [];
  const counts = new Map();
  events.forEach(ev => {
    heatBefore.push(new Map(counts));
    for (const id of touched(ev)) counts.set(id, (counts.get(id) || 0) + 1);
  });
  heatBefore.push(new Map(counts));

  function touched(ev) {
    return [...(ev.fids || []).map(fid => `f${fid}`), ...(ev.entities || []), ...(ev.goals || []), ...(ev.eids || []).map(eid => `v${eid}`)];
  }

  // Which probes saw a window's issue facts: the "because" behind each window.
  const windowSources = new Map(scene.windows.map(w => {
    const fids = new Set(w.fids);
    return [w.id, layout.probes.filter(ev => ev.fids.some(fid => fids.has(fid))).map(ev => ev.probe)];
  }));

  function sourceOf(ev) {
    if (ev.probe) return ev.probe;
    if (ev.name === "query_logs" || ev.name === "assess") return ev.lanes[0];
    if (ev.name === "submit") return scene.root ? "root" : null;
    return null;
  }

  function camera(ev, p, i) {
    const t = pos(sourceOf(ev)) || layout.center;
    switch (ev.phase) {
      case "PARSE": return {target: [0, 0.6, -1], yaw: -0.75 + p * 0.45, pitch: 0.55 - p * 0.12, dist: 42};
      case "MAP": { const g = pos(scene.goals[0]?.id) || [0, 0, 0]; return {target: [g[0] + 4, 1, g[2]], yaw: -0.95, pitch: 0.38, dist: 24}; }
      case "ROUTE":
        if (ev.name === "route_cases") { const w = pos(ev.windows[0]) || t; return {target: [w[0], LAYER_H * 1.2, w[2]], yaw: -0.3, pitch: 0.3, dist: 30}; }
        return {target: [t[0] * 0.45, LAYER_H * 0.55, -0.5], yaw: -0.42 + 0.12 * Math.sin(i * 0.9), pitch: 0.34, dist: 37};
      case "MANAGER": { const l = pos(ev.lanes[0]) || t; return {target: [l[0], LAYER_H * 2.3, l[2]], yaw: 0.28, pitch: 0.3, dist: 30}; }
      case "TRACE":
        if (ev.name === "query_logs") return {target: [t[0] * 0.4, LAYER_H * 1.5, 0], yaw: 0.4, pitch: 0.36, dist: 40};
        return {target: [t[0], LAYER_H * 2.2, t[2]], yaw: 0.18, pitch: 0.32, dist: 28};
      case "SUBMIT": { const r = pos("root") || t; return {target: [r[0], LAYER_H * 2, r[2]], yaw: -0.35 + p * 0.5, pitch: 0.22 + p * 0.1, dist: 36}; }
      default: return {target: layout.center, yaw: -0.5, pitch: 0.4, dist: 42};
    }
  }

  return function frameAt(i, p) {
    const ev = events[i];
    const c = colors();
    const visible = new Set(baseIds);
    const plates = new Set();
    for (const [id, at] of firstSeen) if (at <= i) visible.add(id);
    if (layout.probes.some(e => visible.has(e.probe)) || i > 0) plates.add("route");
    if (scene.windows.some(w => visible.has(w.id))) plates.add("window");
    if (scene.lanes.some(l => visible.has(l.id))) plates.add("trace");
    if (visible.has("root")) plates.add("root");

    const heatCounts = heatBefore[i];
    const heat = new Map();
    for (const [id, n] of heatCounts) heat.set(id, Math.min(1, n / 4));

    const lit = new Map();
    const glow = ramp(p, 0, 0.25);
    for (const id of touched(ev)) lit.set(id, glow);
    for (const id of [...ev.windows || [], ...ev.lanes || [], ...ev.candidates || []]) lit.set(id, glow);
    if (ev.probe) lit.set(ev.probe, 1);
    if (ev.root) lit.set("root", glow);

    // Beams from the call's source to what it touched, fired one after another.
    const beams = [];
    const fire = (from, targets, color, width = 1, alpha = 0.55) => {
      targets.forEach((to, k) => {
        const delay = targets.length > 1 ? (k / targets.length) * 0.35 : 0;
        beams.push({from, to, color, width, alpha, t: ramp(p, delay, delay + 0.3)});
      });
    };
    const pc = phaseColor(ev);
    if (ev.probe) fire(ev.probe, touched(ev).filter(id => !id.startsWith("e:")), pc, 1, 0.42);
    else if (ev.name === "route_cases") ev.windows.forEach(id => fire(id, scene.windows.find(w => w.id === id).fids.map(fid => `f${fid}`), c.window, 1.4, 0.8));
    else if (ev.name === "plan_trace") ev.lanes.forEach(id => { const l = scene.lanes.find(x => x.id === id); fire(`w:${l.anchor}`, [id], c.manager, 2, 0.9); });
    else if (ev.name === "query_logs" && ev.lanes[0]) fire(ev.lanes[0], ev.fids.map(fid => `f${fid}`), c.trace, 1, 0.38);
    else if (ev.name === "assess" && ev.lanes[0]) { fire(ev.lanes[0], ev.candidates, c.trace, 2, 0.9); }
    else if (ev.name === "submit" && scene.root) {
      if (scene.root.candidate) fire(scene.root.candidate, ["root"], c.root, 2.5, 1);
      if (scene.root.fid != null) fire("root", [`f${scene.root.fid}`], c.root, 2.5, 1);
    }

    // Structure built so far.
    const edges = [];
    for (const v of scene.evidence) for (const fid of v.refs) edges.push({a: v.id, b: `f${fid}`, color: c.evidence, alpha: 0.1});
    for (const w of scene.windows) if (visible.has(w.id)) {
      for (const fid of w.fids) edges.push({a: w.id, b: `f${fid}`, color: c.window, alpha: 0.32});
      for (const q of windowSources.get(w.id) || []) if (visible.has(q)) edges.push({a: q, b: w.id, color: c.route, alpha: 0.16, dash: [2, 4]});
    }
    for (const l of scene.lanes) if (visible.has(l.id)) edges.push({a: `w:${l.anchor}`, b: l.id, color: c.manager, alpha: 0.5, width: 1.5});
    for (const cand of scene.candidates) if (visible.has(cand.id)) {
      edges.push({a: cand.lane, b: cand.id, color: c.trace, alpha: 0.55, width: 1.5});
      if (cand.fid != null) edges.push({a: cand.id, b: `f${cand.fid}`, color: c.candidate, alpha: 0.45, dash: [4, 3]});
    }
    if (visible.has("root") && !(ev.name === "submit" && p < 0.6)) {
      if (scene.root.candidate) edges.push({a: scene.root.candidate, b: "root", color: c.root, alpha: 0.9, width: 2.5});
      if (scene.root.fid != null) edges.push({a: "root", b: `f${scene.root.fid}`, color: c.root, alpha: 0.85, width: 2.5});
    }

    const labels = new Set(scene.goals.map(g => g.id));
    const labelText = new Map(scene.goals.map(g => [g.id, g.key]));
    if (ev.probe) { labels.add(ev.probe); labelText.set(ev.probe, ev.name === "view" ? ev.spec : ev.name); }
    for (const w of scene.windows) if (visible.has(w.id)) { labels.add(w.id); labelText.set(w.id, `${w.caseId} · S${w.step}`); }
    for (const l of scene.lanes) if (visible.has(l.id)) { labels.add(l.id); labelText.set(l.id, l.agent); }
    for (const cand of scene.candidates) if (visible.has(cand.id)) { labels.add(cand.id); labelText.set(cand.id, `S${cand.step} ${cand.module}`); }
    if (visible.has("root")) { labels.add("root"); labelText.set("root", `ROOT · S${scene.root.step} ${scene.root.module} · ${scene.root.faultClass || ""}`); }

    return {
      frame: {visible, plates, heat, lit, beams, edges, labels, labelText, dim: (ev.fids || []).length > 0, build: ev.phase === "PARSE" ? ramp(p, 0, 0.8) : 1},
      camera: camera(ev, p, i),
    };
  };
}
