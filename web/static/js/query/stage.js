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
  let frame = {visible: new Set(["core"]), filled: new Set(["core"]), focus: new Set(), appear: new Map()};
  const view = {cluster: null, group: null, basis: null, fact: null};
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
    const center = layout.pos.get(c.id), R = layout.radius.get(c.id);
    if (view.cluster !== c.id) return add(center, scale(ballPoint(p.k), R));
    const gi = groupOf.get(c.id).get(p.fid), g = c.groups[gi];
    const k = g.fids.indexOf(p.fid);
    if (view.group === gi && k < MAX_FACTS) return factSlot(c, gi, k, g.fids.length);
    return add(groupCenter(c, gi), scale(ballPoint(k), cloudRadius(g.fids.length) * 0.7));
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
  function tag(x, y, r, title, detail, color, alpha = 1) {
    // Leader: a short diagonal from the bracket corner, then the text.
    const x0 = x + r, y0 = y - r, x1 = x0 + 10, y1 = y0 - 10;
    stroke(color, alpha * 0.8, 1);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1 + 6, y1); ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "left";
    ctx.fillStyle = color;
    ctx.font = "500 11px 'IBM Plex Mono', monospace";
    ctx.fillText(title, x1 + 10, y1 + 4);
    if (detail) {
      ctx.fillStyle = colors["label-dim"];
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillText(detail, x1 + 10, y1 + 17);
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
      goal = view.cluster ? expansionGoal() : tourGoal;
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

    // Frame: the central axis, a dashed ring per populated tier and its label.
    const shown = clusters.filter(c => frame.visible.has(c.id));
    const tierUsed = new Set(shown.map(c => c.tier));
    stroke(colors.line, 0.9 * fade, 1);
    line3([0, 0, 0], [0, layout.top, 0]);
    const side = norm([B.r[0], 0, B.r[2]]);
    for (const t of TIERS) {
      if (!tierUsed.has(t.tier)) continue;
      const members = shown.filter(c => c.tier === t.tier);
      const ringR = members.length > 1 || t.tier === 1 ? t.ring : 0;
      if (ringR) { stroke(colors.line, 0.9 * fade, 1, [2, 5]); ring3([0, t.y, 0], ringR); }
      const reach = ringR || (t.tier === 0 ? layout.radius.get("core") : 0.8);
      const p = project(add([0, t.y, 0], scale(side, -reach - 1.4)));
      if (!p) continue;
      ctx.setLineDash([]);
      ctx.globalAlpha = fade;
      ctx.textAlign = "right";
      ctx.fillStyle = colors["label-dim"];
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillText(`T${t.tier} · ${t.sub}`, p.x - 10, p.y + 16);
      ctx.fillStyle = colors.label;
      ctx.font = "500 11px 'IBM Plex Mono', monospace";
      ctx.fillText(t.label.toUpperCase(), p.x - 10, p.y + 3);
      stroke(colors["line-hi"], fade, 1);
      ctx.beginPath(); ctx.moveTo(p.x - 5, p.y); ctx.lineTo(p.x + 3, p.y); ctx.stroke();
    }

    // Links between clouds, in the phase colour of the cloud they lead to. The edges of the
    // focused, open or hovered cloud carry their short label.
    const edgeLabels = [];
    const hoverId = hover?.kind === "cluster" ? hover.cluster.id : null;
    for (const c of shown) for (const l of c.links) {
      if (!frame.visible.has(l.from)) continue;
      const hot = frame.focus.has(c.id) || (open && (open.id === c.id || (open.id === l.from && l.from !== "core")));
      const hovered = hoverId === c.id || (hoverId === l.from && l.from !== "core");
      const spoke = l.from === "core";
      const color = phaseColor(c);
      stroke(hot || hovered ? color : colors["line-hi"], hot || hovered ? 0.85 : (spoke ? 0.45 : 0.35 + 0.5 * l.weight) * fade, 1, spoke ? [1, 4] : null);
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
      const alpha = (open && !isOpen ? 0.07 : focus || isOpen ? 1 : c.kind === "core" ? 0.5 : 0.6) * appear;
      if (frame.filled.has(c.id)) {
        if (inst.get(c.id).length !== c.fids.length) inst.set(c.id, c.fids.map((fid, k) => ({fid, k, cur: null})));
        const gmap = groupOf.get(c.id);
        for (const p of inst.get(c.id)) {
          const t = targetOf(c, p);
          if (!p.cur) p.cur = c.kind === "core" ? t : [...layout.pos.get("core")];
          const m = 1 - Math.exp(-dt * 5);
          for (let i = 0; i < 3; i++) p.cur[i] += (t[i] - p.cur[i]) * m;
          const s = project(p.cur);
          if (!s) continue;
          const inGroup = isOpen && view.group === gmap.get(p.fid);
          const role = roleOf(p.fid);
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
      if (focus || hot) brackets(pc.x, pc.y, sr + 4, phaseColor(c), fade);
      if (c.kind !== "query" || focus || hot) {
        tag(pc.x, pc.y, sr + 4, clusterTitle(c), c.detail, focus || hot || c.kind === "root" ? phaseColor(c) : colors.label, fade * Math.min(1, alpha / 0.6));
      } else {
        ctx.globalAlpha = 0.9 * fade * alpha;
        ctx.fillStyle = colors["label-dim"];
        ctx.font = "10px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(callTag(c), pc.x, pc.y + sr + 12);
      }
    }
    for (const e of edgeLabels) edgeLabel(e);
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
      else if (t.kind === "cluster" || t.kind === "edge") open(t.cluster.id);
      else if (t.kind === "group") open(t.cluster.id, view.group === t.gi ? null : t.gi);
      else if (t.kind === "fact") { view.fact = t.fid; emit("select", {kind: "fact", cluster: t.cluster, gi: view.group, fid: t.fid}); }
    }
    drag = null;
  };
  function open(id, group = null) {
    view.fact = null;
    setView(id, group);
    const c = byId.get(id);
    emit("select", group == null ? {kind: "cluster", cluster: c} : {kind: "group", cluster: c, gi: group});
  }
  function back() {
    if (view.fact != null) { view.fact = null; emit("select", {kind: "group", cluster: byId.get(view.cluster), gi: view.group}); }
    else if (view.group != null) open(view.cluster);
    else if (view.cluster) { setView(null); emit("select", null); }
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
    follow() { view.fact = null; setView(null); emit("select", null); },
    open,
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
export const clusterTitle = c => c.kind === "query" ? `${callTag(c)} ${shortSpec(c.label)}` : c.label;
const shortSpec = s => { const t = String(s).replace(/\s+/g, " "); return t.length > 34 ? t.slice(0, 33) + "…" : t; };
const angleDelta = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
