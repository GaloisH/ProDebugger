// Composer: pick a benchmark trajectory and start a live run or a paced replay,
// or describe a custom task. Talks to web/launcher.py; one run at a time. The static
// project site only replays its recorded example runs.
import {STATIC, getCatalog, getLaunch, launchRun, stopRun} from "../api.js?v=50f8681a13";
import {chatHref} from "../routes.js?v=50f8681a13";
import {esc, short} from "../util.js?v=50f8681a13";

const EFFORTS = ["none", "low", "high", "max"];
const MAX_OPTIONS = 80;

const svg = body => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  chevron: '<svg class="icon chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  benchmark: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
  custom: svg('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  live: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>'),
  replay: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5Z" fill="currentColor"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>'),
};
const LABEL = {benchmark: "Benchmark", custom: "Custom task", online: "Live run", replay: "Replay"};
const menuItem = (kind, value, icon, title, sub) => `<button class="menu-item" role="menuitemradio" data-pick="${kind}" data-val="${value}">${icon}<span><strong>${title}</strong><small>${sub}</small></span></button>`;

export function createComposer(root, {index, currentRef, onLaunched, onEnded}) {
  const state = {tab: "benchmark", catalog: null, catalogError: null, query: "", open: false, cursor: 0,
                 selected: null, mode: STATIC ? "replay" : "online", source: "", menu: null, launch: null, busy: false, error: null};
  root.innerHTML = `
    <div class="composer">
      <div class="composer-box">
        <div class="composer-pane" data-pane="benchmark">
          <div class="picker">
            <input id="cp-search" class="input" type="search" autocomplete="off" placeholder="Search benchmark trajectories by id, model or type…" aria-label="Benchmark trajectory" aria-expanded="false" aria-controls="cp-options">
            <ul id="cp-options" class="picker-options" role="listbox" hidden></ul>
          </div>
        </div>
        <div class="composer-pane" data-pane="custom" hidden>
          <textarea id="cp-task" class="input composer-task" rows="3" placeholder="Describe the task the agent should accomplish…"></textarea>
          <span class="muted composer-note">Custom tasks are not wired to the debugger yet; the request is sent but the launcher declines it.</span>
        </div>
        <div class="composer-bar">
          <div class="chip-wrap" id="cp-adv-wrap">
            <button class="chip chip-icon" data-menu="adv" aria-haspopup="true" aria-expanded="false" title="Run settings" aria-label="Run settings">${ICON.plus}</button>
            <div class="menu menu-adv" id="cp-menu-adv" hidden>
              <label>Model <input id="cp-model" class="input mono" type="text" spellcheck="false"></label>
              <label>Reasoning <select id="cp-effort" class="input"><option value="">default</option>${EFFORTS.map(e => `<option>${e}</option>`).join("")}</select></label>
            </div>
          </div>
          <div class="chip-wrap" id="cp-tab-wrap">
            <button class="chip" data-menu="tab" aria-haspopup="true" aria-expanded="false" title="Input"><span id="cp-tab-label"></span>${ICON.chevron}</button>
            <div class="menu" id="cp-menu-tab" role="menu" hidden>
              ${menuItem("tab", "benchmark", ICON.benchmark, "Benchmark", "Pick a trajectory from the dataset")}
              ${menuItem("tab", "custom", ICON.custom, "Custom task", "Describe a task yourself")}
            </div>
          </div>
          <div class="chip-wrap" id="cp-mode-wrap">
            <button class="chip" data-menu="mode" aria-haspopup="true" aria-expanded="false" title="Run mode"><span id="cp-mode-label"></span>${ICON.chevron}</button>
            <div class="menu" id="cp-menu-mode" role="menu" hidden>
              ${menuItem("mode", "online", ICON.live, "Live run", "Call the model through MAP → ROUTE → TRACE → SUBMIT")}
              ${menuItem("mode", "replay", ICON.replay, "Replay", "Re-play a finished run at a readable pace, no model calls")}
            </div>
          </div>
          <div class="chip-wrap" id="cp-source-wrap">
            <button class="chip" id="cp-source-chip" data-menu="source" aria-haspopup="true" aria-expanded="false" title="Finished run to replay"><span id="cp-source-label"></span>${ICON.chevron}</button>
            <div class="menu menu-wide" id="cp-menu-source" role="menu" hidden></div>
          </div>
          <span class="composer-status" id="cp-status" aria-live="polite"></span>
          <button class="composer-run" id="cp-run" aria-label="Run" title="Run"></button>
        </div>
      </div>
      <div class="composer-row composer-picked" id="cp-selected"></div>
    </div>`;
  const $ = id => root.querySelector("#" + id);

  // ---------- catalog picker ----------
  const cases = () => state.catalog?.cases || [];
  function matches() {
    const q = state.query.toLowerCase();
    return cases().filter(c => !q || `${c.trajectory_id} ${c.llm_model} ${c.task_type}`.toLowerCase().includes(q));
  }

  function renderOptions() {
    const list = $("cp-options");
    list.hidden = !state.open;
    $("cp-search").setAttribute("aria-expanded", String(state.open));
    if (!state.open) return;
    if (state.catalogError) { list.innerHTML = `<li class="picker-note">${esc(state.catalogError)}</li>`; return; }
    if (!state.catalog) { list.innerHTML = `<li class="picker-note">Loading benchmark catalog…</li>`; return; }
    const found = matches();
    state.cursor = Math.min(state.cursor, Math.max(0, found.length - 1));
    list.innerHTML = found.slice(0, MAX_OPTIONS).map((c, i) => `<li role="option" class="picker-option ${i === state.cursor ? "is-cursor" : ""} ${c.supported ? "" : "is-disabled"}"
        data-tid="${esc(c.trajectory_id)}" aria-selected="${state.selected?.trajectory_id === c.trajectory_id}" aria-disabled="${!c.supported}">
        <span class="picker-top"><span class="mono">${esc(c.trajectory_id)}</span><span class="badge">${esc(c.task_type)}</span>${c.supported ? "" : '<span class="badge warn">unsupported</span>'}<span class="picker-steps">${esc(c.num_steps)} steps</span></span></li>`).join("")
      + (found.length > MAX_OPTIONS ? `<li class="picker-note">${found.length - MAX_OPTIONS} more — refine the search</li>` : "")
      || `<li class="picker-note">No trajectory matches.</li>`;
    list.querySelector(".is-cursor")?.scrollIntoView({block: "nearest"});
  }

  function select(tid) {
    const c = cases().find(x => x.trajectory_id === tid);
    if (!c || !c.supported) return;
    state.selected = c;
    state.open = false;
    state.query = "";
    $("cp-search").value = "";
    state.source = "";
    render();
    renderOptions();
  }

  // Finished runs of the selected trajectory that a replay can copy (not replays themselves;
  // web/simulate_live.py names its runs <timestamp>-replay).
  function replaySources() {
    const tid = state.selected?.trajectory_id;
    if (!tid) return [];
    return (index()?.groups || []).filter(g => g.source === "runs" && g.chat?.mode !== "replay" && !g.id.endsWith("-replay")).flatMap(g =>
      g.trajectories.filter(t => t.id === tid && !t.live && !["incomplete", "dry_run", "running"].includes(t.status))
        .map(t => ({group: g.id, status: t.status, mtime: t.mtime})))
      .sort((a, b) => b.mtime - a.mtime);
  }

  // ---------- render ----------
  function render() {
    root.querySelectorAll("[data-pane]").forEach(p => { p.hidden = p.dataset.pane !== state.tab; });
    const benchmark = state.tab === "benchmark", replay = state.mode === "replay";
    $("cp-tab-label").textContent = LABEL[state.tab];
    $("cp-mode-label").textContent = LABEL[state.mode];
    $("cp-tab-wrap").hidden = STATIC;
    $("cp-mode-wrap").hidden = !benchmark || STATIC;
    $("cp-adv-wrap").hidden = !benchmark || replay;
    $("cp-source-wrap").hidden = !benchmark || !replay;
    root.querySelectorAll("[data-pick]").forEach(b => {
      const current = b.dataset.pick === "tab" ? state.tab : b.dataset.pick === "mode" ? state.mode : state.source;
      b.setAttribute("aria-checked", String(b.dataset.val === current));
    });
    const c = state.selected;
    $("cp-selected").innerHTML = c ? `<span class="picked"><span class="mono">${esc(c.trajectory_id)}</span><span class="badge">${esc(c.task_type)}</span><span class="badge">${esc(c.llm_model)}</span></span>`
      : `<span class="muted">No trajectory selected — ${state.catalog ? `${cases().filter(x => x.supported).length} of ${cases().length} are supported (ALFWorld, WebShop)` : "loading catalog…"}.</span>`;
    const sources = replaySources();
    if (!sources.some(s => s.group === state.source)) state.source = sources[0]?.group || "";
    $("cp-source-label").textContent = state.source || "No finished run";
    $("cp-source-chip").disabled = !sources.length;
    $("cp-menu-source").innerHTML = sources.map(s => `<button class="menu-item" role="menuitemradio" data-pick="source" data-val="${esc(s.group)}" aria-checked="${s.group === state.source}"><span><strong class="mono">${esc(s.group)}</strong><small>${esc(s.status)} · finished run</small></span></button>`).join("");
    const defaults = state.launch?.defaults || {};
    $("cp-model").placeholder = defaults.model || "model";
    $("cp-effort").options[0].textContent = `default (${defaults.reasoning_effort || "provider"})`;
    for (const name of ["adv", "tab", "mode", "source"]) {
      root.querySelector(`[data-menu="${name}"]`).setAttribute("aria-expanded", String(state.menu === name));
      $("cp-menu-" + name).hidden = state.menu !== name;
    }
    renderStatus();
  }

  function renderStatus() {
    const active = state.launch?.active;
    const running = Boolean(active);
    const label = running ? "Stop" : "Run";
    $("cp-run").innerHTML = running ? ICON.stop : ICON.play;
    $("cp-run").title = label;
    $("cp-run").setAttribute("aria-label", label);
    $("cp-run").classList.toggle("is-stop", running);
    $("cp-run").disabled = state.busy || (!running && (state.tab === "custom" ? false : !state.selected || (state.mode === "replay" && !state.source)));
    $("cp-status").innerHTML = state.error ? `<span class="badge bad" title="${esc(state.error)}">${esc(short(state.error, 90))}</span>`
      : running ? `<a class="badge live" href="${chatHref(active.run_id, active.trajectory_id)}"><span class="live-dot"></span>${active.mode === "replay" ? "Replaying" : "Running"} ${esc(active.trajectory_id)}</a>`
      : "";
  }

  // ---------- actions ----------
  async function start(spec) {
    state.busy = true; state.error = null; renderStatus();
    try {
      const {run} = await launchRun(spec);
      state.launch = {...state.launch, active: run};
      onLaunched(run);
    } catch (error) { state.error = error.message; }
    state.busy = false;
    render();
    poll();
  }

  async function run() {
    if (state.launch?.active) {
      state.busy = true; renderStatus();
      try { await stopRun(); } catch (error) { state.error = error.message; }
      state.busy = false;
      poll();
      return;
    }
    if (state.tab === "custom") { start({mode: "custom", task: $("cp-task").value}); return; }
    const c = state.selected;
    if (!c) return;
    const config = {model: $("cp-model").value.trim() || undefined, reasoning_effort: $("cp-effort").value || undefined};
    start(state.mode === "replay" ? {mode: "replay", trajectory_id: c.trajectory_id, source: [state.source, c.trajectory_id]}
      : {mode: "online", trajectory_id: c.trajectory_id, config});
  }

  function pick(kind, value) {
    if (kind === "tab") { state.tab = value; state.error = null; }
    else if (kind === "mode") state.mode = value;
    else state.source = value;
    state.menu = null;
    render();
  }

  root.addEventListener("click", event => {
    const b = event.target.closest("button, [data-tid]");
    if (!b) return;
    if (b.dataset.menu) { state.menu = state.menu === b.dataset.menu ? null : b.dataset.menu; render(); }
    else if (b.dataset.pick) pick(b.dataset.pick, b.dataset.val);
    else if (b.dataset.tid) select(b.dataset.tid);
    else if (b.id === "cp-run") run();
  });
  const search = $("cp-search");
  search.addEventListener("focus", () => { state.open = true; renderOptions(); });
  search.addEventListener("input", () => { state.query = search.value.trim(); state.open = true; state.cursor = 0; renderOptions(); });
  search.addEventListener("keydown", event => {
    const found = matches().slice(0, MAX_OPTIONS);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      state.open = true;
      state.cursor = Math.max(0, Math.min(found.length - 1, state.cursor + (event.key === "ArrowDown" ? 1 : -1)));
      renderOptions();
    } else if (event.key === "Enter" && state.open && found[state.cursor]) {
      event.preventDefault();
      select(found[state.cursor].trajectory_id);
    } else if (event.key === "Escape") { state.open = false; renderOptions(); }
  });
  root.addEventListener("keydown", event => { if (event.key === "Escape" && state.menu) { state.menu = null; render(); } });
  const outside = event => {
    if (state.open && !event.target.closest(".picker")) { state.open = false; renderOptions(); }
    if (state.menu && !event.target.closest(".chip-wrap")) { state.menu = null; render(); }
  };
  document.addEventListener("pointerdown", outside);

  // ---------- polling ----------
  let timer = null;
  async function poll() {
    clearTimeout(timer);
    try {
      const was = state.launch?.active?.run_id;
      state.launch = await getLaunch();
      if (was && !state.launch.active) { render(); onEnded(); } // buttons and replay sources change
    } catch { /* server restarting; keep the last state */ }
    renderStatus();
    timer = setTimeout(poll, state.launch?.active ? 1500 : 5000);
  }

  // Opening a conversation preselects its trajectory, once per conversation.
  let lastRef = "";
  function follow() {
    const ref = currentRef();
    const key = ref ? ref.join("/") : "";
    if (!state.catalog || key === lastRef) return false;
    lastRef = key;
    if (ref) select(ref[2]);
    return Boolean(ref);
  }

  getCatalog().then(value => {
    state.catalog = value;
    state.catalogError = value.error || null;
    if (!follow()) render();
    renderOptions();
  }).catch(error => { state.catalogError = error.message; renderOptions(); });
  render();
  poll();

  return {
    // New index (replay sources) or a different conversation.
    update() { if (!follow()) render(); },
    active: () => state.launch?.active || null,
    destroy() { clearTimeout(timer); document.removeEventListener("pointerdown", outside); },
  };
}
