// Turns a position on the call timeline (event index + progress inside it) into what the
// stage shows: which clouds exist yet, which are filled, which one is in focus, and where the
// tour camera looks. Clouds simply appear; nothing pulses or flies.
const DURATION = {compile: 4, view: 2.4, view_evidence: 2.4, route_cases: 4, plan_trace: 3.5, query_logs: 4, assess: 3.5, submit: 5};
export const eventDuration = ev => ev.error ? 1.4 : ev.phase === "MAP" ? 3 : DURATION[ev.name] || 3;

const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));

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
  // Looking at a ring member from outside: the camera sits on the member's side of the axis.
  const yawFacing = id => { const a = layout.angle.get(id); return a == null ? null : Math.atan2(Math.cos(a), Math.sin(a)); };
  const P = id => layout.pos.get(id) || [0, 0, 0];

  function camera(ev, focus) {
    const id = focus[0];
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

  return function frameAt(i, p) {
    const ev = scene.events[i];
    const visible = new Set(), filled = new Set(), appear = new Map();
    for (const c of clusters) {
      if (c.event > i) continue;
      visible.add(c.id);
      if (c.fill <= i) filled.add(c.id);
      if (c.event === i && c.kind !== "core") appear.set(c.id, ramp(p, 0, 0.3));
    }
    const focus = focusOf(ev);
    return {frame: {visible, filled, appear, focus: new Set(focus)}, camera: camera(ev, focus)};
  };
}
