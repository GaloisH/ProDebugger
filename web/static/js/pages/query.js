// #/query[/<group>/<trajectory>]: the Query Graph. The DSL record is one dense core; every
// debugger access (a ROUTE view, a window, a TRACE lane's SQL) is a point cloud on a tier
// above it, ending in the root. Click a cloud to open it by entity, an entity to read its facts.
import {esc, short, loader} from "../util.js";
import {caseHref, queryHref} from "../routes.js";
import {loadQueryScene, factRepr, SLOT_LABEL} from "../query/model.js";
import {agentWords} from "../query/narrate.js";
import {buildClusters, chainOf, factLabel, journeyOf, roleFacts} from "../query/clusters.js";
import {layoutClusters, TIERS} from "../query/layout.js";
import {createStage, clusterTitle} from "../query/stage.js";
import {createTour, eventDuration} from "../query/tour.js";

const GROUP = "evidence-query-claims-n30-20261013";
// Cases the page is tuned on: one window/lane, two windows/lanes, and a large WebShop record.
const CASES = [
  {ref: [GROUP, "GPT-4o_013_alfworld_task_013"], label: "ALFWorld 013 · 1 lane"},
  {ref: [GROUP, "GPT-4o_024_alfworld_task_024"], label: "ALFWorld 024 · 2 lanes"},
  {ref: [GROUP, "GPT-4o_003_chat_b000_t00_e02-1e119842"], label: "WebShop 003 · 3 candidates"},
];
export const DEFAULT_CASE = CASES[0].ref;
const PHASES = ["PARSE", "MAP", "ROUTE", "MANAGER", "TRACE", "SUBMIT"];
// Overview camera presets: the whole tower from the front, from above, from the side. The stage
// fits distance and target to the canvas; these give the angle.
const OVERVIEW_CAM = {
  front: {fit: true, target: [0, 7, 0], yaw: 0.55, pitch: 0.32, dist: 56},
  top: {fit: true, target: [0, 7, 0], yaw: 0.55, pitch: 1.42, dist: 56},
  side: {fit: true, target: [0, 7, 0], yaw: 0.55 + Math.PI / 2, pitch: 0.08, dist: 56},
};
const PHASE_NOTE = {
  PARSE: "compile the log into the DSL", MAP: "read the task contract", ROUTE: "query the record, open suspect windows",
  MANAGER: "assign one question per window", TRACE: "test each window with SQL", SUBMIT: "name the root cause",
};

export function mountQuery(app, route) {
  const ref = ["runs", ...(route.ref || DEFAULT_CASE)];
  app.innerHTML = `<div class="qg">${loader("Building the query graph…")}</div>`;
  const root = app.firstElementChild;
  let stage = null, keyHandler = null, destroyed = false;

  loadQueryScene(ref).then(scene => {
    if (destroyed) return;
    const model = buildClusters(scene);
    const layout = layoutClusters(model);
    const roles = roleFacts(model.clusters);
    root.innerHTML = template(scene, model, ref, roles);
    stage = createStage(root.querySelector(".qg-canvas"), scene, model, layout);
    const frameAt = createTour(scene, model, layout);
    const last = scene.events.length - 1;
    // Tour plays the calls in order; Overview shows every cloud at once for free exploration.
    const state = {i: 0, p: 0, playing: true, speed: 1, mode: "tour", view: "front", chain: null,
                   filter: {phases: new Set()}};
    const ui = bindUi(root, scene, model, stage, roles);
    ui.setEvent(state.i);

    stage.start(dt => {
      const overview = state.mode === "overview";
      if (!overview && state.playing) {
        state.p += dt * state.speed / eventDuration(scene.events[state.i]);
        if (state.p >= 1) {
          if (state.i < last) { state.i++; state.p = 0; ui.setEvent(state.i); }
          else { state.p = 1; setPlaying(false); }
        }
      }
      if (!overview) ui.setProgress(state.i, state.p);
      const out = overview ? frameAt(last, 1) : frameAt(state.i, state.p);
      Object.assign(out.frame, {chain: state.chain, filter: state.filter, labelAll: overview});
      if (overview) { out.frame.focus = new Set(); out.camera = OVERVIEW_CAM[state.view]; }
      return out;
    });

    const setMode = mode => {
      state.mode = mode;
      history.replaceState(null, "", location.hash.split("?")[0] + (mode === "overview" ? "?mode=overview" : ""));
      stage.follow();
      stage.release();
      state.chain = null;
      ui.setMode(mode, state.view);
      if (mode === "overview") setPlaying(false);
      else { go(0); setPlaying(true); }
    };

    const setPlaying = on => { state.playing = on; ui.setPlaying(on); };
    const go = (i, p = 0) => { state.i = Math.max(0, Math.min(scene.events.length - 1, i)); state.p = p; ui.setEvent(state.i); };
    const toggle = () => {
      if (!state.playing && state.i === scene.events.length - 1 && state.p >= 1) go(0);
      if (!state.playing && stage.view.cluster) stage.follow();
      setPlaying(!state.playing);
    };
    ui.on("play", toggle);
    ui.on("step", d => go(state.i + d));
    // In Overview the timeline and the phase bar pick a cloud instead of moving the playhead.
    const pick = i => stage.select(scene.events[i].cluster || "core");
    ui.on("seek", i => state.mode === "overview" ? pick(i) : go(i, 0.5));
    ui.on("phase", ph => {
      const i = scene.events.findIndex(e => e.phase === ph);
      if (i >= 0) state.mode === "overview" ? pick(i) : go(i);
    });
    ui.on("mode", setMode);
    ui.on("view", v => { state.view = v; stage.release(); ui.setMode(state.mode, v); });
    ui.on("filterPhase", ph => { state.filter.phases.has(ph) ? state.filter.phases.delete(ph) : state.filter.phases.add(ph); ui.setFilter(state.filter); });
    // A role row (or a fact's "follow its journey") draws one fact's way to its verdict; that
    // needs every cloud on screen, so the tour gives way to the overview first.
    const follow = (role, fid) => {
      if (state.mode !== "overview") setMode("overview");
      stage.setJourney(journeyOf(scene, model, fid ?? roles.byRole.get(role)[0]));
      ui.showJourney(role);
    };
    // The legend row toggles; the panel's role tabs only switch.
    ui.on("journeyRole", (role, tab) => !tab && stage.journey && ui.journeyRole === role ? stage.setJourney(null) : follow(role));
    ui.on("journeyFact", (fid, role) => follow(role || roles.reach(fid), fid));
    stage.on("journey", j => ui.journey(j));
    ui.on("speed", s => { state.speed = s; });
    ui.on("follow", () => { stage.follow(); stage.release(); });
    ui.on("jump", i => { stage.follow(); go(i, 0.5); setPlaying(false); });
    stage.on("select", sel => {
      if (sel) setPlaying(false);
      state.chain = sel?.cluster && sel.cluster.id !== "core" ? chainOf(model, sel.cluster.id) : null;
      ui.inspect(sel);
    });
    stage.on("manual", () => ui.syncFollow());
    stage.on("view", () => ui.syncFollow());
    stage.on("hover", h => ui.hover(h));
    keyHandler = e => {
      if (e.target.closest("input, textarea, select")) return;
      const j = stage.journey;
      if (j && !stage.view.cluster && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        const k = j.focus == null ? (e.key === "ArrowRight" ? 0 : j.stops.length - 1) : j.focus + (e.key === "ArrowRight" ? 1 : -1);
        stage.focusStop(k < 0 || k >= j.stops.length ? null : k);
      } else if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") go(state.i + 1);
      else if (e.key === "ArrowLeft") go(state.i - 1);
      else if (e.key === "Escape") stage.back();
    };
    document.addEventListener("keydown", keyHandler);
    if (route.query?.get("mode") === "overview") setMode("overview");
  }).catch(error => {
    if (destroyed) return;
    root.innerHTML = `<div class="qg-error"><h2>Could not build the query graph</h2><p>${esc(error.message)}</p>
      <p>Open a run from <a href="#/runs">Runs</a>, or use <code>${esc(queryHref(DEFAULT_CASE))}</code>.</p></div>`;
  });

  return {
    unmount() {
      destroyed = true;
      stage?.destroy();
      if (keyHandler) document.removeEventListener("keydown", keyHandler);
    },
  };
}

// The three roles a fact can earn, as the legend and the journey panel name them.
const ROLE_ROWS = [
  {role: "issue", label: "clue in a suspect window", tab: "clue"},
  {role: "candidate", label: "step TRACE blames", tab: "blamed"},
  {role: "root", label: "root cause", tab: "root"},
];
const REACH = {issue: "clue only", candidate: "blamed", root: "ROOT"};

function template(scene, model, ref, roles) {
  const n = k => model.clusters.filter(c => c.kind === k).length;
  const ticks = scene.events.map((e, i) => `<button class="qg-tick" data-i="${i}" data-phase="${e.phase}" style="flex-grow:${eventDuration(e)}" title="${esc(`${e.phase} · ${e.title}`)}"${e.error ? " data-error" : ""}></button>`).join("");
  const rels = Object.keys(scene.meta.relations).length;
  return `
    <canvas class="qg-canvas" aria-label="Query graph"></canvas>
    <header class="qg-head">
      <div class="qg-title">
        <span class="qg-kicker">Query Graph</span>
        <h1>${esc(scene.meta.task || scene.meta.tid)}</h1>
        <p><select class="qg-case" aria-label="Case">${CASES.map(c => `<option value="${esc(queryHref(c.ref))}"${c.ref[1] === ref[2] ? " selected" : ""}>${esc(c.label)}</option>`).join("")}${CASES.some(c => c.ref[1] === ref[2]) ? "" : `<option selected>${esc(scene.meta.tid)}</option>`}</select>
          <a href="${caseHref(ref)}" title="Open in the workbench">${esc(scene.meta.tid)}</a></p>
      </div>
      <div class="qg-modes">
        <div class="qg-seg" role="group" aria-label="Mode"><button data-mode="tour" aria-pressed="true">Tour</button><button data-mode="overview" aria-pressed="false">Overview</button></div>
        <div class="qg-seg qg-views" role="group" aria-label="Camera" hidden><button data-view="front">Front</button><button data-view="top">Top</button><button data-view="side">Side</button></div>
      </div>
      <ol class="qg-phases">${PHASES.filter(ph => scene.events.some(e => e.phase === ph)).map((ph, k) => `<li><button data-phase="${ph}" title="${esc(PHASE_NOTE[ph])}"><span>${String(k + 1).padStart(2, "0")}</span><b>${ph}</b></button></li>`).join("")}</ol>
    </header>
    <aside class="qg-legend is-collapsed" aria-label="Legend">
      <button class="qg-pane-tab" data-pane="legend" aria-expanded="false" title="Show or hide the legend"><span>Legend</span><i>›</i></button>
      <h2>DSL record</h2>
      <dl class="qg-stats">
        <dt>facts</dt><dd>${scene.facts.length}</dd><dt>entities</dt><dd>${scene.entities.length}</dd>
        <dt>relations</dt><dd>${rels}</dd><dt>goals</dt><dd>${scene.goals.length}</dd><dt>steps</dt><dd>${scene.meta.steps}</dd>
      </dl>
      <p class="qg-formula">Fact ≔ rel(args) = value @t</p>
      <ul class="qg-key qg-ties">
        <li><i class="k-hub"></i>entity a fact names</li>
        <li><i class="k-thread"></i>same state, next step</li>
      </ul>
      <h2>A fact becomes evidence</h2>
      <ul class="qg-key">
        <li><i class="k-pt"></i>fact the debugger read</li>
        ${ROLE_ROWS.map(r => { const n = roles.byRole.get(r.role).length; return `<li data-journey-role="${r.role}"${n ? ` title="Follow these facts from the record to the verdict"` : " class=\"none\""}><i class="k-pt" data-role="${r.role}"></i>${r.label}<em>${n}</em></li>`; }).join("")}
      </ul>
      <p class="qg-hint qg-hint-role">Click a row to follow its facts from the record to the verdict.</p>
      <h2>Clouds by phase</h2>
      <ul class="qg-key">
        ${["PARSE", "MAP", "ROUTE", "TRACE", "SUBMIT"].filter(ph => model.clusters.some(c => c.phaseKey === ph)).map(ph => `<li data-phase="${ph}" data-filter-phase="${ph}" title="Hide or show this phase"><i class="k-cloud"></i>${ph.toLowerCase()} · ${PHASE_NOTE[ph]}</li>`).join("")}
        <li><i class="k-dot"></i>pulled from the record</li>
        <li><i class="k-line"></i>leads to</li>
      </ul>
      <p class="qg-hint">Click a cloud to light its causal chain, click it again to open it by entity, then an entity to read its facts. Esc steps back. Legend rows filter.</p>
    </aside>
    <aside class="qg-inspect is-collapsed" hidden>
      <button class="qg-pane-tab" data-pane="inspect" aria-expanded="false" title="Show or hide the details"><i>‹</i><span>Details</span></button>
      <div class="qg-inspect-body"></div>
    </aside>
    <div class="qg-tip" hidden></div>
    <footer class="qg-foot">
      <div class="qg-caption"><span class="qg-chip"></span><div><strong class="qg-cap-title"></strong><p class="qg-cap-text"></p></div></div>
      <div class="qg-bar">
        <button class="qg-btn" data-act="prev" title="Previous call (←)" aria-label="Previous call">‹</button>
        <button class="qg-btn qg-play" data-act="play" title="Play / pause (space)" aria-label="Play or pause">❚❚</button>
        <button class="qg-btn" data-act="next" title="Next call (→)" aria-label="Next call">›</button>
        <div class="qg-track">${ticks}<span class="qg-head-mark"></span></div>
        <span class="qg-count"></span>
        <button class="qg-btn qg-speed" data-act="speed" title="Playback speed">1×</button>
        <button class="qg-btn qg-follow" data-act="follow" title="Fold everything and follow the tour" hidden>Follow tour</button>
      </div>
    </footer>`;
}

function bindUi(root, scene, model, stage, roles) {
  const $ = s => root.querySelector(s);
  const ticks = [...root.querySelectorAll(".qg-tick")];
  const handlers = {};
  const inspect = $(".qg-inspect"), panelBody = $(".qg-inspect-body"), tip = $(".qg-tip");
  let current = 0, journeyRole = null;
  // Both side panels start folded to a tab; the details panel also opens when the user picks
  // something on the stage and folds again when the pick is cleared.
  const setPane = (name, open) => {
    const pane = $(`.qg-${name}`);
    pane.classList.toggle("is-collapsed", !open);
    pane.querySelector(".qg-pane-tab").setAttribute("aria-expanded", String(open));
  };

  $(".qg-case")?.addEventListener("change", e => { if (e.target.value.startsWith("#/")) location.hash = e.target.value; });
  root.addEventListener("click", e => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "speed") {
      const b = e.target.closest("button");
      const s = {"1×": 2, "2×": 0.5}[b.textContent] ?? 1;
      b.textContent = `${s}×`;
      handlers.speed?.(s);
    } else if (act === "prev" || act === "next") handlers.step?.(act === "prev" ? -1 : 1);
    else if (act) handlers[act]?.();
    const mode = e.target.closest("[data-mode]");
    if (mode) handlers.mode?.(mode.dataset.mode);
    const cam = e.target.closest("[data-view]");
    if (cam) handlers.view?.(cam.dataset.view);
    const fp = e.target.closest("[data-filter-phase]");
    if (fp) handlers.filterPhase?.(fp.dataset.filterPhase);
    const jr = e.target.closest("[data-journey-role]:not(.none)");
    if (jr) handlers.journeyRole?.(jr.dataset.journeyRole, !!jr.closest(".qg-roles"));
    const jf = e.target.closest("[data-journey-fact]");
    if (jf) handlers.journeyFact?.(Number(jf.dataset.journeyFact), jf.dataset.role);
    const stop = e.target.closest("[data-stop]");
    if (stop) { const k = Number(stop.dataset.stop); stage.focusStop(stage.journey?.focus === k ? null : k); }
    if (e.target.closest("[data-end-journey]")) stage.setJourney(null);
    const tick = e.target.closest(".qg-tick");
    if (tick) handlers.seek?.(Number(tick.dataset.i));
    const ph = e.target.closest(".qg-phases [data-phase]");
    if (ph) handlers.phase?.(ph.dataset.phase);
    const jump = e.target.closest("[data-jump]");
    if (jump) handlers.jump?.(Number(jump.dataset.jump));
    const open = e.target.closest("[data-open]");
    if (open) stage.open(open.dataset.open, open.dataset.group != null ? Number(open.dataset.group) : null);
    const fact = e.target.closest("[data-fact]");
    if (fact) { stage.selectFact(Number(fact.dataset.fact)); showFact(Number(fact.dataset.fact), stage.view); }
    if (e.target.closest("[data-fold]")) stage.back();
    const tab = e.target.closest("[data-pane]");
    if (tab) setPane(tab.dataset.pane, tab.closest("aside").classList.contains("is-collapsed"));
  });

  function showEvent(i) {
    const ev = scene.events[i];
    const c = model.byId.get(ev.cluster || "core");
    if (!c) { inspect.hidden = true; return; }
    showCluster(c, ev);
  }

  function crumbs(c, gi, fid) {
    const tier = TIERS.find(t => t.tier === c.tier);
    const parts = [`<span>T${c.tier} ${esc(tier.label)}</span>`];
    parts.push(gi == null && fid == null ? `<b>${esc(clusterTitle(c))}</b>` : `<button data-open="${esc(c.id)}">${esc(clusterTitle(c))}</button>`);
    if (gi != null) parts.push(fid == null ? `<b>${esc(c.groups[gi].key)}</b>` : `<button data-open="${esc(c.id)}" data-group="${gi}">${esc(c.groups[gi].key)}</button>`);
    if (fid != null) parts.push(`<b>f${fid}</b>`);
    return `<nav class="qg-crumbs">${parts.join("<i>›</i>")}</nav>`;
  }

  function sharing(c) {
    const own = new Set(c.fids);
    return model.clusters.filter(o => o !== c && o.kind !== "core" && o.fids.length)
      .map(o => [o, o.fids.filter(f => own.has(f)).length]).filter(([, k]) => k).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }

  function showCluster(c, ev = scene.events[c.event], opened = false) {
    inspect.hidden = false;
    let body = "";
    if (c.error) body = `<p class="qg-bad">${esc(c.error.code || "error")}: ${esc(c.error.message)}</p>`;
    else if (c.kind === "query" && ev.calls) body = `<pre class="qg-code">${esc(ev.calls.slice(0, 24).map(e => `${e.name}(f${e.call.arguments?.fid ?? "?"})${e.verdict ? ` → ${e.verdict}` : ""}${e.error ? " ✕" : ""}`).join("\n"))}${ev.calls.length > 24 ? `\n… ${ev.calls.length - 24} more` : ""}</pre>`;
    else if (c.kind === "query") body = `<pre class="qg-code">${esc(ev.name)}(${esc(JSON.stringify(ev.spec))})</pre>`;
    else if (c.kind === "window") body = `<p>${esc(short(c.ref.hypothesis, 320))}</p>`;
    else if (c.kind === "lane") body = `<p>${esc(short(c.ref.question, 300))}</p>${c.fill !== c.event ? `<details><summary>SQL</summary><pre class="qg-code qg-sql">${esc(scene.events[c.fill].sql || "")}</pre></details>` : ""}`;
    else if (c.kind === "candidate" || c.kind === "root") body = `<p>${esc(c.ref.proposition)}</p>${c.ref.quote ? `<blockquote>${esc(c.ref.quote)}</blockquote>` : ""}`;
    else if (c.kind === "core") body = `<p class="qg-muted">The whole compiled trajectory. Every access above draws its facts from here.</p>`;
    const groups = c.groups.length ? `<h4>Entities <small>${c.groups.length}</small></h4>
      <ul class="qg-rows">${c.groups.map((g, gi) => `<li><button data-open="${esc(c.id)}" data-group="${gi}"><span>${esc(g.key)}</span><em>${g.fids.length}</em></button></li>`).join("")}</ul>` : "";
    const shared = c.kind !== "core" ? sharing(c) : [];
    const sharedHtml = shared.length ? `<h4>Shares facts with</h4><ul class="qg-rows">${shared.map(([o, k]) => `<li><button data-open="${esc(o.id)}"><span>${esc(clusterTitle(o))}</span><em>${k}</em></button></li>`).join("")}</ul>` : "";
    const phase = ev?.phase || "PARSE";
    panelBody.innerHTML = `${crumbs(c)}
      <p class="qg-kind"><span class="qg-chip" data-phase="${esc(phase)}">${esc(phase)}</span>${esc(c.kind)}${opened ? ` · <button class="qg-link" data-fold>fold</button>` : ""}</p>
      <h3>${esc(c.label)}</h3><p class="qg-muted">${esc(c.detail)}</p>
      ${!opened && c.groups.length ? `<button class="qg-open" data-open="${esc(c.id)}">Open by entity ›</button>` : ""}${body}${groups}${sharedHtml}`;
  }

  function showGroup(c, gi) {
    const g = c.groups[gi];
    const ent = scene.entities.find(e => e.key === g.key);
    inspect.hidden = false;
    panelBody.innerHTML = `${crumbs(c, gi)}
      <p class="qg-kind">entity group</p><h3>${esc(g.key)}</h3>
      ${ent ? `<dl><dt>kind</dt><dd>${esc(ent.kind)}${ent.parent ? ` ⊑ ${esc(ent.parent)}` : ""}</dd><dt>in record</dt><dd>${ent.facts.length} facts</dd></dl>` : ""}
      <h4>Facts in this access <small>${g.fids.length}</small></h4>
      <ul class="qg-rows qg-facts">${g.fids.map(fid => { const f = scene.factById.get(fid); return `<li><button data-fact="${fid}"><span>${esc(factLabel(f))}</span><em>${f.slot}</em></button></li>`; }).join("")}</ul>`;
  }

  function showFact(fid, view) {
    const f = scene.factById.get(fid), c = model.byId.get(view.cluster);
    const sig = scene.meta.relations[f.rel];
    const seen = model.clusters.filter(o => o.kind !== "core" && o.fids.includes(fid));
    inspect.hidden = false;
    panelBody.innerHTML = `${c ? crumbs(c, view.group, fid) : ""}
      <p class="qg-kind">fact ${fid}</p><h3>${esc(`${f.rel}(${f.args.join(", ")})`)}</h3>
      <pre class="qg-code">${esc(factRepr(f))}</pre>
      <dl><dt>step</dt><dd>S${f.t} · ${SLOT_LABEL[f.slot]} · ${f.side}</dd>
      ${sig ? `<dt>relation</dt><dd>${esc(`${sig.name}(${(sig.arg_kinds || []).join(", ")})`)}${(sig.props || []).length ? ` <small>${esc(sig.props.join(" · "))}</small>` : ""}</dd>` : ""}
      ${f.basis.length ? `<dt>basis</dt><dd>${f.basis.map(b => `<code>f${b}</code>`).join(" ")}</dd>` : ""}</dl>
      ${f.span ? `<blockquote>${esc(short(f.span, 420))}</blockquote>` : ""}
      ${roles.reach(fid) ? `<button class="qg-open" data-journey-fact="${fid}">Follow its journey ›</button>` : ""}
      <h4>Returned by <small>${seen.length}</small></h4>
      <ul class="qg-rows">${seen.map(o => `<li><button data-open="${esc(o.id)}"><span>${esc(clusterTitle(o))}</span><em>T${o.tier}</em></button></li>`).join("")}</ul>`;
  }

  // The journey panel, in plain English for readers new to the project: the role's facts (the
  // agent's own words, how far each got), then the chosen fact's stops as numbered story cards
  // matching the badges on the stage. Each card's structured record folds into its Details.
  function renderJourney(j) {
    const role = journeyRole;
    const fids = roles.byRole.get(role) || [];
    const f = j.fact, last = j.stops.length - 1;
    const stopTitle = s => s.kind === "core" ? "DSL record" : clusterTitle(model.byId.get(s.id));
    // Re-rendering on every focus change keeps the Details the reader opened.
    const opened = new Set([...panelBody.querySelectorAll("details[open][data-k]")].map(d => d.dataset.k));
    const fold = (k, rows) => `<details data-k="${k}"${opened.has(String(k)) ? " open" : ""}><summary>Details</summary><dl>${rows.map(([dt, dd]) => `<dt>${dt}</dt><dd>${esc(dd)}</dd>`).join("")}</dl></details>`;
    inspect.hidden = false;
    panelBody.innerHTML = `
      <p class="qg-kind">evidence journey · <button class="qg-link" data-end-journey>close</button></p>
      <div class="qg-seg qg-roles" role="group" aria-label="Role">${ROLE_ROWS.map(r => `<button data-journey-role="${r.role}" aria-pressed="${r.role === role}"${roles.byRole.get(r.role).length ? "" : " disabled"}>${r.tab} <small>${roles.byRole.get(r.role).length}</small></button>`).join("")}</div>
      <ul class="qg-rows qg-jfacts">${fids.map(fid => { const x = scene.factById.get(fid), w = agentWords(x); return `<li><button data-journey-fact="${fid}" data-role="${role}" title="${esc(`f${fid} ${x.rel}(${x.args.join(", ")})`)}"${fid === f.fid ? ` aria-current="true"` : ""}><span><i>step ${x.t} ${SLOT_LABEL[x.slot]}</i>${w ? ` “${esc(w)}”` : ""}</span><em data-reach="${roles.reach(fid)}">→ ${REACH[roles.reach(fid)]}</em></button></li>`; }).join("")}</ul>
      <div class="qg-jhead">
        <h3>${esc(j.name)}</h3>
        ${j.words ? `<blockquote>“${esc(j.words)}”</blockquote>` : ""}
        ${fold("fact", [["fact", `f${f.fid} ${f.rel}(${f.args.join(", ")}) = ${short(typeof f.value === "string" ? f.value : JSON.stringify(f.value), 90)}`], ["recorded", `S${f.t} · ${SLOT_LABEL[f.slot]}`]])}
      </div>
      <ol class="qg-story">${j.stops.map((s, k) => `
        ${k === 1 && j.startSay ? `<li class="qg-note" title="${esc(j.start)}">↳ ${esc(j.startSay)}</li>` : ""}
        <li data-phase="${esc(s.phase)}"${j.focus === k ? ` class="on"` : ""}>
          <button data-stop="${k}"><b>${k + 1}</b><span class="qg-chip" data-phase="${esc(s.phase)}">${esc(s.phase)}</span>
            <p>${esc(s.say)}</p>${s.quote ? `<blockquote>“${esc(s.quote)}”</blockquote>` : ""}</button>
          ${fold(k, [["where", stopTitle(s)], ...(s.kind === "core" ? [] : [["call", String(s.event).padStart(2, "0")]]), ["result", s.outcome]])}
        </li>
        ${k === last && j.endSay ? `<li class="qg-note qg-end" title="${esc(j.end)}">⊣ ${esc(j.endSay)}</li>` : ""}`).join("")}
      </ol>
      <p class="qg-hint">Click a card or a numbered badge to fly to that stop; ← → step along the way, Esc steps back.</p>`;
    panelBody.querySelector(".qg-story li.on")?.scrollIntoView({block: "nearest"});
  }

  return {
    on(name, fn) { handlers[name] = fn; },
    setEvent(i) {
      current = i;
      const ev = scene.events[i];
      ticks.forEach((t, k) => { t.classList.toggle("done", k < i); t.classList.toggle("now", k === i); });
      const cur = PHASES.indexOf(ev.phase);
      root.querySelectorAll(".qg-phases button").forEach(b => {
        const k = PHASES.indexOf(b.dataset.phase);
        b.classList.toggle("now", k === cur); b.classList.toggle("done", k < cur);
      });
      const chip = $(".qg-caption .qg-chip");
      chip.textContent = ev.phase;
      chip.dataset.phase = ev.phase;
      $(".qg-cap-title").textContent = ev.title || "";
      $(".qg-cap-text").textContent = ev.caption || "";
      $(".qg-count").textContent = `${String(i + 1).padStart(2, "0")} / ${scene.events.length}`;
      if (!stage.view.cluster) showEvent(i);
    },
    setProgress(i, p) {
      const t = ticks[i];
      if (t) $(".qg-head-mark").style.left = `${t.offsetLeft + t.offsetWidth * p}px`;
    },
    setPlaying(on) { $(".qg-play").textContent = on ? "❚❚" : "▶"; },
    syncFollow() {
      const b = $(".qg-follow");
      b.hidden = !(stage.view.cluster || stage.manual || stage.journey || (root.classList.contains("is-overview") && stage.view.selected));
      b.textContent = root.classList.contains("is-overview") ? "Reset view" : "Follow tour";
    },
    setMode(mode, view) {
      root.classList.toggle("is-overview", mode === "overview");
      root.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
      $(".qg-views").hidden = mode !== "overview";
      root.querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
      if (mode === "overview") {
        ticks.forEach(t => { t.classList.add("done"); t.classList.remove("now"); });
        root.querySelectorAll(".qg-phases button").forEach(b => { b.classList.add("done"); b.classList.remove("now"); });
        const chip = $(".qg-caption .qg-chip");
        chip.textContent = "OVERVIEW";
        chip.dataset.phase = "SUBMIT";
        $(".qg-cap-title").textContent = `${scene.events.length} calls · ${model.clusters.length} clouds`;
        $(".qg-cap-text").textContent = "Every access at once. Click a cloud to light the chain it belongs to, click it again to open it; the timeline and phase bar pick clouds too.";
        $(".qg-count").textContent = `${scene.events.length} calls`;
        showCluster(model.byId.get("root") || model.byId.get("core"));
      } else this.setEvent(current);
      this.syncFollow();
    },
    setFilter(filter) {
      root.querySelectorAll("[data-filter-phase]").forEach(li => li.classList.toggle("off", filter.phases.has(li.dataset.filterPhase)));
    },
    get journeyRole() { return journeyRole; },
    showJourney(role) {
      journeyRole = role;
      this.journey(stage.journey);
    },
    // The stage's journey changed (picked, focused or closed): mark the legend row and redraw
    // the panel, or hand the panel back when the journey closes.
    journey(j) {
      if (!j) journeyRole = null;
      root.querySelectorAll(".qg-legend [data-journey-role]").forEach(li => li.classList.toggle("only", li.dataset.journeyRole === journeyRole));
      this.syncFollow();
      if (!j) { this.inspect(null); return; }
      setPane("inspect", true);
      renderJourney(j);
    },
    hover(h) {
      if (!h) { tip.hidden = true; return; }
      let html = "";
      if (h.kind === "cluster") html = `<b>${esc(clusterTitle(h.cluster))}</b><span>${esc(h.cluster.detail)} · click to open</span>`;
      else if (h.kind === "group") { const g = h.cluster.groups[h.gi]; html = `<b>${esc(g.key)}</b><span>${g.fids.length} facts · click to list</span>`; }
      else if (h.kind === "edge") html = `<b>${esc(h.link.title)}</b>${h.link.detail ? `<span>${esc(h.link.detail)}</span>` : ""}
        <dl class="qg-card">${h.link.card.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(short(v, 260))}</dd>`).join("")}</dl>`;
      else if (h.kind === "stop") html = `<b>${h.k + 1} · ${esc(h.stop.kind === "core" ? "DSL record" : clusterTitle(model.byId.get(h.stop.id)))}</b><span>${esc(h.stop.outcome)} · click to fly there</span>`;
      else if (h.kind === "fact") { const f = scene.factById.get(h.fid); html = `<b>fact ${f.fid} · S${f.t} ${SLOT_LABEL[f.slot]}</b><em>${esc(short(typeof f.value === "string" ? f.value : JSON.stringify(f.value), 160))}</em>`; }
      tip.hidden = false;
      tip.innerHTML = html;
      tip.style.left = `${Math.min(h.x + 16, root.clientWidth - 320)}px`;
      tip.style.top = `${Math.max(8, h.y + 14)}px`;
    },
    inspect(sel) {
      this.syncFollow();
      setPane("inspect", !!sel);
      if (!sel) { showEvent(current); return; }
      if (sel.kind === "cluster") showCluster(sel.cluster, scene.events[sel.cluster.event], sel.opened);
      else if (sel.kind === "group") showGroup(sel.cluster, sel.gi);
      else if (sel.kind === "fact") showFact(sel.fid, stage.view);
    },
  };
}
