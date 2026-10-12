// Runs list: every debugger run and compiled session, with live status polling.
import {getIndex} from "../api.js";
import {caseHref} from "../routes.js";
import {ago, debounce, esc, statusBadge} from "../util.js";

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
  const state = {source: "all", status: "all", search: "", collapsed: new Set(), index: null, error: null,
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
      <div class="segmented" id="runs-source" role="group" aria-label="Source">
        ${["all", "runs", "sessions"].map(s => `<button class="btn" data-source="${s}" aria-pressed="${s === "all"}">${s === "all" ? "All" : s === "runs" ? "Debugger runs" : "Compiled sessions"}</button>`).join("")}
      </div>
      <div class="segmented" id="runs-status" role="group" aria-label="Status"></div>
      <span class="runs-refresh" id="runs-refresh"></span>
    </section>
    <div id="runs-list" class="runs-list" aria-live="polite"></div>`;
  const $ = id => root.querySelector("#" + id);

  const matches = t => (state.status === "all" || t.status === state.status) &&
    (!state.search || t.id.toLowerCase().includes(state.search));

  function renderStatusFilter(groups) {
    const counts = {};
    groups.forEach(g => g.trajectories.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; }));
    const all = Object.values(counts).reduce((a, b) => a + b, 0);
    $("runs-status").innerHTML = [["all", all], ...Object.entries(counts).sort((a, b) => b[1] - a[1])]
      .map(([s, n]) => `<button class="btn" data-status="${esc(s)}" aria-pressed="${s === state.status}">${s === "all" ? "Any status" : esc(s.replace("_", " "))} <span class="count">${n}</span></button>`).join("");
  }

  function groupCard(g) {
    const shown = g.trajectories.filter(matches);
    if (!shown.length && (state.search || state.status !== "all")) return "";
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
    if (!index) { $("runs-list").innerHTML = `<p class="empty">Loading runs…</p>`; return; }
    const groups = index.groups.filter(g => state.source === "all" || g.source === state.source);
    renderStatusFilter(groups);
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
    if (b.dataset.source) {
      state.source = b.dataset.source;
      root.querySelectorAll("[data-source]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    } else if (b.dataset.status) state.status = b.dataset.status;
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
