// Composer: pick a benchmark trajectory and start a live run or a paced replay,
// or describe a custom task. Talks to web/launcher.py; one run at a time.
import {getCatalog, getLaunch, launchRun, stopRun} from "../api.js";
import {chatHref} from "../routes.js";
import {esc, short} from "../util.js";

const EFFORTS = ["none", "low", "high", "max"];
const MAX_OPTIONS = 80;

export function createComposer(root, {index, currentRef, onLaunched, onEnded}) {
  const state = {tab: "benchmark", catalog: null, catalogError: null, query: "", open: false, cursor: 0,
                 selected: null, mode: "online", source: "", launch: null, busy: false, error: null};
  root.innerHTML = `
    <div class="composer">
      <div class="composer-row">
        <div class="segmented" role="tablist" aria-label="Input">
          <button class="btn" data-ctab="benchmark" aria-pressed="true">Benchmark</button>
          <button class="btn" data-ctab="custom" aria-pressed="false">Custom task</button>
        </div>
        <span class="composer-status" id="cp-status" aria-live="polite"></span>
      </div>
      <div class="composer-pane" data-pane="benchmark">
        <div class="picker">
          <input id="cp-search" class="input" type="search" autocomplete="off" placeholder="Search benchmark trajectories by id, task or model…" aria-label="Benchmark trajectory" aria-expanded="false" aria-controls="cp-options">
          <ul id="cp-options" class="picker-options" role="listbox" hidden></ul>
        </div>
        <div class="composer-row" id="cp-selected"></div>
        <div class="composer-row">
          <div class="segmented" role="group" aria-label="Run mode">
            <button class="btn" data-mode="online" aria-pressed="true" title="Call the model through MAP → ROUTE → TRACE → SUBMIT">Live run</button>
            <button class="btn" data-mode="replay" aria-pressed="false" title="Re-play a finished run of this trajectory at a readable pace, without model calls">Replay</button>
          </div>
          <select id="cp-source" class="input" aria-label="Finished run to replay" hidden></select>
          <details class="composer-adv" id="cp-adv"><summary>Advanced</summary>
            <label>Model <input id="cp-model" class="input mono" type="text" spellcheck="false"></label>
            <label>Reasoning <select id="cp-effort" class="input"><option value="">default</option>${EFFORTS.map(e => `<option>${e}</option>`).join("")}</select></label>
            <label>Window <input id="cp-window" class="input" type="number" min="1" max="30" step="1"></label>
          </details>
          <span class="composer-fill"></span>
          <button class="btn primary composer-run" id="cp-run">Run ▶</button>
        </div>
      </div>
      <div class="composer-pane" data-pane="custom" hidden>
        <textarea id="cp-task" class="input composer-task" rows="3" placeholder="Describe the task the agent should accomplish…"></textarea>
        <div class="composer-row">
          <span class="muted composer-note">Custom tasks are not wired to the debugger yet; the request is sent but the launcher declines it.</span>
          <span class="composer-fill"></span>
          <button class="btn primary composer-run" id="cp-custom-run">Run ▶</button>
        </div>
      </div>
    </div>`;
  const $ = id => root.querySelector("#" + id);

  // ---------- catalog picker ----------
  const cases = () => state.catalog?.cases || [];
  function matches() {
    const q = state.query.toLowerCase();
    return cases().filter(c => !q || `${c.trajectory_id} ${c.task} ${c.llm_model} ${c.task_type}`.toLowerCase().includes(q));
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
        <span class="picker-top"><span class="mono">${esc(c.trajectory_id)}</span><span class="badge">${esc(c.task_type)}</span>${c.supported ? "" : '<span class="badge warn">unsupported</span>'}<span class="picker-steps">${esc(c.num_steps)} steps</span></span>
        ${c.task ? `<span class="picker-task">${esc(short(c.task, 140))}</span>` : ""}</li>`).join("")
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
    root.querySelectorAll("[data-ctab]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.ctab === state.tab)));
    root.querySelectorAll("[data-pane]").forEach(p => { p.hidden = p.dataset.pane !== state.tab; });
    root.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    const c = state.selected;
    $("cp-selected").innerHTML = c ? `<span class="picked"><span class="mono">${esc(c.trajectory_id)}</span><span class="badge">${esc(c.task_type)}</span><span class="badge">${esc(c.llm_model)}</span>
        ${c.task ? `<span class="picked-task">“${esc(short(c.task, 120))}”</span>` : ""}</span>`
      : `<span class="muted">No trajectory selected — ${state.catalog ? `${cases().filter(x => x.supported).length} of ${cases().length} are supported (ALFWorld, WebShop)` : "loading catalog…"}.</span>`;
    const sources = replaySources();
    if (!sources.some(s => s.group === state.source)) state.source = sources[0]?.group || "";
    const source = $("cp-source");
    source.hidden = state.mode !== "replay";
    source.innerHTML = sources.length ? sources.map(s => `<option value="${esc(s.group)}" ${s.group === state.source ? "selected" : ""}>${esc(s.group)} · ${esc(s.status)}</option>`).join("")
      : `<option value="">No finished run to replay</option>`;
    source.disabled = !sources.length;
    $("cp-adv").hidden = state.mode !== "online";
    const defaults = state.launch?.defaults || {};
    $("cp-model").placeholder = defaults.model || "model";
    $("cp-window").placeholder = defaults.window_size ?? 5;
    $("cp-effort").options[0].textContent = `default (${defaults.reasoning_effort || "provider"})`;
    renderStatus();
  }

  function renderStatus() {
    const active = state.launch?.active;
    const running = Boolean(active);
    const blocked = running || state.busy;
    $("cp-run").textContent = running ? "Stop ■" : "Run ▶";
    $("cp-run").classList.toggle("is-stop", running);
    $("cp-run").disabled = state.busy || (!running && (!state.selected || (state.mode === "replay" && !state.source)));
    $("cp-custom-run").disabled = blocked;
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
    const c = state.selected;
    if (!c) return;
    const config = {model: $("cp-model").value.trim() || undefined, reasoning_effort: $("cp-effort").value || undefined,
                    window_size: $("cp-window").value ? Number($("cp-window").value) : undefined};
    start(state.mode === "replay" ? {mode: "replay", trajectory_id: c.trajectory_id, source: [state.source, c.trajectory_id]}
      : {mode: "online", trajectory_id: c.trajectory_id, config});
  }

  root.addEventListener("click", event => {
    const b = event.target.closest("button, [data-tid]");
    if (!b) return;
    if (b.dataset.ctab) { state.tab = b.dataset.ctab; state.error = null; render(); }
    else if (b.dataset.mode) { state.mode = b.dataset.mode; render(); }
    else if (b.dataset.tid) select(b.dataset.tid);
    else if (b.id === "cp-run") run();
    else if (b.id === "cp-custom-run") start({mode: "custom", task: $("cp-task").value});
  });
  $("cp-source").addEventListener("change", e => { state.source = e.target.value; renderStatus(); });
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
  const outside = event => { if (state.open && !event.target.closest(".picker")) { state.open = false; renderOptions(); } };
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
