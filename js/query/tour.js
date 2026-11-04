const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));

export const readSeconds = words => Math.max(4, words * 0.35);

export function createTour(scene, model, layout) {
  const {clusters} = model;
  const focusOf = ev => {
    if (ev.phase === "PARSE") return ["core"];
    if (ev.name === "route_cases") return ev.windows;
    if (ev.name === "plan_trace" || ev.name === "query_logs") return ev.lanes;
    if (ev.name === "assess") return ev.candidates.length ? ev.candidates : ev.lanes;
    if (ev.name === "submit") return scene.root ? ["root"] : [];
    return ev.cluster ? [ev.cluster] : [];
  };
  const yawFacing = id => { const a = layout.angle.get(id); return a == null ? null : Math.atan2(Math.cos(a), Math.sin(a)); };
  const P = id => layout.pos.get(id) || [0, 0, 0];

  function camera(ev, focus) {
    const id = focus[0];
    if (ev.phase === "ROUTE" && focus.length > 1) {
      const ps = focus.map(P), mid = [0, 1, 2].map(k => ps.reduce((n, p) => n + p[k], 0) / ps.length);
      const spread = Math.max(...ps.map(p => Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2])));
      return {target: mid, yaw: null, pitch: 0.32, dist: Math.max(24, spread * 3 + 16)};
    }
    switch (ev.phase) {
      case "PARSE": return {target: [0, 1.5, 0], yaw: 0.55, pitch: 0.3, dist: 26};
      case "MAP": case "ROUTE":
        if (ev.name === "route_cases") return {target: [0, 4, 0], yaw: null, pitch: 0.3, dist: 44};
        return {target: [P(id)[0] * 0.55, 2, P(id)[2] * 0.55], yaw: yawFacing(id), pitch: 0.36, dist: 34};
      case "MANAGER": case "TRACE": return {target: [P(id)[0], P(id)[1] - 2.5, P(id)[2]], yaw: null, pitch: 0.28, dist: 30};
      case "SUBMIT": return {target: [0, 9.5, 0], yaw: null, pitch: 0.16, dist: 58};
      default: return {target: [0, 7, 0], yaw: null, pitch: 0.3, dist: 48};
    }
  }

  function frameAt(i, p, all = false) {
    const ev = scene.events[i];
    const visible = new Set(), filled = new Set(), appear = new Map();
    for (const c of clusters) {
      if (c.event > i || (c.error && !all)) continue;
      visible.add(c.id);
      if (c.fill <= i) filled.add(c.id);
      if (c.event === i && c.kind !== "core") appear.set(c.id, ramp(p, 0, 0.3));
    }
    const focus = focusOf(ev);
    return {frame: {visible, filled, appear, focus: new Set(focus)}, camera: camera(ev, focus)};
  }

  function frameAtBeat(beat, p) {
    if (beat.i < 0) {
      const mid = (layout.top + layout.bottom) / 2;
      return {frame: {visible: new Set(), filled: new Set(), appear: new Map(), focus: new Set(), allFloors: true},
              camera: {target: [0, mid, 0], yaw: 0.55, pitch: 0.3, dist: 30 + (layout.top - layout.bottom) * 1.1}};
    }
    const out = frameAt(beat.i, 1);
    out.frame.shot = beat.shot || null;
    if (beat.shot) {
      out.frame.focus = new Set([beat.shot.cloud]);
      const ev = scene.events[beat.i];
      out.camera = {target: P(beat.shot.cloud), yaw: null, pitch: 0.3, dist: beat.shot.cloud === "core" ? 18 : 11};
      out.frame.appear = new Map();
      return out;
    }
    if (beat.log) {
      out.frame.focus = new Set(beat.focus);
      out.frame.appear = new Map();
      out.camera = {fit: true, target: [0, 7, 0], yaw: 0.55, pitch: 0.32, dist: 56};
      return out;
    }
    const mine = new Set(beat.events);
    out.frame.appear = new Map(clusters.filter(c => mine.has(c.event) && c.kind !== "core" && out.frame.visible.has(c.id)).map(c => [c.id, ramp(p, 0, 0.3)]));
    if (beat.events.length > 1) {
      const focus = [...new Set(beat.events.flatMap(k => focusOf(scene.events[k])))];
      out.frame.focus = new Set(focus);
      out.camera = camera(scene.events[beat.i], focus);
    }
    return out;
  }

  return Object.assign(frameAt, {beat: frameAtBeat});
}
