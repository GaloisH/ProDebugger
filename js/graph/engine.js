// Minimal SVG graph canvas: pan, wheel zoom, fit and focus.
// Views hand it a positioned scene; it never computes layout itself.
import {esc} from "../util.js?v=27bf1baa85";

const NS = "http://www.w3.org/2000/svg";

export function edgePath(a, b, kind = "auto") {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  if (kind === "vertical" || (kind === "auto" && Math.abs(bx - ax) < Math.max(a.w, b.w) * .6)) {
    const down = by > ay;
    const y1 = down ? a.y + a.h : a.y, y2 = down ? b.y : b.y + b.h, my = (y1 + y2) / 2;
    if (Math.abs(bx - ax) < 2 && Math.abs(by - ay) < a.h * 3) {
      // Same column, nearby rows: arc out to the side so the edge stays visible.
      const side = a.x + a.w + 18 + Math.abs(by - ay) * .15;
      return `M${a.x + a.w},${ay} C${side},${ay} ${side},${by} ${b.x + b.w},${by}`;
    }
    return `M${ax},${y1} C${ax},${my} ${bx},${my} ${bx},${y2}`;
  }
  const right = bx > ax;
  const x1 = right ? a.x + a.w : a.x, x2 = right ? b.x : b.x + b.w, mx = (x1 + x2) / 2;
  return `M${x1},${ay} C${mx},${ay} ${mx},${by} ${x2},${by}`;
}

export function createCanvas(container, handlers = {}) {
  container.classList.add("graph-canvas");
  container.innerHTML = `
    <svg class="graph-svg" tabindex="0" aria-label="Graph canvas">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrow-head"/></marker>
        <marker id="arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrow-head hot"/></marker>
      </defs>
      <g class="viewport"><g class="layer-groups"></g><g class="layer-edges"></g><g class="layer-nodes"></g><g class="layer-labels"></g></g>
    </svg>
    <div class="graph-controls">
      <button class="btn" data-zoom="1.25" aria-label="Zoom in">+</button>
      <button class="btn" data-zoom="0.8" aria-label="Zoom out">−</button>
      <button class="btn" data-fit aria-label="Fit graph">Fit</button>
    </div>
    <div class="graph-tip" hidden></div>`;
  const svg = container.querySelector(".graph-svg");
  const viewport = svg.querySelector(".viewport");
  const layers = {groups: svg.querySelector(".layer-groups"), edges: svg.querySelector(".layer-edges"),
                  nodes: svg.querySelector(".layer-nodes"), labels: svg.querySelector(".layer-labels")};
  const tip = container.querySelector(".graph-tip");
  let view = {x: 0, y: 0, k: 1};
  let scene = {nodes: [], edges: [], groups: [], labels: []};
  let bounds = {x: 0, y: 0, w: 1, h: 1};
  const byId = new Map();

  const apply = () => {
    viewport.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
    container.style.setProperty("--zoom", view.k);
    container.classList.toggle("is-far", view.k < .55);
  };

  function computeBounds() {
    const items = [...scene.nodes, ...scene.groups];
    if (!items.length) { bounds = {x: 0, y: 0, w: 1, h: 1}; return; }
    const x0 = Math.min(...items.map(n => n.x)), y0 = Math.min(...items.map(n => n.y));
    const x1 = Math.max(...items.map(n => n.x + n.w)), y1 = Math.max(...items.map(n => n.y + n.h));
    bounds = {x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0)};
  }

  function nodeSvg(n) {
    const lines = [n.label, n.sub].filter(Boolean);
    const text = lines.map((line, i) => `<text class="${i ? "node-sub" : "node-label"}" x="${n.shape === "pill" ? n.w / 2 : 10}" y="${n.h / 2 + (lines.length === 1 ? 4 : i ? 12 : -3)}" ${n.shape === "pill" ? 'text-anchor="middle"' : ""}>${esc(line)}</text>`).join("");
    const r = n.shape === "pill" ? n.h / 2 : n.shape === "circle" ? n.w / 2 : 7;
    const badge = n.badge ? `<g class="node-badge"><rect x="${n.w - 6 - n.badge.length * 6.5 - 8}" y="-8" width="${n.badge.length * 6.5 + 8}" height="16" rx="8"/><text x="${n.w - 10 - n.badge.length * 3.25}" y="4" text-anchor="middle">${esc(n.badge)}</text></g>` : "";
    return `<g class="node ${n.cls || ""}" data-id="${esc(n.id)}" transform="translate(${n.x},${n.y})" tabindex="-1">
      <rect class="node-box" width="${n.w}" height="${n.h}" rx="${r}" ${n.style ? `style="${n.style}"` : ""}/>${text}${badge}<title>${esc(n.title || n.label)}</title></g>`;
  }

  function render() {
    byId.clear();
    scene.nodes.forEach(n => byId.set(n.id, n));
    layers.groups.innerHTML = scene.groups.map(g => `<g class="group ${g.cls || ""}"><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="12"/>${g.label ? `<text x="${g.x + 12}" y="${g.y + 20}">${esc(g.label)}</text>` : ""}</g>`).join("");
    layers.edges.innerHTML = scene.edges.map((e, i) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) return "";
      return `<path class="edge ${e.cls || ""}" data-edge="${i}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${e.path || edgePath(a, b, e.route)}" marker-end="url(#${e.hot ? "arrow-hot" : "arrow"})">${e.title ? `<title>${esc(e.title)}</title>` : ""}</path>`;
    }).join("");
    layers.nodes.innerHTML = scene.nodes.map(nodeSvg).join("");
    layers.labels.innerHTML = (scene.labels || []).map(l => `<text class="graph-label ${l.cls || ""}" x="${l.x}" y="${l.y}" ${l.anchor ? `text-anchor="${l.anchor}"` : ""}>${esc(l.text)}</text>`).join("");
    computeBounds();
  }

  let fitPending = false;
  function fit(padding = 40, maxK = 1.2) {
    const r = svg.getBoundingClientRect();
    // Hidden canvases have no size yet; fit once the ResizeObserver reports one.
    if (!r.width || !r.height) { fitPending = true; return; }
    fitPending = false;
    // Tall graphs fit to width (down to 0.4x) and scroll vertically instead of shrinking to dust.
    const wr = (r.width - padding * 2) / bounds.w, hr = (r.height - padding * 2) / bounds.h;
    const k = Math.min(maxK, wr, Math.max(hr, Math.min(wr, .4)));
    view = {k: Math.max(.08, k), x: 0, y: 0};
    view.x = (r.width - bounds.w * view.k) / 2 - bounds.x * view.k;
    view.y = Math.max(padding, (r.height - bounds.h * view.k) / 2) - bounds.y * view.k;
    apply();
  }

  function centerOn(x, y, k = view.k, smooth = true) {
    const r = svg.getBoundingClientRect();
    const target = {k, x: r.width / 2 - x * k, y: r.height / 2 - y * k};
    if (!smooth) { view = target; apply(); return; }
    const from = {...view}, start = performance.now();
    const step = now => {
      const p = Math.min(1, (now - start) / 380), e = 1 - Math.pow(1 - p, 3);
      view = {x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e};
      apply();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function focus(id, k) {
    const n = byId.get(id);
    if (n) centerOn(n.x + n.w / 2, n.y + n.h / 2, k ?? Math.max(view.k, .9));
  }

  function zoomAt(factor, cx, cy) {
    const k = Math.min(3, Math.max(.06, view.k * factor));
    view.x = cx - (cx - view.x) * (k / view.k);
    view.y = cy - (cy - view.y) * (k / view.k);
    view.k = k;
    apply();
  }

  // Pointer interaction
  let drag = null;
  svg.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target.closest(".node")) return;
    drag = {x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false};
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("is-panning");
  });
  svg.addEventListener("pointermove", e => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      view.x = drag.vx + dx; view.y = drag.vy + dy; apply();
      return;
    }
    const node = e.target.closest(".node");
    const id = node?.dataset.id ?? null;
    if (id !== hovered) { hovered = id; handlers.onHover?.(id); }
    if (node && handlers.tooltip) {
      const html = handlers.tooltip(id);
      if (html) {
        const r = container.getBoundingClientRect();
        tip.innerHTML = html; tip.hidden = false;
        tip.style.left = `${Math.min(e.clientX - r.left + 14, r.width - 300)}px`;
        tip.style.top = `${e.clientY - r.top + 14}px`;
      }
    } else tip.hidden = true;
  });
  let hovered = null;
  svg.addEventListener("pointerleave", () => { tip.hidden = true; if (hovered) { hovered = null; handlers.onHover?.(null); } });
  svg.addEventListener("pointerup", e => {
    svg.classList.remove("is-panning");
    const wasDrag = drag?.moved;
    drag = null;
    if (wasDrag) return;
    const node = e.target.closest(".node");
    if (node) handlers.onClick?.(node.dataset.id, e);
    else handlers.onBackground?.(e);
  });
  svg.addEventListener("dblclick", e => {
    const node = e.target.closest(".node");
    if (node) handlers.onDouble?.(node.dataset.id, e);
  });
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * .0015), e.clientX - r.left, e.clientY - r.top);
  }, {passive: false});
  container.querySelector(".graph-controls").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    const r = svg.getBoundingClientRect();
    if (b.dataset.fit != null) fit();
    else zoomAt(Number(b.dataset.zoom), r.width / 2, r.height / 2);
  });
  const resize = new ResizeObserver(() => { if (fitPending) fit(); });
  resize.observe(svg);

  return {
    svg,
    setScene(next, {keepView = false} = {}) {
      scene = {nodes: [], edges: [], groups: [], labels: [], ...next};
      render();
      if (!keepView) fit();
      else apply();
    },
    // Class toggles without re-rendering, for hover/selection/live highlights.
    mark(cls, ids, edgePredicate) {
      svg.querySelectorAll(`.${cls}`).forEach(el => el.classList.remove(cls));
      const set = ids instanceof Set ? ids : new Set(ids || []);
      if (set.size) layers.nodes.querySelectorAll(".node").forEach(el => { if (set.has(el.dataset.id)) el.classList.add(cls); });
      if (edgePredicate) layers.edges.querySelectorAll(".edge").forEach(el => { if (edgePredicate(el.dataset.from, el.dataset.to)) el.classList.add(cls); });
    },
    dim(on) { svg.classList.toggle("has-focus", on); },
    node: id => byId.get(id),
    fit, focus, centerOn,
    destroy() { resize.disconnect(); },
  };
}
