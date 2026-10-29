// #/query[/<group>/<trajectory>]: the Query Graph. The DSL record is one dense core; every
// debugger access (a ROUTE view, a window, a TRACE lane's SQL) is a point cloud on a tier
// above it, ending in the root. Click a cloud to open it by entity, an entity to read its facts.
import {esc, short, loader} from "../util.js";
import {caseHref, queryHref} from "../routes.js";
import {loadQueryScene, factRepr, SLOT_LABEL} from "../query/model.js";
import {agentWords} from "../query/narrate.js";
import {buildClusters, chainPath, factLabel, journeyOf, phaseFocus, roleFacts} from "../query/clusters.js";
import {layoutClusters, TIERS} from "../query/layout.js";
import {createStage, clusterTitle} from "../query/stage.js";
import {createTour, eventDuration} from "../query/tour.js";
import {buildStory} from "../query/story.js";
import {coachSeen, runCoach} from "../query/coach.js";

const GROUP = "evidence-query-claims-n30-20261013";
// Cases the page is tuned on (one window/lane, two windows/lanes, a large WebShop record), then
// the other examples the project site carries; every one of them runs the MANAGER phase.
const CASES = [
  {ref: [GROUP, "GPT-4o_013_alfworld_task_013"], label: "ALFWorld 013 · 1 lane"},
  {ref: [GROUP, "GPT-4o_024_alfworld_task_024"], label: "ALFWorld 024 · 2 lanes"},
  {ref: [GROUP, "GPT-4o_003_chat_b000_t00_e02-1e119842"], label: "WebShop 003 · 3 candidates"},
  {ref: [GROUP, "GPT-4o_019_alfworld_task_019"], label: "ALFWorld 019 · 2 lanes"},
  {ref: [GROUP, "Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d"], label: "WebShop Qwen3-8B 017 · 2 windows"},
  {ref: [GROUP, "Llama3.3-70B-Turbo_017_webshop_task_017"], label: "WebShop Llama 017 · 921 facts"},
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
// The Story mode frames every cloud revealed so far from the overview's front angle.
const STORY_CAM = {fit: true, target: [0, 7, 0], yaw: 0.55, pitch: 0.32, dist: 56};
const PHASE_NOTE = {
  PARSE: "compile the log into the DSL record", MAP: "read the task goal", ROUTE: "query the record, open suspect windows",
  MANAGER: "turn each suspicion into a question", TRACE: "search the logs to test each suspicion", SUBMIT: "name the root cause",
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
    const story = buildStory(scene, model);
    root.innerHTML = template(scene, model, ref, roles, story);
    stage = createStage(root.querySelector(".qg-canvas"), scene, model, layout);
    const frameAt = createTour(scene, model, layout);
    const last = scene.events.length - 1;
    const plays = scene.events.map((e, i) => i).filter(i => !scene.events[i].error);
    // The nearest played step from i in direction d (0: i itself, else forward first).
    const playable = (i, d = 0) => {
      i = Math.max(0, Math.min(last, i));
      if (!scene.events[i].error) return i;
      const after = plays.find(k => k > i), before = plays.findLast(k => k < i);
      return d < 0 ? before ?? after : after ?? before;
    };
    const lastPlay = plays[plays.length - 1];
    // Tour plays the calls in order; Overview shows every cloud at once for free exploration.
    const state = {i: 0, p: 0, playing: true, speed: 1, mode: "tour", view: "front", chain: null, phase: null,
                   filter: {phases: new Set()}, row: story.rows.length - 1};
    const ui = bindUi(root, scene, model, stage, roles, ref, story);
    ui.setEvent(state.i);

    stage.start(dt => {
      // Story: the tower stands where the current board row's call left it, that row's clouds in focus.
      if (state.mode === "story") {
        const row = story.rows[state.row];
        const out = frameAt(row.event, 1);
        Object.assign(out.frame, {focus: new Set(row.focus), chain: state.chain?.chain || null, chainEdges: state.chain?.edges, phase: null, filter: state.filter, labelAll: false});
        out.camera = STORY_CAM;
        return out;
      }
      const overview = state.mode === "overview";
      if (!overview && state.playing) {
        state.p += dt * state.speed / eventDuration(scene.events[state.i]);
        if (state.p >= 1) {
          if (state.i < lastPlay) { state.i = playable(state.i + 1, 1); state.p = 0; stage.clearHover(); ui.setEvent(state.i); }
          else { state.p = 1; setPlaying(false); }
        }
      }
      if (!overview) ui.setProgress(state.i, state.p);
      const out = overview ? frameAt(last, 1, true) : frameAt(state.i, state.p);
      Object.assign(out.frame, {chain: state.chain?.chain || null, chainEdges: state.chain?.edges, phase: state.phase, filter: state.filter, labelAll: overview});
      if (overview) { out.frame.focus = new Set(); out.camera = OVERVIEW_CAM[state.view]; }
      return out;
    });

    const setMode = mode => {
      state.mode = mode;
      history.replaceState(null, "", location.hash.split("?")[0] + (mode === "tour" ? "" : `?mode=${mode}`));
      stage.follow();
      stage.release();
      state.chain = null;
      setPhase(null);
      ui.setMode(mode, state.view);
      if (mode !== "tour") setPlaying(false);
      else { go(0); setPlaying(true); }
      if (mode === "story") setRow(0);
    };

    const setPlaying = on => { state.playing = on; ui.setPlaying(on); };
    const go = (i, p = 0, d = 0) => { stage.clearHover(); state.i = playable(i, d); state.p = p; ui.setEvent(state.i); };
    const toggle = () => {
      if (!state.playing && state.i === lastPlay && state.p >= 1) go(0);
      if (!state.playing && stage.view.cluster) stage.follow();
      setPlaying(!state.playing);
    };
    ui.on("play", toggle);
    ui.on("step", d => go(state.i + d, 0, d));
    // In Overview the timeline and the phase bar pick a cloud instead of moving the playhead.
    const pick = i => stage.select(scene.events[i].cluster || "core");
    ui.on("seek", i => state.mode === "overview" ? pick(i) : go(i, 0.5));
    // In Overview a phase button focuses that phase's clouds instead; a second click lets go.
    const setPhase = ph => {
      state.phase = ph ? phaseFocus(model, ph) : null;
      ui.setPhase(state.phase);
    };
    ui.on("phase", ph => {
      if (state.mode === "overview") {
        const again = state.phase?.phase === ph;
        stage.setJourney(null);
        stage.select(null);
        stage.release();
        setPhase(again ? null : ph);
        return;
      }
      const i = scene.events.findIndex(e => e.phase === ph && !e.error);
      if (i >= 0) go(i);
    });
    ui.on("endPhase", () => setPhase(null));
    stage.on("back", () => state.phase && setPhase(null));
    ui.on("mode", setMode);
    ui.on("view", v => { state.view = v; stage.release(); ui.setMode(state.mode, v); });
    ui.on("filterPhase", ph => { state.filter.phases.has(ph) ? state.filter.phases.delete(ph) : state.filter.phases.add(ph); ui.setFilter(state.filter); });
    // A role row (or a fact's "follow its journey") draws one fact's way to its verdict; that
    // needs every cloud on screen, so the tour gives way to the overview first.
    const follow = (role, fid) => {
      if (state.mode !== "overview") setMode("overview");
      setPhase(null);
      stage.setJourney(journeyOf(scene, model, fid ?? roles.byRole.get(role)[0]));
      ui.showJourney(role);
    };
    // The legend row toggles; the panel's role tabs only switch.
    ui.on("journeyRole", (role, tab) => !tab && stage.journey && ui.journeyRole === role ? stage.setJourney(null) : follow(role));
    ui.on("journeyFact", (fid, role) => follow(role || roles.reach(fid), fid));
    ui.on("cta", () => follow(ctaOf(roles).role));
    stage.on("journey", j => ui.journey(j));
    ui.on("speed", s => { state.speed = s; });
    ui.on("follow", () => { stage.follow(); stage.release(); });
    ui.on("jump", i => { stage.follow(); go(i, 0.5); setPlaying(false); });
    stage.on("select", sel => {
      if (sel) { setPlaying(false); if (state.phase) { state.phase = null; ui.setPhase(null, true); } }
      const id = sel?.cluster && sel.cluster.id !== "core" ? sel.cluster.id : null;
      if (id !== state.chain?.id) state.chainAll = false;
      state.chain = id ? chainPath(model, id, state.chainAll) : null;
      ui.setChain(state.chain);
      ui.inspect(sel);
    });
    // "show all" on the chain list puts the parallel queries back on the chain, and folds them.
    ui.on("chainAll", () => {
      if (!state.chain) return;
      state.chainAll = !state.chainAll;
      state.chain = chainPath(model, state.chain.id, state.chainAll);
      ui.setChain(state.chain);
      ui.inspect({kind: "cluster", cluster: model.byId.get(state.chain.id), opened: false});
    });
    stage.on("manual", () => ui.syncFollow());
    stage.on("view", () => ui.syncFollow());
    stage.on("hover", h => ui.hover(h));
    keyHandler = e => {
      if (e.target.closest("input, textarea, select")) return;
      const j = stage.journey;
      if (state.mode === "story" && !stage.view.cluster && [" ", "ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        setRow(e.key === "Home" ? 0 : e.key === "End" ? story.rows.length - 1 : state.row + (e.key === "ArrowLeft" ? -1 : 1));
      } else if (j && !stage.view.cluster && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        const k = j.focus == null ? (e.key === "ArrowRight" ? 0 : j.stops.length - 1) : j.focus + (e.key === "ArrowRight" ? 1 : -1);
        stage.focusStop(k < 0 || k >= j.stops.length ? null : k);
      } else if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") go(state.i + 1, 0, 1);
      else if (e.key === "ArrowLeft") go(state.i - 1, 0, -1);
      else if (e.key === "Escape") stage.back();
    };
    document.addEventListener("keydown", keyHandler);
    const setRow = k => {
      state.row = Math.max(0, Math.min(story.rows.length - 1, k));
      stage.clearHover();
      stage.select(null);
      stage.release();
      state.chain = null;
      ui.setRow(state.row);
    };
    ui.on("row", setRow);
    const asked = route.query?.get("mode");
    if (asked === "overview" || asked === "story") setMode(asked);

    // The guide: once per browser, again from the header's Guide button; playback waits for it.
    const pick1 = (...sel) => sel.map(q => root.querySelector(q)).find(el => el?.getClientRects().length);
    const guide = () => {
      const was = state.playing;
      setPlaying(false);
      runCoach(root, [
        {title: "Pick a run", target: () => root.querySelector(".qg-case"),
         text: "Each case is one failed agent run. The debugger compiles its log into a DSL record, queries it, and names the step that caused the failure."},
        {title: "Every cloud is a query",
         text: "Floors rise PARSE → ROUTE → TRACE → SUBMIT. <b>Click</b> a cloud to light its causal chain, <b>click it again</b> to open it by entity. Drag to turn the tower, scroll to zoom."},
        {title: "Follow a fact", before: () => ui.openPane("legend"), target: () => pick1(".qg-follows", ".qg-cta"), side: "right",
         text: "These buttons trace one fact from the record to the verdict, stop by stop. Start with the root cause."},
      ], () => { if (was && state.mode === "tour") setPlaying(true); });
    };
    ui.on("guide", guide);
    if (!coachSeen()) guide();
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

// The footer's call to action: the furthest role that has facts.
const ctaOf = roles => [{role: "root", name: "root cause"}, {role: "candidate", name: "blamed step"}, {role: "issue", name: "clues"}]
  .find(r => roles.byRole.get(r.role).length);

// Where a step sits on the board's axis: the middle of its column.
const stepX = (step, n) => `${((step - 0.5) / n * 100).toFixed(2)}%`;

// One row's marks on the step axis. Range bars stack in lanes; notes lead out to the right.
function storyMarks(row, n) {
  const at = s => stepX(s, n);
  // Anchor and root notes sit to the left of their mark (the arrow runs right); near the axis's
  // start there is no room, so they ride above the mark's right shoulder instead.
  const side = s => (s - 0.5) / n > 0.22 ? "is-left" : "is-raised";
  const note = (s, t, cls = "") => `<em class="sb-note ${cls}${/is-(anchor|root)/.test(cls) ? ` ${side(s)}` : ""}" style="left:${at(s)}">${esc(t)}</em>`;
  let lane = 0;
  return row.marks.map(m => {
    switch (m.type) {
      case "x": return `<i class="sb-x" style="left:${at(m.step)}">✕</i>${note(m.step, m.label, "is-bad")}`;
      case "signal": return `<i class="sb-sig" data-kind="${m.kind}" style="left:${at(m.step)}" title="step ${m.step}: ${m.kind === "goal" ? "touches the goal" : m.kind === "invalid" ? "action with no effect" : "routine noise"}"></i>`;
      case "range": {
        const style = `left:${((m.a - 1) / n * 100).toFixed(2)}%;width:${((m.b - m.a + 1) / n * 100).toFixed(2)}%`;
        return m.tone === "all" ? `<i class="sb-range" data-tone="all" style="${style}"></i>`
          : `<i class="sb-range" data-tone="${m.tone}" style="${style};top:${8 + lane++ * 5}px" title="${esc(m.label || "")}"></i>`;
      }
      case "arrow": return `<i class="sb-arrow" style="left:${at(m.to)};width:${((m.from - m.to) / n * 100).toFixed(2)}%"></i><i class="sb-sym" style="left:${at(m.from)}"></i>`;
      case "anchor": return `<i class="sb-anchor" style="left:${at(m.step)}"></i>${m.label ? note(m.step, m.label, "is-anchor") : ""}`;
      case "question": return `<i class="sb-q" style="left:${at(m.step)}">?</i>`;
      case "hit": return `<i class="sb-hit" style="left:${at(m.step)}"></i>`;
      case "blamed": return `<i class="sb-dia" data-kind="cand" style="left:${at(m.step)}"></i>`;
      case "rival": return `<i class="sb-dia" data-kind="rival" style="left:${at(m.step)}"></i>${note(m.step, m.label, "is-struck")}`;
      case "root": return `<i class="sb-dia" data-kind="root" style="left:${at(m.step)}"></i>${note(m.step, m.label, "is-root")}`;
      default: return "";
    }
  }).join("");
}

function storyBoard(story) {
  const n = story.steps;
  const marked = new Set(story.rows.flatMap(r => r.marks.filter(m => ["x", "anchor", "root"].includes(m.type)).map(m => m.step)));
  const axis = Array.from({length: n}, (_, i) => i + 1).filter(s => n <= 40 || s === 1 || s % 5 === 0 || marked.has(s))
    .map(s => `<span${marked.has(s) ? ` class="is-marked"` : ""} style="left:${stepX(s, n)}">${s}</span>`).join("");
  const lanes = r => r.marks.filter(m => m.type === "range" && m.tone !== "all").length;
  return `
    <section class="qg-board" aria-label="Case board" style="--n:${n}">
      <div class="qg-sb-axis"><span class="qg-sb-lab">Agent step</span><span class="qg-sb-track">${axis}</span></div>
      ${story.rows.map((r, k) => `
      <button class="qg-sb-row" data-row="${k}" data-phase="${r.phase}"${lanes(r) ? ` style="--lanes:${lanes(r)}"` : ""} title="${esc(r.answer)}">
        <span class="qg-sb-lab"><i class="qg-chip" data-phase="${r.phase}">${r.phase}</i><b>${esc(r.question)}</b></span>
        <span class="qg-sb-track">${storyMarks(r, n)}</span>
      </button>`).join("")}
    </section>
    <aside class="qg-cards" aria-label="Evidence">
      <div class="qg-sb-say"><p class="qg-sb-head"><span class="qg-chip"></span><span class="qg-sb-count"></span></p><strong></strong><p class="qg-sb-answer"></p></div>${story.cards.map(c => `
      <article class="qg-card-ev" data-row="${story.rows.findIndex(r => r.key === c.row)}" data-phase="${c.phase}">
        <h3>${esc(c.title)}</h3>
        ${c.lines.map(l => `<p class="${[l.strong && "is-strong", l.quote && "is-quote", l.quiet && "is-quiet", l.tone === "bad" && "is-bad"].filter(Boolean).join(" ")}"${l.rule ? ` title="${esc(l.rule)}"` : ""}>${l.label ? `<b>${esc(l.label)}</b> ` : ""}${esc(l.text)}</p>`).join("")}
      </article>`).join("")}
    </aside>`;
}

function template(scene, model, ref, roles, story) {
  const cta = ctaOf(roles);
  const n = k => model.clusters.filter(c => c.kind === k).length;
  const ticks = scene.events.map((e, i) => `<button class="qg-tick" data-i="${i}" data-phase="${e.phase}" style="flex-grow:${eventDuration(e)}" title="${esc(`${e.phase} · ${e.title}`)}"${e.error ? " data-error" : ""}></button>`).join("");
  const rels = Object.keys(scene.meta.relations).length;
  return `
    <canvas class="qg-canvas" aria-label="Query graph"></canvas>
    <header class="qg-head">
      <div class="qg-title">
        <span class="qg-kicker">Query Graph</span>
        <h1>${esc(scene.meta.task || scene.meta.tid)}</h1>
        <p><select class="qg-case" aria-label="Case">${CASES.map(c => `<option value="${esc(queryHref(c.ref))}"${c.ref[1] === ref[2] ? " selected" : ""}>${esc(c.label)}</option>`).join("")}${CASES.some(c => c.ref[1] === ref[2]) ? "" : `<option selected>${esc(scene.meta.tid)}</option>`}</select></p>
      </div>
      <div class="qg-modes">
        <div class="qg-seg"><button data-act="guide" title="Show the guide again">Guide</button></div>
        <div class="qg-seg" role="group" aria-label="Mode"><button data-mode="story" aria-pressed="false">Story</button><button data-mode="tour" aria-pressed="true">Tour</button><button data-mode="overview" aria-pressed="false">Overview</button></div>
        <div class="qg-seg qg-views" role="group" aria-label="Camera" hidden><button data-view="front">Front</button><button data-view="top">Top</button><button data-view="side">Side</button></div>
      </div>
      <ol class="qg-phases">${PHASES.filter(ph => scene.events.some(e => e.phase === ph)).map((ph, k) => `<li><button data-phase="${ph}" title="${esc(PHASE_NOTE[ph])}"><span>${String(k + 1).padStart(2, "0")}</span><b>${ph}</b></button></li>`).join("")}</ol>
    </header>
    ${storyBoard(story)}
    <aside class="qg-legend is-collapsed" aria-label="Legend">
      <button class="qg-pane-tab" data-pane="legend" aria-expanded="false" title="Show or hide the legend"><span>Legend</span><i>›</i></button>
      <div class="qg-legend-body">
      <h2>A fact becomes evidence</h2>
      <ul class="qg-key">
        <li><i class="k-pt"></i>fact the debugger read</li>
      </ul>
      <p class="qg-sub">Follow a fact from the record to the verdict:</p>
      <div class="qg-follows">
        ${ROLE_ROWS.map(r => { const n = roles.byRole.get(r.role).length; return `<button data-journey-role="${r.role}"${n ? ` title="Follow these facts from the record to the verdict"` : " disabled"}><i class="k-pt" data-role="${r.role}"></i><span>${r.label}</span><em>${n}</em><b>Follow ›</b></button>`; }).join("")}
      </div>
      <h2>DSL record</h2>
      <dl class="qg-stats">${[["facts", scene.facts.length], ["entities", scene.entities.length], ["relations", rels], ["steps", scene.meta.steps]].map(([k, v]) => `<div><dd>${v}</dd><dt>${k}</dt></div>`).join("")}</dl>
      <p class="qg-formula">One fact = who did or thought what, at which step</p>
      <ul class="qg-key qg-ties">
        <li><i class="k-hub"></i>entity a fact names</li>
        <li><i class="k-thread"></i>same state, next step</li>
        <li><i class="k-dot"></i>pulled from the record</li>
        <li><i class="k-line"></i>leads to</li>
      </ul>
      <h2>Show clouds by phase</h2>
      <p class="qg-sub">Click a phase to hide or show its clouds:</p>
      <div class="qg-phase-toggles">
        ${["PARSE", "MAP", "ROUTE", "TRACE", "SUBMIT"].map(ph => [ph, model.clusters.filter(c => c.phaseKey === ph).length]).filter(([, n]) => n).map(([ph, n]) => `<button data-phase="${ph}" data-filter-phase="${ph}" aria-pressed="true" title="${esc(`${PHASE_NOTE[ph]} · click to hide or show`)}"><i></i><span>${ph.toLowerCase()}</span><em>${n}</em></button>`).join("")}
      </div>
      </div>
    </aside>
    <aside class="qg-inspect is-collapsed" hidden>
      <button class="qg-pane-tab" data-pane="inspect" aria-expanded="false" title="Show or hide the details"><i>‹</i><span>Details</span></button>
      <div class="qg-inspect-body"></div>
    </aside>
    <div class="qg-tip" hidden></div>
    <div class="qg-hovercard" hidden></div>
    <footer class="qg-foot">
      <div class="qg-caption"><span class="qg-chip"></span><div><strong class="qg-cap-title"></strong><p class="qg-cap-text"></p><p class="qg-cap-next"></p></div><p class="qg-cap-full"></p>
        ${cta ? `<button class="qg-cta" data-act="cta" title="Draw this fact's way from the record to the verdict">▶ Follow the ${esc(cta.name)}</button>` : ""}</div>
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

function bindUi(root, scene, model, stage, roles, ref, story) {
  const $ = s => root.querySelector(s);
  // Story mode: the board sits under the header and the tower under the board; both edges are
  // measured, so a two-line title or a wrapped answer moves the tower down instead of under.
  function placeStory() {
    const head = $(".qg-head"), board = $(".qg-board");
    root.style.setProperty("--qg-story-top", `${head.offsetTop + head.offsetHeight + 10}px`);
    root.style.setProperty("--qg-tower-top", `${board.offsetTop + board.offsetHeight + 8}px`);
  }
  new ResizeObserver(() => root.classList.contains("is-story") && placeStory()).observe($(".qg-board"));
  const ticks = [...root.querySelectorAll(".qg-tick")];
  const handlers = {};
  const inspect = $(".qg-inspect"), panelBody = $(".qg-inspect-body"), tip = $(".qg-tip");
  let current = 0, journeyRole = null, chain = null;
  // Both side panels start folded to a tab; the details panel also opens when the user picks
  // something on the stage and folds again when the pick is cleared.
  const setPane = (name, open) => {
    const pane = $(`.qg-${name}`);
    pane.classList.toggle("is-collapsed", !open);
    pane.querySelector(".qg-pane-tab").setAttribute("aria-expanded", String(open));
  };

  // The side panels stop above the footer, whose height changes with the caption's length.
  const foot = $(".qg-foot");
  new ResizeObserver(() => { root.style.setProperty("--qg-foot-h", `${foot.offsetHeight}px`); clampCaption(); }).observe(foot);
  // The caption text stops at two lines; when it is cut, hovering the caption shows the whole
  // text in a card above it, so the footer (and the stage framed against it) keeps its height.
  function clampCaption() {
    const text = $(".qg-cap-text");
    $(".qg-cap-full").textContent = text.textContent;
    $(".qg-caption").classList.toggle("is-clamped", text.scrollHeight > text.clientHeight + 1);
  }
  $(".qg-case")?.addEventListener("change", e => { if (e.target.value.startsWith("#/")) location.hash = e.target.value; });
  panelBody.addEventListener("mouseover", e => stage.highlightChainEdge(e.target.closest("[data-chain-edge]") ? Number(e.target.closest("[data-chain-edge]").dataset.chainEdge) : null));
  panelBody.addEventListener("mouseleave", () => stage.highlightChainEdge(null));
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
    const jr = e.target.closest("[data-journey-role]:not(:disabled)");
    if (jr) handlers.journeyRole?.(jr.dataset.journeyRole, !!jr.closest(".qg-roles"));
    const jf = e.target.closest("[data-journey-fact]");
    if (jf) handlers.journeyFact?.(Number(jf.dataset.journeyFact), jf.dataset.role);
    const stop = e.target.closest("[data-stop]");
    if (stop) { const k = Number(stop.dataset.stop); stage.focusStop(stage.journey?.focus === k ? null : k); }
    if (e.target.closest("[data-end-journey]")) stage.setJourney(null);
    if (e.target.closest("[data-end-phase]")) handlers.endPhase?.();
    const pick = e.target.closest("[data-select]");
    if (pick) stage.select(pick.dataset.select);
    if (e.target.closest("[data-chain-all]")) handlers.chainAll?.();
    const row = e.target.closest(".qg-sb-row, .qg-card-ev");
    if (row) handlers.row?.(Number(row.dataset.row));
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
    else if (c.kind === "query") body = `<pre class="qg-code">${esc(ev.raw || `${ev.name}(${JSON.stringify(ev.spec)})`)}</pre>`;
    else if (c.kind === "window") body = `<p>${esc(short(c.ref.hypothesis, 320))}</p>`;
    else if (c.kind === "lane") body = `<p>${esc(short(c.ref.question, 300))}</p>${c.fill !== c.event ? `<details><summary>SQL</summary><pre class="qg-code qg-sql">${esc(scene.events[c.fill].sql || "")}</pre></details>` : ""}`;
    else if (c.kind === "candidate" || c.kind === "root") body = `<p>${esc(c.ref.proposition)}</p>${c.ref.quote ? `<blockquote>${esc(c.ref.quote)}</blockquote>` : ""}`;
    else if (c.kind === "core") body = `<p class="qg-muted">The whole compiled trajectory. Every access above draws its facts from here.</p>`;
    if (c.raw && c.kind !== "query") body += `<pre class="qg-code">${esc(c.raw)}</pre>`;
    const groups = c.groups.length ? `<h4>Entities <small>${c.groups.length}</small></h4>
      <ul class="qg-rows">${c.groups.map((g, gi) => `<li><button data-open="${esc(c.id)}" data-group="${gi}"><span>${esc(g.key)}</span><em>${g.fids.length}</em></button></li>`).join("")}</ul>` : "";
    const shared = c.kind !== "core" ? sharing(c) : [];
    const sharedHtml = shared.length ? `<h4>Shares facts with</h4><ul class="qg-rows">${shared.map(([o, k]) => `<li><button data-open="${esc(o.id)}"><span>${esc(clusterTitle(o))}</span><em>${k}</em></button></li>`).join("")}</ul>` : "";
    const phase = ev?.phase || "PARSE";
    panelBody.innerHTML = `${crumbs(c)}
      <p class="qg-kind"><span class="qg-chip" data-phase="${esc(phase)}">${esc(phase)}</span>${esc(c.kind)}${opened ? ` · <button class="qg-link" data-fold>fold</button>` : ""}</p>
      <h3>${esc(c.label)}</h3><p class="qg-muted">${esc(c.detail)}</p>
      ${!opened && c.groups.length ? `<button class="qg-open" data-open="${esc(c.id)}">Open by entity ›</button>` : ""}${!opened ? chainList(c) : ""}${body}${groups}${sharedHtml}
      <p class="qg-muted qg-run">Run <a href="${caseHref(ref)}" title="Open in the workbench">${esc(scene.meta.tid)}</a></p>`;
  }

  // The lit chain as a numbered list matching the badges on the stage: each step's two clouds,
  // what was asked along it and what came back. Parallel queries set aside are counted under
  // the step into their window, with a switch to show them all.
  function chainList(c) {
    if (!chain || chain.id !== c.id || !chain.edges.length) return "";
    const name = id => id === "core" ? "DSL record" : clusterTitle(model.byId.get(id));
    const extraNote = id => {
      const n = chain.extra.get(id)?.length;
      return n ? `<li class="qg-note">+${n} more quer${n === 1 ? "y" : "ies"} also returned these clues · <button class="qg-link" data-chain-all>show all</button></li>` : "";
    };
    return `<h4>Causal chain <small>${chain.edges.length} steps</small></h4>
      <ol class="qg-chain">${chain.edges.map((e, k) => `
        <li data-chain-edge="${k}" data-phase="${esc(model.byId.get(e.to).phaseKey)}"><b>${k + 1}</b><div>
          <strong>${esc(name(e.from))} → ${esc(name(e.to))}</strong>
          ${e.link.title ? `<span>${esc(e.link.title)}</span>` : ""}${e.link.detail ? `<em>${esc(e.link.detail)}</em>` : ""}</div></li>
        ${extraNote(e.to)}`).join("")}
      </ol>${chain.all ? `<p class="qg-muted">Showing every query that fed a window · <button class="qg-link" data-chain-all>fold</button></p>` : ""}`;
  }

  function showPhase(focus) {
    const ph = focus.phase, list = [...focus.members].map(id => model.byId.get(id));
    inspect.hidden = false;
    setPane("inspect", true);
    panelBody.innerHTML = `
      <p class="qg-kind"><span class="qg-chip" data-phase="${esc(ph)}">${esc(ph)}</span>phase · <button class="qg-link" data-end-phase>close</button></p>
      <h3>${esc(PHASE_NOTE[ph])}</h3><p class="qg-muted">${list.length} cloud${list.length === 1 ? "" : "s"} · ${focus.edges.length} links in or out</p>
      <ul class="qg-rows">${list.map(c => `<li><button data-select="${esc(c.id)}"><span>${esc(clusterTitle(c))}</span><em>${esc(c.detail)}</em></button></li>`).join("")}</ul>
      <p class="qg-hint">Click a cloud to light its whole chain; Esc or the phase button again lets go.</p>`;
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
    const f = j.fact;
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
        <li data-phase="${esc(s.phase)}"${s.branch ? ` data-branch="${s.branch}"` : ""}${j.focus === k ? ` class="on"` : ""}>
          <button data-stop="${k}"><b>${esc(s.num)}</b><span class="qg-chip" data-phase="${esc(s.phase)}">${esc(s.phase)}</span>
            <p>${esc(s.say)}</p>${s.quote ? `<blockquote>“${esc(s.quote)}”</blockquote>` : ""}</button>
          ${fold(k, [["where", stopTitle(s)], ...(s.kind === "core" ? [] : [["call", String(s.event).padStart(2, "0")]]), ["result", s.outcome]])}
        </li>
        ${k === j.endAt && j.endSay ? `<li class="qg-note qg-end" title="${esc(j.end)}">⊣ ${esc(j.endSay)}</li>` : ""}`).join("")}
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
      const next = scene.events.slice(i + 1).find(e => !e.error);
      $(".qg-cap-next").textContent = next ? `Next · ${next.phase} · ${next.title || ""}` : "End of the tour · switch to Overview to explore every cloud";
      $(".qg-caption").dataset.phase = ev.phase;
      clampCaption();
      root.classList.toggle("at-end", !next);
      const played = scene.events.filter(e => !e.error);
      $(".qg-count").textContent = `${String(played.indexOf(ev) + 1).padStart(2, "0")} / ${played.length}`;
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
      root.classList.toggle("is-story", mode === "story");
      root.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
      $(".qg-views").hidden = mode !== "overview";
      root.querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
      if (mode === "story") placeStory();
      else if (mode === "overview") {
        ticks.forEach(t => { t.classList.add("done"); t.classList.remove("now"); });
        root.querySelectorAll(".qg-phases button").forEach(b => { b.classList.add("done"); b.classList.remove("now"); });
        const chip = $(".qg-caption .qg-chip");
        chip.textContent = "OVERVIEW";
        chip.dataset.phase = "SUBMIT";
        $(".qg-cap-title").textContent = `${scene.events.length} calls · ${model.clusters.length} clouds`;
        $(".qg-cap-text").textContent = "Every access at once. Click a cloud to light the chain it belongs to, click it again to open it; the timeline and phase bar pick clouds too.";
        $(".qg-cap-next").textContent = "";
        $(".qg-caption").dataset.phase = "SUBMIT";
        clampCaption();
        $(".qg-count").textContent = `${scene.events.length} calls`;
        showCluster(model.byId.get("root") || model.byId.get("core"));
      } else this.setEvent(current);
      this.syncFollow();
    },
    setFilter(filter) {
      root.querySelectorAll("[data-filter-phase]").forEach(b => b.setAttribute("aria-pressed", String(!filter.phases.has(b.dataset.filterPhase))));
    },
    setRow(k) {
      root.querySelectorAll(".qg-sb-row").forEach((el, i) => {
        el.classList.toggle("is-hidden", i > k); el.classList.toggle("is-now", i === k);
        el.setAttribute("aria-current", String(i === k));
      });
      root.querySelectorAll(".qg-card-ev").forEach(el => {
        const i = Number(el.dataset.row);
        el.classList.toggle("is-hidden", i > k); el.classList.toggle("is-now", i === k);
      });
      const row = story.rows[k], say = $(".qg-sb-say");
      say.dataset.phase = row.phase;
      say.querySelector(".qg-chip").textContent = row.phase;
      say.querySelector("strong").textContent = row.question;
      say.querySelector(".qg-sb-answer").textContent = row.answer;
      $(".qg-sb-count").textContent = k < story.rows.length - 1 ? `${k + 1} / ${story.rows.length} · → next` : `${k + 1} / ${story.rows.length}`;
      root.querySelector(".qg-card-ev.is-now")?.scrollIntoView({block: "nearest"});
    },
    get journeyRole() { return journeyRole; },
    openPane(name) { setPane(name, true); },
    setChain(path) { chain = path; },
    // The phase in focus: its button pressed, and its clouds listed in the panel (quiet keeps the
    // panel as it is, for a pick that replaces it anyway).
    setPhase(focus, quiet = false) {
      root.querySelectorAll(".qg-phases button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.phase === focus?.phase)));
      if (quiet) return;
      if (focus) showPhase(focus);
      else this.inspect(null);
    },
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
    // Hover help never floats over the stage's lines: a cloud's or entity's own tag says what a
    // click does, an edge's card lies over the details panel's place (folded or not, so the
    // stage does not reframe), and only facts and journey stops keep a small tip by the pointer.
    hover(h) {
      panelBody.querySelectorAll(".qg-chain li.hi").forEach(li => li.classList.remove("hi"));
      if (h?.kind === "edge" && h.k != null) panelBody.querySelector(`[data-chain-edge="${h.k}"]`)?.classList.add("hi");
      const card = $(".qg-hovercard");
      if (h?.kind === "edge") {
        if (card.dataset.link !== h.link.title + h.link.detail) {
          card.dataset.link = h.link.title + h.link.detail;
          card.innerHTML = `<p class="qg-kind">hovered edge</p><h3>${esc(h.link.title)}</h3>${h.link.detail ? `<p class="qg-muted">${esc(h.link.detail)}</p>` : ""}
            <dl class="qg-card">${h.link.card.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(short(v, 360))}</dd>`).join("")}</dl>`;
        }
        card.hidden = false;
      } else if (!card.hidden) {
        card.hidden = true;
        card.dataset.link = "";
      }
      let html = "";
      const act = t => `<i class="qg-tip-act">${t}</i>`;
      if (h?.kind === "stop") html = `<b>${h.k + 1} · ${esc(h.stop.kind === "core" ? "DSL record" : clusterTitle(model.byId.get(h.stop.id)))}</b><span>${esc(h.stop.outcome)}</span>${act("click to fly there")}`;
      else if (h?.kind === "fact") { const f = scene.factById.get(h.fid); html = `<b>fact ${f.fid} · S${f.t} ${SLOT_LABEL[f.slot]}</b><em>${esc(short(typeof f.value === "string" ? f.value : JSON.stringify(f.value), 160))}</em>`; }
      if (!html) { tip.hidden = true; return; }
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
