import {esc, short, loader} from "../util.js?v=27bf1baa85";
import {caseHref, queryHref} from "../routes.js?v=27bf1baa85";
import {loadQueryScene, factRepr, SLOT_LABEL} from "../query/model.js?v=signs-79eb29e";
import {agentWords} from "../query/narrate.js?v=23f9bfd6b4";
import {buildClusters, chainPath, factLabel, journeyOf, phaseFocus, roleFacts} from "../query/clusters.js?v=signs-79eb29e";
import {layoutClusters, TIERS} from "../query/layout.js?v=23f9bfd6b4";
import {createStage, clusterTitle} from "../query/stage.js?v=signs-79eb29e";
import {createTour, eventDuration} from "../query/tour.js?v=23f9bfd6b4";
import {buildStory} from "../query/story.js?v=signs-79eb29e";
import {createDetails} from "../query/details.js?v=signs-79eb29e";
import {mountOverviewNarrative} from "../query/overview.js?v=signs-79eb29e";

const GROUP = "evidence-query-claims-n30-20261013";
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
const OVERVIEW_CAM = {
  front: {fit: true, target: [0, 7, 0], yaw: 0.55, pitch: 0.32, dist: 56},
  top: {fit: true, target: [0, 7, 0], yaw: 0.55, pitch: 1.42, dist: 56},
  side: {fit: true, target: [0, 7, 0], yaw: 0.55 + Math.PI / 2, pitch: 0.08, dist: 56},
};
const STORY_CAM = {fit: true, target: [0, 7, 0], yaw: 0.55, pitch: 0.32, dist: 56};
const PHASE_NOTE = {
  PARSE: "compile the log into the DSL record", MAP: "read the task goal", ROUTE: "query the record, open suspect windows",
  MANAGER: "turn each suspicion into a question", TRACE: "search the logs to test each suspicion", SUBMIT: "name the root cause",
};

export function mountQuery(app, route) {
  const ref = ["runs", ...(route.ref || DEFAULT_CASE)];
  app.innerHTML = `<div class="qg">${loader("Building the query graph…")}</div>`;
  const root = app.firstElementChild;
  let stage = null, narrative = null, keyHandler = null, destroyed = false;

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
    const playable = (i, d = 0) => {
      i = Math.max(0, Math.min(last, i));
      if (!scene.events[i].error) return i;
      const after = plays.find(k => k > i), before = plays.findLast(k => k < i);
      return d < 0 ? before ?? after : after ?? before;
    };
    const lastPlay = plays[plays.length - 1];
    const state = {i: 0, p: 0, playing: true, speed: 1, mode: "tour", view: "front", chain: null, phase: null,
                   filter: {phases: new Set()}, row: story.rows.length - 1};
    const ui = bindUi(root, scene, model, stage, roles, ref, story);
    const details = createDetails(root, scene, model, stage, {onOpen: () => setPlaying(false)});
    narrative = mountOverviewNarrative(root, scene, model, stage);
    ui.on("event", (ph, i) => { details.show(ph); details.caption(scene.events[i]); });
    ui.setEvent(state.i);

    stage.start(dt => {
      if (state.mode === "story") {
        const row = story.rows[state.row];
        const out = frameAt(row.event, 1);
        const beatSpec = row.bridge?.tower?.[state.beat - 1];
        const lit = state.peek || (beatSpec?.focus.length ? beatSpec.focus : row.focus);
        Object.assign(out.frame, {focus: new Set(lit), chain: state.chain?.chain || null, chainEdges: state.chain?.edges, phase: null, filter: state.filter, labelAll: false, mini: true});
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
      details.close();
      ui.setMode(mode, state.view);
      narrative.mode(mode);
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
    const pick = i => { stage.select(scene.events[i].cluster || "core"); narrative.event(i); };
    ui.on("seek", i => state.mode === "overview" ? pick(i) : go(i, 0.5));
    const setPhase = ph => {
      state.phase = ph ? phaseFocus(model, ph) : null;
      ui.setPhase(state.phase, state.mode === "overview");
      narrative.phase(ph);
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
    const follow = (role, fid) => {
      if (state.mode !== "overview") setMode("overview");
      setPhase(null);
      stage.setJourney(journeyOf(scene, model, fid ?? roles.byRole.get(role)[0]));
      ui.showJourney(role);
    };
    ui.on("journeyRole", (role, tab) => !tab && stage.journey && ui.journeyRole === role ? stage.setJourney(null) : follow(role));
    ui.on("journeyFact", (fid, role) => follow(role || roles.reach(fid), fid));
    ui.on("cta", () => follow(ctaOf(roles).role));
    stage.on("journey", j => ui.journey(j));
    ui.on("speed", s => { state.speed = s; });
    ui.on("follow", () => { stage.follow(); stage.release(); });
    ui.on("jump", i => { stage.follow(); go(i, 0.5); setPlaying(false); });
    stage.on("select", sel => {
      if (state.mode === "story" && sel?.kind === "cluster") {
        const hit = rowOf(sel.cluster.id);
        if (hit) {
          setRow(hit.k);
          if (hit.beat) { state.beat = hit.beat; showBeat(); }
          return;
        }
      }
      if (sel) { setPlaying(false); if (state.phase) { state.phase = null; ui.setPhase(null, true); } }
      const id = sel?.cluster && sel.cluster.id !== "core" ? sel.cluster.id : null;
      if (id !== state.chain?.id) state.chainAll = false;
      state.chain = id ? chainPath(model, id, state.chainAll) : null;
      ui.setChain(state.chain);
      ui.inspect(sel);
      narrative.selection(sel);
    });
    stage.on("details", id => narrative.details(id));
    ui.on("chainAll", () => {
      if (!state.chain) return;
      state.chainAll = !state.chainAll;
      state.chain = chainPath(model, state.chain.id, state.chainAll);
      ui.setChain(state.chain);
      ui.inspect({kind: "cluster", cluster: model.byId.get(state.chain.id), opened: false});
    });
    stage.on("manual", () => ui.syncFollow());
    stage.on("view", () => ui.syncFollow());
    stage.on("hover", h => { ui.hover(state.mode === "overview" ? null : h); narrative.hover(h); });
    keyHandler = e => {
      if (e.target.closest("input, textarea, select")) return;
      if (e.key === "Escape" && details.isOpen) { details.close(); return; }
      const j = stage.journey;
      if (state.mode === "story" && !stage.view.cluster && [" ", "ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        if (e.key === "Home" || e.key === "End") setRow(e.key === "Home" ? 0 : story.rows.length - 1);
        else stepStory(e.key === "ArrowLeft" ? -1 : 1);
      } else if (j && !stage.view.cluster && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        const k = j.focus == null ? (e.key === "ArrowRight" ? 0 : j.stops.length - 1) : j.focus + (e.key === "ArrowRight" ? 1 : -1);
        stage.focusStop(k < 0 || k >= j.stops.length ? null : k);
      } else if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") go(state.i + 1, 0, 1);
      else if (e.key === "ArrowLeft") go(state.i - 1, 0, -1);
      else if (e.key === "Escape") stage.back();
    };
    document.addEventListener("keydown", keyHandler);
    const beats = k => story.rows[k]?.bridge?.beats || null;
    const towerBeat = () => {
      stage.markFacts([]);
      if (stage.journey) stage.setJourney(null);
    };
    const showBeat = () => {
      const b = beats(state.row);
      towerBeat();
      if (!b) return;
      ui.setBeat(state.beat, b[state.beat - 1]);
      $count().textContent = `${state.row + 1} / ${story.rows.length} · beat ${state.beat}/${b.length}`;
    };
    const $count = () => root.querySelector(".qg-sb-count");
    const stepStory = d => {
      const b = beats(state.row);
      if (b && state.beat + d >= 1 && state.beat + d <= b.length) { state.beat += d; showBeat(); return; }
      const next = state.row + d;
      setRow(next);
      if (beats(state.row)) { state.beat = d < 0 ? beats(state.row).length : 1; showBeat(); }
    };
    const setRow = k => {
      state.row = Math.max(0, Math.min(story.rows.length - 1, k));
      state.beat = beats(state.row)?.length || 0;
      stage.clearHover();
      stage.select(null);
      stage.release();
      state.chain = null;
      ui.setRow(state.row);
      showBeat();
    };
    ui.on("row", setRow);
    ui.on("peekRow", k => { state.peek = k == null ? null : story.rows[k]?.focus || null; });
    ui.on("peekMark", n => { state.peek = n == null ? null : story.rows[state.row]?.bridge?.tower?.marks?.[n]?.focus || null; });
    stage.on("hover", h => {
      if (state.mode !== "story") return;
      const c = h?.kind === "cluster" ? h.cluster : null;
      ui.peekSteps(c && c.kind !== "core" ? [...new Set(c.fids.map(f => scene.factById.get(f)?.t).filter(t => t != null))] : null);
    });
    const rowOf = id => {
      if (id === "core") return {k: 0};
      for (let k = 0; k < story.rows.length; k++) {
        const r = story.rows[k], beat = r.bridge?.tower?.findIndex(b => b.focus.includes(id));
        if (beat >= 0) return {k, beat: beat + 1};
        if (r.focus.includes(id)) return {k};
      }
      return null;
    };
    const asked = route.query?.get("mode");
    if (asked === "overview" || asked === "story") setMode(asked);
  }).catch(error => {
    if (destroyed) return;
    root.innerHTML = `<div class="qg-error"><h2>Could not build the query graph</h2><p>${esc(error.message)}</p>
      <p>Open a run from <a href="#/runs">Runs</a>, or use <code>${esc(queryHref(DEFAULT_CASE))}</code>.</p></div>`;
  });

  return {
    unmount() {
      destroyed = true;
      narrative?.destroy();
      stage?.destroy();
      if (keyHandler) document.removeEventListener("keydown", keyHandler);
    },
  };
}

const ROLE_ROWS = [
  {role: "issue", label: "clue in a suspect window", tab: "clue"},
  {role: "candidate", label: "step TRACE blames", tab: "blamed"},
  {role: "root", label: "root cause", tab: "root"},
];
const REACH = {issue: "clue only", candidate: "blamed", root: "ROOT"};

const ctaOf = roles => [{role: "root", name: "root cause"}, {role: "candidate", name: "blamed step"}, {role: "issue", name: "clues"}]
  .find(r => roles.byRole.get(r.role).length);

const pct = v => `${v.toFixed(2)}%`;
function storyMarks(row, ax) {
  const at = s => pct(ax.x(s));
  const side = s => ax.x(s) > 22 ? "is-left" : "is-raised";
  const note = (s, t, cls = "") => `<em class="sb-note ${cls} ${side(s)}" style="left:${at(s)}">${esc(t)}</em>`;
  const dot = (s, tone, extra = "", tip = "") => `<i class="sb-dot" data-tone="${tone}" style="left:${at(s)}${extra}"${tip ? ` title="${esc(tip)}"` : ""}></i>`;
  const dia = (s, kind, tip = "") => `<i class="sb-dia" data-kind="${kind}" style="left:${at(s)}"${tip ? ` title="${esc(tip)}"` : ""}></i>`;
  const bar = (p, q, cls = "", top = "") => { const [l, w] = ax.span(p, q); return `<i class="sb-bar ${cls}" style="left:${pct(l)};width:${pct(w)}${top}"></i>`; };
  const SIG = {goal: "touches the goal", invalid: "action with no effect", noise: "routine, no new progress"};
  const cross = (s, extra = "", tip = "") => `<i class="sb-x" style="left:${at(s)}${extra}"${tip ? ` title="${esc(tip)}"` : ""}></i>`;
  const lanesEnd = [];
  const laneOf = (a, b) => { let k = lanesEnd.findIndex(e => e < a); if (k < 0) k = lanesEnd.length; lanesEnd[k] = b; return k; };
  const rangeLane = new Map(row.marks.filter(m => m.type === "range" && m.tone !== "all").sort((x, y) => x.a - y.a).map(m => [m, laneOf(m.a, m.b)]));
  const folds = new Map();
  const fold = (s, key) => { const band = ax.bands.find(b => b.fold && s >= b.a && s <= b.b); const m = folds.get(band) || new Map(); m.set(key, (m.get(key) || 0) + 1); folds.set(band, m); };
  const html = row.marks.map(m => {
    if ((m.type === "signal" || m.type === "hit") && ax.folded(m.step)) { fold(m.step, m.type === "hit" ? "hit" : m.kind); return ""; }
    switch (m.type) {
      case "cell": { const [l, w] = ax.span(m.a, m.b);
        return `<span class="sb-cell is-${m.tone}" style="left:${pct(l)};width:${pct(w)}"${m.tip ? ` title="${esc(m.tip)}"` : ""}><b>${esc(m.text)}</b></span>${m.note ? `<em class="sb-note is-cell" style="left:${pct(l + w)}">${esc(m.note)}</em>` : ""}`; }
      case "x": return `${cross(m.step, "", `step ${m.step}: ${m.label || "goal fails"}`)}${m.label ? note(m.step, m.label, "is-bad") : ""}`;
      case "signal": return dot(m.step, m.kind, "", `step ${m.step}: ${SIG[m.kind]}${m.tip ? ` (${m.tip})` : ""}`);
      case "range": {
        const [l, w] = ax.span(m.a, m.b);
        if (m.tone === "all") return `<i class="sb-bar is-all" style="left:${pct(l)};width:${pct(w)};top:5px" title="the whole run: steps ${m.a}–${m.b}"></i>`;
        const top = 22 + rangeLane.get(m) * 18, word = m.tone === "near" ? "read closely" : "contrast";
        const text = w < 11 ? `S${m.a}–${m.b}` : `${word} · S${m.a}–${m.b}`;
        return `<i class="sb-bar is-${m.tone}" style="left:${pct(l)};width:${pct(w)};top:${top}px"></i><em class="sb-tag is-${m.tone}" style="left:${pct(l + w / 2)};top:${top}px" title="${esc(`${word === "contrast" ? "read for contrast" : "read closely"}: steps ${m.a}–${m.b}`)}">${esc(text)}</em>`;
      }
      case "anchor": return `${dia(m.step, "suspect")}${m.label ? note(m.step, m.label, "is-anchor") : ""}`;
      case "question": return dia(m.step, "pending");
      case "hit": { const [l, w] = ax.col(m.step); return `<i class="sb-bar is-hit" style="left:${pct(l + w * 0.32)};width:${pct(w * 0.36)}"></i>`; }
      case "tnode": return m.lane === "goal" ? cross(m.step, ";top:28%", `step ${m.step}: goal check fails`) : dot(m.step, m.lane === "env" ? "env" : "agent", `;top:${m.lane === "env" ? 72 : 50}%`, `step ${m.step}: ${m.lane === "env" ? "the world shows" : "the agent believes or does"}`);
      case "bworld": return dot(m.step, "env", ";top:72%", `step ${m.step}: the world shows`);
      case "blink": return dot(m.step, m.role === "root" ? "root" : m.role === "guess" ? "guess" : "agent", `;margin-left:${m.shift * 9}px`, `step ${m.step}: ${LINK_SAY[m.role]}`);
      case "bfail": return cross(m.step, ";top:28%", `step ${m.step}: the goal fails`);
      case "blamed": return dia(m.step, "cand");
      case "rival": return `${dia(m.step, "rival", m.tip)}${m.label ? note(m.step, m.label, "is-struck") : ""}`;
      case "root": return `${dia(m.step, "root")}${note(m.step, m.label, "is-root")}`;
      default: return "";
    }
  }).join("");
  const counts = [...folds].map(([band, m]) => { const [l, w] = ax.span(band.a, band.b);
    return `<span class="sb-fold" style="left:${pct(l)};width:${pct(w)}">${[...m].map(([k, c]) => `<span title="steps ${band.a}–${band.b}: ${c} × ${k === "hit" ? "step read" : SIG[k]}">${k === "hit" ? `<i class="sb-bar is-hit"></i>` : `<i class="sb-dot" data-tone="${k}"></i>`}${c}</span>`).join("")}</span>`; }).join("");
  return html + counts;
}

const LINK_SAY = {guess: "the agent's guess", root: "the agent's first unsupported commitment", repeat: "the agent relies on the link again", commit: "the agent links it to the goal"};

const LANE_TOP = {goal: 22, env: 56, agent: 90};
const LANE_NAME = [["goal", "Goal check"], ["env", "Environment shows"], ["agent", "Agent believes or does"]];
function threadPanel(th) {
  const steps = Array.from({length: th.to - th.from + 1}, (_, i) => th.from + i);
  const weight = s => s === th.anchor ? 3.4 : 1, total = steps.reduce((n, s) => n + weight(s), 0);
  let acc = 0;
  const FILL = 88;
  const x = new Map(steps.map(s => { const c = (acc + weight(s) / 2) / total * FILL; acc += weight(s); return [s, c]; }));
  const span = s => { let a = 0; for (const t of steps) { if (t === s) return [a / total * FILL, weight(t) / total * FILL]; a += weight(t); } return [0, 0]; };
  const stack = new Map();
  const chips = th.nodes.map(n => {
    const k = n.lane === "agent" ? (stack.get(n.step) || 0) : 0;
    if (n.lane === "agent") stack.set(n.step, k + 1);
    const tip = `step ${n.step} · ${n.lane === "env" ? "observation" : n.slot === "chk" ? "goal check" : n.slot}\n${n.full || n.label}`;
    return `<span class="th-node" data-id="${n.id}" data-lane="${n.lane}" style="left:${x.get(n.step).toFixed(2)}%;top:${LANE_TOP[n.lane] + k * 30}px" title="${esc(tip)}">${esc(n.label)}${n.sub ? ` <small>${esc(n.sub)}</small>` : ""}</span>`;
  });
  const deepest = Math.max(1, ...stack.values());
  const traceTop = LANE_TOP.agent + deepest * 30 + 4;
  const col = (s, cls) => { const [l, w] = span(s); return `<i class="th-col ${cls}" style="left:${l.toFixed(2)}%;width:${w.toFixed(2)}%"></i>`; };
  const failAt = th.trace?.from;
  return `
    <div class="qg-thread" data-links="${esc(JSON.stringify(th.links))}" data-trace="${th.trace ? `${x.get(th.trace.from)},${x.get(th.trace.to)}` : ""}" style="--trace-top:${traceTop}px">
      <span class="th-lanes">${LANE_NAME.map(([k, t]) => `<b style="top:${LANE_TOP[k]}px">${t}</b>`).join("")}${th.trace ? `<b class="is-trace" style="top:${traceTop}px">Debugger traces back</b>` : ""}</span>
      <span class="th-track">
        ${col(th.anchor, "is-anchor")}${failAt ? col(failAt, "is-fail") : ""}
        ${steps.map(s => `<em class="th-step${s === th.anchor || s === failAt ? " is-marked" : ""}" style="left:${x.get(s).toFixed(2)}%">${s}</em>`).join("")}
        <svg class="th-links" aria-hidden="true"></svg>
        ${chips.join("")}
        ${th.trace ? `<em class="th-trace-label" style="left:${((x.get(th.trace.from) + x.get(th.trace.to)) / 2).toFixed(2)}%;top:${traceTop + 14}px">${esc(th.trace.label)}</em>` : ""}
      </span>
    </div>`;
}

function bridgePanel(br, row) {
  const t = br.table;
  return `
    <div class="qg-bridge" data-bridge="${esc(JSON.stringify(br))}">
      <header><i>Evidence · S${t.root.step}</i><h3>${esc(row.short)}</h3></header>
      <div class="br-body">
        <span class="br-lanes">
          <span class="br-lane" data-lane="need" data-beat="1"><i>Goal needs</i><b>${esc(t.need)}</b>${t.needSub ? `<small>${esc(t.needSub)}</small>` : ""}</span>
          <span class="br-lane" data-lane="link" data-beat="3"><i>Agent assumed</i></span>
          <span class="br-lane" data-lane="got" data-beat="2"><i>World showed</i></span>
        </span>
        <span class="br-track"><svg class="br-svg" role="img"><title>Evidence bridge</title></svg></span>
      </div>
    </div>`;
}

function storyBoard(story, phaseNo) {
  const ax = story.axis;
  const marked = new Set(story.cols.map(c => c.step));
  const axis = ax.bands.map(b => b.fold
    ? `<span class="is-fold" style="left:${pct(ax.span(b.a, b.b)[0])};width:${pct(ax.span(b.a, b.b)[1])}">${b.a}–${b.b}</span>`
    : Array.from({length: b.b - b.a + 1}, (_, i) => b.a + i).map(s => `<span${marked.has(s) ? ` class="is-marked"` : ""} style="left:${pct(ax.x(s))}">${s}</span>`).join("")).join("");
  const open = ax.bands.find(b => !b.fold);
  const under = [
    ...ax.bands.filter(b => b.fold).map(b => { const [l, w] = ax.span(b.a, b.b); return `<i class="is-fold" style="left:${pct(l)};width:${pct(w)}"></i>`; }),
    ...Array.from({length: open.b - open.a + 2}, (_, i) => `<i class="is-line" style="left:${pct(i <= open.b - open.a ? ax.col(open.a + i)[0] : ax.span(open.a, open.b).reduce((p, q) => p + q))}"></i>`),
    ...story.cols.map(c => { const [l, w] = ax.col(c.step); return `<i class="is-col" data-tone="${c.tone}" style="left:${pct(l)};width:${pct(w)}"></i>`; }),
  ].join("");
  const lanes = r => { const ends = []; r.marks.filter(m => m.type === "range" && m.tone !== "all").sort((x, y) => x.a - y.a)
    .forEach(m => { const k = ends.findIndex(e => e < m.a); ends[k < 0 ? ends.length : k] = m.b; }); return Math.max(0, ends.length - 1); };
  return `
    <section class="qg-board" aria-label="Case board">
      <span class="qg-sb-under" aria-hidden="true">${under}</span>
      <div class="qg-sb-axis"><span class="qg-sb-lab">Agent step</span><span class="qg-sb-track">${axis}</span></div>
      ${story.rows.map((r, k) => `
      <button class="qg-sb-row" data-row="${k}" data-key="${r.key}" data-phase="${r.phase}"${lanes(r) ? ` style="--lanes:${lanes(r)}"` : ""} title="${esc(`${r.question}
${r.answer}`)}">
        <span class="qg-sb-lab"><i class="qg-chip" data-phase="${r.phase}" title="${esc(PHASE_NOTE[r.phase] || "")}">${k && story.rows[k - 1].phase === r.phase ? "" : `${phaseNo(r.phase) === "00" ? "" : `<span>${phaseNo(r.phase)}</span>`}${r.phase}`}</i><span class="qg-sb-qa"><b class="is-q">${esc(r.question)}</b><b class="is-a">${esc(r.short || r.question)}</b></span>${r.count != null ? `<em class="qg-sb-n">${r.count} step${r.count === 1 ? "" : "s"}</em>` : ""}</span>
        <span class="qg-sb-track">${storyMarks(r, ax)}</span>
      </button>`).join("")}
      <svg class="qg-sb-path" aria-hidden="true"></svg>
      <span class="qg-sb-peek" aria-hidden="true"></span>
      ${story.rows.filter(r => r.thread).map(r => r.bridge ? bridgePanel(r.bridge, r) : threadPanel(r.thread)).join("")}
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
        <div class="qg-seg" role="group" aria-label="Mode"><button data-mode="story" aria-pressed="false">Story</button><button data-mode="tour" aria-pressed="true">Tour</button><button data-mode="overview" aria-pressed="false">Overview</button></div>
        <div class="qg-seg qg-views" role="group" aria-label="Camera" hidden><button data-view="front">Front</button><button data-view="top">Top</button><button data-view="side">Side</button></div>
      </div>
      <ol class="qg-phases">${PHASES.filter(ph => scene.events.some(e => e.phase === ph)).map((ph, k) => `<li><button data-phase="${ph}" title="${esc(PHASE_NOTE[ph])}"><span>${String(k + 1).padStart(2, "0")}</span><b>${ph}</b></button></li>`).join("")}</ol>
    </header>
    ${storyBoard(story, ph => String(PHASES.filter(p => scene.events.some(e => e.phase === p)).indexOf(ph) + 1).padStart(2, "0"))}
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
  function placeStory() {
    const head = $(".qg-head"), board = $(".qg-board");
    root.style.setProperty("--qg-story-top", `${head.offsetTop + head.offsetHeight + 10}px`);
    root.style.setProperty("--qg-tower-top", `${board.offsetTop + board.offsetHeight + 8}px`);
  }
  new ResizeObserver(() => root.classList.contains("is-story") && placeStory()).observe($(".qg-board"));
  function drawThread() {
    const panel = $(".qg-thread"), board = $(".qg-board");
    if (!panel || !board.classList.contains("is-zoomed")) return;
    const track = panel.querySelector(".th-track"), svg = panel.querySelector(".th-links"), base = track.getBoundingClientRect();
    const chips = [...panel.querySelectorAll(".th-node")];
    chips.forEach(c => { c.style.maxWidth = ""; });
    for (let pass = 0; pass < 3; pass++) for (const a of chips) for (const b of chips) {
      if (a === b) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      if (ra.bottom <= rb.top || rb.bottom <= ra.top || ra.right + 8 <= rb.left || rb.right + 8 <= ra.left || ra.width < rb.width) continue;
      const over = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) + 8;
      a.style.maxWidth = `${Math.max(80, ra.width - 2 * over)}px`;
    }
    const box = id => { const r = panel.querySelector(`[data-id="${id}"]`).getBoundingClientRect(); return {l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top, cx: (r.left + r.right) / 2 - base.left, cy: (r.top + r.bottom) / 2 - base.top}; };
    const paths = JSON.parse(panel.dataset.links).map(([from, to]) => {
      const a = box(from), b = box(to);
      if (Math.abs(a.cx - b.cx) < 4) return b.t > a.b ? `M${a.cx} ${a.b} V${b.t - 2}` : `M${a.cx} ${a.t} V${b.b + 2}`;
      const right = b.cx > a.cx, tx = b.cx + (right ? -16 : 16);
      const sx = right ? a.r : a.l;
      return b.t > a.cy ? `M${sx} ${a.cy} H${tx} V${b.t - 2}` : `M${sx} ${a.cy} H${tx} V${b.b + 2}`;
    });
    const [from, to] = (panel.dataset.trace || "").split(",").map(Number);
    const y = parseFloat(panel.style.getPropertyValue("--trace-top")) + 8, W = base.width;
    svg.setAttribute("viewBox", `0 0 ${W} ${base.height}`);
    svg.innerHTML = `<defs><marker id="th-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.6"/></marker></defs>`
      + paths.map(d => `<path class="th-link" d="${d}" marker-end="url(#th-arrow)"/>`).join("")
      + (Number.isFinite(from) ? `<circle class="th-trace-dot" cx="${from / 100 * W}" cy="${y}" r="5"/><path class="th-trace" d="M${from / 100 * W} ${y} H${to / 100 * W + 10}" marker-end="url(#th-arrow)"/>` : "");
  }
  new ResizeObserver(drawThread).observe($(".qg-board"));
  const boardEl = $(".qg-board");
  boardEl.addEventListener("mouseover", e => {
    const mark = e.target.closest("[data-mark]");
    if (mark) { handlers.peekMark?.(mark.dataset.mark); return; }
    const row = e.target.closest(".qg-sb-row");
    handlers.peekRow?.(row && !row.classList.contains("is-hidden") ? Number(row.dataset.row) : null);
  });
  boardEl.addEventListener("mouseleave", () => { handlers.peekRow?.(null); });
  let beat = 6;
  let shown = 0;
  function drawPath() {
    const board = $(".qg-board"), svg = $(".qg-sb-path"), P = story.path;
    if (!svg) return;
    svg.innerHTML = "";
    if (!P || !root.classList.contains("is-story") || board.classList.contains("is-zoomed")) return;
    const base = board.getBoundingClientRect(), track = board.querySelector(".qg-sb-row .qg-sb-track").getBoundingClientRect();
    const X = s => track.left - base.left + story.axis.x(s) / 100 * track.width;
    const box = key => { const el = board.querySelector(`.qg-sb-row[data-key="${key}"]`); if (!el || Number(el.dataset.row) > shown) return null;
      const r = el.getBoundingClientRect(); return {top: r.top - base.top, mid: (r.top + r.bottom) / 2 - base.top, bottom: r.bottom - base.top}; };
    const anchor = box("anchor");
    if (!anchor) return;
    svg.setAttribute("viewBox", `0 0 ${base.width} ${base.height}`);
    let out = `<defs><marker id="sb-path-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1L9 5L1 9Z" class="sb-path-head"/></marker></defs>`;
    const xs = X(P.sus);
    if (P.fail != null && box("goal")) {
      const xf = X(P.fail), y0 = box("goal").mid + 8, yb = anchor.top;
      out += `<path class="sb-path" d="M${xf} ${y0}V${yb}H${xs}V${anchor.top + 5}" marker-end="url(#sb-path-arrow)"/>`;
      out += `<text class="sb-path-label" x="${xf - 10}" y="${yb - 5}" text-anchor="end">Trace back</text>`;
    }
    const below = ["thread", "manager", "trace", "verdict"].map(box).filter(Boolean);
    if (below.length) {
      const last = below[below.length - 1], xr = X(P.root);
      const turn = box("trace")?.top ?? last.mid;
      const d = xr === xs ? `M${xs} ${anchor.mid}V${last.mid}` : `M${xs} ${anchor.mid}V${Math.min(turn, last.mid)}H${xr}V${last.mid}`;
      out += `<path class="sb-path" d="${d}"/>`;
    }
    svg.innerHTML = out;
  }
  new ResizeObserver(drawPath).observe($(".qg-board"));
  function drawBridge() {
    const panel = $(".qg-bridge"), board = $(".qg-board");
    if (!panel || !board.classList.contains("is-zoomed")) return;
    const br = JSON.parse(panel.dataset.bridge), t = br.table, track = panel.querySelector(".br-track"), svg = panel.querySelector(".br-svg");
    const W = track.clientWidth, H = track.clientHeight;
    if (H < 80) return;
    const steps = Array.from({length: br.to - br.from + 1}, (_, i) => br.from + i);
    const X = s => story.axis.x(s) / 100 * W, colOf = s => story.axis.col(s).map(v => v / 100 * W);
    const yTop = 26, yBot = H - 44, yMid = (yTop + yBot) / 2;
    const end = Math.min(W, (story.axis.span(br.from, br.to).reduce((p, q) => p + q) + 2) / 100 * W);
    const tip = s => `<title>${esc(s)}</title>`;
    const parts = [];
    for (const [s, cls] of [[br.anchor, "is-anchor"], [br.fail, "is-fail"]]) if (s != null && s >= br.from && s <= br.to) { const [l, w] = colOf(s); parts.push(`<rect class="br-col ${cls}" x="${l}" y="0" width="${w}" height="${H - 20}"/>`); }
    parts.push(`<line class="br-ruler" x1="0" y1="${H - 18}" x2="${end}" y2="${H - 18}"/>`);
    for (const s of steps) parts.push(`<text class="br-step${s === br.anchor || s === br.fail ? " is-on" : ""}" x="${X(s)}" y="${H - 3}">${s}</text>`);
    parts.push(`<g data-beat="1"><line class="br-rail is-need" x1="0" y1="${yTop}" x2="${end}" y2="${yTop}"/></g>`);
    const xw = t.worldStep != null ? X(t.worldStep) : null;
    const worldText = `${t.worldStep != null ? `S${t.worldStep} · ` : ""}${t.world}${t.worldSub ? ` · ${t.worldSub}` : ""}`;
    const fitsRight = xw != null && xw + worldText.length * 7.4 < W;
    parts.push(`<g data-beat="2" data-mark="1"><line class="br-rail is-got" x1="0" y1="${yBot}" x2="${end}" y2="${yBot}"/>${xw != null ? `<rect class="br-pt is-got" x="${xw - 4}" y="${yBot - 4}" width="8" height="8"/><text class="br-note is-got" x="${fitsRight ? xw - 4 : xw + 4}" y="${yBot + 20}" text-anchor="${fitsRight ? "start" : "end"}">${esc(worldText)}</text>` : ""}</g>`);
    const rootB = br.bridges.find(b => b.role === "root"), guessB = br.bridges.find(b => b.role === "guess");
    const xr = X(rootB.step) + (guessB && guessB.step === rootB.step ? 14 : 0);
    if (guessB && t.guess) {
      const xg = X(guessB.step) - (guessB.step === rootB.step ? 14 : 0);
      parts.push(`<g data-beat="3" data-mark="2">${tip(guessB.quotes.join("\n"))}<line class="br-link is-guess" x1="${xg}" y1="${yTop + 4}" x2="${xg}" y2="${yBot - 4}"/><text class="br-kicker" x="${xg - 10}" y="${yMid - 8}" text-anchor="end">S${t.guess.step} · GUESS</text><text class="br-label is-guess" x="${xg - 10}" y="${yMid + 12}" text-anchor="end">${esc(t.guess.text)}</text></g>`);
    }
    const lines = t.root.text.split(" ").reduce((o, w) => { const l = o[o.length - 1]; if (l && (l + " " + w).length <= 26) o[o.length - 1] = l + " " + w; else o.push(w); return o; }, []);
    if (lines.length > 2) lines.splice(1, lines.length, lines.slice(1).join(" "));
    lines[0] = "\u201c" + lines[0]; lines[lines.length - 1] += "\u201d";
    const ly = yMid - 4 - (lines.length - 1) * 10;
    parts.push(`<g data-beat="${guessB ? 4 : 3}" data-mark="3">${tip(t.root.quote)}<line class="br-link is-root" x1="${xr}" y1="${yTop + 4}" x2="${xr}" y2="${yBot - 4}"/><text class="br-kicker is-root" x="${xr + 12}" y="${ly - 22}">S${t.root.step} · ${esc(t.root.module.toUpperCase())}</text><text class="br-label is-root" x="${xr + 12}" y="${ly}">${lines.map((l, i) => `<tspan x="${xr + 12}" dy="${i ? 20 : 0}">${esc(l)}</tspan>`).join("")}</text></g>`);
    if (xw != null) { const far = Math.abs(xr - xw) >= 40, xn = far ? (xr + xw) / 2 : xr, yn = far ? yBot : yBot - 26;
      parts.push(`<g data-beat="4"><circle class="br-neq-bg" cx="${xn}" cy="${yn}" r="11"/><text class="br-neq" x="${xn}" y="${yn + 6}">\u2260</text></g>`); }
    const repeats = br.bridges.filter(b => b.role === "repeat");
    if (repeats.length) {
      const xl = Math.max(...repeats.map(b => X(b.step)));
      parts.push(`<g data-beat="5" data-mark="4">${repeats.map(b => `<line class="br-link is-repeat" x1="${X(b.step)}" y1="${yTop + 4}" x2="${X(b.step)}" y2="${yBot - 4}"/>`).join("")}<text class="br-label is-repeat" x="${xl + 10}" y="${yMid + 4}">${esc(repeats.map(b => `S${b.step}`).join(", "))} rely on it again</text></g>`);
    }
    if (br.fail != null && br.fail >= br.from && br.fail <= br.to) {
      const x = X(br.fail);
      parts.push(`<g data-beat="5" data-mark="5"><path class="br-x" d="M${x - 6} ${yTop - 6}L${x + 6} ${yTop + 6}M${x + 6} ${yTop - 6}L${x - 6} ${yTop + 6}"/><text class="br-kicker is-fail" x="${x + 12}" y="${yTop - 8}">S${br.fail} · ${esc(t.outcome.toUpperCase())}</text></g>`);
    }
    parts.push(`<g data-beat="6"><rect class="br-tag" x="${xr + 12}" y="${ly - 50}" width="86" height="16"/><text class="br-tag-text" x="${xr + 55}" y="${ly - 38}">ROOT CAUSE</text></g>`);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `<title>Evidence bridge</title>${parts.join("")}`;
    const place = (lane, y) => { const el = panel.querySelector(`[data-lane="${lane}"]`); el.style.top = `${y}px`; };
    place("need", yTop); place("link", yMid); place("got", yBot);
    setBeat(beat);
  }
  new ResizeObserver(drawBridge).observe($(".qg-board"));
  function setBeat(b) {
    beat = b;
    $(".qg-bridge")?.querySelectorAll("[data-beat]").forEach(el => el.classList.toggle("is-on", Number(el.dataset.beat) <= b));
  }
  const ticks = [...root.querySelectorAll(".qg-tick")];
  const handlers = {};
  const inspect = $(".qg-inspect"), panelBody = $(".qg-inspect-body"), tip = $(".qg-tip");
  let current = 0, journeyRole = null, chain = null;
  const setPane = (name, open) => {
    const pane = $(`.qg-${name}`);
    pane.classList.toggle("is-collapsed", !open);
    pane.querySelector(".qg-pane-tab").setAttribute("aria-expanded", String(open));
  };

  const foot = $(".qg-foot");
  new ResizeObserver(() => { root.style.setProperty("--qg-foot-h", `${foot.offsetHeight}px`); clampCaption(); }).observe(foot);
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
    if (root.classList.contains("is-overview") && c.narrative) {
      panelBody.innerHTML = `${crumbs(c)}<p class="qg-kind">Evidence index · ${esc(c.kind)}</p>
        <h3>${esc(clusterTitle(c))}</h3><p class="qg-muted">${c.fids.length} mapped facts. Select an entity or fact to inspect its source.</p>
        <button class="ovn-more" data-ov-more>Explain this investigation</button>
        ${groups}${sharedHtml}<details><summary>Recorded request / assessment</summary>${body}</details>
        <p class="qg-hint">Association does not establish a bug or a causal relationship.</p>`;
      return;
    }
    panelBody.innerHTML = `${crumbs(c)}
      <p class="qg-kind"><span class="qg-chip" data-phase="${esc(phase)}">${esc(phase)}</span>${esc(c.kind)}${opened ? ` · <button class="qg-link" data-fold>fold</button>` : ""}</p>
      <h3>${esc(c.label)}</h3><p class="qg-muted">${esc(c.detail)}</p>
      ${!opened && c.groups.length ? `<button class="qg-open" data-open="${esc(c.id)}">Open by entity ›</button>` : ""}${!opened ? chainList(c) : ""}${body}${groups}${sharedHtml}
      <p class="qg-muted qg-run">Run <a href="${caseHref(ref)}" title="Open in the workbench">${esc(scene.meta.tid)}</a></p>`;
  }

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
      ${f.span ? `<blockquote>${esc(root.classList.contains("is-overview") ? f.span : short(f.span, 420))}</blockquote>` : ""}
      ${root.classList.contains("is-overview") ? `<button class="ovn-inline" data-ov-step="${f.t}">Read original step S${f.t} ↗</button>` : ""}
      ${roles.reach(fid) ? `<button class="qg-open" data-journey-fact="${fid}">Follow its journey ›</button>` : ""}
      <h4>Returned by <small>${seen.length}</small></h4>
      <ul class="qg-rows">${seen.map(o => `<li><button data-open="${esc(o.id)}"><span>${esc(clusterTitle(o))}</span><em>T${o.tier}</em></button></li>`).join("")}</ul>`;
  }

  function renderJourney(j) {
    const role = journeyRole;
    const fids = roles.byRole.get(role) || [];
    const f = j.fact;
    const stopTitle = s => s.kind === "core" ? "DSL record" : clusterTitle(model.byId.get(s.id));
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
      handlers.event?.(ev.phase, i);
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
      $(".qg-board").classList.toggle("is-zoomed", !!row.thread);
      root.classList.toggle("is-bridge", !!row.thread);
      shown = k;
      requestAnimationFrame(() => { drawPath(); if (row.thread) { drawThread(); drawBridge(); } });
      say.dataset.phase = row.phase;
      say.querySelector(".qg-chip").textContent = row.phase;
      say.querySelector(".qg-chip").title = PHASE_NOTE[row.phase] || "";
      say.querySelector("strong").textContent = row.question;
      say.querySelector(".qg-sb-answer").textContent = row.answer;
      $(".qg-sb-count").textContent = k < story.rows.length - 1 ? `${k + 1} / ${story.rows.length} · → next` : `${k + 1} / ${story.rows.length}`;
      root.querySelector(".qg-card-ev.is-now")?.scrollIntoView({block: "nearest"});
    },
    peekSteps(steps) {
      const layer = $(".qg-sb-peek");
      layer.innerHTML = (steps || []).map(s => { const [l, w] = story.axis.col(s); return `<i style="left:${pct(l)};width:${pct(w)}"></i>`; }).join("");
      layer.classList.toggle("is-on", !!steps?.length);
    },
    setBeat(b, line) {
      setBeat(b);
      if (line) $(".qg-sb-answer").textContent = line;
    },
    get journeyRole() { return journeyRole; },
    openPane(name) { setPane(name, true); },
    setChain(path) { chain = path; },
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
    journey(j) {
      if (!j) journeyRole = null;
      root.querySelectorAll(".qg-legend [data-journey-role]").forEach(li => li.classList.toggle("only", li.dataset.journeyRole === journeyRole));
      this.syncFollow();
      if (!j) { this.inspect(null); return; }
      setPane("inspect", true);
      renderJourney(j);
    },
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
      setPane("inspect", !!sel && !(root.classList.contains("is-overview") && sel.kind === "cluster" && !sel.opened));
      if (!sel) { showEvent(current); return; }
      if (sel.kind === "cluster") showCluster(sel.cluster, scene.events[sel.cluster.event], sel.opened);
      else if (sel.kind === "group") showGroup(sel.cluster, sel.gi);
      else if (sel.kind === "fact") showFact(sel.fid, stage.view);
    },
  };
}
