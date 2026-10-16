// Schema graph: the kind hierarchy as a tidy tree and relation signatures beside it.
// Selecting a relation lights its argument kinds; selecting a kind lights every
// relation that accepts it, directly or through an ancestor.
import {entityId} from "../case/model.js?v=50f8681a13";
import {factChip} from "../case/format.js?v=50f8681a13";
import {esc} from "../util.js?v=50f8681a13";
import {entityChip, wireInspector} from "./inspect.js?v=50f8681a13";
import {kindColor} from "./entities.js?v=50f8681a13";

const KW = 170, KH = 40, DX = 220, DY = 50, RW = 270, RH = 46;
const PROP_HELP = {functional: "value determined by key positions", mutable: "may be re-established later", symmetric: "argument order does not matter",
                   transitive: "chains compose", observed: "all shown instances recorded; absence is negation"};

export function createSubview(api, createCanvas) {
  const state = {model: null, selected: null, showSig: false};
  api.toolbar.innerHTML = `<button class="btn" id="sc-sig" aria-pressed="false">Show all signature edges</button>
    <input class="input" id="sc-search" type="search" placeholder="Find kind or relation…">`;
  api.legend.innerHTML = `<span class="muted">Left: kinds (is-a tree, count = entities). Right: relations ordered by usage; dashed edges link a relation to its argument kinds.</span>`;
  const canvas = createCanvas(api.stage, {
    onClick: id => select(id), onBackground: () => select(null),
    onHover: id => mark(id, "is-hover"),
    tooltip: id => id.startsWith("r:") ? `<strong class="mono">${esc(signature(state.model.dsl.relations[id.slice(2)]))}</strong>` : `<strong>${esc(id.slice(2))}</strong>`,
  });
  wireInspector(api.inspector, api);
  api.inspector.addEventListener("click", e => {
    const b = e.target.closest("[data-schema]");
    if (b) { select(b.dataset.schema); canvas.focus(b.dataset.schema); }
  }, true);

  const signature = r => r ? `${r.name}(${(r.arg_kinds || []).join(", ") || Array.from({length: r.arity}, (_, i) => `a${i}`).join(", ")})` : "";
  const ancestors = k => { const out = []; for (let x = k; x && !out.includes(x); x = state.model.dsl.kinds[x]) out.push(x); return out; };

  function build() {
    const {kinds, relations, facts, entities} = state.model.dsl;
    const children = {};
    Object.entries(kinds).forEach(([k, p]) => { (children[p ?? "__root"] ||= []).push(k); });
    Object.values(children).forEach(list => list.sort());
    const entityCount = {};
    Object.values(entities).forEach(e => { entityCount[e.kind] = (entityCount[e.kind] || 0) + 1; });
    const nodes = [], edges = [];
    let leaf = 0, maxDepth = 0;
    const place = (k, depth) => {
      maxDepth = Math.max(maxDepth, depth);
      const kids = children[k] || [];
      let y;
      if (!kids.length) y = leaf++ * DY;
      else { const ys = kids.map(c => place(c, depth + 1)); y = (ys[0] + ys[ys.length - 1]) / 2; }
      const n = entityCount[k] || 0;
      nodes.push({id: `k:${k}`, x: depth * DX, y, w: KW, h: KH, shape: "pill", label: k, sub: n ? `${n} entit${n === 1 ? "y" : "ies"}` : "",
                  cls: `kind ${n ? "" : "is-abstract"}`, style: `--kc:${kindColor(k)}`});
      kids.forEach(c => edges.push({from: `k:${k}`, to: `k:${c}`, cls: "isa", route: "horizontal"}));
      return y;
    };
    (children.__root || []).forEach(r => place(r, 0));
    const usage = {};
    facts.forEach(f => { usage[f.rel] = (usage[f.rel] || 0) + 1; });
    const relList = Object.values(relations).sort((a, b) => (usage[b.name] || 0) - (usage[a.name] || 0) || a.name.localeCompare(b.name));
    const rx = (maxDepth + 1) * DX + 160;
    const ry0 = Math.max(0, (leaf * DY - relList.length * (RH + 12)) / 2);
    relList.forEach((r, i) => {
      nodes.push({id: `r:${r.name}`, x: rx, y: ry0 + i * (RH + 12), w: RW, h: RH, label: signature(r), sub: `${usage[r.name] || 0} facts · ${(r.props || []).join(" ") || "—"}`, cls: "relation"});
      (r.arg_kinds || []).forEach((k, pos) => kinds[k] !== undefined && edges.push({from: `r:${r.name}`, to: `k:${k}`, cls: "sig", route: "horizontal", title: `${r.name} arg ${pos}`}));
    });
    canvas.setScene({nodes, edges, labels: [{x: 0, y: -24, text: "KINDS"}, {x: rx, y: Math.min(-24, ry0 - 24), text: "RELATIONS"}]});
    api.stage.classList.toggle("show-sig", state.showSig);
  }

  function related(id) {
    const ids = new Set([id]);
    const {relations} = state.model.dsl;
    if (id.startsWith("r:")) (relations[id.slice(2)]?.arg_kinds || []).forEach(k => ids.add(`k:${k}`));
    else {
      const anc = ancestors(id.slice(2));
      anc.forEach(k => ids.add(`k:${k}`));
      Object.values(relations).forEach(r => { if ((r.arg_kinds || []).some(k => anc.includes(k))) ids.add(`r:${r.name}`); });
    }
    return ids;
  }

  function mark(id, cls) {
    if (!id) { canvas.mark(cls, []); return; }
    const ids = related(id);
    canvas.mark(cls, ids, (a, b) => ids.has(a) && ids.has(b) && (a === id || b === id || (a.startsWith("k:") && b.startsWith("k:"))));
  }

  function inspector() {
    const id = state.selected, {kinds, relations, entities, facts} = state.model.dsl;
    if (!id) return `<div class="insp-head"><span class="eyebrow">Schema</span><h3>${Object.keys(kinds).length} kinds · ${Object.keys(relations).length} relations</h3></div>
      <p class="muted">The DSL's type system: every entity has a kind, every relation constrains its arguments to kinds. Select a node to see what it admits.</p>
      <dl class="kv">${Object.entries(PROP_HELP).map(([p, h]) => `<dt class="mono">${p}</dt><dd>${h}</dd>`).join("")}</dl>`;
    if (id.startsWith("k:")) {
      const k = id.slice(2);
      const kids = Object.entries(kinds).filter(([, p]) => p === k).map(([c]) => c);
      const anc = ancestors(k);
      const ents = Object.keys(entities).filter(e => entities[e].kind === k);
      const rels = Object.values(relations).filter(r => (r.arg_kinds || []).some(a => anc.includes(a)));
      return `<div class="insp-head"><span class="eyebrow">Kind</span><h3>${esc(k)}</h3><div class="chip-row">${anc.map(a => `<button class="badge" data-schema="k:${esc(a)}" style="border-color:${kindColor(a)}">${esc(a)}</button>`).join('<span class="muted">⊂</span>')}</div></div>
        <div class="insp-block"><h4>Sub-kinds · ${kids.length}</h4><div class="chip-row">${kids.map(c => `<button class="badge" data-schema="k:${esc(c)}">${esc(c)}</button>`).join("") || `<span class="muted">None.</span>`}</div></div>
        <div class="insp-block"><h4>Entities · ${ents.length}</h4><div class="chip-row">${ents.slice(0, 40).map(entityChip).join("") || `<span class="muted">None (abstract).</span>`}</div></div>
        <div class="insp-block"><h4>Accepted by · ${rels.length}</h4><div class="chip-col">${rels.map(r => `<button class="sig-chip mono" data-schema="r:${esc(r.name)}">${esc(signature(r))}</button>`).join("") || `<span class="muted">No relation names this kind.</span>`}</div></div>`;
    }
    const r = relations[id.slice(2)];
    const used = facts.filter(f => f.rel === r.name);
    const sides = {};
    used.forEach(f => { sides[f.side] = (sides[f.side] || 0) + 1; });
    return `<div class="insp-head"><span class="eyebrow">Relation</span><h3 class="mono">${esc(signature(r))}</h3>
        <div class="chip-row">${(r.props || []).map(p => `<span class="badge info" title="${esc(PROP_HELP[p] || "")}">${esc(p)}</span>`).join("")}</div></div>
      <dl class="kv"><dt>arity</dt><dd>${r.arity}</dd><dt>key</dt><dd class="mono">[${(r.key || []).join(", ")}]</dd>
        <dt>arg kinds</dt><dd>${(r.arg_kinds || []).map(k => `<button class="badge" data-schema="k:${esc(k)}">${esc(k)}</button>`).join(" ") || "unconstrained"}</dd>
        <dt>value types</dt><dd class="mono">${esc((r.value_types || []).join(", ") || "—")}</dd>
        <dt>facts</dt><dd>${used.length} ${Object.entries(sides).map(([s, n]) => `<span class="badge">${esc(s)} ${n}</span>`).join(" ")}</dd></dl>
      <div class="insp-block"><h4>Examples</h4><div class="chip-col">${used.slice(0, 12).map(f => factChip(f, `<span class="slot mono">S${f.t}</span>`)).join("") || `<span class="muted">Declared but unused.</span>`}</div></div>
      <div class="insp-block"><h4>Entities involved</h4><div class="chip-row">${[...new Set(used.flatMap(f => (f.args || []).map(entityId)))].slice(0, 30).map(entityChip).join("")}</div></div>`;
  }

  function select(id) {
    state.selected = id;
    api.select(id);
    api.inspector.innerHTML = inspector();
    mark(id, "is-lineage");
    canvas.mark("is-selected", id ? [id] : []);
    canvas.dim(Boolean(id));
  }

  api.toolbar.addEventListener("click", e => {
    if (e.target.closest("#sc-sig")) {
      state.showSig = !state.showSig;
      e.target.closest("#sc-sig").setAttribute("aria-pressed", String(state.showSig));
      api.stage.classList.toggle("show-sig", state.showSig);
    }
  });
  api.toolbar.querySelector("#sc-search").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const q = e.target.value.trim().toLowerCase();
    const {kinds, relations} = state.model.dsl;
    const hit = Object.keys(relations).find(r => r.toLowerCase() === q) ? `r:${Object.keys(relations).find(r => r.toLowerCase() === q)}`
      : Object.keys(kinds).find(k => k.toLowerCase().includes(q)) ? `k:${Object.keys(kinds).find(k => k.toLowerCase().includes(q))}`
      : Object.keys(relations).find(r => r.toLowerCase().includes(q)) ? `r:${Object.keys(relations).find(r => r.toLowerCase().includes(q))}` : null;
    if (hit) { select(hit); canvas.focus(hit); }
  });

  return {
    update(model, {first}) {
      const firstTime = !state.model;
      state.model = model;
      if (!model.dsl) return;
      if (firstTime || first) { build(); api.inspector.innerHTML = inspector(); }
    },
    show(id) { if (id && state.model?.dsl) { select(id); requestAnimationFrame(() => canvas.focus(id)); } },
    destroy() { canvas.destroy(); },
  };
}
