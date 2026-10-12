// Dual linked lanes: debugger events (top) and original agent steps (bottom).
// Cards expand in place; curves connect an event to the steps it cites.
import {getJSON} from "../api.js";
import {PHASES} from "../case/model.js";
import {EVAL_CLASS, factChip, icon} from "../case/format.js";
import {actionLabel, ROLE_LABEL, stepRoles} from "../case/roles.js";
import {debounce, esc, number, pretty, raw, short} from "../util.js";

const KINDS = ["handoff", "model", "tool", "assessment", "answer", "attempt", "inflight"];

export function createView(root, ctx) {
  const state = {
    model: null, openEvent: null, openStep: null, selEvent: null, selStep: null, hoverEvent: null, hoverStep: null,
    phases: new Set(PHASES), kinds: new Set(KINDS), search: "", linkedOnly: false, follow: true, seen: 0,
    requests: new Map(),
  };
  root.innerHTML = `
    <div class="traj-head">
      <div><div class="eyebrow">Execution path</div><h2 class="traj-title">Debugger trajectory ↔ agent trajectory</h2>
        <p class="traj-hint" id="tj-hint">Open a card to inspect it. Hover or select a debugger event to trace the steps it cites; select a step to see every event that looked at it.</p></div>
      <div class="traj-tools">
        <input class="input" id="tj-search" type="search" placeholder="Search events…" aria-label="Search debugger events">
        <button class="btn" id="tj-linked" aria-pressed="false" title="Show only events citing the selected step">Linked to step</button>
        <button class="btn" id="tj-follow" aria-pressed="true" title="Scroll to new events while the run is live">Follow latest</button>
      </div>
    </div>
    <div class="traj-filters" id="tj-filters"></div>
    <div class="lanes" id="tj-lanes">
      <section class="lane lane-debugger" aria-label="Debugger events">
        <div class="lane-label"><span class="eyebrow">Debugger</span><span id="tj-dbg-count" class="lane-count"></span><span class="lane-nav"><button class="btn" data-pan="tj-dbg" data-dir="-1" aria-label="Scroll debugger lane left">←</button><button class="btn" data-pan="tj-dbg" data-dir="1" aria-label="Scroll debugger lane right">→</button></span></div>
        <div class="lane-overview" id="tj-dbg-overview"></div>
        <div class="lane-scroll" id="tj-dbg" tabindex="0"><div class="lane-track" id="tj-dbg-track"></div></div>
      </section>
      <div class="lane-gap" aria-hidden="true"></div>
      <section class="lane lane-steps" aria-label="Agent steps">
        <div class="lane-label"><span class="eyebrow">Agent</span><span id="tj-step-count" class="lane-count"></span><span class="lane-nav"><button class="btn" data-pan="tj-steps" data-dir="-1" aria-label="Scroll agent lane left">←</button><button class="btn" data-pan="tj-steps" data-dir="1" aria-label="Scroll agent lane right">→</button></span></div>
        <div class="lane-overview" id="tj-step-overview"></div>
        <div class="lane-scroll" id="tj-steps" tabindex="0"><div class="lane-track" id="tj-step-track"></div></div>
      </section>
      <svg class="lane-links" id="tj-links" aria-hidden="true"></svg>
    </div>`;
  const $ = id => root.querySelector("#" + id);
  const dbg = $("tj-dbg"), steps = $("tj-steps"), lanes = $("tj-lanes");

  // ---------- derived lookups ----------
  function stepIndex(model) {
    const facts = new Map(), evals = new Map(), refs = new Map();
    model.dsl?.facts.forEach(f => { if (!facts.has(f.t)) facts.set(f.t, []); facts.get(f.t).push(f); });
    model.evaluations.forEach(e => { if (!evals.has(e.t)) evals.set(e.t, []); evals.get(e.t).push(e); });
    model.debugger?.events.forEach(e => e.steps.forEach(t => { if (!refs.has(t)) refs.set(t, []); refs.get(t).push(e.index); }));
    return {facts, evals, refs, maxRefs: Math.max(1, ...[...refs.values()].map(v => v.length))};
  }

  function visibleEvents() {
    const d = state.model?.debugger;
    if (!d) return [];
    const q = state.search.toLowerCase();
    return d.events.filter(e => state.phases.has(e.phase) && state.kinds.has(e.kind) &&
      (!state.linkedOnly || state.selStep == null || e.steps.includes(state.selStep)) &&
      (!q || `${e.title} ${e.subtitle} ${e.kind}`.toLowerCase().includes(q) || (q.length > 2 && pretty(e.data).toLowerCase().includes(q))));
  }

  // ---------- debugger lane ----------
  function eventDetail(e) {
    const steps = e.steps.length ? `<div class="detail-block"><h4>Cited steps</h4><div class="chip-row">${e.steps.map(t => `<button class="step-chip" data-goto-step="${t}">S${String(t).padStart(2, "0")}</button>`).join("")}</div></div>` : "";
    const facts = e.fids?.length ? `<div class="detail-block tone-violet"><h4>Cited facts · ${e.fids.length}</h4><div class="chip-col">${e.fids.slice(0, 40).map(fid => factChip(state.model.dsl.factsById.get(fid))).join("")}${e.fids.length > 40 ? `<span class="muted">+${e.fids.length - 40} more</span>` : ""}</div></div>` : "";
    let body = "";
    if (e.kind === "handoff") {
      const h = e.data;
      body = `<div class="detail-block tone-info"><h4>${esc(h.from || "START")} → ${esc(h.to)}</h4><dl class="kv">${Object.entries(h).filter(([k]) => !["schema", "from", "to"].includes(k)).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === "object" ? short(JSON.stringify(v), 220) : v)}</dd>`).join("")}</dl></div>
        <details class="detail-block"><summary>Full handoff</summary>${raw(h)}</details>`;
    } else if (e.kind === "model") {
      const m = e.data, u = e.usage || {};
      const calls = (m.tool_calls || []).map(c => {
        let args = c.function?.arguments;
        try { args = JSON.parse(args); } catch { /* keep text */ }
        return `<div class="call"><span class="mono call-name">${esc(c.function?.name)}</span>${raw(args)}</div>`;
      }).join("");
      body = `${m.reasoning_content ? `<details class="detail-block tone-violet" open><summary>Reasoning</summary><div class="text-box">${esc(m.reasoning_content)}</div></details>` : ""}
        ${m.content ? `<div class="detail-block tone-info"><h4>Response</h4><div class="text-box">${esc(m.content)}</div></div>` : ""}
        ${calls ? `<div class="detail-block"><h4>Tool calls · ${(m.tool_calls || []).length}</h4>${calls}</div>` : ""}
        <div class="detail-block"><h4>Usage</h4><dl class="kv"><dt>model</dt><dd>${esc(u.response_model || u.requested_model || "—")}</dd><dt>input</dt><dd>${number(u.input_tokens)}</dd><dt>output</dt><dd>${number(u.output_tokens)}</dd><dt>time</dt><dd>${esc(u.timestamp_utc || "—")}</dd></dl>
        ${u.request_file ? `<button class="btn" data-request="${esc(u.request_file)}">Load full request</button><div class="request-box" data-request-box="${esc(u.request_file)}">${requestHtml(u.request_file)}</div>` : ""}</div>`;
    } else if (e.kind === "tool") {
      const c = e.data, result = c.result?.data ?? c.result;
      body = `<div class="detail-block tone-info"><h4>Arguments</h4>${raw(c.arguments)}</div>
        <div class="detail-block tone-teal"><h4>Result</h4>${typeof result === "string" ? `<div class="text-box">${esc(result)}</div>` : raw(result)}</div>`;
    } else if (e.kind === "assessment") {
      const w = e.data;
      body = `<div class="detail-block tone-info"><h4>Window ${esc(w.window_id)}</h4><dl class="kv">${Object.entries(w.window || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</dd>`).join("")}</dl></div>
        ${(w.candidates || []).map(c => `<div class="detail-block candidate tone-${c.status === "error" ? "bad" : "warn"}">
          <h4><span class="badge ${c.status === "error" ? "bad" : "warn"}">${esc(c.status)}</span> <button class="step-chip" data-goto-step="${c.step}">S${String(c.step).padStart(2, "0")}</button> ${esc(c.module || "")} · <span class="mono">${esc(c.fault_class || "")}</span></h4>
          ${c.output_quote ? `<blockquote>${esc(c.output_quote)}</blockquote>` : ""}<p>${esc(c.proposition || "")}</p>
          <details><summary>Reasoning & evidence</summary>${raw(c)}</details></div>`).join("")}
        ${w.conclusion ? `<details class="detail-block"><summary>Window conclusion</summary>${raw(w.conclusion)}</details>` : ""}`;
    } else if (e.kind === "answer") {
      const r = e.data.result || {};
      body = `<div class="detail-block tone-${r.accepted ? "ok" : "warn"}"><h4>${esc(r.status || "answer")}</h4><p>${esc(r.reasoning || r.stop_reason || "")}</p></div>
        <details class="detail-block"><summary>Raw answer</summary>${raw(e.data.raw_answer)}</details>`;
    } else {
      body = raw(e.data);
    }
    return `<div class="card-detail">${body}${steps}${facts}</div>`;
  }

  function requestHtml(file) {
    const r = state.requests.get(file);
    if (!r) return "";
    if (r === "loading") return `<p class="muted">Loading…</p>`;
    if (r.error) return `<p class="error-box">${esc(r.error)}</p>`;
    const messages = r.messages || [];
    return `<p class="muted">${messages.length} messages · ${esc(r.requested_model || "")}</p>${messages.map((m, i) =>
      `<details><summary>#${i + 1} ${esc(m.role)}${m.tool_call_id ? ` · ${esc(m.tool_call_id)}` : ""}</summary>${raw(m.content ?? m)}</details>`).join("")}`;
  }

  function eventCard(e, isNew) {
    const open = state.openEvent === e.index;
    const cls = ["ev-card", `kind-${e.kind}`, `phase-${e.phase}`, open && "is-open", state.selEvent === e.index && "is-selected",
                 e.status === "error" && "is-error", isNew && "is-new"].filter(Boolean).join(" ");
    const steps = e.steps.length ? `<span class="ev-steps">→ ${e.steps.slice(0, 4).map(t => `S${t}`).join(" ")}${e.steps.length > 4 ? ` +${e.steps.length - 4}` : ""}</span>` : "";
    return `<article class="${cls}" data-ev="${e.index}">
      <div class="card-meta">
        <div class="card-top"><span class="mono card-idx">#${String(e.index + 1).padStart(3, "0")}</span><button class="card-toggle" data-toggle-ev="${e.index}" aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"} event">${open ? "−" : "+"}</button></div>
        <span class="card-icon">${icon(e.kind)}</span>
        <h3 class="card-title">${esc(e.title)}</h3>
        <p class="card-sub mono">${esc(short(e.subtitle, open ? 200 : 48))}</p>
        <div class="card-foot">${e.status === "error" ? '<span class="badge bad">error</span>' : ""}${e.kind === "inflight" ? '<span class="badge live"><span class="live-dot"></span>waiting</span>' : ""}${steps}</div>
      </div>
      ${open ? eventDetail(e) : ""}
    </article>`;
  }

  function renderDebugger() {
    const d = state.model.debugger;
    // Compiled sessions have no debugger run: show the agent lane alone.
    root.querySelector(".lane-debugger").hidden = !d;
    root.querySelector(".lane-gap").hidden = !d;
    root.querySelector(".traj-tools").hidden = !d;
    if (!d) {
      $("tj-hint").textContent = "Compiled session: no debugger run yet. Open a step to inspect its roles, facts and rule evaluations.";
      return;
    }
    const list = visibleEvents();
    const groups = [];
    list.forEach(e => {
      const g = groups[groups.length - 1];
      if (g && g.phase === e.phase) g.items.push(e); else groups.push({phase: e.phase, items: [e]});
    });
    const seen = state.seen;
    $("tj-dbg-track").innerHTML = groups.map(g => `<div class="phase-group phase-${g.phase}"><div class="phase-label"><span class="phase-dot"></span>${esc(g.phase)}<span class="muted">${g.items.length}</span></div><div class="phase-cards">${g.items.map(e => eventCard(e, seen && e.index >= seen)).join("")}</div></div>`).join("")
      || `<p class="empty lane-empty">No events match the filters.</p>`;
    state.seen = d.events.length;
    $("tj-dbg-count").textContent = `${list.length} / ${d.events.length} events`;
    $("tj-dbg-overview").innerHTML = d.events.map(e => `<button class="tick phase-${e.phase} ${list.includes(e) ? "" : "is-dim"} ${e.status === "error" ? "is-error" : ""}" data-jump-ev="${e.index}" title="#${e.index + 1} ${esc(e.title)}"></button>`).join("");
  }

  // ---------- step lane ----------
  function block(role, f, tone) {
    const value = typeof f.value === "string" ? f.value : pretty(f.value);
    return `<div class="detail-block role-${role} tone-${tone}"><h4>${esc(f.label)}<span class="role-tag">${ROLE_LABEL[role]}</span></h4><div class="text-box" data-zoom>${esc(value)}</div></div>`;
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
      <div class="detail-col">
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
        <div class="card-foot">${violated ? `<span class="badge warn">⚠ ${violated} violated</span>` : ""}<span class="badge">${(idx.facts.get(t) || []).length} facts</span></div>
        ${state.model.debugger ? `<div class="heat" title="${refs} debugger events cite this step"><span style="width:${Math.round(100 * refs / idx.maxRefs)}%"></span></div>` : ""}
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
      return `<button class="tick step-tick ${violated ? "is-warn" : ""}" style="--heat:${heat.toFixed(2)}" data-jump-step="${t}" title="S${t}"></button>`;
    }).join("");
  }

  function renderFilters() {
    const d = state.model.debugger;
    if (!d) { $("tj-filters").innerHTML = ""; return; }
    const kindsPresent = KINDS.filter(k => d.events.some(e => e.kind === k));
    $("tj-filters").innerHTML = `<div class="segmented">${PHASES.map(p => `<button class="btn phase-btn phase-${p}" data-phase="${p}" aria-pressed="${state.phases.has(p)}"><span class="phase-dot"></span>${p}</button>`).join("")}</div>
      <div class="segmented">${kindsPresent.map(k => `<button class="btn" data-kind="${k}" aria-pressed="${state.kinds.has(k)}">${icon(k)}${k}</button>`).join("")}</div>`;
  }

  // ---------- links between lanes ----------
  function cardRect(el, scroller, base) {
    const r = el.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    const cx = Math.min(Math.max(r.left + r.width / 2, s.left + 8), s.right - 8);
    return {x: cx - base.left, top: r.top - base.top, bottom: r.bottom - base.top, off: r.right < s.left || r.left > s.right};
  }

  function drawLinks() {
    const svg = $("tj-links");
    const base = lanes.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${base.width} ${base.height}`);
    root.querySelectorAll(".is-linked").forEach(el => el.classList.remove("is-linked"));
    const d = state.model?.debugger;
    if (!d) { svg.innerHTML = ""; return; }
    const pairs = [];
    const evIdx = state.hoverEvent ?? (state.hoverStep == null ? state.selEvent : null);
    const stepT = evIdx == null ? (state.hoverStep ?? state.selStep) : null;
    if (evIdx != null) d.events[evIdx]?.steps.forEach(t => pairs.push([evIdx, t]));
    else if (stepT != null) (state.idx.refs.get(stepT) || []).forEach(i => pairs.push([i, stepT]));
    const transient = state.hoverEvent != null || state.hoverStep != null;
    svg.innerHTML = pairs.slice(0, 80).map(([i, t]) => {
      const ev = dbg.querySelector(`[data-ev="${i}"]`), st = steps.querySelector(`[data-step="${t}"]`);
      if (!ev || !st) return "";
      ev.classList.add("is-linked"); st.classList.add("is-linked");
      const a = cardRect(ev, dbg, base), b = cardRect(st, steps, base);
      const y1 = a.bottom, y2 = b.top, mid = (y1 + y2) / 2;
      const phase = d.events[i].phase;
      return `<path class="link phase-${phase} ${a.off || b.off ? "is-off" : ""} ${transient ? "is-preview" : ""}" d="M${a.x},${y1} C${a.x},${mid} ${b.x},${mid} ${b.x},${y2}"/><circle class="link-end phase-${phase}" cx="${b.x}" cy="${y2}" r="3.5"/>`;
    }).join("");
  }
  let raf = 0;
  const scheduleLinks = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawLinks); };

  // ---------- render & events ----------
  function render() {
    if (!state.model) return;
    const keep = {dbg: dbg.scrollLeft, steps: steps.scrollLeft};
    renderFilters(); renderDebugger(); renderSteps();
    dbg.scrollLeft = keep.dbg; steps.scrollLeft = keep.steps;
    scheduleLinks();
  }

  function scrollToCard(scroller, el, smooth = true) {
    if (!el) return;
    const s = scroller.getBoundingClientRect(), r = el.getBoundingClientRect();
    const target = scroller.scrollLeft + r.left - s.left - (el.classList.contains("is-open") ? 16 : (s.width - r.width) / 2);
    programmatic = true;
    scroller.scrollTo({left: target, behavior: smooth ? "smooth" : "auto"});
    setTimeout(() => { programmatic = false; }, 600);
  }
  let programmatic = false;

  function setFollow(on) { state.follow = on; $("tj-follow").setAttribute("aria-pressed", String(on)); }

  function selectStep(t, scroll = true) {
    state.selStep = state.selStep === t && !scroll ? null : t;
    if (state.linkedOnly) renderDebugger();
    root.querySelectorAll(".st-card").forEach(el => el.classList.toggle("is-selected", Number(el.dataset.step) === state.selStep));
    if (scroll) scrollToCard(steps, steps.querySelector(`[data-step="${t}"]`));
    scheduleLinks();
  }

  root.addEventListener("click", async event => {
    const el = event.target;
    const fid = el.closest("[data-fid]")?.dataset.fid;
    if (fid != null) { ctx.navigate("graph", "facts", fid); return; }
    const req = el.closest("[data-request]")?.dataset.request;
    if (req) {
      state.requests.set(req, "loading");
      const box = root.querySelector(`[data-request-box="${CSS.escape(req)}"]`);
      if (box) box.innerHTML = requestHtml(req);
      try { state.requests.set(req, await getJSON(ctx.ref, req)); } catch (error) { state.requests.set(req, {error: error.message}); }
      const fresh = root.querySelector(`[data-request-box="${CSS.escape(req)}"]`);
      if (fresh) fresh.innerHTML = requestHtml(req);
      return;
    }
    const goto = el.closest("[data-goto-step]")?.dataset.gotoStep;
    if (goto) { selectStep(Number(goto)); return; }
    const zoom = el.closest("[data-zoom]");
    if (zoom) { zoom.classList.toggle("is-full"); scheduleLinks(); return; }
    const b = el.closest("button");
    if (b?.dataset.phase) { const p = b.dataset.phase; state.phases.has(p) ? state.phases.delete(p) : state.phases.add(p); render(); return; }
    if (b?.dataset.kind) { const k = b.dataset.kind; state.kinds.has(k) ? state.kinds.delete(k) : state.kinds.add(k); render(); return; }
    if (b?.dataset.jumpEv) { const i = Number(b.dataset.jumpEv); state.selEvent = i; setFollow(false); render(); scrollToCard(dbg, dbg.querySelector(`[data-ev="${i}"]`)); return; }
    if (b?.dataset.pan) { const lane = $(b.dataset.pan); if (lane === dbg) setFollow(false); lane.scrollBy({left: Number(b.dataset.dir) * lane.clientWidth * .8, behavior: "smooth"}); return; }
    if (b?.dataset.jumpStep) { selectStep(Number(b.dataset.jumpStep)); return; }
    if (b?.id === "tj-linked") { state.linkedOnly = !state.linkedOnly; b.setAttribute("aria-pressed", String(state.linkedOnly)); render(); return; }
    if (b?.id === "tj-follow") { setFollow(!state.follow); if (state.follow) scrollToEnd(true); return; }
    if (b?.dataset.toggleEv != null) {
      const i = Number(b.dataset.toggleEv);
      state.openEvent = state.openEvent === i ? null : i; state.selEvent = i; setFollow(false);
      render(); scrollToCard(dbg, dbg.querySelector(`[data-ev="${i}"]`)); return;
    }
    if (b?.dataset.toggleStep != null) {
      const t = Number(b.dataset.toggleStep);
      state.openStep = state.openStep === t ? null : t; state.selStep = t;
      render(); scrollToCard(steps, steps.querySelector(`[data-step="${t}"]`)); return;
    }
    if (el.closest(".card-detail")) return; // reading inside an open card
    const ev = el.closest("[data-ev]");
    if (ev) {
      const i = Number(ev.dataset.ev);
      state.selEvent = state.selEvent === i ? null : i;
      root.querySelectorAll(".ev-card").forEach(c => c.classList.toggle("is-selected", Number(c.dataset.ev) === state.selEvent));
      scheduleLinks(); return;
    }
    const st = el.closest("[data-step]");
    if (st) { selectStep(Number(st.dataset.step), false); }
  });

  root.addEventListener("dblclick", event => {
    if (event.target.closest(".card-detail")) return;
    const card = event.target.closest("[data-ev], [data-step]");
    card?.querySelector(".card-toggle")?.click();
  });

  root.addEventListener("pointerover", event => {
    const ev = event.target.closest(".ev-card"), st = event.target.closest(".st-card");
    const he = ev && !ev.classList.contains("is-open") ? Number(ev.dataset.ev) : null;
    const hs = st && !st.classList.contains("is-open") ? Number(st.dataset.step) : null;
    if (he !== state.hoverEvent || hs !== state.hoverStep) { state.hoverEvent = he; state.hoverStep = hs; scheduleLinks(); }
  });
  lanes.addEventListener("pointerleave", () => { state.hoverEvent = state.hoverStep = null; scheduleLinks(); });

  root.addEventListener("keydown", event => {
    const lane = event.target.closest(".lane-scroll");
    if (event.key === "Escape") { state.openEvent = state.openStep = null; render(); return; }
    if (!lane || !["ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) return;
    event.preventDefault();
    if (lane === dbg) {
      const order = visibleEvents().map(e => e.index);
      if (!order.length) return;
      const pos = order.indexOf(state.selEvent);
      if (event.key === "Enter") { if (state.selEvent != null) { state.openEvent = state.openEvent === state.selEvent ? null : state.selEvent; render(); } return; }
      state.selEvent = order[Math.max(0, Math.min(order.length - 1, pos + (event.key === "ArrowRight" ? 1 : -1)))];
      setFollow(false); render(); scrollToCard(dbg, dbg.querySelector(`[data-ev="${state.selEvent}"]`));
    } else {
      const ts = state.model.steps.map((s, i) => s.t ?? i + 1);
      const pos = ts.indexOf(state.selStep);
      if (event.key === "Enter") { if (state.selStep != null) { state.openStep = state.openStep === state.selStep ? null : state.selStep; render(); } return; }
      selectStep(ts[Math.max(0, Math.min(ts.length - 1, pos + (event.key === "ArrowRight" ? 1 : -1)))]);
    }
  });

  $("tj-search").addEventListener("input", debounce(e => { state.search = e.target.value.trim(); render(); }, 200));
  dbg.addEventListener("scroll", () => {
    scheduleLinks();
    if (!programmatic && state.follow && dbg.scrollLeft + dbg.clientWidth < dbg.scrollWidth - 40) setFollow(false);
  }, {passive: true});
  steps.addEventListener("scroll", scheduleLinks, {passive: true});
  const resize = new ResizeObserver(scheduleLinks);
  resize.observe(lanes);

  // Auto-follow jumps (a smooth scroll would be cut short by the next live render).
  function scrollToEnd(smooth = false) {
    programmatic = true;
    dbg.scrollTo({left: dbg.scrollWidth, behavior: smooth ? "smooth" : "auto"});
    scheduleLinks();
    setTimeout(() => { programmatic = false; }, smooth ? 700 : 120);
  }

  return {
    update(model, {changed, first}) {
      const grew = state.model?.debugger && model.debugger && model.debugger.events.length > state.model.debugger.events.length;
      state.model = model;
      state.idx = stepIndex(model);
      if (!changed.has("all") && !changed.has("messages") && !changed.has("tool_calls") && !changed.has("usage_rows")
          && !changed.has("canonical_record") && !changed.has("input") && !changed.has("record") && !changed.has("steps")
          && !changed.has("window_trace") && !changed.has("direct_submit") && !changed.has("evaluations")) return;
      render();
      if ((grew || first) && state.follow && ctx.store.live) scrollToEnd();
    },
    show(route) {
      // The first live render happens while the tab is still hidden, so follow again once visible.
      if (state.follow && ctx.store.live && !route.extra.length) requestAnimationFrame(() => scrollToEnd());
      if (route.extra[0] === "step" && route.extra[1]) { state.openStep = Number(route.extra[1]); state.selStep = state.openStep; render(); selectStep(state.selStep); }
      if (route.extra[0] === "event" && route.extra[1]) { const i = Number(route.extra[1]); state.openEvent = state.selEvent = i; setFollow(false); render(); scrollToCard(dbg, dbg.querySelector(`[data-ev="${i}"]`)); }
      scheduleLinks();
    },
    destroy() { resize.disconnect(); cancelAnimationFrame(raf); },
  };
}
