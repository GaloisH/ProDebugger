// DSL Graph tab: a switcher of graph subviews, each with its own canvas, toolbar and inspector.
import {createCanvas} from "../graph/engine.js?v=50f8681a13";
import {esc} from "../util.js?v=50f8681a13";

const SUBVIEWS = [
  {id: "facts", label: "Fact dependencies", hint: "Facts by step and side; edges follow basis.", load: () => import("../graph/facts.js?v=50f8681a13"),
   count: m => m.dsl?.facts.length},
  {id: "entities", label: "Entities & relations", hint: "World state at a chosen step.", load: () => import("../graph/entities.js?v=50f8681a13"),
   count: m => Object.keys(m.dsl?.entities || {}).length},
  {id: "schema", label: "Schema", hint: "Kind hierarchy and relation signatures.", load: () => import("../graph/schema.js?v=50f8681a13"),
   count: m => Object.keys(m.dsl?.kinds || {}).length},
  {id: "goals", label: "Goals & requirements", hint: "Task → requirement → constraint → evidence.", load: () => import("../graph/goals.js?v=50f8681a13"),
   count: m => m.dsl?.goals.length},
  {id: "rules", label: "Rules → evidence → facts", hint: "Abstract rule evaluations and the facts they cite.", load: () => import("../graph/rules.js?v=50f8681a13"),
   count: m => m.evaluations.length},
];

export function createView(root, ctx) {
  root.innerHTML = `
    <div class="graph-layout">
      <nav class="graph-nav" aria-label="Graph views">
        <div class="eyebrow">DSL structure</div>
        ${SUBVIEWS.map(s => `<button class="graph-nav-item" data-sub="${s.id}"><strong>${esc(s.label)}</strong><span class="graph-nav-count" data-count="${s.id}"></span><small>${esc(s.hint)}</small></button>`).join("")}
      </nav>
      <section class="graph-main" id="g-main"></section>
      <aside class="graph-inspector" id="g-inspector" aria-live="polite"></aside>
    </div>`;
  const main = root.querySelector("#g-main"), inspectorRoot = root.querySelector("#g-inspector");
  const mounted = new Map(), pending = new Map();
  let model = null, active = null, wanted = null;

  async function mount(def) {
    const box = document.createElement("div");
    box.className = `graph-sub sub-${def.id}`;
    box.innerHTML = `<div class="graph-toolbar"></div><div class="graph-stage"></div><div class="graph-legend"></div>`;
    box.hidden = true;
    main.append(box);
    const inspector = document.createElement("div");
    inspector.hidden = true;
    inspectorRoot.append(inspector);
    const module = await def.load();
    const api = {
      ctx, store: ctx.store,
      toolbar: box.querySelector(".graph-toolbar"), legend: box.querySelector(".graph-legend"), inspector,
      stage: box.querySelector(".graph-stage"),
      canvas: null,
      // Keeps the URL in sync so selections are shareable and survive reloads (not when embedded).
      select: id => ctx.embedded || history.replaceState(null, "", `#/case/${ctx.ref.map(encodeURIComponent).join("/")}/graph/${def.id}${id != null ? "/" + encodeURIComponent(id) : ""}`),
      goto: (sub, id) => ctx.navigate("graph", sub, id),
    };
    const sub = module.createSubview(api, createCanvas);
    mounted.set(def.id, {box, inspector, sub});
    if (model) sub.update(model, {changed: new Set(["all"]), first: true});
  }

  async function show(id, extra) {
    const def = SUBVIEWS.find(s => s.id === id) || SUBVIEWS[0];
    wanted = def.id;
    root.querySelectorAll(".graph-nav-item").forEach(b => b.setAttribute("aria-current", String(b.dataset.sub === def.id)));
    if (!pending.has(def.id)) pending.set(def.id, mount(def));
    await pending.get(def.id);
    if (wanted !== def.id) return;
    active = def.id;
    mounted.forEach((m, key) => { m.box.hidden = key !== active; m.inspector.hidden = key !== active; });
    mounted.get(active).sub.show?.(extra);
  }

  root.querySelector(".graph-nav").addEventListener("click", e => {
    const b = e.target.closest("[data-sub]");
    if (b) ctx.navigate("graph", b.dataset.sub);
  });

  return {
    update(next, info) {
      model = next;
      SUBVIEWS.forEach(s => { const el = root.querySelector(`[data-count="${s.id}"]`); if (el) el.textContent = s.count(next) ?? "—"; });
      mounted.forEach(m => m.sub.update(next, info));
    },
    show(route) { show(route.extra[0], route.extra[1]); },
    destroy() { mounted.forEach(m => m.sub.destroy?.()); },
  };
}
