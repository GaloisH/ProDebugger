// Entity–relation graph: binary relation facts as edges between entities, shown as
// the state "as of step t". Layout is computed once over every step so the time
// slider only changes what is visible, never where things are.
import {entityId} from "../case/model.js?v=b33d828e89";
import {factChip, factText} from "../case/format.js?v=b33d828e89";
import {esc, short} from "../util.js?v=b33d828e89";
import {entityChip, wireInspector} from "./inspect.js?v=b33d828e89";

export const kindColor = kind => {
  let h = 0;
  for (const c of String(kind)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 42% 58%)`;
};

// Deterministic force layout (seeded by kind clusters on a circle).
function forceLayout(ids, links, kindOf) {
  const kinds = [...new Set(ids.map(kindOf))];
  const R = 140 + ids.length * 9;
  const pos = new Map(ids.map((id, i) => {
    const k = kinds.indexOf(kindOf(id)), a = (k / kinds.length) * Math.PI * 2, j = (i * 2.399) % (Math.PI * 2);
    return [id, {x: Math.cos(a) * R * .6 + Math.cos(j) * 40, y: Math.sin(a) * R * .6 + Math.sin(j) * 40, vx: 0, vy: 0}];
  }));
  const nodes = [...pos.values()];
  const L = links.map(([a, b]) => [pos.get(a), pos.get(b)]).filter(([a, b]) => a && b && a !== b);
  // The forces treat nodes as points, so pills could overlap: separate overlapping pairs
  // along their shallower axis, sized like the pills build() draws, while the layout
  // settles (so links can relax around them) and once more at the end.
  const box = ids.map(id => {
    const index = id.split(":").slice(1).join(":") || id;
    const label = /^\d+$/.test(index) ? `${kindOf(id)} ${index}` : index;
    return {n: pos.get(id), w: Math.max(70, Math.min(170, Math.min(22, label.length) * 7.4 + 26)) + 40, h: 70};
  });
  const separate = () => {
    let moved = false;
    for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) {
      const a = box[i], b = box[j], dx = b.n.x - a.n.x, dy = b.n.y - a.n.y;
      const ox = (a.w + b.w) / 2 - Math.abs(dx), oy = (a.h + b.h) / 2 - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      if (ox < oy) { const s = (dx < 0 ? -1 : 1) * ox / 2; a.n.x -= s; b.n.x += s; }
      else { const s = (dy < 0 ? -1 : 1) * oy / 2; a.n.y -= s; b.n.y += s; }
    }
    return moved;
  };
  const iterations = ids.length > 150 ? 220 : 320;
  for (let it = 0; it < iterations; it++) {
    const alpha = 1 - it / iterations;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || .01;
      const f = 5200 / d2;
      const d = Math.sqrt(d2);
      dx /= d; dy /= d;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const [a, b] of L) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || .01;
      const f = (d - 150) * .025;
      a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
    }
    for (const n of nodes) {
      n.vx -= n.x * .004; n.vy -= n.y * .004; // gravity
      n.x += Math.max(-30, Math.min(30, n.vx)) * alpha; n.y += Math.max(-30, Math.min(30, n.vy)) * alpha;
      n.vx *= .5; n.vy *= .5;
    }
    if (it > iterations * .6) separate();
  }
  for (let it = 0; it < 120 && separate(); it++);
  return pos;
}

function boundaryPath(a, b) {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  const dx = bx - ax, dy = by - ay;
  const s = (n, x, y) => 1 / Math.sqrt((x / (n.w / 2 + 3)) ** 2 + (y / (n.h / 2 + 3)) ** 2 || 1);
  const sa = s(a, dx, dy), sb = s(b, dx, dy);
  return `M${ax + dx * sa},${ay + dy * sa} L${bx - dx * sb},${by - dy * sb}`;
}

export function createSubview(api, createCanvas) {
  const state = {model: null, t: 0, side: "env", hiddenKinds: new Set(), selected: null, playing: null, layout: null, layoutKey: ""};
  api.toolbar.innerHTML = `
    <button class="btn" id="er-play" aria-label="Play through steps">▶</button>
    <label class="field time-field">Step <input type="range" id="er-t" class="time-slider" min="0" value="0" aria-label="Step"><strong id="er-t-label" class="mono"></strong></label>
    <div class="segmented" id="er-side">${["env", "mind", "all"].map(s => `<button class="btn" data-side="${s}" aria-pressed="${s === "env"}" title="${s === "env" ? "Environment observations" : s === "mind" ? "Agent beliefs and intentions" : "Both"}">${s}</button>`).join("")}</div>
    <div class="chip-row kind-filter" id="er-kinds"></div>`;
  api.legend.innerHTML = `<span class="lg lg-new"></span>changed at this step <span class="lg lg-removed"></span>no longer holds <span class="muted">Node colour = kind · ←/→ change step · click an entity for its history</span>`;
  const $ = id => api.toolbar.querySelector("#" + id);
  const canvas = createCanvas(api.stage, {
    onClick: id => select(id),
    onBackground: () => select(null),
    onHover: id => canvas.mark("is-hover", id ? [id] : [], id ? (a, b) => a === id || b === id : null),
    tooltip: id => { const e = state.model.dsl.entities[id]; return e ? `<strong class="mono">${esc(id)}</strong><div class="muted">kind ${esc(e.kind)}</div>` : ""; },
  });
  wireInspector(api.inspector, api, fid => api.goto("facts", fid));
  api.inspector.addEventListener("click", e => {
    const t = e.target.closest("[data-set-t]");
    if (t) setT(Number(t.dataset.setT));
  }, true);

  const binary = f => (f.args || []).length === 2;
  const sideOk = f => state.side === "all" || f.side === state.side;

  // Latest fact per relation key up to t; functional relations replace by their key positions.
  function stateAt(t) {
    const rels = state.model.dsl.relations;
    const latest = new Map();
    for (const f of state.model.dsl.facts) {
      if (f.t > t || !binary(f) || !sideOk(f)) continue;
      const rel = rels[f.rel];
      const keyPos = rel?.props?.includes("functional") && rel.key?.length ? rel.key : [0, 1];
      const key = `${f.rel}|${keyPos.map(i => entityId(f.args[i])).join(",")}`;
      const prev = latest.get(key);
      if (!prev || prev.t <= f.t) latest.set(key, f);
    }
    return [...latest.values()].filter(f => f.value !== false && f.value !== null || f.value_type === "null");
  }

  function computeLayout() {
    const key = `${state.side}|${state.model.dsl.facts.length}`;
    if (state.layoutKey === key) return;
    const links = state.model.dsl.facts.filter(f => binary(f) && sideOk(f)).map(f => [entityId(f.args[0]), entityId(f.args[1])]);
    const ids = [...new Set(links.flat())].filter(id => state.model.dsl.entities[id] || id.includes(":"));
    const kindOf = id => state.model.dsl.entities[id]?.kind || id.split(":")[0];
    state.layout = {ids, pos: forceLayout(ids, links, kindOf), kindOf};
    state.layoutKey = key;
  }

  function renderKinds() {
    const counts = {};
    state.layout.ids.forEach(id => { const k = state.layout.kindOf(id); counts[k] = (counts[k] || 0) + 1; });
    $("er-kinds").innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) =>
      `<button class="kind-chip ${state.hiddenKinds.has(k) ? "is-off" : ""}" data-kind="${esc(k)}" style="--kc:${kindColor(k)}"><span class="kind-dot"></span>${esc(k)} <span class="muted">${n}</span></button>`).join("");
  }

  function build(keepView) {
    computeLayout();
    const {ids, pos, kindOf} = state.layout;
    const now = stateAt(state.t), before = state.t > 0 ? stateAt(state.t - 1) : [];
    const nowKeys = new Set(now.map(f => f.fid));
    const removed = before.filter(f => !now.some(g => g.rel === f.rel && entityId(g.args[0]) === entityId(f.args[0]) && entityId(g.args[1]) === entityId(f.args[1])));
    const active = new Set(now.flatMap(f => f.args.map(entityId)));
    const degree = new Map();
    now.forEach(f => f.args.forEach(a => degree.set(entityId(a), (degree.get(entityId(a)) || 0) + 1)));
    const visible = id => !state.hiddenKinds.has(kindOf(id));
    const nodes = ids.filter(visible).map(id => {
      const p = pos.get(id), d = degree.get(id) || 0, index = id.split(":").slice(1).join(":") || id;
      const label = /^\d+$/.test(index) ? `${kindOf(id)} ${index}` : index;
      const w = Math.max(70, Math.min(170, label.length * 7.4 + 26)), h = 30 + Math.min(10, d * 1.5);
      return {id, x: p.x - w / 2, y: p.y - h / 2, w, h, shape: "pill", label: short(label, 22), sub: "",
              cls: `entity ${active.has(id) ? "" : "is-inactive"}`, style: `--kc:${kindColor(kindOf(id))}`, title: `${id} (${kindOf(id)})`};
    });
    const byId = new Map(nodes.map(n => [n.id, n]));
    // Group parallel facts between the same pair into one edge with a combined label.
    const pairs = new Map();
    const addPair = (f, cls) => {
      const a = entityId(f.args[0]), b = entityId(f.args[1]);
      if (!byId.has(a) || !byId.has(b) || a === b) return;
      const k = `${a}>${b}|${cls}`;
      if (!pairs.has(k)) pairs.set(k, {from: a, to: b, rels: new Set(), cls, fresh: false});
      const p = pairs.get(k);
      p.rels.add(f.rel);
      if (f.t === state.t) p.fresh = true;
    };
    now.forEach(f => addPair(f, "holds"));
    removed.forEach(f => addPair(f, "removed"));
    const edges = [], labels = [];
    pairs.forEach(p => {
      const a = byId.get(p.from), b = byId.get(p.to);
      edges.push({from: p.from, to: p.to, path: boundaryPath(a, b), cls: `rel ${p.cls} ${p.fresh ? "is-fresh" : ""}`, title: [...p.rels].join(", "), hot: p.fresh});
      labels.push({x: (a.x + a.w / 2 + b.x + b.w / 2) / 2, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 - 4, text: [...p.rels].join(", "), anchor: "middle", cls: `edge-label ${p.cls}`});
    });
    canvas.setScene({nodes, edges, labels}, {keepView});
    $("er-t-label").textContent = `S${String(state.t).padStart(2, "0")} · ${now.length} relations${removed.length ? ` · −${removed.length}` : ""}`;
    renderKinds();
    if (state.selected) { canvas.mark("is-selected", [state.selected], (a, b) => a === state.selected || b === state.selected); }
  }

  function inspector() {
    const id = state.selected;
    if (!id) {
      const kinds = {};
      Object.values(state.model.dsl.entities).forEach(e => { kinds[e.kind] = (kinds[e.kind] || 0) + 1; });
      return `<div class="insp-head"><span class="eyebrow">Entities & relations</span><h3>${Object.keys(state.model.dsl.entities).length} entities</h3></div>
        <p class="muted">Edges are binary relation facts that still hold at the chosen step (latest value per functional key). Select an entity for its history.</p>
        <dl class="kv">${Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => `<dt><span class="kind-dot" style="--kc:${kindColor(k)}"></span> ${esc(k)}</dt><dd>${n}</dd>`).join("")}</dl>`;
    }
    const facts = state.model.dsl.facts.filter(f => (f.args || []).some(a => entityId(a) === id) || entityId(f.purpose) === id);
    const steps = [...new Set(facts.map(f => f.t))].sort((a, b) => a - b);
    const nowFacts = facts.filter(f => f.t <= state.t).slice(-25).reverse();
    const kind = state.model.dsl.entities[id]?.kind || id.split(":")[0];
    const chain = [];
    for (let k = kind; k && !chain.includes(k); k = state.model.dsl.kinds[k]) chain.push(k);
    const maxT = state.model.dsl.maxT || 1;
    return `<div class="insp-head"><span class="eyebrow">Entity</span><h3 class="mono">${esc(id)}</h3>
        <div class="chip-row">${chain.map(k => `<span class="badge" style="border-color:${kindColor(k)}">${esc(k)}</span>`).join('<span class="muted">⊂</span>')}</div></div>
      <div class="insp-block"><h4>Appears at ${steps.length} steps</h4><div class="timeline">${steps.map(t => `<button class="tl-mark ${t === state.t ? "is-now" : ""}" style="left:${100 * t / maxT}%" data-set-t="${t}" title="S${t}"></button>`).join("")}<span class="tl-now" style="left:${100 * state.t / maxT}%"></span></div></div>
      <div class="insp-block"><h4>Facts up to S${String(state.t).padStart(2, "0")} · newest first</h4><div class="chip-col">${nowFacts.map(f => factChip(f, `<span class="slot mono">S${f.t}</span>`)).join("") || `<p class="muted">Not mentioned yet.</p>`}</div></div>
      <div class="insp-block"><h4>Related entities</h4><div class="chip-row">${[...new Set(facts.flatMap(f => (f.args || []).map(entityId)).filter(x => x !== id))].slice(0, 30).map(entityChip).join("")}</div></div>`;
  }

  function select(id) {
    state.selected = id;
    api.select(id);
    api.inspector.innerHTML = inspector();
    if (id) canvas.mark("is-selected", [id], (a, b) => a === id || b === id); else canvas.mark("is-selected", []);
    canvas.dim(Boolean(id));
    if (id) {
      const near = new Set([id]);
      api.stage.querySelectorAll(".edge").forEach(e => { if (e.dataset.from === id) near.add(e.dataset.to); if (e.dataset.to === id) near.add(e.dataset.from); });
      canvas.mark("is-lineage", near, (a, b) => a === id || b === id);
    }
  }

  function setT(t) {
    const max = state.model.dsl.maxT;
    state.t = Math.max(0, Math.min(max, t));
    $("er-t").value = state.t;
    build(true);
    if (state.selected) select(state.selected);
  }

  $("er-t").addEventListener("input", e => setT(Number(e.target.value)));
  api.toolbar.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.side) {
      state.side = b.dataset.side;
      api.toolbar.querySelectorAll("[data-side]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      build(false);
    }
    if (b.dataset.kind) { const k = b.dataset.kind; state.hiddenKinds.has(k) ? state.hiddenKinds.delete(k) : state.hiddenKinds.add(k); build(true); }
    if (b.id === "er-play") {
      if (state.playing) { clearInterval(state.playing); state.playing = null; b.textContent = "▶"; return; }
      if (state.t >= state.model.dsl.maxT) setT(0);
      b.textContent = "❚❚";
      state.playing = setInterval(() => {
        if (state.t >= state.model.dsl.maxT) { clearInterval(state.playing); state.playing = null; b.textContent = "▶"; return; }
        setT(state.t + 1);
      }, 900);
    }
  });
  api.stage.addEventListener("keydown", e => {
    if (e.key === "ArrowRight") setT(state.t + 1);
    if (e.key === "ArrowLeft") setT(state.t - 1);
  });

  return {
    update(model, {first}) {
      const firstTime = !state.model;
      state.model = model;
      if (!model.dsl) return;
      $("er-t").max = model.dsl.maxT;
      if (firstTime || first) {
        state.t = Math.min(model.dsl.maxT, 1);
        $("er-t").value = state.t;
        build(false);
        api.inspector.innerHTML = inspector();
      }
    },
    show(id) {
      if (!id || !state.model?.dsl) return;
      const facts = state.model.dsl.facts.filter(f => (f.args || []).some(a => entityId(a) === id));
      if (facts.length && !facts.some(f => f.t <= state.t)) setT(facts[0].t);
      select(id);
      requestAnimationFrame(() => canvas.focus(id));
    },
    destroy() { clearInterval(state.playing); canvas.destroy(); },
  };
}
