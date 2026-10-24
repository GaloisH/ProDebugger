// Zero-dependency 3D stage: a perspective camera over the tower, drawn on a 2D canvas with
// additive glow sprites. The caller hands it a frame (which nodes are visible, lit, warm,
// and which beams/edges to draw); the stage owns the camera, picking and the render loop.
import {SLOTS, SLOT_LABEL} from "./model.js";

const TOKENS = ["void", "plate", "plate-line", "grid", "label", "label-dim", "env", "mind", "task", "entity", "goal",
                "evidence", "window", "lane", "candidate", "root", "beam", "map", "route", "manager", "trace", "submit", "parse"];

function readColors() {
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries(TOKENS.map(t => [t, css.getPropertyValue(["map", "route", "manager", "trace", "submit", "parse"].includes(t) ? `--${t}` : `--qg-${t}`).trim() || "#888"]));
}

// One glow sprite per colour: a hot core and a soft halo, blended additively.
function sprite(color) {
  const s = 64, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.12, color);
  grad.addColorStop(0.3, color + "88");
  grad.addColorStop(0.62, color + "1c");
  grad.addColorStop(1, color + "00");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return c;
}

const RADIUS = {fact: 0.15, entity: 0.22, goal: 0.55, evidence: 0.24, probe: 0.3, window: 0.55, lane: 0.45, candidate: 0.42, root: 0.75};

export function nodeColor(node, colors) {
  switch (node.type) {
    case "fact": return colors[node.side] || colors.env;
    case "probe": return colors[node.phase === "MAP" ? "map" : "route"];
    default: return colors[node.type] || colors.label;
  }
}

export function createStage(canvas, scene, layout) {
  const ctx = canvas.getContext("2d");
  let colors = readColors();
  let sprites = new Map();
  const spriteFor = color => { if (!sprites.has(color)) sprites.set(color, sprite(color)); return sprites.get(color); };

  // Every drawable node in one list; probes come from the layout.
  const nodes = [
    ...scene.facts, ...scene.entities, ...scene.goals, ...scene.evidence, ...scene.windows,
    ...scene.lanes, ...scene.candidates, ...(scene.root ? [scene.root] : []),
    ...layout.probes.map(ev => ({id: ev.probe, type: "probe", phase: ev.phase, event: ev})),
  ].filter(n => layout.pos.has(n.id));
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  const cam = {target: [...layout.center], yaw: -0.55, pitch: 0.42, dist: 44, fov: 0.85};
  let goal = {...cam, target: [...cam.target]};
  let manual = false;
  let frame = {visible: new Set(), lit: new Map(), heat: new Map(), beams: [], edges: [], labels: new Set(), dim: false, build: 1};
  let selected = null, hovered = null;
  let projected = [];
  let W = 0, H = 0, dpr = 1, raf = 0, last = 0, onFrame = null;
  const listeners = {hover: [], select: [], manual: []};
  const emit = (k, v) => listeners[k].forEach(fn => fn(v));

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }

  function basis() {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const eye = [cam.target[0] + cam.dist * cp * Math.sin(cam.yaw), cam.target[1] + cam.dist * sp, cam.target[2] + cam.dist * cp * Math.cos(cam.yaw)];
    const f = norm(sub(cam.target, eye));
    const r = norm(cross(f, [0, 1, 0]));
    const u = cross(r, f);
    return {eye, f, r, u, focal: H / (2 * Math.tan(cam.fov / 2))};
  }
  let B = null;
  function project(p) {
    const d = sub(p, B.eye);
    const z = dot(d, B.f);
    if (z < 0.5) return null;
    return {x: W / 2 + B.focal * dot(d, B.r) / z, y: H / 2 - B.focal * dot(d, B.u) / z, z, s: B.focal / z};
  }

  function drawPlate(p, i) {
    const corners = [[p.x0, p.y, p.z0], [p.x1, p.y, p.z0], [p.x1, p.y, p.z1], [p.x0, p.y, p.z1]].map(project);
    if (corners.some(c => !c)) return;
    ctx.beginPath();
    corners.forEach((c, k) => k ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y));
    ctx.closePath();
    ctx.fillStyle = colors.plate;
    ctx.globalAlpha = i === 0 ? 0.55 : 0.32;
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = colors["plate-line"];
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Label on the left edge of the plate.
    // Wide plates are labelled just inside their front-left corner (the outside would clip);
    // the small upper plates are labelled outside, so the label never covers their nodes.
    const inside = i < 2;
    const a = project(inside ? [p.x0 + 0.3, p.y, p.z1 - 0.2] : [p.x0, p.y, p.z1]);
    if (a) {
      const x = inside ? a.x + 4 : a.x - 10, y = inside ? a.y + 16 : a.y + 4;
      ctx.textAlign = inside ? "left" : "right";
      ctx.fillStyle = colors.label;
      ctx.font = "600 12px 'IBM Plex Sans', sans-serif";
      ctx.fillText(p.label, x, y);
      ctx.fillStyle = colors["label-dim"];
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText(p.sub, x, y + 14);
    }
  }

  function drawBaseGrid() {
    const {X, slotZ, T} = layout;
    const base = layout.plates[0];
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = 1; t <= T; t++) {
      const a = project([X(t), base.y, layout.zMin - 0.7]), b = project([X(t), base.y, layout.zMax + 0.7]);
      if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    }
    for (const s of SLOTS) {
      const a = project([X(0.5), base.y, slotZ(s)]), b = project([X(T + 0.5), base.y, slotZ(s)]);
      if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    }
    ctx.stroke();
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.fillStyle = colors["label-dim"];
    ctx.textAlign = "center";
    for (let t = 1; t <= T; t++) {
      if (t !== 1 && t % 5 && t !== T) continue;
      const a = project([X(t), base.y, layout.zMax + 1.05]);
      if (a) ctx.fillText(`S${t}`, a.x, a.y + 10);
    }
    ctx.textAlign = "right";
    for (const s of SLOTS) {
      const a = project([X(0.2), base.y, slotZ(s)]);
      if (a) ctx.fillText(SLOT_LABEL[s], a.x - 4, a.y + 3);
    }
  }

  function line(a, b, color, alpha, width = 1, dash = null) {
    const pa = project(a), pb = project(b);
    if (!pa || !pb) return;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }

  function shape(n, p, r, color, alpha) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (n.type === "window" || n.type === "candidate") ctx.arc(p.x, p.y, r * 1.15, 0, Math.PI * 2);
    else if (n.type === "lane") ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
    else if (n.type === "evidence") { ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); }
    else if (n.type === "goal" || n.type === "root") {
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.5 : r * 1.25;
        k ? ctx.lineTo(p.x + rr * Math.cos(a), p.y + rr * Math.sin(a)) : ctx.moveTo(p.x + rr * Math.cos(a), p.y + rr * Math.sin(a));
      }
      ctx.closePath();
    } else return;
    ctx.stroke();
  }

  function draw(now) {
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    if (onFrame) {
      const next = onFrame(dt);
      if (next) { frame = next.frame || frame; if (next.camera && !manual) goal = next.camera; }
    }
    // Ease the camera toward its goal.
    const k = 1 - Math.exp(-dt * 1.8);
    if (!manual) {
      cam.yaw += (goal.yaw - cam.yaw) * k;
      cam.pitch += (goal.pitch - cam.pitch) * k;
      cam.dist += (goal.dist - cam.dist) * k;
      for (let i = 0; i < 3; i++) cam.target[i] += (goal.target[i] - cam.target[i]) * k;
    }
    B = basis();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.void;
    ctx.fillRect(0, 0, W, H);

    // Plates back to front.
    layout.plates.map((p, i) => ({p, i, z: project([(p.x0 + p.x1) / 2, p.y, (p.z0 + p.z1) / 2])?.z ?? 0}))
      .filter(({p, i}) => i === 0 || frame.plates?.has(p.id))
      .sort((a, b) => b.z - a.z).forEach(({p, i}) => { drawPlate(p, i); if (i === 0) drawBaseGrid(); });

    ctx.globalCompositeOperation = "lighter";
    const P = id => layout.pos.get(id);
    for (const e of frame.edges) if (P(e.a) && P(e.b)) line(P(e.a), P(e.b), e.color, e.alpha, e.width || 1, e.dash);
    for (const b of frame.beams) {
      const a = P(b.from), c = P(b.to);
      if (!a || !c) continue;
      const t = Math.min(1, b.t);
      line(a, [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t], b.color, b.alpha, b.width || 1);
    }
    // Selection: arg edges to entities and basis edges to earlier facts.
    if (selected?.type === "fact") {
      selected.args.forEach(a => P(`e:${a}`) && line(P(selected.id), P(`e:${a}`), colors.entity, 0.8, 1.2));
      selected.basis.forEach(fid => P(`f${fid}`) && line(P(selected.id), P(`f${fid}`), colors.label, 0.45, 1, [3, 3]));
    } else if (selected?.type === "entity") {
      selected.facts.forEach(fid => P(`f${fid}`) && line(P(selected.id), P(`f${fid}`), colors.entity, 0.35, 1));
    }

    projected = [];
    const T = layout.T;
    for (const n of nodes) {
      if (!frame.visible.has(n.id)) continue;
      if (n.type === "fact" && n.t > frame.build * T + 0.001) continue;
      const p = project(P(n.id));
      if (!p) continue;
      const lit = frame.lit.get(n.id) || 0, heat = frame.heat.get(n.id) || 0;
      const isSel = n === selected || n === hovered;
      const color = nodeColor(n, colors);
      const base = frame.dim && n.type === "fact" ? 0.22 : 0.5;
      const alpha = Math.min(1, base + heat * 0.45 + lit * 0.6 + (isSel ? 0.5 : 0));
      const r = Math.max(1.6, RADIUS[n.type] * p.s * (1 + lit * 0.9 + heat * 0.25 + (isSel ? 0.6 : 0)));
      const size = r * 5;
      ctx.globalAlpha = alpha;
      ctx.drawImage(spriteFor(color), p.x - size / 2, p.y - size / 2, size, size);
      if (RADIUS[n.type] >= 0.24) shape(n, p, r, color, Math.min(1, alpha + 0.2));
      projected.push({n, x: p.x, y: p.y, r: Math.max(6, r * 1.6), z: p.z});
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    for (const item of projected) {
      const {n} = item;
      if (!frame.labels.has(n.id) && n !== selected && n !== hovered) continue;
      const text = frame.labelText?.get(n.id) || n.label || n.id;
      if (n.type === "root") {
        ctx.font = "600 13px 'IBM Plex Sans', sans-serif";
        ctx.fillStyle = colors.root;
        ctx.textAlign = "center";
        ctx.fillText(text, item.x, item.y - item.r - 10);
        ctx.textAlign = "left";
        continue;
      }
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillStyle = colors.label;
      ctx.fillText(text, item.x + item.r + 4, item.y + 4);
    }
    raf = requestAnimationFrame(draw);
  }

  function pick(x, y) {
    let best = null, bd = Infinity;
    for (const item of projected) {
      const d = Math.hypot(item.x - x, item.y - y);
      if (d < item.r + 4 && d < bd) { best = item.n; bd = d; }
    }
    return best;
  }

  // Orbit with drag, zoom with the wheel; any of these takes the camera off the tour.
  let drag = null;
  const takeOver = () => { if (!manual) { manual = true; emit("manual", true); } };
  const onDown = e => { drag = {x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: false, pan: e.button === 2 || e.shiftKey, target: [...cam.target]}; canvas.setPointerCapture(e.pointerId); };
  const onMove = e => {
    const r = canvas.getBoundingClientRect();
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; takeOver(); }
      if (!drag.moved) return;
      if (drag.pan) {
        const s = cam.dist / B.focal;
        for (let i = 0; i < 3; i++) cam.target[i] = drag.target[i] - (B.r[i] * dx - B.u[i] * dy) * s;
      } else {
        cam.yaw = drag.yaw - dx * 0.006;
        cam.pitch = Math.max(-0.2, Math.min(1.45, drag.pitch + dy * 0.005));
      }
      return;
    }
    const n = pick(e.clientX - r.left, e.clientY - r.top);
    if (n !== hovered) { hovered = n; canvas.style.cursor = n ? "pointer" : "grab"; emit("hover", {node: n, x: e.clientX - r.left, y: e.clientY - r.top}); }
    else if (n) emit("hover", {node: n, x: e.clientX - r.left, y: e.clientY - r.top});
  };
  const onUp = e => {
    if (drag && !drag.moved) {
      const r = canvas.getBoundingClientRect();
      selected = pick(e.clientX - r.left, e.clientY - r.top);
      emit("select", selected);
    }
    drag = null;
  };
  const onWheel = e => { e.preventDefault(); takeOver(); cam.dist = Math.max(8, Math.min(90, cam.dist * Math.exp(e.deltaY * 0.001))); };
  const onLeave = () => { if (hovered) { hovered = null; emit("hover", {node: null}); } };
  const noMenu = e => e.preventDefault();
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, {passive: false});
  canvas.addEventListener("contextmenu", noMenu);
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  return {
    nodeById,
    start(fn) { onFrame = fn; raf = requestAnimationFrame(draw); },
    follow() { manual = false; emit("manual", false); },
    get manual() { return manual; },
    select(node) { selected = node; emit("select", node); },
    get selected() { return selected; },
    refreshColors() { colors = readColors(); sprites = new Map(); },
    colors: () => colors,
    on(k, fn) { listeners[k].push(fn); },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
