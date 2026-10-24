// #/query[/<group>/<trajectory>]: the Query Graph. A 3D tower whose floor is the DSL record
// and whose upper layers are built by the debugger's own calls, played back as a guided tour.
import {esc, short, loader} from "../util.js";
import {caseHref, queryHref} from "../routes.js";
import {loadQueryScene, factRepr, SLOT_LABEL} from "../query/model.js";
import {layoutScene} from "../query/layout.js";
import {createStage, nodeColor} from "../query/stage.js";
import {createTour, eventDuration} from "../query/tour.js";

export const DEFAULT_CASE = ["evidence-query-claims-n30-20261013", "GPT-4o_013_alfworld_task_013"];
const PHASES = ["PARSE", "MAP", "ROUTE", "MANAGER", "TRACE", "SUBMIT"];
const PHASE_NOTE = {
  PARSE: "compile the log into the DSL", MAP: "read the task contract", ROUTE: "query the record, open suspect windows",
  MANAGER: "assign one question per window", TRACE: "test each window with SQL", SUBMIT: "name the root cause",
};
const LEGEND = [
  ["env", "Fact · env", "observed by the environment"],
  ["mind", "Fact · mind", "the agent's memory, reflection, plan, action"],
  ["entity", "Entity", "kind:index, typed by the kind lattice"],
  ["goal", "Goal", "the task requirement as a relational expression"],
  ["evidence", "Evidence", "rule finding citing facts"],
  ["route", "Query", "a debugger view over the record"],
  ["window", "Window", "a suspect step ROUTE hands on"],
  ["lane", "TRACE lane", "one investigation per window"],
  ["candidate", "Candidate", "a step TRACE proposes"],
  ["root", "Root", "the conclusion"],
];

export function mountQuery(app, route) {
  const ref = ["runs", ...(route.ref || DEFAULT_CASE)];
  app.innerHTML = `<div class="qg">${loader("Building the query graph…")}</div>`;
  const root = app.firstElementChild;
  let stage = null, keyHandler = null, destroyed = false;

  loadQueryScene(ref).then(scene => {
    if (destroyed) return;
    const layout = layoutScene(scene);
    root.innerHTML = template(scene, ref);
    const canvas = root.querySelector(".qg-canvas");
    stage = createStage(canvas, scene, layout);
    const frameAt = createTour(scene, layout, stage.colors);
    const ui = bindUi(root, scene, stage);

    const state = {i: 0, p: 0, playing: true, speed: 1};
    const ev = () => scene.events[state.i];
    ui.setEvent(state.i, scene);
    stage.start(dt => {
      if (state.playing) {
        state.p += dt * state.speed / eventDuration(ev());
        if (state.p >= 1) {
          if (state.i < scene.events.length - 1) { state.i++; state.p = 0; ui.setEvent(state.i, scene); }
          else { state.p = 1; state.playing = false; ui.setPlaying(false); }
        }
      }
      ui.setProgress(state.i, state.p);
      return frameAt(state.i, state.p);
    });

    const go = i => { state.i = Math.max(0, Math.min(scene.events.length - 1, i)); state.p = 0; ui.setEvent(state.i, scene); };
    const toggle = () => {
      if (!state.playing && state.i === scene.events.length - 1 && state.p >= 1) go(0);
      state.playing = !state.playing;
      ui.setPlaying(state.playing);
    };
    ui.onPlay(toggle);
    ui.onStep(d => go(state.i + d));
    ui.onSeek(i => { go(i); state.p = 0.6; });
    ui.onPhase(phase => { const i = scene.events.findIndex(e => e.phase === phase); if (i >= 0) go(i); });
    ui.onSpeed(s => { state.speed = s; });
    ui.onFollow(() => stage.follow());
    ui.onJump(i => { go(i); state.p = 0.6; state.playing = false; ui.setPlaying(false); });
    stage.on("manual", m => ui.setManual(m));
    stage.on("hover", h => ui.hover(h, scene));
    stage.on("select", n => ui.inspect(n, scene, state.i));
    keyHandler = e => {
      if (e.target.closest("input, textarea, select")) return;
      if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") go(state.i + 1);
      else if (e.key === "ArrowLeft") go(state.i - 1);
      else if (e.key === "Escape") stage.select(null);
    };
    document.addEventListener("keydown", keyHandler);
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

function template(scene, ref) {
  const counts = {
    env: scene.facts.filter(f => f.side === "env").length, mind: scene.facts.filter(f => f.side !== "env").length,
    entity: scene.entities.length, goal: scene.goals.length, evidence: scene.evidence.length,
    route: scene.events.filter(e => e.probe).length, window: scene.windows.length, lane: scene.lanes.length,
    candidate: scene.candidates.length, root: scene.root ? 1 : 0,
  };
  const ticks = scene.events.map((e, i) => `<button class="qg-tick" data-i="${i}" data-phase="${e.phase}" style="flex-grow:${eventDuration(e)}" title="${esc(`${e.phase} · ${e.title}`)}"${e.error ? " data-error" : ""}></button>`).join("");
  return `
    <canvas class="qg-canvas" aria-label="Query graph"></canvas>
    <header class="qg-head">
      <div class="qg-title">
        <span class="qg-kicker">Query Graph</span>
        <h1>${esc(scene.meta.task || scene.meta.tid)}</h1>
        <p><a href="${caseHref(ref)}">${esc(scene.meta.tid)}</a> · ${scene.meta.steps} steps · ${scene.facts.length} facts</p>
      </div>
      <ol class="qg-phases">${PHASES.filter(ph => scene.events.some(e => e.phase === ph)).map(ph => `<li><button data-phase="${ph}" title="${esc(PHASE_NOTE[ph])}"><b>${ph}</b><small>${esc(PHASE_NOTE[ph])}</small></button></li>`).join("")}</ol>
    </header>
    <aside class="qg-legend" aria-label="DSL types">
      <h2>DSL</h2>
      <p class="qg-formula">Fact = rel(args) = value @ t</p>
      <ul>${LEGEND.map(([k, label, note]) => `<li title="${esc(note)}"><i class="qg-dot" data-k="${k}"></i>${esc(label)}<span>${counts[k] ?? ""}</span></li>`).join("")}</ul>
    </aside>
    <aside class="qg-inspect" hidden></aside>
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
        <button class="qg-btn qg-follow" data-act="follow" title="Hand the camera back to the tour" hidden>Follow tour</button>
      </div>
    </footer>`;
}

function bindUi(root, scene, stage) {
  const $ = s => root.querySelector(s);
  const ticks = [...root.querySelectorAll(".qg-tick")];
  const handlers = {};
  const on = name => fn => { handlers[name] = fn; };
  const inspect = $(".qg-inspect"), tip = $(".qg-tip");
  const colors = stage.colors();
  root.querySelectorAll(".qg-dot").forEach(d => { d.style.background = colors[d.dataset.k]; d.style.boxShadow = `0 0 8px ${colors[d.dataset.k]}`; });

  root.addEventListener("click", e => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "play") handlers.play?.();
    else if (act === "prev") handlers.step?.(-1);
    else if (act === "next") handlers.step?.(1);
    else if (act === "follow") handlers.follow?.();
    else if (act === "speed") {
      const b = e.target.closest("button");
      const s = {"1×": 2, "2×": 0.5, "0.5×": 1}[b.textContent] ?? 1;
      b.textContent = `${s}×`;
      handlers.speed?.(s);
    }
    const tick = e.target.closest(".qg-tick");
    if (tick) handlers.seek?.(Number(tick.dataset.i));
    const ph = e.target.closest(".qg-phases [data-phase]");
    if (ph) handlers.phase?.(ph.dataset.phase);
    const jump = e.target.closest("[data-jump]");
    if (jump) handlers.jump?.(Number(jump.dataset.jump));
    if (e.target.closest(".qg-close")) stage.select(null);
  });

  let lastPhase = null;
  return {
    onPlay: on("play"), onStep: on("step"), onSeek: on("seek"), onPhase: on("phase"), onSpeed: on("speed"), onFollow: on("follow"), onJump: on("jump"),
    setEvent(i, sc) {
      const ev = sc.events[i];
      ticks.forEach((t, k) => { t.classList.toggle("done", k < i); t.classList.toggle("now", k === i); });
      if (ev.phase !== lastPhase) {
        root.querySelectorAll(".qg-phases button").forEach(b => {
          const k = PHASES.indexOf(b.dataset.phase), cur = PHASES.indexOf(ev.phase);
          b.classList.toggle("now", k === cur); b.classList.toggle("done", k < cur);
        });
        lastPhase = ev.phase;
      }
      const chip = $(".qg-caption .qg-chip");
      chip.textContent = ev.phase;
      chip.dataset.phase = ev.phase;
      $(".qg-cap-title").textContent = ev.title || "";
      $(".qg-cap-text").textContent = ev.caption || "";
      $(".qg-count").textContent = `${i + 1} / ${sc.events.length}`;
      if (!stage.selected) showEvent(ev, i);
    },
    setProgress(i, p) {
      const t = ticks[i];
      if (t) $(".qg-head-mark").style.left = `${t.offsetLeft + t.offsetWidth * p}px`;
    },
    setPlaying(playing) { $(".qg-play").textContent = playing ? "❚❚" : "▶"; },
    setManual(m) { $(".qg-follow").hidden = !m; },
    hover({node, x, y}, sc) {
      if (!node) { tip.hidden = true; return; }
      tip.hidden = false;
      tip.innerHTML = tipHtml(node, sc);
      tip.style.left = `${Math.min(x + 16, root.clientWidth - 320)}px`;
      tip.style.top = `${Math.max(8, y - 12)}px`;
    },
    inspect(node, sc, i) {
      if (!node) { showEvent(sc.events[i], i); return; }
      inspect.hidden = false;
      inspect.innerHTML = `<button class="qg-close" aria-label="Close">×</button>${nodeHtml(node, sc, colors)}`;
    },
  };

  function showEvent(ev, i) {
    if (ev.phase === "PARSE") { inspect.hidden = true; return; }
    inspect.hidden = false;
    inspect.innerHTML = eventHtml(ev, scene, i);
  }
}

const touchedBy = (scene, pred) => scene.events.map((ev, i) => [ev, i]).filter(([ev]) => pred(ev));
const eventLinks = list => list.length
  ? `<ul class="qg-links">${list.map(([ev, i]) => `<li><button data-jump="${i}"><span data-phase="${ev.phase}">${ev.phase}</span>${esc(short(ev.title, 46))}</button></li>`).join("")}</ul>`
  : `<p class="qg-muted">No debugger call returned it.</p>`;

function tipHtml(n, scene) {
  switch (n.type) {
    case "fact": return `<b>${esc(`${n.rel}(${n.args.join(", ")})`)}</b><span>fact ${n.fid} · S${n.t} ${SLOT_LABEL[n.slot]} · ${n.side}</span><em>${esc(short(typeof n.value === "string" ? n.value : JSON.stringify(n.value), 110))}</em>`;
    case "entity": return `<b>${esc(n.key)}</b><span>entity · kind ${esc(n.kind)}${n.parent ? ` ⊑ ${esc(n.parent)}` : ""} · ${n.facts.length} facts</span>`;
    case "goal": return `<b>${esc(n.key)}</b><span>goal · ∃=${n.count} x : ${esc(n.ofKind)}(x) ∧ ${esc(n.rel)}(x, ${esc(n.target)})</span>`;
    case "evidence": return `<b>${esc(n.rule || n.kind)}</b><span>evidence ${n.eid} · S${n.t} · refs ${n.refs.join(", ")}</span><em>${esc(n.reason)}</em>`;
    case "probe": return `<b>${esc(n.event.title)}</b><span>${n.event.phase} · ${n.event.fids.length} facts returned</span>`;
    case "window": return `<b>${esc(n.caseId)} · step ${n.step}</b><span>window · issue facts ${n.fids.join(", ")}</span><em>${esc(short(n.hypothesis, 140))}</em>`;
    case "lane": return `<b>${esc(n.agent)}</b><span>TRACE lane ← ${esc(n.anchor)} · ${n.rows.length} SQL rows</span><em>${esc(short(n.question, 140))}</em>`;
    case "candidate": return `<b>S${n.step} ${esc(n.module)}</b><span>candidate · ${esc(n.status)}${n.faultClass ? ` · ${esc(n.faultClass)}` : ""}</span><em>${esc(short(n.proposition, 140))}</em>`;
    case "root": return `<b>ROOT · S${n.step} ${esc(n.module)}</b><span>${esc(n.faultClass || "")}</span><em>${esc(short(n.proposition, 140))}</em>`;
    default: return esc(n.id);
  }
}

function nodeHtml(n, scene, colors) {
  const head = (kind, title) => `<p class="qg-kind"><i class="qg-dot" style="background:${nodeColor(n, colors)}"></i>${kind}</p><h3>${title}</h3>`;
  switch (n.type) {
    case "fact": {
      const sig = scene.meta.relations[n.rel];
      return `${head("Fact", esc(`${n.rel}(${n.args.join(", ")})`))}
        <pre class="qg-code">${esc(factRepr(n))}</pre>
        <dl><dt>step</dt><dd>S${n.t} · ${SLOT_LABEL[n.slot]} · ${n.side}</dd>
        ${sig ? `<dt>relation</dt><dd>${esc(`${sig.name}(${(sig.arg_kinds || []).join(", ")})`)}${(sig.props || []).length ? ` <small>${esc(sig.props.join(" · "))}</small>` : ""}</dd>` : ""}
        <dt>args</dt><dd>${n.args.map(a => `<code>${esc(a)}</code>`).join(" ") || "—"}</dd>
        ${n.basis.length ? `<dt>basis</dt><dd>${n.basis.map(b => `<code>f${b}</code>`).join(" ")}</dd>` : ""}</dl>
        ${n.span ? `<blockquote>${esc(short(n.span, 360))}</blockquote>` : ""}
        <h4>Touched by</h4>${eventLinks(touchedBy(scene, ev => ev.fids?.includes(n.fid)))}`;
    }
    case "entity":
      return `${head("Entity", esc(n.key))}<dl><dt>kind</dt><dd>${esc(n.kind)}${n.parent ? ` ⊑ ${esc(n.parent)}` : ""}</dd><dt>facts</dt><dd>${n.facts.length}</dd></dl>
        <h4>Touched by</h4>${eventLinks(touchedBy(scene, ev => ev.entities?.includes(n.id)))}`;
    case "goal":
      return `${head("Goal", esc(n.key))}<pre class="qg-code">∃^{=${n.count}} x : ${esc(n.ofKind)}(x) ∧ ${esc(n.rel)}(x, ${esc(n.target)})</pre>
        <ul class="qg-cons">${n.constraints.map(c => `<li><code>${esc(c.property?.index || c.property)} ${esc(c.operator)} ${esc(JSON.stringify(c.expected))}</code><small>${esc(c.mode || "")}</small></li>`).join("")}</ul>`;
    case "evidence":
      return `${head("Evidence", esc(n.rule || n.kind))}<dl><dt>step</dt><dd>S${n.t}</dd><dt>refs</dt><dd>${n.refs.map(r => `<code>f${r}</code>`).join(" ")}</dd><dt>status</dt><dd>${esc(n.status)}</dd><dt>reason</dt><dd>${esc(n.reason)}</dd></dl>`;
    case "probe": return eventHtml(n.event, scene, scene.events.indexOf(n.event));
    case "window":
      return `${head("Window", `${esc(n.caseId)} · step ${n.step}`)}<dl><dt>issue facts</dt><dd>${n.fids.map(f => `<code>f${f}</code>`).join(" ")}</dd><dt>goals</dt><dd>${n.goals.map(g => `<code>${esc(g)}</code>`).join(" ")}</dd></dl><blockquote>${esc(n.hypothesis)}</blockquote>`;
    case "lane":
      return `${head("TRACE lane", esc(n.agent))}<dl><dt>anchor</dt><dd>${esc(n.anchor)}</dd><dt>SQL rows</dt><dd>${n.rows.length} on ${n.steps.length} steps</dd></dl><blockquote>${esc(n.question)}</blockquote>`;
    case "candidate":
      return `${head("Candidate", `S${n.step} ${esc(n.module)}`)}<dl><dt>status</dt><dd>${esc(n.status)}</dd><dt>fault</dt><dd>${esc(n.faultClass || "—")}</dd><dt>fact</dt><dd>${n.fid != null ? `<code>f${n.fid}</code>` : "—"}</dd></dl><p>${esc(n.proposition)}</p>${n.quote ? `<blockquote>${esc(n.quote)}</blockquote>` : ""}`;
    case "root":
      return `${head("Root cause", `S${n.step} ${esc(n.module)}`)}<dl><dt>fault</dt><dd>${esc(n.faultClass || "—")}</dd><dt>fact</dt><dd>${n.fid != null ? `<code>f${n.fid}</code>` : "—"}</dd><dt>status</dt><dd>${esc(n.status)}${n.accepted ? " · accepted" : ""}</dd></dl><p>${esc(n.proposition)}</p>${n.quote ? `<blockquote>${esc(n.quote)}</blockquote>` : ""}`;
    default: return esc(n.id);
  }
}

function eventHtml(ev, scene, i) {
  const args = ev.call?.arguments || {};
  let body = "";
  if (ev.error) body = `<p class="qg-bad">${esc(ev.error.code || "error")}: ${esc(ev.error.message)}</p>`;
  else if (ev.sql) body = `<pre class="qg-code qg-sql">${esc(short(ev.sql, 900))}</pre>`;
  else if (ev.name === "route_cases") body = (args.candidates || []).map(c => `<p><b>${esc(c.candidate_id)} · S${c.issue_step}</b> ${esc(short(c.hypothesis, 220))}</p>`).join("");
  else if (ev.name === "plan_trace") body = (args.assignments || []).map(a => `<p><b>${esc(a.agent_id)} ← ${esc(a.anchor_case_id)}</b> ${esc(short(a.question, 260))}</p>`).join("");
  else if (ev.name === "submit" && scene.root) body = `<p>${esc(scene.root.proposition)}</p>`;
  else if (ev.spec != null) body = `<pre class="qg-code">${esc(ev.name)}(${esc(JSON.stringify(ev.spec))})</pre>`;
  const stat = [
    ev.fids?.length ? `${ev.fids.length} facts` : "", ev.entities?.length ? `${ev.entities.length} entities` : "",
    ev.eids?.length ? `${ev.eids.length} evidence` : "", ev.windows?.length ? `${ev.windows.length} windows` : "",
    ev.candidates?.length ? `${ev.candidates.length} candidates` : "",
  ].filter(Boolean).join(" · ");
  return `<p class="qg-kind"><span class="qg-chip" data-phase="${ev.phase}">${ev.phase}</span>call ${i + 1}</p>
    <h3>${esc(ev.title)}</h3>${stat ? `<p class="qg-muted">${stat}</p>` : ""}${body}`;
}
