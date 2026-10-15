// Debugger process (one card per phase, expanding into one node per model call) above the
// original agent steps. Selecting a phase or call opens it in the side panel and links it
// to the steps it touched.
import {getJSON} from "../api.js";
import {EVAL_CLASS, factChip, icon} from "../case/format.js";
import {actionLabel, ROLE_LABEL, stepRoles} from "../case/roles.js";
import {esc, pretty, short} from "../util.js";
import {callDetail, expandable, layoutPhases, layoutProcess, overviewHtml, phaseDetail, processHtml, requestHtml} from "./process.js";
import {anchorsByStep, anchorTitle} from "./route.js";
import {candidateCard, candidatesByStep, planOf} from "./trace.js";

export function createView(root, ctx) {
  const state = {
    model: null, sel: null, selPhase: null, openPhases: new Set(), hover: null, openStep: null, selStep: null, hoverStep: null,
    requests: new Map(), phases: [],
  };
  root.innerHTML = `
    <div class="traj-head">
      <div><div class="eyebrow">Execution path</div><h2 class="traj-title">Debugger process ↔ agent trajectory</h2>
        <p class="traj-hint" id="tj-hint">Each card is one debugger phase; open it to see its model calls. Select a phase or call to inspect it; select a step to see every call that touched it.</p></div>
    </div>
    <div class="lanes" id="tj-lanes">
      <div class="proc is-side-closed" id="tj-proc">
        <section class="proc-graph" aria-label="Debugger model calls"><div class="proc-view" id="tj-graph" tabindex="0"></div></section>
        <div class="proc-side-col">
          <button class="side-toggle" id="tj-side-toggle" aria-controls="tj-side"></button>
          <aside class="proc-side" id="tj-side" aria-label="Selected call" hidden></aside>
        </div>
      </div>
      <div class="lane-gap" aria-hidden="true"></div>
      <section class="lane lane-steps" aria-label="Agent steps">
        <div class="lane-label"><span class="eyebrow">Agent</span><span id="tj-step-count" class="lane-count"></span><span class="lane-nav"><button class="btn" data-pan="tj-steps" data-dir="-1" aria-label="Scroll agent lane left">←</button><button class="btn" data-pan="tj-steps" data-dir="1" aria-label="Scroll agent lane right">→</button></span></div>
        <div class="lane-overview" id="tj-step-overview"></div>
        <div class="lane-scroll" id="tj-steps" tabindex="0"><div class="lane-track" id="tj-step-track"></div></div>
      </section>
      <svg class="lane-links" id="tj-links" aria-hidden="true"></svg>
    </div>`;
  const $ = id => root.querySelector("#" + id);
  const graph = $("tj-graph"), side = $("tj-side"), steps = $("tj-steps"), lanes = $("tj-lanes");

  // The side panel starts collapsed to a strip and only opens from its toggle; selecting a
  // phase or call keeps it as it is. The graph refits to the width it frees or takes.
  function setSideOpen(open) {
    const toggle = $("tj-side-toggle");
    $("tj-proc").classList.toggle("is-side-closed", !open);
    side.hidden = !open;
    toggle.setAttribute("aria-expanded", open);
    toggle.title = open ? "Hide details" : "Show details";
    toggle.innerHTML = `<span class="side-toggle-ico" aria-hidden="true">${open ? "›" : "‹"}</span><span class="side-toggle-label">Details</span>`;
  }
  setSideOpen(false);

  // ---------- derived lookups ----------
  function stepIndex(model) {
    const facts = new Map(), evals = new Map(), refs = new Map();
    model.dsl?.facts.forEach(f => { if (!facts.has(f.t)) facts.set(f.t, []); facts.get(f.t).push(f); });
    model.evaluations.forEach(e => { if (!evals.has(e.t)) evals.set(e.t, []); evals.get(e.t).push(e); });
    model.debugger?.calls.forEach(c => c.steps.forEach(t => { if (!refs.has(t)) refs.set(t, []); refs.get(t).push(c.index); }));
    // Parse gaps: source text the parser could not account for (unknown, never an agent error).
    const gaps = new Map();
    (model.debugger?.parseAudit || []).filter(a => a.status === "unresolved").forEach(a => {
      if (!gaps.has(a.step)) gaps.set(a.step, []);
      gaps.get(a.step).push(a);
    });
    const anchors = anchorsByStep(model.debugger?.routeCandidates);
    const candidates = candidatesByStep(model.debugger?.calls || []);
    return {facts, evals, refs, gaps, anchors, candidates, maxRefs: Math.max(1, ...[...refs.values()].map(v => v.length))};
  }

  // manager_plan.json once saved; the committed plan_trace result while live.
  const planFor = d => d.managerPlan || d.calls.map(planOf).filter(Boolean).at(-1) || null;

  const callOf = key => key == null ? null : state.model?.debugger?.calls[Number(key)];
  const phaseOf = name => state.phases.find(p => p.phase === name);
  const cardOf = name => graph.querySelector(`.ph-card[data-phase="${name}"]`);

  // ---------- process graph ----------
  function renderGraph() {
    const d = state.model.debugger;
    $("tj-proc").hidden = !d;
    root.querySelector(".lane-gap").hidden = !d;
    if (!d) {
      $("tj-hint").textContent = "Compiled session: no debugger run yet. Open a step to inspect its roles, facts and rule evaluations.";
      return;
    }
    state.phases = layoutPhases(d.calls, d.parse, planFor(d));
    graph.innerHTML = state.phases.length ? processHtml(layoutProcess(state.phases, state.openPhases), {sel: state.sel, selPhase: state.selPhase})
      : `<p class="empty lane-empty">No model calls recorded yet.</p>`;
    fitGraph();
  }

  // The whole graph always fits its frame: a canvas wider than the frame or taller than its
  // max-height is scaled down (never up), and the negative margins give back the space it frees.
  function fitGraph() {
    const canvas = graph.querySelector(".proc-canvas");
    if (!canvas) return;
    const cs = getComputedStyle(graph);
    const w = parseFloat(canvas.style.width), h = parseFloat(canvas.style.height);
    const roomW = graph.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const roomH = parseFloat(cs.maxHeight) - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (roomW <= 0) return; // hidden tab: refit once the frame has a width
    const scale = Math.min(1, roomW / w, roomH / h);
    canvas.style.transform = scale < 1 ? `scale(${scale})` : "";
    canvas.style.marginRight = `${w * (scale - 1)}px`;
    canvas.style.marginBottom = `${h * (scale - 1)}px`;
  }

  function renderSide() {
    const d = state.model.debugger;
    if (!d) return;
    const call = callOf(state.sel), phase = call ? null : phaseOf(state.selPhase);
    const detailCtx = {requests: state.requests, factsById: state.model.dsl?.factsById, model: state.model, managerPlan: planFor(d)};
    const key = call ? state.sel : phase ? "phase:" + phase.phase : null;
    const top = side.scrollTop;
    side.innerHTML = call ? callDetail(call, detailCtx) : phase ? phaseDetail(phase, detailCtx) : overviewHtml(d, state.phases);
    side.scrollTop = key != null && state.sideKey === key ? top : 0;
    state.sideKey = key;
  }

  // ---------- step lane ----------
  function block(role, f, tone) {
    const value = typeof f.value === "string" ? f.value : pretty(f.value);
    return `<div class="detail-block role-${role} tone-${tone}"><h4>${esc(f.label)}<span class="role-tag">${ROLE_LABEL[role]}</span></h4><div class="text-box" data-zoom>${esc(value)}</div></div>`;
  }

  function gapBlock(gaps) {
    if (!gaps?.length) return "";
    return `<div class="detail-block tone-gap"><h4>Parse gap<span class="role-tag">unknown, not an agent error</span></h4>
      ${gaps.map(a => `${(a.unresolved || []).map(u => `<blockquote>${esc(u.quote)}</blockquote><p class="muted">${esc(u.reason)}</p>`).join("")}
        <details><summary>${esc(a.kind)} · ${esc(a.source_id || "")}</summary><ul class="gap-reasons">${(a.reasons || []).map(r => `<li class="mono">${esc(r)}</li>`).join("")}</ul></details>`).join("")}
    </div>`;
  }

  function anchorBlock(anchors) {
    if (!anchors?.length) return "";
    return `<div class="detail-block tone-route"><h4>ROUTE anchor${anchors.length === 1 ? "" : "s"}</h4>
      ${anchors.map(c => `<p><span class="mono">${esc(c.candidate_id)}</span> · ${(c.goal_links || []).map(esc).join(", ")}</p><div class="text-box" data-zoom>${esc(c.hypothesis || "")}</div>`).join("")}</div>`;
  }

  function stepDetail(step, roles, idx) {
    const t = step.t;
    const facts = idx.facts.get(t) || [];
    const evals = idx.evals.get(t) || [];
    const bySide = {};
    facts.forEach(f => { (bySide[f.side || "other"] ||= []).push(f); });
    const counts = {};
    evals.forEach(e => { counts[e.state] = (counts[e.state] || 0) + 1; });
    const others = roles.other.map(f => Array.isArray(f.value)
      ? `<details class="detail-block"><summary>${esc(f.label)} · ${f.value.length}</summary><div class="chip-row">${f.value.map(v => `<span class="chip mono">${esc(typeof v === "string" ? v : JSON.stringify(v))}</span>`).join("")}</div></details>`
      : `<details class="detail-block"><summary>${esc(f.label)}${f.raw ? " · raw source" : ""}</summary><div class="text-box">${esc(typeof f.value === "string" ? f.value : pretty(f.value))}</div></details>`).join("");
    return `<div class="card-detail step-detail">
      <div class="detail-col">${roles.state.map(f => block("state", f, "teal")).join("") || `<div class="detail-block muted">No state field.</div>`}
        ${roles.action.map(f => block("action", f, "plain")).join("")}
        ${roles.outcome.length ? roles.outcome.map(f => block("outcome", {...f, label: `${f.label} → S${String(t + 1).padStart(2, "0")}`}, "teal-2")).join("") : `<div class="detail-block muted">No following state (last step).</div>`}</div>
      <div class="detail-col">${roles.reasoning.map(f => block("reasoning", f, "info")).join("") || `<div class="detail-block muted">No reasoning fields.</div>`}</div>
      <div class="detail-col">${(idx.candidates.get(t) || []).map(candidateCard).join("")}${anchorBlock(idx.anchors.get(t))}${gapBlock(idx.gaps.get(t))}
        <div class="detail-block tone-violet"><h4>Facts · ${facts.length}</h4>${Object.entries(bySide).map(([side, list]) => `<div class="fact-group"><span class="eyebrow">${esc(side)}</span><div class="chip-col">${list.map(f => factChip(f, `<span class="slot mono">${esc(f.slot)}</span>`)).join("")}</div></div>`).join("") || `<p class="muted">No facts at this step.</p>`}</div>
        <div class="detail-block tone-ok"><h4>Rule evaluations · ${evals.length}</h4>
          <div class="chip-row">${Object.entries(counts).map(([s, n]) => `<span class="badge ${EVAL_CLASS[s] || ""}">${esc(s)} ${n}</span>`).join("")}</div>
          ${evals.filter(e => e.state !== "satisfied").map(e => `<div class="eval-row"><span class="badge ${EVAL_CLASS[e.state] || ""}">${esc(e.state)}</span><span class="mono">${esc(e.rule)}</span><span class="muted">${esc(e.details?.reason || "")}</span>${(e.refs || []).map(fid => `<button class="mono link" data-fid="${fid}">f${fid}</button>`).join("")}</div>`).join("")}
        </div>
        ${others}
      </div>
    </div>`;
  }

  function stepCard(step, i, idx) {
    const roles = stepRoles(step, state.model.steps[i + 1]);
    const t = step.t ?? i + 1;
    const open = state.openStep === t;
    const evals = idx.evals.get(t) || [];
    const violated = evals.filter(e => e.state === "violated").length;
    const refs = idx.refs.get(t)?.length || 0;
    const label = actionLabel(roles) || "(no action)";
    const thought = roles.reasoning.at(-1)?.value;
    const cls = ["st-card", open && "is-open", state.selStep === t && "is-selected", violated && "has-violation"].filter(Boolean).join(" ");
    return `<article class="${cls}" data-step="${t}">
      <div class="card-meta">
        <div class="card-top"><span class="mono card-idx">S${String(t).padStart(2, "0")}</span><button class="card-toggle" data-toggle-step="${t}" aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"} step">${open ? "−" : "+"}</button></div>
        <span class="card-icon">${icon("step")}</span>
        <h3 class="card-title" title="${esc(label)}">${esc(short(label, open ? 120 : 34))}</h3>
        <p class="card-sub">${esc(short(typeof thought === "string" ? thought.split("\n").filter(Boolean).at(-1) : "", open ? 160 : 60))}</p>
        <div class="card-foot">${(idx.candidates.get(t) || []).map(c => `<span class="badge cand ${c.is_root_cause === false ? "not-root" : ""}" title="TRACE ${esc(c.caseId || "")}: ${esc(c.status)} ${esc(c.fault_class || "")}${c.is_root_cause === false ? " (not the root cause)" : ""}">${esc(c.module)}</span>`).join("")}${(idx.anchors.get(t) || []).map(c => `<span class="badge anchor" title="${esc(anchorTitle(c))}">anchor ${esc(c.candidate_id)}</span>`).join("")}${idx.gaps.has(t) ? '<span class="badge gap" title="The parser could not account for part of the source text at this step">parse gap</span>' : ""}${violated ? `<span class="badge warn">⚠ ${violated} violated</span>` : ""}<span class="badge">${(idx.facts.get(t) || []).length} facts</span></div>
        ${state.model.debugger ? `<div class="heat" title="${refs} model calls touched this step"><span style="width:${Math.round(100 * refs / idx.maxRefs)}%"></span></div>` : ""}
      </div>
      ${open ? stepDetail(step, roles, idx) : ""}
    </article>`;
  }

  function renderSteps() {
    const idx = state.idx;
    const list = state.model.steps;
    $("tj-step-track").innerHTML = list.map((s, i) => stepCard(s, i, idx)).join("") || `<p class="empty lane-empty">No steps recorded.</p>`;
    $("tj-step-count").textContent = `${list.length} steps`;
    $("tj-step-overview").innerHTML = list.map((s, i) => {
      const t = s.t ?? i + 1;
      const violated = (idx.evals.get(t) || []).some(e => e.state === "violated");
      const heat = (idx.refs.get(t)?.length || 0) / idx.maxRefs;
      const marks = [violated && "is-warn", idx.gaps.has(t) && "has-gap", idx.anchors.has(t) && "is-anchor", idx.candidates.has(t) && "is-candidate"].filter(Boolean).join(" ");
      return `<button class="tick step-tick ${marks}" style="--heat:${heat.toFixed(2)}" data-jump-step="${t}" title="S${t}${idx.anchors.has(t) ? " · anchor" : ""}${idx.gaps.has(t) ? " · parse gap" : ""}"></button>`;
    }).join("");
  }

  // ---------- links between graph and steps ----------
  function cardRect(el, scroller, base) {
    const r = el.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    const cx = Math.min(Math.max(r.left + r.width / 2, s.left + 8), s.right - 8);
    const off = r.right < s.left || r.left > s.right || r.bottom < s.top || r.top > s.bottom;
    return {x: cx - base.left, top: r.top - base.top, bottom: Math.min(r.bottom, s.bottom) - base.top, off};
  }

  function drawLinks() {
    const svg = $("tj-links");
    const base = lanes.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${base.width} ${base.height}`);
    root.querySelectorAll(".is-linked").forEach(el => el.classList.remove("is-linked"));
    const d = state.model?.debugger;
    if (!d) { svg.innerHTML = ""; return; }
    const pairs = [];
    const current = state.sel ?? (state.selPhase ? "phase:" + state.selPhase : null);
    const key = state.hover ?? (state.hoverStep == null ? current : null);
    const stepT = key == null ? (state.hoverStep ?? state.selStep) : null;
    if (key?.startsWith("phase:")) {
      // A whole phase touches too many steps for curves: light up its card and the steps only.
      cardOf(key.slice(6))?.classList.add("is-linked");
      new Set(d.calls.filter(c => c.phase === key.slice(6)).flatMap(c => c.steps)).forEach(t => steps.querySelector(`[data-step="${t}"]`)?.classList.add("is-linked"));
      svg.innerHTML = "";
      return;
    }
    if (key != null) callOf(key)?.steps.forEach(t => pairs.push([callOf(key), t]));
    else if (stepT != null) (state.idx.refs.get(stepT) || []).forEach(i => pairs.push([d.calls[i], stepT]));
    const transient = state.hover != null || state.hoverStep != null;
    // A call in a collapsed phase links from its phase card: one curve per card and step.
    const seen = new Set();
    svg.innerHTML = pairs.map(([c, t]) => {
      const node = graph.querySelector(`.pnode[data-call="${c.index}"]`) || cardOf(c.phase), st = steps.querySelector(`[data-step="${t}"]`);
      const id = `${node?.dataset.call ?? c.phase}:${t}`;
      if (!node || !st || seen.has(id) || seen.size >= 80) return "";
      seen.add(id);
      node.classList.add("is-linked"); st.classList.add("is-linked");
      const a = cardRect(node, graph, base), b = cardRect(st, steps, base);
      if (a.off) return ""; // a node scrolled out of view would draw across the side panel
      const y1 = a.bottom, y2 = b.top, mid = (y1 + y2) / 2;
      return `<path class="link phase-${c.phase} ${b.off ? "is-off" : ""} ${transient ? "is-preview" : ""}" d="M${a.x},${y1} C${a.x},${mid} ${b.x},${mid} ${b.x},${y2}"/><circle class="link-end phase-${c.phase}" cx="${b.x}" cy="${y2}" r="3.5"/>`;
    }).join("");
  }
  let raf = 0;
  const scheduleLinks = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawLinks); };

  // ---------- render & events ----------
  function render() {
    if (!state.model) return;
    const keep = steps.scrollLeft;
    renderGraph(); renderSide(); renderSteps();
    steps.scrollLeft = keep;
    scheduleLinks();
  }

  function scrollToCard(scroller, el, smooth = true) {
    if (!el) return;
    const s = scroller.getBoundingClientRect(), r = el.getBoundingClientRect();
    const target = scroller.scrollLeft + r.left - s.left - (el.classList.contains("is-open") ? 16 : (s.width - r.width) / 2);
    scroller.scrollTo({left: target, behavior: smooth ? "smooth" : "auto"});
  }

  // reveal: expand the call's phase so its node is visible.
  function select(key, reveal = false) {
    state.sel = key;
    const call = callOf(key);
    if (call) state.selPhase = call.phase;
    if (call && reveal && expandable(phaseOf(call.phase))) state.openPhases.add(call.phase);
    renderGraph(); renderSide();
    scheduleLinks();
  }

  // open: true/false expands or collapses the phase; null leaves it as it is.
  function selectPhase(name, open = null) {
    state.sel = null; state.selPhase = name;
    if (open === true && expandable(phaseOf(name))) state.openPhases.add(name);
    if (open === false) state.openPhases.delete(name);
    renderGraph(); renderSide();
    scheduleLinks();
  }

  function selectStep(t, scroll = true) {
    state.selStep = state.selStep === t && !scroll ? null : t;
    root.querySelectorAll(".st-card").forEach(el => el.classList.toggle("is-selected", Number(el.dataset.step) === state.selStep));
    if (scroll) scrollToCard(steps, steps.querySelector(`[data-step="${t}"]`));
    scheduleLinks();
  }

  root.addEventListener("click", async event => {
    const el = event.target;
    if (el.closest("#tj-side-toggle")) { setSideOpen(side.hidden); return; }
    const fid = el.closest("[data-fid]")?.dataset.fid;
    if (fid != null) { ctx.navigate("graph", "facts", fid); return; }
    const req = el.closest("[data-request]")?.dataset.request;
    if (req) {
      state.requests.set(req, "loading");
      const paint = () => root.querySelectorAll(`[data-request-box="${CSS.escape(req)}"]`).forEach(box => { box.innerHTML = requestHtml(req, state.requests); });
      paint();
      try { state.requests.set(req, await getJSON(ctx.ref, req)); } catch (error) { state.requests.set(req, {error: error.message}); }
      paint();
      return;
    }
    const gotoCall = el.closest("[data-goto-call]")?.dataset.gotoCall;
    if (gotoCall != null) { select(gotoCall, true); return; }
    const gotoPhase = el.closest("[data-goto-phase]")?.dataset.gotoPhase;
    if (gotoPhase) { selectPhase(gotoPhase); return; }
    const goto = el.closest("[data-goto-step]")?.dataset.gotoStep;
    if (goto) { selectStep(Number(goto)); return; }
    const zoom = el.closest("[data-zoom]");
    if (zoom) { zoom.classList.toggle("is-full"); scheduleLinks(); return; }
    const node = el.closest(".pnode");
    if (node) { select(state.sel === node.dataset.call ? null : node.dataset.call); return; }
    const toggle = el.closest("[data-toggle-phase]")?.dataset.togglePhase;
    if (toggle) { selectPhase(toggle, !state.openPhases.has(toggle)); return; }
    const card = el.closest(".ph-card");
    if (card) { selectPhase(card.dataset.phase, true); return; }
    const b = el.closest("button");
    if (b?.dataset.pan) { $(b.dataset.pan).scrollBy({left: Number(b.dataset.dir) * steps.clientWidth * .8, behavior: "smooth"}); return; }
    if (b?.dataset.jumpStep) { selectStep(Number(b.dataset.jumpStep)); return; }
    if (b?.dataset.toggleStep != null) {
      const t = Number(b.dataset.toggleStep);
      state.openStep = state.openStep === t ? null : t; state.selStep = t;
      render(); scrollToCard(steps, steps.querySelector(`[data-step="${t}"]`)); return;
    }
    if (el.closest(".card-detail") || el.closest(".proc-side")) return;
    const st = el.closest("[data-step]");
    if (st) selectStep(Number(st.dataset.step), false);
  });

  root.addEventListener("dblclick", event => {
    if (event.target.closest(".card-detail")) return;
    event.target.closest("[data-step]")?.querySelector(".card-toggle")?.click();
  });

  root.addEventListener("pointerover", event => {
    const node = event.target.closest(".pnode"), card = event.target.closest(".ph-card"), st = event.target.closest(".st-card");
    const hn = node ? node.dataset.call : card ? "phase:" + card.dataset.phase : null;
    const hs = st && !st.classList.contains("is-open") ? Number(st.dataset.step) : null;
    if (hn !== state.hover || hs !== state.hoverStep) { state.hover = hn; state.hoverStep = hs; scheduleLinks(); }
  });
  lanes.addEventListener("pointerleave", () => { state.hover = state.hoverStep = null; scheduleLinks(); });

  root.addEventListener("keydown", event => {
    if (event.key === "Escape") { state.openStep = null; state.sel = state.selPhase = null; state.openPhases.clear(); render(); return; }
    const lane = event.target.closest(".proc-view, .lane-scroll");
    const keys = lane === graph ? ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"] : ["ArrowLeft", "ArrowRight", "Enter"];
    if (!lane || !keys.includes(event.key)) return;
    event.preventDefault();
    if (lane === graph) {
      // Left/right move between phase cards, Enter opens or closes one, up/down walk the calls.
      const names = state.phases.map(p => p.phase);
      const current = state.selPhase ?? callOf(state.sel)?.phase;
      if (event.key === "Enter") {
        if (current) selectPhase(current, !state.openPhases.has(current));
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const pos = names.indexOf(current);
        if (names.length) selectPhase(names[pos < 0 ? 0 : Math.max(0, Math.min(names.length - 1, pos + (event.key === "ArrowLeft" ? -1 : 1)))]);
        return;
      }
      const calls = state.model.debugger?.calls || [];
      if (!calls.length) return;
      const dir = event.key === "ArrowUp" ? -1 : 1, phase = phaseOf(current);
      const pos = state.sel != null ? Number(state.sel)
        : phase?.calls.length ? (dir > 0 ? phase.calls[0].index - 1 : phase.calls.at(-1).index + 1) : -1;
      select(String(Math.max(0, Math.min(calls.length - 1, pos + dir))), true);
    } else {
      const ts = state.model.steps.map((s, i) => s.t ?? i + 1);
      const pos = ts.indexOf(state.selStep);
      if (event.key === "Enter") { if (state.selStep != null) { state.openStep = state.openStep === state.selStep ? null : state.selStep; render(); } return; }
      selectStep(ts[Math.max(0, Math.min(ts.length - 1, pos + (event.key === "ArrowRight" ? 1 : -1)))]);
    }
  });

  steps.addEventListener("scroll", scheduleLinks, {passive: true});
  window.addEventListener("scroll", scheduleLinks, {passive: true});
  const resize = new ResizeObserver(scheduleLinks);
  resize.observe(lanes);
  // Refit when the frame changes width (window resize, side panel wrapping below).
  let fitWidth = 0;
  const refit = new ResizeObserver(() => {
    if (graph.clientWidth === fitWidth) return;
    fitWidth = graph.clientWidth;
    fitGraph(); scheduleLinks();
  });
  refit.observe(graph);
  window.addEventListener("resize", fitGraph);

  return {
    update(model, {changed}) {
      state.model = model;
      state.idx = stepIndex(model);
      if (!["all", "usage_rows", "tool_calls", "claim_usage", "parse_audit_usage", "canonical_record", "input", "record", "steps",
            "evaluations", "result", "route_candidates", "manager_plan", "trace_queries", "parse_audit"].some(k => changed.has(k))) return;
      render();
    },
    show(route) {
      if (route.extra[0] === "step" && route.extra[1]) { state.openStep = Number(route.extra[1]); state.selStep = state.openStep; render(); selectStep(state.selStep); }
      if (route.extra[0] === "call" && route.extra[1]) select(String(Number(route.extra[1]) - 1));
      scheduleLinks();
    },
    destroy() { resize.disconnect(); refit.disconnect(); cancelAnimationFrame(raf); window.removeEventListener("scroll", scheduleLinks); window.removeEventListener("resize", fitGraph); },
  };
}
