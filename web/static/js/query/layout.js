// World-space layout of the Query Graph tower. Every layer shares the x axis (step t), so a
// vertical line always means "the same moment in the trajectory".
//   y = 0   DSL record: facts (z = slot row), entities (back rows), goals (left)
//   y = 1   ROUTE: query probes in call order along the front rail, rule evidence at its step
//   y = 2   route_cases windows
//   y = 3   TRACE lanes and their candidates
//   y = 4   SUBMIT root
import {SLOTS} from "./model.js";

export const LAYER_H = 3.4;
export const LAYERS = [
  {id: "dsl", label: "① DSL record", sub: "Entity · Fact · Goal"},
  {id: "route", label: "② ROUTE queries", sub: "views · rule evidence"},
  {id: "window", label: "③ Suspect windows", sub: "route_cases"},
  {id: "trace", label: "④ TRACE lanes", sub: "SQL · candidates"},
  {id: "root", label: "⑤ Conclusion", sub: "SUBMIT root"},
];
const ZS = 1.35;          // distance between slot rows
const CELL_R = 0.46;      // radius of the jitter disc inside one (step, slot) cell

// Small deterministic hash so the cloud keeps its shape between reloads.
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function layoutScene(scene) {
  const T = scene.meta.steps;
  const X = t => t - (T + 1) / 2;
  const slotZ = slot => (Math.max(0, SLOTS.indexOf(slot)) - (SLOTS.length - 1) / 2) * ZS;
  const zMin = slotZ(SLOTS[0]), zMax = slotZ(SLOTS[SLOTS.length - 1]);
  const pos = new Map();

  // Facts: a sunflower disc per (step, slot) cell, a little vertical jitter for depth.
  const cells = new Map();
  for (const f of scene.facts) {
    const k = `${f.t}|${f.slot}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(f);
  }
  for (const list of cells.values()) {
    list.forEach((f, k) => {
      const n = list.length;
      const r = n === 1 ? 0 : CELL_R * Math.sqrt((k + 0.5) / n);
      const a = k * 2.39996 + hash(f.t);
      pos.set(f.id, [X(f.t) + r * Math.cos(a), (hash(f.fid) - 0.5) * 0.5, slotZ(f.slot) + r * Math.sin(a) * 0.8]);
    });
  }

  // Entities: two back rows ordered by the mean step of their facts, spread to a minimum gap.
  const ents = scene.entities.map(e => {
    const ts = e.facts.map(fid => scene.factById.get(fid)?.t).filter(t => t != null);
    return {e, bx: ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : (T + 1) / 2};
  }).sort((a, b) => a.bx - b.bx);
  const rows = ents.length > 40 ? 3 : 2;
  const width = T + 2, gap = Math.min(0.9, width / Math.max(1, Math.ceil(ents.length / rows)));
  ents.forEach(({e, bx}, i) => {
    const row = i % rows;
    pos.set(e.id, [Math.max(X(0.2), Math.min(X(bx), X(T + 0.8))), 0.15 + row * 0.35, zMin - 2.4 - row * 0.9]);
  });
  // Resolve overlaps along x inside each row.
  for (let row = 0; row < rows; row++) {
    const inRow = ents.filter((_, i) => i % rows === row).map(({e}) => pos.get(e.id)).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < inRow.length; i++) if (inRow[i][0] - inRow[i - 1][0] < gap) inRow[i][0] = inRow[i - 1][0] + gap;
    const over = inRow.length ? inRow[inRow.length - 1][0] - X(T + 0.8) : 0;
    if (over > 0) inRow.forEach(p => { p[0] -= over; });
  }

  scene.goals.forEach((g, i) => pos.set(g.id, [X(0) - 2.4 - (i % 2) * 1.2, 0.4, zMin - 1.4 - i * 0.9]));

  // ROUTE: rule evidence at its step, a little behind the slot it cites first.
  const y1 = LAYER_H;
  scene.evidence.forEach((v, i) => {
    const first = scene.factById.get(v.refs[0]);
    pos.set(v.id, [X(v.t) + (hash(i + 7) - 0.5) * 0.4, y1, (first ? slotZ(first.slot) : 0) - 0.5]);
  });
  // Query probes: every MAP/ROUTE event gets a probe on the front rail, in call order.
  const probes = scene.events.filter(ev => ev.phase === "MAP" || (ev.phase === "ROUTE" && ev.name !== "route_cases"));
  probes.forEach((ev, i) => {
    ev.probe = `q${ev.ordinal}`;
    const x = probes.length === 1 ? 0 : X(1) + (T - 1) * i / (probes.length - 1);
    pos.set(ev.probe, [x, y1, zMax + 1.9]);
  });

  const y2 = LAYER_H * 2;
  scene.windows.forEach((w, i) => {
    const zs = w.fids.map(fid => pos.get(`f${fid}`)?.[2]).filter(z => z != null);
    pos.set(w.id, [X(w.step), y2, zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : 0]);
  });

  const y3 = LAYER_H * 3;
  scene.lanes.forEach((l, i) => {
    const w = scene.windows.find(w => w.caseId === l.anchor);
    const x = w ? X(w.step) : 0;
    pos.set(l.id, [x - 1.6, y3, (i - (scene.lanes.length - 1) / 2) * 2.6 - 1.2]);
  });
  scene.candidates.forEach(c => {
    const f = scene.factById.get(c.fid);
    const p = f ? pos.get(f.id) : null;
    pos.set(c.id, [p ? p[0] : X(c.step), y3, p ? p[2] : 0]);
  });

  if (scene.root) {
    const f = scene.factById.get(scene.root.fid);
    const p = f ? pos.get(f.id) : null;
    pos.set("root", [p ? p[0] : X(scene.root.step), LAYER_H * 4, p ? p[2] : 0]);
  }

  // Plates: the base spans the whole record; higher layers hug their content, so the tower
  // narrows as the search converges.
  const pad = 1.4;
  const box = (ids, y, min = 2.2) => {
    const ps = ids.map(id => pos.get(id)).filter(Boolean);
    if (!ps.length) return null;
    let x0 = Math.min(...ps.map(p => p[0])) - pad, x1 = Math.max(...ps.map(p => p[0])) + pad;
    let z0 = Math.min(...ps.map(p => p[2])) - pad, z1 = Math.max(...ps.map(p => p[2])) + pad;
    if (x1 - x0 < min * 2) { const c = (x0 + x1) / 2; x0 = c - min; x1 = c + min; }
    if (z1 - z0 < min * 2) { const c = (z0 + z1) / 2; z0 = c - min; z1 = c + min; }
    return {x0, x1, z0, z1, y};
  };
  const base = {x0: X(0) - 4.2, x1: X(T + 1) + 0.6, z0: zMin - 2.4 - (rows - 1) * 0.9 - 1, z1: zMax + 1, y: -0.45};
  const plates = [
    {...LAYERS[0], ...base},
    {...LAYERS[1], ...(box([...scene.evidence.map(v => v.id), ...probes.map(e => e.probe)], y1) || {x0: base.x0 + 4, x1: base.x1, z0: zMin, z1: zMax + 2.6, y: y1})},
    {...LAYERS[2], ...(box(scene.windows.map(w => w.id), y2) || {})},
    {...LAYERS[3], ...(box([...scene.lanes.map(l => l.id), ...scene.candidates.map(c => c.id)], y3) || {})},
    {...LAYERS[4], ...(box(scene.root ? ["root"] : [], LAYER_H * 4, 1.8) || {})},
  ].filter(p => p.x0 != null);

  const center = [0, LAYER_H * 1.6, (zMin + zMax) / 2 - 1];
  return {pos, plates, X, slotZ, zMin, zMax, T, center, probes};
}
