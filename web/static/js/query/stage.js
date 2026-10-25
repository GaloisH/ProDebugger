// Zero-dependency 3D stage for the cluster tower: a perspective orbit camera over a 2D canvas.
// Flat square points, 1px lines and HUD brackets; the only motion is camera easing and points
// moving to their place when a cloud appears, expands or folds.
import {ballPoint, cloudRadius, TIERS} from "./layout.js";
import {factLabel, factRoles, ROLE_ORDER} from "./clusters.js";

const TOKENS = ["void", "ink", "ink-hi", "ink-dim", "line", "line-hi", "focus", "label", "label-dim", "issue", "cand"];
const PHASE_TOKENS = {PARSE: "parse", MAP: "map", ROUTE: "route", MANAGER: "manager", TRACE: "trace", SUBMIT: "submit"};
const readColors = () => {
  const css = getComputedStyle(document.documentElement);
  const read = name => css.getPropertyValue(name).trim() || "#888";
  return {
    ...Object.fromEntries(TOKENS.map(t => [t, read(`--qg-${t}`)])),
    phase: Object.fromEntries(Object.entries(PHASE_TOKENS).map(([k, t]) => [k, read(`--${t}`)])),
  };
};
const MAX_FACTS = 26;     // facts listed when a group opens; the inspector has the rest
const FACT_GAP = 0.5;     // world units between fact rows

export function createStage(canvas, scene, model, layout) {
  const ctx = canvas.getContext("2d");
  const colors = readColors();
  const {clusters, byId} = model;
  const cam = {target: [0, 7, 0], yaw: 0.5, pitch: 0.32, dist: 48, fov: 0.8};
  let goal = {...cam, target: [...cam.target]};
  let tourGoal = goal, manual = false;
  let frame = {visible: new Set(["core"]), filled: new Set(["core"]), focus: new Set(), appear: new Map(), chain: null, labelAll: false, filter: null};
  const view = {cluster: null, group: null, basis: null, fact: null, selected: null};
  let hover = null;
  let targets = [];
  let W = 0, H = 0, dpr = 1, raf = 0, last = 0, onFrame = null, B = null;
  const listeners = {hover: [], select: [], manual: [], view: []};
  const emit = (k, v) => listeners[k].forEach(fn => fn(v));

  // Point instances per cloud; a cloud's points start at the core and travel out to it.
  const inst = new Map(clusters.map(c => [c.id, c.fids.map((fid, k) => ({fid, k, cur: null}))]));
  // A fact's evidence role, counted only from clouds already on screen.
  const roles = factRoles(clusters);
  const roleColor = {issue: colors.issue, candidate: colors.cand, root: colors.focus};
  function roleOf(fid) {
    let best = -1;
    for (const r of roles.get(fid) || []) if (frame.visible.has(r.id)) best = Math.max(best, ROLE_ORDER.indexOf(r.role));
    return best < 0 ? null : ROLE_ORDER[best];
  }
  const phaseColor = c => colors.phase[c.phaseKey] || colors.label;
  const groupOf = new Map(clusters.map(c => [c.id, new Map(c.groups.flatMap((g, gi) => g.fids.map(fid => [fid, gi])))]));
  // The main chain the overview lights: record → query → window → lane → candidate → root.
  // Walk down from the root through its first link; at the window take the query that gave it
  // most of its clues.
  const backbone = new Set();
  for (let c = byId.get("root"); c; ) {
    backbone.add(c.id);
    const links = c.links.filter(l => byId.has(l.from));
    if (c.kind === "window") { const q = [...links].sort((a, b) => b.weight - a.weight)[0]; if (q) backbone.add(q.from); break; }
    c = links[0] && byId.get(links[0].from);
    if (c && (c.kind === "core" || c.kind === "query")) { backbone.add(c.id); break; }
  }
  if (backbone.size) backbone.add("core");
  // Depth fog: clouds behind the tower's middle fade, those in front stay full.
  const fog = z => 1 - 0.55 * Math.max(0, Math.min(1, (z - cam.dist + 9) / 18));
  // Entity hubs travel like points; opened, a hub sits on its entity group (or the "+more" one).
  const hubInst = new Map(clusters.map(c => [c.id, c.structure.hubs.map(() => ({cur: null}))]));
  const hubGroup = new Map(clusters.map(c => {
    const other = c.groups.findIndex(g => g.other);
    return [c.id, c.structure.hubs.map(h => { const gi = c.groups.findIndex(g => g.key === h.key); return gi >= 0 ? gi : other; })];
  }));

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  function basis() {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const eye = [cam.target[0] + cam.dist * cp * Math.sin(cam.yaw), cam.target[1] + cam.dist * sp, cam.target[2] + cam.dist * cp * Math.cos(cam.yaw)];
    const f = norm(sub(cam.target, eye)), r = norm(cross(f, [0, 1, 0]));
    return {eye, f, r, u: cross(r, f), focal: H / (2 * Math.tan(cam.fov / 2))};
  }
  function project(p) {
    const d = sub(p, B.eye), z = dot(d, B.f);
    if (z < 0.5) return null;
    return {x: W / 2 + B.focal * dot(d, B.r) / z, y: H / 2 - B.focal * dot(d, B.u) / z, z, s: B.focal / z};
  }

  // Expanded layout: entity groups on a ring in the camera plane around the cloud, the open
  // group's facts as a column beside it.
  const groupRing = c => layout.radius.get(c.id) + 1.3 + 0.07 * c.groups.length;
  function groupCenter(c, gi) {
    const center = layout.pos.get(c.id), R = groupRing(c), a = Math.PI / 2 - gi / c.groups.length * Math.PI * 2;
    const {r, u} = view.basis;
    return add(center, add(scale(r, R * Math.cos(a)), scale(u, R * Math.sin(a))));
  }
  function factSlot(c, gi, k, n) {
    const gc = groupCenter(c, gi), {r, u} = view.basis;
    const top = (Math.min(n, MAX_FACTS) - 1) / 2 * FACT_GAP;
    return add(gc, add(scale(r, cloudRadius(n) * 0.7 + 0.8), scale(u, top - k * FACT_GAP)));
  }
  function targetOf(c, p) {
    const center = layout.pos.get(c.id), R = layout.radius.get(c.id), shape = layout.shape.get(c.id);
    if (view.cluster !== c.id) return add(center, scale(shape ? shape.fact.get(p.fid) : ballPoint(p.k), R));
    const gi = groupOf.get(c.id).get(p.fid), g = c.groups[gi];
    const k = g.fids.indexOf(p.fid);
    if (view.group === gi && k < MAX_FACTS) return factSlot(c, gi, k, g.fids.length);
    return add(groupCenter(c, gi), scale(ballPoint(k), cloudRadius(g.fids.length) * 0.7));
  }
  function hubTarget(c, j) {
    const gi = hubGroup.get(c.id)[j];
    if (view.cluster === c.id && gi >= 0) return groupCenter(c, gi);
    return add(layout.pos.get(c.id), scale(layout.shape.get(c.id).hub[j], layout.radius.get(c.id)));
  }

  // The DSL inside a cloud: hairline spokes from each fact to the entities it names, threads in
  // the phase colour along each state's timeline, and the hubs as small rings. With a group
  // open, ties to its facts stay lit and the rest drop back.
  function drawStructure(c, alpha, isOpen, m) {
    const st = c.structure, hubs = hubInst.get(c.id);
    if (!layout.shape.get(c.id)) return;
    st.hubs.forEach((h, j) => {
      const t = hubTarget(c, j), q = hubs[j];
      if (!q.cur) q.cur = c.kind === "core" ? t : [...layout.pos.get("core")];
      for (let i = 0; i < 3; i++) q.cur[i] += (t[i] - q.cur[i]) * m;
    });
    const cur = new Map(inst.get(c.id).map(p => [p.fid, p.cur]));
    const lit = isOpen && view.group != null ? new Set(c.groups[view.group].fids) : null;
    const path = (pairs, color, a) => {
      if (!pairs.length || a < 0.01) return;
      stroke(color, a, 1);
      ctx.beginPath();
      for (const [p, q] of pairs) {
        const pa = project(p), pb = project(q);
        if (pa && pb) { ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); }
      }
      ctx.stroke();
    };
    const split = (list, touches) => lit ? [list.filter(e => !touches(e)), list.filter(touches)] : [list, []];
    const [spokeDim, spokeLit] = split(st.spokes, ([fid]) => lit.has(fid));
    const [threadDim, threadLit] = split(st.threads, ([a, b]) => lit.has(a) || lit.has(b));
    const spokeSeg = ([fid, j]) => [cur.get(fid), hubs[j].cur];
    const threadSeg = ([a, b]) => [cur.get(a), cur.get(b)];
    const base = lit ? 0.3 : 1;
    path(spokeDim.map(spokeSeg), colors["line-hi"], alpha * (isOpen ? 0.3 : 0.22) * base);
    path(threadDim.map(threadSeg), phaseColor(c), alpha * (isOpen ? 0.6 : 0.5) * base);
    path(spokeLit.map(spokeSeg), colors["line-hi"], alpha * 0.7);
    path(threadLit.map(threadSeg), phaseColor(c), alpha * 0.95);
    ctx.setLineDash([]);
    // Rings only for the entities the inspector lists; the rest still anchor their spokes.
    const other = c.groups.findIndex(g => g.other);
    hubs.forEach((q, j) => {
      const s = hubGroup.get(c.id)[j] !== other && project(q.cur);
      if (!s) return;
      const agent = st.hubs[j].key.startsWith("agent:");
      stroke(colors.label, alpha * (agent ? 0.9 : 0.7), 1);
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(2, Math.min(agent ? 5 : 3.5, s.s * (agent ? 0.14 : 0.09))), 0, Math.PI * 2); ctx.stroke();
    });
  }
  // A selected, folded cloud names its biggest hubs.
  function hubLabels(c, alpha) {
    const hubs = hubInst.get(c.id);
    ctx.textAlign = "left";
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.fillStyle = colors["label-dim"];
    ctx.globalAlpha = alpha;
    c.structure.hubs.slice(0, 4).forEach((h, j) => {
      const s = hubs[j].cur && project(hubs[j].cur);
      if (s) ctx.fillText(h.key, s.x + 6, s.y - 4);
    });
  }

  function expansionGoal() {
    const c = byId.get(view.cluster);
    if (view.group != null) {
      const g = c.groups[view.group];
      const t = add(groupCenter(c, view.group), scale(view.basis.r, 2.6));
      return {target: t, yaw: cam.yaw, pitch: cam.pitch, dist: Math.max(10, Math.min(g.fids.length, MAX_FACTS) * FACT_GAP * 1.9 + 4)};
    }
    return {target: layout.pos.get(c.id), yaw: cam.yaw, pitch: cam.pitch, dist: Math.max(12, groupRing(c) * 4.2)};
  }

  // A preset marked fit frames the whole cone in the canvas area left free by the phase ruler
  // and the inspector: the distance fits both its height and its width, and the target slides
  // sideways so the tower centres in that area.
  function fitGoal(g) {
    const tan = Math.tan(cam.fov / 2), cp = Math.cos(g.pitch), sp = Math.abs(Math.sin(g.pitch));
    const R = TIERS[0].plate, h = layout.top + 2.5 - layout.bottom;
    const box = canvas.getBoundingClientRect();
    const page = canvas.closest(".qg");
    const rect = sel => { const r = page?.querySelector(sel)?.getBoundingClientRect(); return r && r.width ? r : null; };
    const panel = rect(".qg-inspect:not([hidden])"), head = rect(".qg > header"), foot = rect(".qg-foot");
    const left = 130, right = panel ? Math.max(0, box.right - panel.left + 12) : 0;
    const top = head ? Math.max(0, head.bottom - box.top) : 0, bottom = foot ? Math.max(0, box.bottom - foot.top + 8) : 0;
    const freeW = Math.max(240, W - left - right), freeH = Math.max(240, H - top - bottom);
    const dist = 1.08 * Math.max((h * cp + 2 * R * sp) / (2 * tan * freeH / H), 2 * R / (2 * tan * freeW / H));
    const px = dist / (H / (2 * tan));          // world units per screen pixel at the target
    const dx = (right - left) / 2 * px, dy = (bottom - top) / 2 * px;
    const mid = (layout.top + layout.bottom) / 2 + 0.6;
    // Slide right along the camera's right vector, and down along its up vector.
    const r = [Math.cos(g.yaw), 0, -Math.sin(g.yaw)];
    const u = [-Math.sin(g.yaw) * Math.sin(g.pitch), Math.cos(g.pitch), -Math.cos(g.yaw) * Math.sin(g.pitch)];
    return {...g, dist, target: [r[0] * dx - u[0] * dy, mid - u[1] * dy, r[2] * dx - u[2] * dy]};
  }

  function setView(cluster, group = null) {
    if (cluster && cluster !== view.cluster) view.basis = {r: [...B.r], u: [...B.u]};
    view.cluster = cluster; view.group = group;
    manual = false; emit("manual", false);
    emit("view", {cluster: cluster ? byId.get(cluster) : null, group});
  }

  // ---- drawing helpers
  const stroke = (color, alpha = 1, width = 1, dash = null) => {
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.setLineDash(dash || []);
  };
  function line3(a, b) {
    const pa = project(a), pb = project(b);
    if (!pa || !pb) return;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  function ring3(center, R, seg = 120) {
    ctx.beginPath();
    let open = false;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, p = project([center[0] + R * Math.cos(a), center[1], center[2] + R * Math.sin(a)]);
      if (!p) { open = false; continue; }
      open ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      open = true;
    }
    ctx.stroke();
  }
  // The ROUTE floor's guide: one turn of a helix through the query clouds, rising with call order.
  function helix3(t, n) {
    if (n < 2) return;
    ctx.beginPath();
    let open = false;
    for (let i = 0; i <= 120; i++) {
      const f = i / 120 * (n - 1) / n, a = Math.PI / 2 - f * Math.PI * 2;
      const p = project([t.ring * Math.cos(a), t.y + t.rise * f * n / (n - 1), t.ring * Math.sin(a)]);
      if (!p) { open = false; continue; }
      open ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      open = true;
    }
    ctx.stroke();
  }
  // A tier's floor: a faint disc with a hairline rim in the phase colour.
  function plate(center, R, color, alpha) {
    ctx.setLineDash([]);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 96; i++) {
      const a = i / 96 * Math.PI * 2, p = project([center[0] + R * Math.cos(a), center[1], center[2] + R * Math.sin(a)]);
      if (!p) continue;
      started ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      started = true;
    }
    ctx.closePath();
    ctx.globalAlpha = 0.05 * alpha;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 0.4 * alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Phase ruler: a fixed HUD scale on the left whose ticks sit at each tier's projected height,
  // one segment per phase, the current tier lit.
  function ruler(shown, current) {
    const x = 18, top = 96, bottom = H - 150;
    const tiers = TIERS.filter(t => shown.some(c => c.tier === t.tier))
      .map(t => ({t, y: project([0, t.y, 0])?.y})).filter(r => r.y != null)
      .map(r => ({...r, y: Math.max(top, Math.min(bottom, r.y))}));
    if (!tiers.length) return;
    // Clamped ticks keep at least a label's height between them, pushing upward.
    for (let k = 1; k < tiers.length; k++) tiers[k].y = Math.min(tiers[k].y, tiers[k - 1].y - 28);
    stroke(colors.line, 1, 1);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    tiers.forEach((r, k) => {
      const color = colors.phase[r.t.phase];
      const next = tiers[k + 1];
      const on = current === r.t.tier;
      if (next) {
        stroke(color, on ? 1 : 0.55, on ? 3 : 2);
        ctx.beginPath(); ctx.moveTo(x, r.y); ctx.lineTo(x, next.y + 3); ctx.stroke();
      }
      stroke(color, 1, 1);
      ctx.beginPath(); ctx.moveTo(x - 5, r.y); ctx.lineTo(x + 6, r.y); ctx.stroke();
      const n = shown.filter(c => c.tier === r.t.tier).length;
      ctx.textAlign = "left";
      ctx.globalAlpha = on ? 1 : 0.75;
      ctx.fillStyle = color;
      ctx.font = `${on ? 600 : 500} 10px 'IBM Plex Mono', monospace`;
      ctx.fillText(`${on ? "▸ " : ""}T${r.t.tier} ${r.t.phase}`, x + 10, r.y - 2);
      ctx.fillStyle = colors["label-dim"];
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillText(`${r.t.label.toLowerCase()}${n > 1 ? ` · ${n}` : ""}`, x + 10, r.y + 10);
    });
    ctx.globalAlpha = 1;
  }

  function brackets(x, y, r, color, alpha = 1) {
    const L = Math.max(5, Math.min(10, r * 0.4));
    stroke(color, alpha, 1);
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const cx = x + sx * r, cy = y + sy * r;
      ctx.moveTo(cx, cy - sy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx - sx * L, cy);
    }
    ctx.stroke();
  }
  // A cloud's name, led out away from the tower's axis so names on the two sides never cross it;
  // a fixed side (+1 right, -1 left) overrides that.
  function tag(x, y, r, title, detail, color, alpha = 1, side = 0) {
    const axis = project([0, cam.target[1], 0]);
    const s = side || (axis && x < axis.x - 4 ? -1 : 1);
    // Leader: a short diagonal from the bracket corner, then the text.
    const x0 = x + s * r, y0 = y - r, x1 = x0 + s * 10, y1 = y0 - 10;
    stroke(color, alpha * 0.8, 1);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1 + s * 6, y1); ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.textAlign = s > 0 ? "left" : "right";
    ctx.fillStyle = color;
    ctx.font = "500 11px 'IBM Plex Mono', monospace";
    ctx.fillText(title, x1 + s * 10, y1 + 4);
    if (detail) {
      ctx.fillStyle = colors["label-dim"];
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillText(detail, x1 + s * 10, y1 + 17);
    }
  }
  // A two-line label on an edge (what was asked / what came back), on a void plate so it reads
  // over points. It sits 40% of the way from the source, so edges converging on one cloud keep
  // their labels apart, and it is a hover target for the full card.
  function edgeLabel({a, b, link, cluster, color, hot}) {
    const pa = project(a), pb = project(b);
    if (!pa || !pb) return;
    const x = pa.x + (pb.x - pa.x) * 0.4, y = pa.y + (pb.y - pa.y) * 0.4;
    ctx.font = "500 10px 'IBM Plex Mono', monospace";
    const w1 = ctx.measureText(link.title).width;
    ctx.font = "10px 'IBM Plex Mono', monospace";
    const w2 = link.detail ? ctx.measureText(link.detail).width : 0;
    const w = Math.max(w1, w2) + 14, h = link.detail ? 30 : 17;
    const x0 = Math.round(x - w / 2), y0 = Math.round(y - h / 2);
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = colors.void;
    ctx.fillRect(x0, y0, w, h);
    stroke(color, hot ? 1 : 0.65, 1);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, 2, h);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.fillStyle = color;
    ctx.font = "500 10px 'IBM Plex Mono', monospace";
    ctx.fillText(link.title, x0 + 8, y0 + 12);
    if (link.detail) {
      ctx.fillStyle = colors.label;
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillText(link.detail, x0 + 8, y0 + 25);
    }
    targets.push({kind: "edge", link, cluster, x, y, rect: [x0, y0, w, h]});
  }
  function diamond(x, y, r, fill) {
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    fill ? ctx.fill() : ctx.stroke();
  }

  function draw(now) {
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    if (onFrame) {
      const next = onFrame(dt);
      if (next) { frame = next.frame; tourGoal = next.camera; }
    }
    B = basis();
    if (!manual) {
      goal = view.cluster ? expansionGoal() : tourGoal.fit ? fitGoal(tourGoal) : tourGoal;
      const k = 1 - Math.exp(-dt * 2.4);
      if (goal.yaw != null) cam.yaw += angleDelta(cam.yaw, goal.yaw) * k;
      if (goal.pitch != null) cam.pitch += (goal.pitch - cam.pitch) * k;
      cam.dist += (goal.dist - cam.dist) * k;
      for (let i = 0; i < 3; i++) cam.target[i] += (goal.target[i] - cam.target[i]) * k;
      B = basis();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.void;
    ctx.fillRect(0, 0, W, H);
    targets = [];
    const open = view.cluster ? byId.get(view.cluster) : null;
    const fade = open ? 0.12 : 1;

    // Frame: the central axis, then one plate per populated tier in its phase colour, so each
    // phase stands on its own floor. Legend filters can hide phases.
    const hiddenPhase = frame.filter?.phases;
    const shown = clusters.filter(c => frame.visible.has(c.id) && !hiddenPhase?.has(c.phaseKey));
    const tierUsed = new Set(shown.map(c => c.tier));
    const floors = TIERS.filter(t => tierUsed.has(t.tier));
    // The axis in segments, each floor's phase colour up to the next floor.
    floors.forEach((t, k) => {
      const next = floors[k + 1];
      stroke(colors.phase[t.phase], 0.55 * fade, 1);
      line3([0, t.y, 0], [0, next ? next.y : t.y + 1.2, 0]);
    });
    // The cone's outline: the two silhouette edges between neighbouring plates, taken along the
    // camera's horizontal right vector so they hug the rims from any angle.
    const side = norm([B.r[0], 0, B.r[2]]);
    stroke(colors["line-hi"], 0.45 * fade, 1, [3, 5]);
    for (let k = 1; k < floors.length; k++) {
      const a = floors[k - 1], b = floors[k];
      for (const s of [-1, 1]) line3([s * side[0] * a.plate, a.y, s * side[2] * a.plate], [s * side[0] * b.plate, b.y, s * side[2] * b.plate]);
    }
    for (const t of floors) {
      const members = shown.filter(c => c.tier === t.tier);
      plate([0, t.y, 0], t.plate, colors.phase[t.phase], fade);
      if (t.rise) { stroke(colors.line, 0.9 * fade, 1, [2, 5]); helix3(t, members.length); }
      else if (members.length > 1) { stroke(colors.line, 0.9 * fade, 1, [2, 5]); ring3([0, t.y, 0], t.ring); }
    }

    // Links between clouds, in the phase colour of the cloud they lead to. The edges of the
    // focused, open or hovered cloud carry their short label.
    const edgeLabels = [];
    const hoverId = hover?.kind === "cluster" ? hover.cluster.id : null;
    for (const c of shown) for (const l of c.links) {
      if (!frame.visible.has(l.from)) continue;
      if (hiddenPhase?.has(byId.get(l.from)?.phaseKey)) continue;
      const inChain = frame.chain && frame.chain.has(c.id) && frame.chain.has(l.from);
      const hot = inChain || (!frame.chain && frame.focus.has(c.id)) || (open && (open.id === c.id || (open.id === l.from && l.from !== "core")));
      const hovered = hoverId === c.id || (hoverId === l.from && l.from !== "core");
      const spoke = l.from === "core";
      const color = phaseColor(c);
      const quiet = frame.chain && !inChain ? 0.25 : 1;
      const main = frame.labelAll && !frame.chain && !open && backbone.has(c.id) && backbone.has(l.from);
      if (main) stroke(color, 0.9, 1.6);
      else stroke(hot || hovered ? color : colors["line-hi"], hot || hovered ? 0.85 : (spoke ? 0.45 : 0.35 + 0.5 * l.weight) * fade * quiet * (frame.labelAll && !frame.chain ? 0.7 : 1), 1, spoke ? [1, 4] : null);
      line3(layout.pos.get(l.from), layout.pos.get(c.id));
      const edgeHot = hover?.kind === "edge" && hover.link === l;
      if ((hot || hovered || edgeHot) && l.title) edgeLabels.push({a: layout.pos.get(l.from), b: layout.pos.get(c.id), link: l, cluster: c, color, hot: edgeHot});
    }

    // Points.
    ctx.setLineDash([]);
    const labelled = [];
    for (const c of shown) {
      const appear = frame.appear.get(c.id) ?? 1;
      const center = layout.pos.get(c.id), pc = project(center);
      const R = layout.radius.get(c.id);
      const focus = frame.focus.has(c.id);
      const isOpen = open?.id === c.id;
      const outside = frame.chain && !frame.chain.has(c.id);
      const lead = frame.labelAll && !frame.chain && backbone.has(c.id) && c.kind !== "core";
      const alpha = (open && !isOpen ? 0.07 : outside ? 0.13 : focus || isOpen || frame.chain || lead ? 1 : c.kind === "core" ? 0.5 : 0.6)
        * appear * (pc && !isOpen ? fog(pc.z) : 1);
      if (frame.filled.has(c.id)) {
        if (inst.get(c.id).length !== c.fids.length) inst.set(c.id, c.fids.map((fid, k) => ({fid, k, cur: null})));
        const gmap = groupOf.get(c.id);
        const m = 1 - Math.exp(-dt * 5);
        for (const p of inst.get(c.id)) {
          const t = targetOf(c, p);
          if (!p.cur) p.cur = c.kind === "core" ? t : [...layout.pos.get("core")];
          for (let i = 0; i < 3; i++) p.cur[i] += (t[i] - p.cur[i]) * m;
        }
        if (!(frame.filter?.role && !isOpen)) drawStructure(c, alpha, isOpen, m);
        for (const p of inst.get(c.id)) {
          const s = project(p.cur);
          if (!s) continue;
          const inGroup = isOpen && view.group === gmap.get(p.fid);
          const role = roleOf(p.fid);
          if (frame.filter?.role && role !== frame.filter.role && !isOpen) continue;
          const size = Math.max(role ? 3 : 1.3, Math.min(inGroup || role ? 4 : 2.6, s.s * (role ? 0.12 : 0.085)));
          ctx.globalAlpha = isOpen && view.group != null && !inGroup ? alpha * 0.35 : alpha;
          if (role && !(open && !isOpen)) ctx.globalAlpha = Math.max(ctx.globalAlpha, 0.95 * appear);
          ctx.fillStyle = role ? roleColor[role] : focus || isOpen ? colors["ink-hi"] : c.kind === "core" ? colors["ink-dim"] : colors.ink;
          ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size);
          if (inGroup && c.groups[view.group].fids.indexOf(p.fid) < MAX_FACTS) {
            targets.push({kind: "fact", cluster: c, fid: p.fid, x: s.x, y: s.y, r: 7});
            ctx.globalAlpha = 1;
            ctx.fillStyle = view.fact === p.fid || hover?.fid === p.fid ? colors["ink-hi"] : colors.label;
            ctx.font = "11px 'IBM Plex Mono', monospace";
            ctx.textAlign = "left";
            ctx.fillText(factLabel(scene.factById.get(p.fid)), s.x + 9, s.y + 4);
          }
        }
      } else if (pc) {
        // A lane before its SQL result: an empty dashed slot.
        stroke(colors["line-hi"], alpha, 1, [2, 3]);
        ctx.beginPath(); ctx.arc(pc.x, pc.y, Math.max(6, 0.6 * pc.s), 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (!pc) continue;
      const sr = Math.max(7, R * pc.s * 1.08);
      if (c.kind === "candidate" || c.kind === "root") {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = colors.focus;
        ctx.strokeStyle = c.kind === "root" ? colors.focus : colors.cand;
        ctx.lineWidth = 1.2;
        diamond(pc.x, pc.y, c.kind === "root" ? 9 : 7, c.kind === "root");
      }
      if (c.error) {
        stroke(colors["ink-dim"], alpha, 1);
        ctx.beginPath(); ctx.moveTo(pc.x - 4, pc.y - 4); ctx.lineTo(pc.x + 4, pc.y + 4); ctx.moveTo(pc.x + 4, pc.y - 4); ctx.lineTo(pc.x - 4, pc.y + 4); ctx.stroke();
      }
      if (!isOpen) targets.push({kind: "cluster", cluster: c, x: pc.x, y: pc.y, r: sr + 3});
      labelled.push({c, pc, sr, focus, alpha, isOpen});
    }

    // Groups of the open cloud: a bracket and a name each.
    if (open && frame.filled.has(open.id)) {
      open.groups.forEach((g, gi) => {
        const p = project(groupCenter(open, gi));
        if (!p) return;
        const r = Math.max(6, cloudRadius(g.fids.length) * 0.7 * p.s + 3);
        const on = view.group === gi, hot = hover?.kind === "group" && hover.gi === gi;
        brackets(p.x, p.y, r, on || hot ? phaseColor(open) : colors["line-hi"], 1);
        if (!on) {
          ctx.globalAlpha = view.group != null ? 0.5 : 1;
          ctx.textAlign = "left";
          ctx.fillStyle = hot ? phaseColor(open) : colors.label;
          ctx.font = "11px 'IBM Plex Mono', monospace";
          ctx.fillText(g.key, p.x + r + 5, p.y - 1);
          ctx.fillStyle = colors["label-dim"];
          ctx.font = "10px 'IBM Plex Mono', monospace";
          ctx.fillText(`${g.fids.length} fact${g.fids.length === 1 ? "" : "s"}`, p.x + r + 5, p.y + 11);
        } else if (g.fids.length > MAX_FACTS) {
          const q = project(factSlot(open, gi, MAX_FACTS, g.fids.length));
          if (q) { ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.fillStyle = colors["label-dim"]; ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.fillText(`+${g.fids.length - MAX_FACTS} more in the inspector`, q.x + 9, q.y + 4); }
        }
        targets.push({kind: "group", cluster: open, gi, x: p.x, y: p.y, r: r + 4});
      });
    }

    // HUD: brackets and tags for the clouds that matter right now.
    for (const {c, pc, sr, focus, alpha, isOpen} of labelled) {
      const hot = hover?.kind === "cluster" && hover.cluster === c;
      if (isOpen) {
        const r = layout.radius.get(c.id) * pc.s + 6;
        brackets(pc.x, pc.y, r, phaseColor(c));
        tag(pc.x, pc.y, r, clusterTitle(c), c.detail, phaseColor(c));
        continue;
      }
      const selected = view.selected === c.id;
      if ((selected || hot) && frame.filled.has(c.id) && layout.shape.get(c.id)) hubLabels(c, fade);
      const outside = frame.chain && !frame.chain.has(c.id);
      if (focus || hot || selected) brackets(pc.x, pc.y, sr + 4, phaseColor(c), fade);
      if (outside && !hot) continue;
      const lead = frame.labelAll && !frame.chain && backbone.has(c.id);
      const named = c.kind !== "query" || focus || hot || selected || lead || (frame.chain && frame.chain.has(c.id));
      if (named) {
        // In the overview the main chain reads down the right; its tier-mates take the left.
        const side = !frame.labelAll || frame.chain ? 0 : lead ? 1 : c.kind !== "query" ? -1 : 0;
        tag(pc.x, pc.y, sr + 4, clusterTitle(c), c.detail, focus || hot || lead || c.kind === "root" ? phaseColor(c) : colors.label, fade * Math.min(1, alpha / 0.6), side);
      } else {
        // Unnamed queries keep only their call tag under the cloud; hover names them.
        ctx.globalAlpha = 0.9 * fade * alpha;
        ctx.fillStyle = colors["label-dim"];
        ctx.font = "10px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(callTag(c), pc.x, pc.y + sr + 12);
      }
    }
    for (const e of edgeLabels) edgeLabel(e);
    const current = (view.selected && byId.get(view.selected)?.tier) ?? (frame.focus.size ? byId.get([...frame.focus][0])?.tier : null);
    ruler(shown, current);
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  }

  function pick(x, y) {
    let best = null, bd = Infinity;
    for (const t of targets) {
      const d = Math.hypot(t.x - x, t.y - y);
      // A fact's label sits to the right of its point and is clickable too; edge labels are boxes.
      const hit = t.kind === "edge" ? x >= t.rect[0] && x <= t.rect[0] + t.rect[2] && y >= t.rect[1] && y <= t.rect[1] + t.rect[3]
        : t.kind === "fact" ? d < t.r || (x > t.x && x < t.x + 380 && Math.abs(y - t.y) < 7) : d < t.r;
      const score = t.kind === "edge" ? -2000 : t.kind === "fact" ? Math.abs(y - t.y) - 1000 : t.kind === "group" ? d - 500 : d;
      if (hit && score < bd) { best = t; bd = score; }
    }
    return best;
  }

  // ---- input
  let drag = null;
  const takeOver = () => { if (!manual) { manual = true; emit("manual", true); } };
  const onDown = e => { drag = {x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, target: [...cam.target], pan: e.button === 2 || e.shiftKey, moved: false}; canvas.setPointerCapture(e.pointerId); };
  const onMove = e => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; takeOver(); }
      if (!drag.moved) return;
      if (drag.pan) { const s = cam.dist / B.focal; for (let i = 0; i < 3; i++) cam.target[i] = drag.target[i] - (B.r[i] * dx - B.u[i] * dy) * s; }
      else { cam.yaw = drag.yaw - dx * 0.006; cam.pitch = Math.max(-0.3, Math.min(1.45, drag.pitch + dy * 0.005)); }
      return;
    }
    hover = pick(x, y);
    canvas.style.cursor = hover ? "pointer" : "grab";
    emit("hover", hover ? {...hover, x, y} : null);
  };
  const onUp = e => {
    if (drag && !drag.moved) {
      const r = canvas.getBoundingClientRect();
      const t = pick(e.clientX - r.left, e.clientY - r.top);
      if (!t) back();
      else if (t.kind === "cluster" || t.kind === "edge") view.selected === t.cluster.id ? open(t.cluster.id) : select(t.cluster.id);
      else if (t.kind === "group") open(t.cluster.id, view.group === t.gi ? null : t.gi);
      else if (t.kind === "fact") { view.fact = t.fid; emit("select", {kind: "fact", cluster: t.cluster, gi: view.group, fid: t.fid}); }
    }
    drag = null;
  };
  // First click selects a cloud (the page lights its causal chain); a second click opens it.
  function select(id) {
    view.selected = id;
    if (view.cluster && view.cluster !== id) setView(null);
    emit("select", id ? {kind: "cluster", cluster: byId.get(id), opened: false} : null);
  }
  function open(id, group = null) {
    view.selected = id;
    view.fact = null;
    setView(id, group);
    const c = byId.get(id);
    emit("select", group == null ? {kind: "cluster", cluster: c, opened: true} : {kind: "group", cluster: c, gi: group});
  }
  function back() {
    if (view.fact != null) { view.fact = null; emit("select", {kind: "group", cluster: byId.get(view.cluster), gi: view.group}); }
    else if (view.group != null) open(view.cluster);
    else if (view.cluster) { setView(null); emit("select", {kind: "cluster", cluster: byId.get(view.selected), opened: false}); }
    else if (view.selected) { view.selected = null; emit("select", null); }
  }
  const onWheel = e => { e.preventDefault(); takeOver(); cam.dist = Math.max(5, Math.min(110, cam.dist * Math.exp(e.deltaY * 0.001))); };
  const onLeave = () => { hover = null; emit("hover", null); };
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
  B = basis();

  return {
    start(fn) { onFrame = fn; raf = requestAnimationFrame(draw); },
    // Fold everything and hand the camera back to the tour.
    follow() { view.fact = null; view.selected = null; setView(null); emit("select", null); },
    // Hand the camera back to whoever drives it (tour or overview presets) without folding.
    release() { manual = false; emit("manual", false); },
    open,
    select,
    back,
    selectFact(fid) { view.fact = fid; },
    get view() { return view; },
    get manual() { return manual; },
    colors: () => colors,
    on(k, fn) { listeners[k].push(fn); },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
  };
}

export const callTag = c => `${c.phase === "MAP" ? "M" : "Q"}${String(c.event).padStart(2, "0")}`;
export const clusterTitle = c => c.kind === "query" ? `${callTag(c)} ${shortSpec(c.error ? c.label : c.intent || c.label)}` : c.label;
const shortSpec = s => { const t = String(s).replace(/\s+/g, " "); return t.length > 34 ? t.slice(0, 33) + "…" : t; };
const angleDelta = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
