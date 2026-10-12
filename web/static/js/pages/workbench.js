// Case workbench: summary header, phase strip and lazily mounted views.
import {CaseStore} from "../case/store.js";
import {PHASES} from "../case/model.js";
import {caseHref} from "../routes.js";
import {esc, number, statusBadge} from "../util.js";

const TABS = [
  {id: "trajectory", label: "Trajectory", load: () => import("../views/trajectory.js")},
  {id: "graph", label: "DSL Graph", load: () => import("../views/graph.js")},
  {id: "result", label: "Result", load: () => import("../views/result.js"), runOnly: true},
];

export function mountWorkbench(root, route) {
  const store = new CaseStore(route.ref);
  const views = new Map();
  let active = null;
  let currentRoute = route;

  root.innerHTML = `
    <section class="wb-head">
      <div class="wb-title">
        <div class="eyebrow" id="wb-kind">${store.kind === "run" ? "Debugger run" : "Compiled session"}</div>
        <h1 id="wb-task" class="wb-task">Loading…</h1>
        <div class="wb-badges" id="wb-badges"></div>
      </div>
      <dl class="wb-metrics" id="wb-metrics"></dl>
    </section>
    <ol class="phase-strip" id="phase-strip" aria-label="Debugger phases"></ol>
    <nav class="wb-tabs" role="tablist" aria-label="Workbench views">
      ${TABS.map(t => `<a role="tab" class="wb-tab" data-tab="${t.id}" href="${caseHref(route.ref, t.id)}">${t.label}</a>`).join("")}
      <span class="wb-tabs-fill"></span>
      <span class="wb-sync" id="wb-sync"></span>
    </nav>
    <div id="wb-views" class="wb-views"></div>`;
  const $ = id => root.querySelector("#" + id);

  function renderHeader(model) {
    const d = model.debugger;
    const result = d?.result;
    $("wb-task").textContent = model.task || model.trajectoryId || "—";
    $("wb-kind").textContent = `${store.kind === "run" ? "Debugger run" : "Compiled session"} · ${model.taskType || "—"}`;
    const status = store.live ? "running" : store.kind === "session" ? "compiled" : result?.status || "incomplete";
    $("wb-badges").innerHTML = [
      statusBadge(status, !store.live && result?.accepted),
      d?.manifest?.config?.model ? `<span class="badge">${esc(d.manifest.config.model)}</span>` : "",
      d?.manifest?.mode ? `<span class="badge">${esc(d.manifest.mode)}</span>` : "",
      `<span class="badge mono" title="trajectory id">${esc(model.trajectoryId || "")}</span>`,
    ].join("");
    const usage = d?.usage || {};
    const tokens = d ? (usage.input_tokens != null ? usage.input_tokens + (usage.output_tokens || 0)
      : (d.events.reduce((s, e) => s + (e.usage?.input_tokens || 0) + (e.usage?.output_tokens || 0), 0))) : null;
    const metrics = [
      ["Steps", model.steps.length], ["Facts", model.dsl?.facts.length ?? 0], ["Entities", Object.keys(model.dsl?.entities || {}).length],
      ...(d ? [["Events", d.events.length], ["Tokens", number(tokens)]] : [["Evaluations", model.evaluations.length]]),
    ];
    $("wb-metrics").innerHTML = metrics.map(([k, v]) => `<div><dt class="eyebrow">${k}</dt><dd>${v}</dd></div>`).join("");
    const strip = $("phase-strip");
    if (!d) { strip.hidden = true; return; }
    const reached = new Set(d.events.map(e => e.phase));
    const last = d.events[d.events.length - 1]?.phase;
    strip.innerHTML = PHASES.map(p => {
      const count = d.events.filter(e => e.phase === p).length;
      const state = store.live && p === last ? "is-current" : reached.has(p) ? "is-done" : "";
      return `<li class="phase-pill phase-${p} ${state}"><span class="phase-dot"></span><strong>${p}</strong><span class="phase-count">${count} events</span></li>`;
    }).join('<li class="phase-arrow" aria-hidden="true">→</li>');
  }

  function renderSync() {
    $("wb-sync").innerHTML = store.error ? `<span class="badge bad">${esc(store.error)}</span>`
      : store.live ? `<span class="badge live"><span class="live-dot"></span>Live · following writes</span>`
      : `<span class="sync-idle">Snapshot · ${new Date().toLocaleTimeString("en-GB")}</span>`;
  }

  async function show(routeNow) {
    currentRoute = routeNow;
    let tab = TABS.find(t => t.id === routeNow.tab) || TABS[0];
    if (tab.runOnly && store.kind !== "run") tab = TABS[0];
    root.querySelectorAll(".wb-tab").forEach(a => {
      const on = a.dataset.tab === tab.id;
      a.setAttribute("aria-selected", String(on));
      a.classList.toggle("is-active", on);
      const t = TABS.find(x => x.id === a.dataset.tab);
      a.hidden = Boolean(t.runOnly && store.kind !== "run");
    });
    if (!pending.has(tab.id)) pending.set(tab.id, mountView(tab));
    await pending.get(tab.id);
    if (currentRoute !== routeNow) return; // a newer navigation won
    active = tab.id;
    views.forEach((v, id) => { v.container.hidden = id !== active; });
    views.get(active).view.show?.(routeNow);
  }

  const pending = new Map();
  async function mountView(tab) {
    const container = document.createElement("section");
    container.className = `wb-view view-${tab.id}`;
    container.hidden = true;
    $("wb-views").append(container);
    const module = await tab.load();
    const view = module.createView(container, {store, ref: route.ref, navigate: (t, ...extra) => { location.hash = caseHref(route.ref, t, ...extra); }});
    views.set(tab.id, {container, view});
    if (store.model) view.update(store.model, {changed: new Set(["all"]), first: true});
  }

  store.on("change", ({changed, first}) => {
    renderHeader(store.model);
    renderSync();
    views.forEach(v => v.view.update(store.model, {changed, first}));
    if (first) show(currentRoute);
  });
  store.start().catch(error => {
    $("wb-views").innerHTML = `<div class="error-box">Could not load this case: ${esc(error.message)}</div>`;
  });

  return {
    update: show,
    unmount() { store.stop(); views.forEach(v => v.view.destroy?.()); },
  };
}
