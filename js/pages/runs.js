// Runs list: every debugger run and compiled session, with live status polling.
import {getIndex} from "../api.js?v=27bf1baa85";
import {caseHref} from "../routes.js?v=27bf1baa85";
import {ago, debounce, esc, loader, statusBadge} from "../util.js?v=27bf1baa85";

const POLL_MS = 3000;
const DOMAINS = ["alfworld", "webshop", "chat"];

// Display-only parsing of ids such as GPT-4o_018_alfworld_task_018.
export function describeTrajectory(id) {
  const match = id.match(/^(.+?)_(\d{3})_/);
  const lower = id.toLowerCase();
  return {model: match ? match[1] : "", index: match ? match[2] : "",
          domain: DOMAINS.find(d => lower.includes(d)) || "other"};
}

const DOMAIN_ICON = {
  alfworld: '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>',
  webshop: '<path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6 5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  other: '<circle cx="12" cy="12" r="9"/>',
};
export const domainIcon = domain =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${DOMAIN_ICON[domain] || DOMAIN_ICON.other}</svg>`;

export function mountRuns(root, route) {
  const state = {sources: new Set(), statuses: new Set(), open: {source: true, status: true}, panelOpen: false, search: "", collapsed: new Set(), index: null, error: null,
                 focus: route.query.get("group")};
  root.innerHTML = `
    <section class="runs-hero">
      <div>
        <div class="eyebrow">The workbench</div>
        <h1 class="title-xl">Debug runs, <em>in focus</em>.</h1>
        <p class="lede">Follow MAP → ROUTE → TRACE → SUBMIT as it happens, inspect the compiled DSL as graphs, and compare every debugger decision with the original agent trajectory.</p>
      </div>
      <div class="runs-totals" id="runs-totals"></div>
    </section>
    <section class="runs-toolbar" aria-label="Filters">
      <input id="runs-search" class="input" type="search" placeholder="Filter trajectories…  ( / )" aria-label="Filter trajectories">
      <span class="runs-refresh" id="runs-refresh"></span>
    </section>
    <section class="filter-panel" id="runs-filters" aria-label="Filters"></section>
    <div id="runs-list" class="runs-list" aria-live="polite"></div>`;
  const $ = id => root.querySelector("#" + id);

  const matches = t => (!state.statuses.size || state.statuses.has(t.status)) &&
    (!state.search || t.id.toLowerCase().includes(state.search));

  const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>';
  const DASH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8"/></svg>';
  const box = mode => `<span class="cbox ${mode ? "is-on" : ""}">${mode === "all" ? CHECK : mode === "some" ? DASH : ""}</span>`;
  const fold = (open, attr) => `<button class="filter-fold" ${attr} aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"}"><svg viewBox="0 0 16 16" aria-hidden="true">${open ? '<path d="M4 8h8"/>' : '<path d="M4 8h8M8 4v8"/>'}</svg></button>`;

  // Parent rows are tri-state over their children; nothing ticked means no restriction.
  function filterGroup(kind, title, items, selected) {
    const picked = items.filter(i => selected.has(i.value)).length;
    const mode = picked === 0 ? "" : picked === items.length ? "all" : "some";
    const open = state.open[kind];
    return `<div class="filter-group">
      <div class="filter-parent">
        <button class="filter-check" data-all="${kind}" role="checkbox" aria-checked="${mode === "all" ? "true" : mode === "some" ? "mixed" : "false"}">${box(mode)}<span>${title}</span></button>
        ${fold(open, `data-fold="${kind}"`)}
      </div>
      <div class="filter-children" ${open ? "" : "hidden"}>
        ${items.map(i => `<button class="filter-check filter-child" data-${kind}="${esc(i.value)}" role="checkbox" aria-checked="${selected.has(i.value)}">${box(selected.has(i.value) ? "all" : "")}<span>${esc(i.label)}</span><span class="count">${i.count}</span></button>`).join("")}
      </div>
    </div>`;
  }

  function renderFilters(index) {
    const tally = key => index.groups.flatMap(g => g.trajectories.map(t => ({source: g.source, status: t.status})))
      .reduce((c, t) => { c[t[key]] = (c[t[key]] || 0) + 1; return c; }, {});
    const bySource = tally("source"), byStatus = tally("status");
    const sources = [["runs", "Debugger runs"], ["sessions", "Compiled sessions"]]
      .map(([value, label]) => ({value, label, count: bySource[value] || 0}));
    const statuses = Object.entries(byStatus).sort((a, b) => b[1] - a[1])
      .map(([value, n]) => ({value, label: value.replace("_", " "), count: n}));
    const active = state.sources.size + state.statuses.size;
    $("runs-filters").innerHTML = `
      <div class="filter-head">
        <h2>Filters${active ? ` <span class="count">${active}</span>` : ""}</h2>
        ${active ? `<button class="filter-clear" data-clear>Clear</button>` : ""}
        ${fold(state.panelOpen, "data-panel")}
      </div>
      <div class="filter-body" ${state.panelOpen ? "" : "hidden"}>
        ${filterGroup("source", "Source", sources, state.sources)}
        ${filterGroup("status", "Status", statuses, state.statuses)}
      </div>`;
  }

  function groupCard(g) {
    const shown = g.trajectories.filter(matches);
    if (!shown.length && (state.search || state.statuses.size)) return "";
    const key = `${g.source}/${g.id}`;
    const collapsed = state.collapsed.has(key);
    const counts = {};
    g.trajectories.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
    const bar = Object.entries(counts).map(([s, n]) =>
      `<span class="bar-seg status-${esc(s)}" style="flex:${n}" title="${esc(s)}: ${n}"></span>`).join("");
    const meta = [g.model && `<span class="badge">${esc(g.model)}</span>`, g.mode && `<span class="badge">${esc(g.mode)}</span>`,
                  g.policy && `<span class="badge mono" title="submission policy">${esc(g.policy)}</span>`].filter(Boolean).join("");
    return `<article class="group-card ${g.live ? "is-live" : ""} ${state.focus === g.id ? "is-focus" : ""}" data-group="${esc(key)}">
      <button class="group-head" data-toggle="${esc(key)}" aria-expanded="${!collapsed}">
        <span class="chevron" aria-hidden="true">${collapsed ? "▸" : "▾"}</span>
        <span class="group-kind eyebrow">${g.source === "sessions" ? "Compiled session" : "Debugger run"}</span>
        <span class="group-id mono">${esc(g.id)}</span>
        ${g.live ? statusBadge("running") : ""}
        <span class="group-meta">${meta}</span>
        <span class="group-when">${g.created_at ? esc(new Date(g.created_at).toLocaleString("en-CA", {hour12: false})) : ago(g.mtime)}</span>
      </button>
      <div class="status-bar" aria-hidden="true">${bar}</div>
      <div class="traj-grid" ${collapsed ? "hidden" : ""}>
        ${shown.map(t => trajectoryTile(g, t)).join("") || `<p class="empty">No trajectories.</p>`}
      </div>
    </article>`;
  }

  function trajectoryTile(g, t) {
    const d = describeTrajectory(t.id);
    return `<a class="traj-tile ${t.live ? "is-live" : ""}" href="${caseHref([g.source, g.id, t.id])}" title="${esc(t.id)}">
      <span class="tile-top"><span class="tile-index mono">${esc(d.index || "—")}</span>${statusBadge(t.status)}</span>
      <span class="tile-domain">${domainIcon(d.domain)}<strong>${esc(d.domain)}</strong></span>
      <span class="tile-model">${esc(d.model || t.id)}</span>
      <span class="tile-id mono">${esc(t.id)}</span>
      <span class="tile-when">updated ${ago(t.mtime)}</span>
    </a>`;
  }

  function render() {
    const index = state.index;
    if (state.error && !index) { $("runs-list").innerHTML = `<div class="error-box">Cannot reach the workbench server: ${esc(state.error)}</div>`; return; }
    if (!index) { $("runs-list").innerHTML = loader("Loading runs…"); return; }
    const groups = index.groups.filter(g => !state.sources.size || state.sources.has(g.source));
    renderFilters(index);
    const trajectories = index.groups.flatMap(g => g.trajectories);
    $("runs-totals").innerHTML = [
      ["Runs", index.groups.filter(g => g.source === "runs").length],
      ["Sessions", index.groups.filter(g => g.source === "sessions").length],
      ["Trajectories", trajectories.length],
      ["Live", trajectories.filter(t => t.live).length],
    ].map(([k, v]) => `<div class="total"><span class="eyebrow">${k}</span><strong>${v}</strong></div>`).join("");
    const html = groups.map(groupCard).join("");
    $("runs-list").innerHTML = html || `<p class="empty">No runs match. Start one with <code>python -m prodebugger.run_experiment …</code>; it appears here automatically.</p>`;
    $("runs-refresh").innerHTML = state.error ? `<span class="badge bad">offline</span>` : `auto-refresh · ${new Date(index.generated_at * 1000).toLocaleTimeString("en-GB")}`;
    if (state.focus) {
      root.querySelector(".group-card.is-focus")?.scrollIntoView({block: "start", behavior: "smooth"});
      state.focus = null;
    }
  }

  let signature = "";
  async function refresh() {
    try {
      const index = await getIndex();
      const next = JSON.stringify(index.groups);
      state.index = index; state.error = null;
      // Unchanged data keeps the DOM (and hover/focus) as is; only the clock moves.
      if (next === signature) {
        $("runs-refresh").textContent = `auto-refresh · ${new Date(index.generated_at * 1000).toLocaleTimeString("en-GB")}`;
        return;
      }
      signature = next;
    } catch (error) { state.error = error.message; signature = ""; }
    render();
  }

  root.addEventListener("click", event => {
    const b = event.target.closest("button");
    if (!b) return;
    const flip = (set, v) => set.has(v) ? set.delete(v) : set.add(v);
    const values = kind => [...root.querySelectorAll(`.filter-child[data-${kind}]`)].map(x => x.dataset[kind]);
    if (b.dataset.source) flip(state.sources, b.dataset.source);
    else if (b.dataset.status) flip(state.statuses, b.dataset.status);
    else if (b.dataset.all) {
      const set = b.dataset.all === "source" ? state.sources : state.statuses;
      const all = values(b.dataset.all);
      all.every(v => set.has(v)) ? set.clear() : all.forEach(v => set.add(v));
    } else if (b.dataset.fold) state.open[b.dataset.fold] = !state.open[b.dataset.fold];
    else if (b.hasAttribute("data-panel")) state.panelOpen = !state.panelOpen;
    else if (b.hasAttribute("data-clear")) { state.sources.clear(); state.statuses.clear(); }
    else if (b.dataset.toggle) {
      const k = b.dataset.toggle;
      state.collapsed.has(k) ? state.collapsed.delete(k) : state.collapsed.add(k);
    } else return;
    render();
  });
  $("runs-search").addEventListener("input", debounce(e => { state.search = e.target.value.trim().toLowerCase(); render(); }));
  const onKey = e => {
    if (e.key === "/" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); $("runs-search").focus(); }
  };
  document.addEventListener("keydown", onKey);
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  refresh();
  return {unmount() { clearInterval(timer); document.removeEventListener("keydown", onKey); }};
}
