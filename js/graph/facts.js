// Fact dependency graph: columns are steps, bands are sides, edges follow `basis`.
// A step-range brush keeps large records readable; dependencies leaving the range
// end at ghost nodes on either side.
import {factText} from "../case/format.js?v=50f8681a13";
import {debounce, esc, short} from "../util.js?v=50f8681a13";
import {factIndex, factInspector, wireInspector} from "./inspect.js?v=50f8681a13";

const W = 210, H = 36, VGAP = 8, HGAP = 14, COL_GAP = 110, BAND_GAP = 34, GHOST_MAX = 30, MAX_ROWS = 10;
const SIDE_ORDER = ["task", "env", "mind"];

export function createSubview(api, createCanvas) {
  const state = {model: null, lo: null, hi: null, selected: null, depth: 2, route: true, heat: true, latest: new Set()};
  api.toolbar.innerHTML = `
    <div class="brush" id="fx-brush">
      <div class="brush-hist" id="fx-hist"></div>
      <input type="range" class="brush-lo" id="fx-lo" aria-label="First step">
      <input type="range" class="brush-hi" id="fx-hi" aria-label="Last step">
    </div>
    <div class="brush-info"><strong id="fx-range"></strong><span id="fx-stats" class="muted"></span></div>
    <div class="segmented">
      <button class="btn" data-shift="-1" title="Earlier steps">◀</button><button class="btn" data-shift="1" title="Later steps">▶</button>
      ${[3, 6, 10].map(n => `<button class="btn" data-width="${n}">${n}</button>`).join("")}<button class="btn" data-width="all">All</button>
    </div>
    <label class="field">Lineage <select class="input" id="fx-depth">${[1, 2, 3, 99].map(d => `<option value="${d}" ${d === 2 ? "selected" : ""}>${d === 99 ? "all" : d} hop${d === 1 ? "" : "s"}</option>`).join("")}</select></label>
    <button class="btn" id="fx-heat" aria-pressed="true" title="Debugger attention: how often each fact was cited">Attention</button>
    <button class="btn" id="fx-route" aria-pressed="true" title="Overlay the ROUTE trace_graph">Route path</button>
    <input class="input" id="fx-search" type="search" placeholder="Find fact (f34, rel, entity)…">`;
  api.legend.innerHTML = `<span class="lg side-task"></span>task <span class="lg side-env"></span>env <span class="lg side-mind"></span>mind
    <span class="lg lg-route"></span>ROUTE path <span class="lg lg-heat"></span>cited by debugger <span class="lg lg-ghost"></span>outside range · click to include
    <span class="muted">Drag to pan · wheel to zoom · double-click opens the step</span>`;
  const $ = id => api.toolbar.querySelector("#" + id);
  const canvas = createCanvas(api.stage, {
    onClick: id => select(id),
    onDouble: id => { const f = factOf(id); if (f) api.ctx.navigate("trajectory", "step", f.t); },
    onBackground: () => select(null),
    onHover: id => hover(id),
    tooltip: id => { const f = factOf(id); return f ? `<strong class="mono">f${f.fid} · S${f.t}</strong><div class="mono">${esc(factText(f))}</div>${f.span ? `<div class="muted">${esc(short(f.span, 180))}</div>` : ""}` : ""; },
  });
  wireInspector(api.inspector, api, fid => focusFact(fid));

  const factOf = id => id && state.model?.dsl?.factsById.get(Number(String(id).slice(2)));
  const nodeId = fid => `f:${fid}`;

  function bounds() {
    const facts = state.model.dsl.facts;
    const ts = facts.map(f => f.t || 0);
    return {min: Math.min(...ts), max: Math.max(...ts)};
  }

  function setRange(lo, hi, {keepView = false} = {}) {
    const b = bounds();
    lo = Math.max(b.min, Math.min(lo, b.max)); hi = Math.max(lo, Math.min(hi, b.max));
    state.lo = lo; state.hi = hi;
    $("fx-lo").value = lo; $("fx-hi").value = hi;
    build(keepView);
  }

  function renderBrush() {
    const b = bounds();
    const counts = new Map();
    state.model.dsl.facts.forEach(f => counts.set(f.t, (counts.get(f.t) || 0) + 1));
    const violated = new Set(state.model.evaluations.filter(e => e.state === "violated").map(e => e.t));
    const max = Math.max(...counts.values());
    const steps = [];
    for (let t = b.min; t <= b.max; t++) steps.push(t);
    $("fx-hist").innerHTML = steps.map(t => `<span class="bar ${t >= state.lo && t <= state.hi ? "is-in" : ""} ${violated.has(t) ? "is-warn" : ""}" style="height:${Math.max(8, 100 * (counts.get(t) || 0) / max)}%" title="S${t}: ${counts.get(t) || 0} facts" data-t="${t}"></span>`).join("");
    for (const input of [$("fx-lo"), $("fx-hi")]) { input.min = b.min; input.max = b.max; input.step = 1; }
  }

  function build(keepView) {
    const {dsl} = state.model;
    const idx = factIndex(state.model);
    const inRange = f => f.t >= state.lo && f.t <= state.hi;
    const facts = dsl.facts.filter(inRange);
    const cols = [];
    for (let t = state.lo; t <= state.hi; t++) cols.push(t);
    const sides = [...new Set([...SIDE_ORDER, ...facts.map(f => f.side || "other")])].filter(s => facts.some(f => (f.side || "other") === s));
    // Band height = the busiest step for that side, so bands align across columns.
    const cell = new Map();
    facts.forEach(f => { const k = `${f.t}|${f.side || "other"}`; if (!cell.has(k)) cell.set(k, []); cell.get(k).push(f); });
    cell.forEach(list => list.sort((a, b) => String(a.slot).localeCompare(String(b.slot)) || a.fid - b.fid));
    // Busy cells wrap into sub-columns (MAX_ROWS each); bands still align across steps.
    const rowsOf = n => Math.min(n, MAX_ROWS), subcols = n => Math.max(1, Math.ceil(n / MAX_ROWS));
    const colWidth = new Map(cols.map(t => [t, Math.max(...sides.map(side => subcols((cell.get(`${t}|${side}`) || []).length))) * (W + HGAP) - HGAP]));
    const bandTop = {}, bandH = {};
    let y = 40;
    sides.forEach(side => {
      bandTop[side] = y;
      bandH[side] = Math.max(...cols.map(t => rowsOf((cell.get(`${t}|${side}`) || []).length))) * (H + VGAP) - VGAP + 24;
      y += bandH[side] + BAND_GAP;
    });
    const ghostW = 150, x0 = ghostW + 60;
    const colLeft = new Map();
    cols.reduce((x, t) => { colLeft.set(t, x); return x + colWidth.get(t) + COL_GAP; }, x0);
    const colX = t => colLeft.get(t);
    const nodes = [], edges = [], groups = [], labels = [];
    const heat = state.heat && state.model.debugger;
    const maxCited = Math.max(1, ...facts.map(f => idx.cited.get(f.fid)?.length || 0));
    cols.forEach(t => {
      groups.push({x: colX(t) - 14, y: 0, w: colWidth.get(t) + 28, h: y - BAND_GAP + 12, cls: "step-col", label: `S${String(t).padStart(2, "0")}`});
      sides.forEach(side => (cell.get(`${t}|${side}`) || []).forEach((f, i) => {
        const cited = idx.cited.get(f.fid)?.length || 0;
        nodes.push({id: nodeId(f.fid), x: colX(t) + Math.floor(i / MAX_ROWS) * (W + HGAP), y: bandTop[side] + 20 + (i % MAX_ROWS) * (H + VGAP), w: W, h: H,
          label: short(factText(f), 30), sub: `f${f.fid} · ${f.slot}`, cls: `fact side-${f.side || "other"} ${heat && cited ? "is-cited" : ""}`,
          style: heat && cited ? `--heat:${(0.25 + 0.75 * cited / maxCited).toFixed(2)}` : "", badge: heat && cited ? String(cited) : ""});
      }));
    });
    sides.forEach(side => labels.push({x: x0 - 40, y: bandTop[side] + 14, text: side.toUpperCase(), anchor: "end", cls: "band-label"}));
    sides.forEach((side, i) => i && groups.push({x: x0 - 20, y: bandTop[side] - BAND_GAP / 2 - 1, w: colX(state.hi) + colWidth.get(state.hi) - x0 + 40, h: 1, cls: "band-sep"}));
    // Ghosts: sources before the range and dependents after it.
    const before = new Map(), after = new Map();
    facts.forEach(f => {
      (f.basis || []).forEach(b => {
        const src = dsl.factsById.get(b);
        if (!src) return;
        if (inRange(src)) edges.push({from: nodeId(b), to: nodeId(f.fid), cls: "basis"});
        else if (src.t < state.lo) { before.set(b, src); edges.push({from: `g:${b}`, to: nodeId(f.fid), cls: "basis ghost-edge"}); }
      });
      (idx.dependents.get(f.fid) || []).forEach(d => {
        const dep = dsl.factsById.get(d);
        if (dep && dep.t > state.hi) { after.set(d, dep); edges.push({from: nodeId(f.fid), to: `g:${d}`, cls: "basis ghost-edge"}); }
      });
    });
    const ghost = (map, x) => [...map.values()].sort((a, b) => a.t - b.t || a.fid - b.fid).slice(0, GHOST_MAX).forEach((f, i) =>
      nodes.push({id: `g:${f.fid}`, x, y: 40 + i * (28 + 6), w: ghostW, h: 28, label: `f${f.fid} · S${f.t}`, sub: "", cls: `ghost side-${f.side}`, title: factText(f)}));
    ghost(before, 0);
    const rightX = colX(state.hi) + colWidth.get(state.hi) + COL_GAP - 20;
    ghost(after, rightX);
    if (before.size > GHOST_MAX) labels.push({x: 0, y: 40 + GHOST_MAX * 34 + 12, text: `+${before.size - GHOST_MAX} more`});
    if (after.size > GHOST_MAX) labels.push({x: rightX, y: 40 + GHOST_MAX * 34 + 12, text: `+${after.size - GHOST_MAX} more`});
    const ids = new Set(nodes.map(n => n.id));
    const shownEdges = edges.filter(e => ids.has(e.from) && ids.has(e.to));
    canvas.setScene({nodes, edges: shownEdges, groups, labels}, {keepView});
    $("fx-range").textContent = `S${String(state.lo).padStart(2, "0")} – S${String(state.hi).padStart(2, "0")}`;
    $("fx-stats").textContent = ` · ${facts.length} facts · ${shownEdges.length} edges${before.size + after.size ? ` · ${before.size + after.size} outside` : ""}`;
    renderBrush();
    overlays();
    if (state.selected != null) highlightLineage();
  }

  function overlays() {
    const d = state.model.debugger;
    const routeGraph = Array.isArray(d?.traceGraph) ? d.traceGraph : d?.traceGraph ? [d.traceGraph] : [];
    const routeNodes = new Set(), routeEdges = new Set();
    if (state.route) routeGraph.forEach(g => {
      (g.nodes || []).forEach(n => n.fid != null && routeNodes.add(nodeId(n.fid)));
      (g.edges || []).forEach(e => routeEdges.add(`${e.source.replace("fact:", "f:")}>${e.target.replace("fact:", "f:")}`));
    });
    canvas.mark("in-route", routeNodes, (a, b) => routeEdges.has(`${a}>${b}`));
    canvas.mark("is-latest", [...state.latest].map(nodeId));
  }

  function lineage(fid, dir) {
    const out = new Set();
    const idx = factIndex(state.model);
    let frontier = [fid];
    for (let hop = 0; hop < state.depth && frontier.length; hop++) {
      const next = [];
      frontier.forEach(x => {
        const list = dir === "up" ? (state.model.dsl.factsById.get(x)?.basis || []) : (idx.dependents.get(x) || []);
        list.forEach(y => { if (!out.has(y)) { out.add(y); next.push(y); } });
      });
      frontier = next;
    }
    return out;
  }

  function highlightLineage() {
    const fid = state.selected;
    if (fid == null) { canvas.dim(false); canvas.mark("is-lineage", []); canvas.mark("is-selected", []); return; }
    const up = lineage(fid, "up"), down = lineage(fid, "down");
    const ids = new Set([fid, ...up, ...down].flatMap(x => [nodeId(x), `g:${x}`]));
    canvas.mark("is-selected", [nodeId(fid), `g:${fid}`]);
    canvas.mark("is-lineage", ids, (a, b) => ids.has(a) && ids.has(b));
    canvas.dim(true);
  }

  function hover(id) {
    if (!id) { canvas.mark("is-hover", []); return; }
    canvas.mark("is-hover", [id], (a, b) => a === id || b === id);
  }

  function select(id) {
    if (id && id.startsWith("g:")) { focusFact(Number(id.slice(2))); return; }
    state.selected = id ? Number(id.slice(2)) : null;
    api.select(state.selected);
    api.inspector.innerHTML = state.selected == null ? emptyInspector() : factInspector(state.model, state.selected);
    highlightLineage();
  }

  function focusFact(fid) {
    const f = state.model.dsl.factsById.get(Number(fid));
    if (!f) return;
    if (f.t < state.lo || f.t > state.hi) {
      const width = state.hi - state.lo;
      const lo = Math.max(bounds().min, f.t - Math.floor(width / 2));
      setRange(lo, lo + width);
    }
    select(nodeId(f.fid));
    requestAnimationFrame(() => canvas.focus(nodeId(f.fid)));
  }

  function emptyInspector() {
    const m = state.model;
    const sides = {};
    m.dsl.facts.forEach(f => { sides[f.side] = (sides[f.side] || 0) + 1; });
    return `<div class="insp-head"><span class="eyebrow">Fact dependency graph</span><h3>${m.dsl.facts.length} facts</h3></div>
      <p class="muted">Select a fact to trace its basis (upstream) and dependents (downstream). Ghost nodes at the edges are dependencies outside the selected step range.</p>
      <dl class="kv">${Object.entries(sides).map(([s, n]) => `<dt>${esc(s)}</dt><dd>${n}</dd>`).join("")}</dl>`;
  }

  // Toolbar wiring
  const onRange = debounce(() => {
    let lo = Number($("fx-lo").value), hi = Number($("fx-hi").value);
    if (lo > hi) [lo, hi] = [hi, lo];
    setRange(lo, hi);
  }, 120);
  $("fx-lo").addEventListener("input", onRange);
  $("fx-hi").addEventListener("input", onRange);
  $("fx-hist").addEventListener("click", e => {
    const t = Number(e.target.closest("[data-t]")?.dataset.t);
    if (!Number.isNaN(t)) { const w = state.hi - state.lo; setRange(t - Math.floor(w / 2), t - Math.floor(w / 2) + w); }
  });
  $("fx-depth").addEventListener("change", e => { state.depth = Number(e.target.value); highlightLineage(); });
  $("fx-search").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;
    const m = q.match(/^f?(\d+)$/);
    const hit = m ? state.model.dsl.factsById.get(Number(m[1])) : state.model.dsl.facts.find(f => factText(f).toLowerCase().includes(q) || (f.span || "").toLowerCase().includes(q));
    if (hit) focusFact(hit.fid);
    else e.target.classList.add("is-miss"), setTimeout(() => e.target.classList.remove("is-miss"), 600);
  });
  api.toolbar.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.shift) { const s = Number(b.dataset.shift) * Math.max(1, state.hi - state.lo + 1); setRange(state.lo + s, state.hi + s); }
    if (b.dataset.width) { const bd = bounds(); if (b.dataset.width === "all") setRange(bd.min, bd.max); else setRange(state.lo, state.lo + Number(b.dataset.width) - 1); }
    if (b.id === "fx-heat") { state.heat = !state.heat; b.setAttribute("aria-pressed", String(state.heat)); build(true); }
    if (b.id === "fx-route") { state.route = !state.route; b.setAttribute("aria-pressed", String(state.route)); overlays(); }
  });

  return {
    update(model, {changed, first}) {
      const hadModel = state.model;
      state.model = model;
      if (!model.dsl) { api.stage.innerHTML = `<p class="empty">No compiled record yet.</p>`; return; }
      const calls = model.debugger?.calls || [];
      const latest = calls.filter(c => c.fids?.length).at(-1);
      state.latest = new Set(api.store.live && latest ? latest.fids : []);
      if (!hadModel || first || state.lo == null) {
        const b = bounds();
        const start = b.min === 0 ? 0 : b.min;
        api.toolbar.querySelector("#fx-lo").value = start;
        state.lo = start; state.hi = Math.min(b.max, start + 5);
        build(false);
        api.inspector.innerHTML = state.selected == null ? emptyInspector() : factInspector(model, state.selected);
        return;
      }
      // Live runs: refresh attention/latest/route overlays; the record itself is fixed per run.
      if (changed.has("canonical_record") || changed.has("record")) build(true);
      else if (state.heat) build(true);
      else overlays();
      if (state.selected != null) api.inspector.innerHTML = factInspector(model, state.selected);
    },
    show(id) {
      if (id != null && state.model?.dsl) focusFact(Number(id));
    },
    destroy() { canvas.destroy(); },
  };
}
