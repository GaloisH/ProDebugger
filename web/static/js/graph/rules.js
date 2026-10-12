// Rule → evaluation/evidence → fact, as three columns. Evaluations are filtered by
// state (violated by default); facts are ordered by the barycentre of the
// evaluations citing them to keep crossings down.
import {EVAL_CLASS, factText} from "../case/format.js";
import {esc, short} from "../util.js";
import {factInspector, wireInspector} from "./inspect.js";

const X = [0, 400, 800], RW = 300, RH = 64, EW = 300, EH = 40, FW = 270, FH = 34, GAP = 10;
const STATES = ["violated", "unknown", "satisfied", "not_applicable"];

export function createSubview(api, createCanvas) {
  const state = {model: null, states: new Set(["violated"]), hiddenRules: new Set(), selected: null};
  api.toolbar.innerHTML = `<div class="segmented" id="ru-states"></div><div class="chip-row" id="ru-rules"></div>`;
  api.legend.innerHTML = `<span class="lg lg-bad"></span>violated <span class="lg lg-warn"></span>unknown <span class="lg lg-ok"></span>satisfied <span class="muted">E = also emitted as candidate evidence · solid edge = bound fact, dashed = context fact</span>`;
  const canvas = createCanvas(api.stage, {
    onClick: id => select(id), onBackground: () => select(null),
    onHover: id => hover(id),
    tooltip: id => tip(id),
    onDouble: id => { const e = evalOf(id); if (e) api.ctx.navigate("trajectory", "step", e.t); else if (id.startsWith("f:")) api.goto("facts", id.slice(2)); },
  });
  wireInspector(api.inspector, api);
  api.inspector.addEventListener("click", e => {
    const b = e.target.closest("[data-ru]");
    if (b) { select(b.dataset.ru); canvas.focus(b.dataset.ru); }
  }, true);

  const evalOf = id => id?.startsWith("e:") ? state.model.evaluations[Number(id.slice(2))] : null;
  const ruleIds = () => [...new Set([...state.model.rules.map(r => r.id), ...state.model.evaluations.map(e => e.rule)])];
  const evidenceKey = x => `${x.rule}|${x.t}|${(x.refs || []).join(",")}`;

  function renderToolbar() {
    const counts = {};
    state.model.evaluations.forEach(e => { counts[e.state] = (counts[e.state] || 0) + 1; });
    api.toolbar.querySelector("#ru-states").innerHTML = STATES.filter(s => counts[s]).map(s =>
      `<button class="btn state-btn ${EVAL_CLASS[s] || ""}" data-state="${s}" aria-pressed="${state.states.has(s)}">${s.replace("_", " ")} <span class="count">${counts[s]}</span></button>`).join("");
    api.toolbar.querySelector("#ru-rules").innerHTML = ruleIds().map(r =>
      `<button class="kind-chip rule-chip ${state.hiddenRules.has(r) ? "is-off" : ""}" data-rule="${esc(r)}">${esc(r)}</button>`).join("");
  }

  function build() {
    const {evaluations, dsl} = state.model;
    const evidence = new Set(state.model.evidences.map(evidenceKey));
    const rules = ruleIds().filter(r => !state.hiddenRules.has(r));
    const visible = evaluations.map((e, i) => ({...e, index: i})).filter(e => state.states.has(e.state) && !state.hiddenRules.has(e.rule))
      .sort((a, b) => rules.indexOf(a.rule) - rules.indexOf(b.rule) || a.t - b.t);
    const nodes = [], edges = [];
    // Middle column first; rules are centred on their evaluations.
    const evalY = new Map();
    visible.forEach((e, i) => {
      const y = i * (EH + GAP);
      evalY.set(e.index, y);
      nodes.push({id: `e:${e.index}`, x: X[1], y, w: EW, h: EH, label: `S${String(e.t).padStart(2, "0")} · ${short(e.details?.reason || e.state, 26)}`,
                  sub: `${e.rule.split("/")[0]} · ${(e.refs || []).map(r => "f" + r).join(" ")}`, cls: `evaluation st-${e.state}`, badge: evidence.has(evidenceKey(e)) ? "E" : ""});
    });
    // Rules with nothing visible stack below the rest.
    let fallbackY = Math.max(0, visible.length * (EH + GAP)) + 30;
    const counts = {};
    evaluations.forEach(e => { (counts[e.rule] ||= {})[e.state] = (counts[e.rule][e.state] || 0) + 1; });
    rules.forEach(r => {
      const ys = visible.filter(e => e.rule === r).map(e => evalY.get(e.index));
      let y;
      if (ys.length) y = (Math.min(...ys) + Math.max(...ys)) / 2 + EH / 2 - RH / 2;
      else { y = fallbackY; fallbackY += RH + GAP; }
      const c = counts[r] || {};
      const def = state.model.rules.find(x => x.id === r);
      nodes.push({id: `r:${r}`, x: X[0], y, w: RW, h: RH, label: r, sub: `✗${c.violated || 0}  ?${c.unknown || 0}  ✓${c.satisfied || 0} · ${def?.property || ""}`, cls: `rule ${ys.length ? "" : "is-empty"}`});
      visible.filter(e => e.rule === r).forEach(e => edges.push({from: `r:${r}`, to: `e:${e.index}`, cls: `rule-edge st-${e.state}`, route: "horizontal"}));
    });
    // Facts by barycentre of the evaluations citing them.
    const factYs = new Map();
    visible.forEach(e => (e.refs || []).forEach(fid => { if (!factYs.has(fid)) factYs.set(fid, []); factYs.get(fid).push(evalY.get(e.index)); }));
    const facts = [...factYs.entries()].map(([fid, ys]) => ({fid, y: ys.reduce((a, b) => a + b, 0) / ys.length})).sort((a, b) => a.y - b.y);
    let lastY = -Infinity;
    facts.forEach(({fid, y}) => {
      const f = dsl.factsById.get(fid);
      const yy = Math.max(y, lastY + FH + GAP);
      lastY = yy;
      nodes.push({id: `f:${fid}`, x: X[2], y: yy, w: FW, h: FH, label: f ? short(factText(f), 30) : `f${fid}`, sub: f ? `f${fid} · S${f.t} · ${f.slot}` : "missing", cls: `fact side-${f?.side || "other"}`});
    });
    visible.forEach(e => (e.refs || []).forEach((fid, i) => edges.push({from: `e:${e.index}`, to: `f:${fid}`, cls: `ref-edge ${i ? "context" : "bound"}`, route: "horizontal"})));
    canvas.setScene({nodes, edges, labels: [{x: X[0], y: -18, text: "RULES"}, {x: X[1], y: -18, text: `EVALUATIONS · ${visible.length}`}, {x: X[2], y: -18, text: `FACTS · ${facts.length}`}]});
    if (state.selected) highlight(state.selected);
  }

  function related(id) {
    const ids = new Set([id]);
    const edges = api.stage.querySelectorAll(".edge");
    const add = (from) => edges.forEach(el => { if (el.dataset.from === from) ids.add(el.dataset.to); });
    if (id.startsWith("r:")) { add(id); [...ids].filter(x => x.startsWith("e:")).forEach(add); }
    else if (id.startsWith("e:")) { add(id); edges.forEach(el => { if (el.dataset.to === id) ids.add(el.dataset.from); }); }
    else edges.forEach(el => { if (el.dataset.to === id) { ids.add(el.dataset.from); edges.forEach(x => { if (x.dataset.to === el.dataset.from) ids.add(x.dataset.from); }); } });
    return ids;
  }
  function highlight(id) {
    if (!id) { canvas.mark("is-lineage", []); canvas.dim(false); return; }
    const ids = related(id);
    canvas.mark("is-lineage", ids, (a, b) => ids.has(a) && ids.has(b));
    canvas.dim(true);
  }
  function hover(id) {
    if (!id) { canvas.mark("is-hover", []); return; }
    const ids = related(id);
    canvas.mark("is-hover", ids, (a, b) => ids.has(a) && ids.has(b));
  }

  function tip(id) {
    const e = evalOf(id);
    if (e) return `<strong>${esc(e.rule)} · S${e.t}</strong><div class="muted">${esc(e.state)} · ${esc(e.details?.reason || "")}</div>`;
    if (id.startsWith("f:")) { const f = state.model.dsl.factsById.get(Number(id.slice(2))); return f ? `<span class="mono">${esc(factText(f))}</span>` : ""; }
    const r = state.model.rules.find(x => `r:${x.id}` === id);
    return r ? `<strong>${esc(r.id)}</strong><div class="muted">${esc(r.property)} when ${esc(r.trigger)}</div>` : "";
  }

  function ruleInspector(rid) {
    const r = state.model.rules.find(x => x.id === rid) || {id: rid};
    const evals = state.model.evaluations.map((e, i) => ({...e, index: i})).filter(e => e.rule === rid);
    const maxT = state.model.dsl?.maxT || Math.max(1, ...evals.map(e => e.t));
    const byT = new Map();
    evals.forEach(e => { if (!byT.has(e.t)) byT.set(e.t, []); byT.get(e.t).push(e); });
    const worst = list => list.some(e => e.state === "violated") ? "violated" : list.some(e => e.state === "unknown") ? "unknown" : list[0].state;
    return `<div class="insp-head"><span class="eyebrow">Abstract rule</span><h3 class="mono">${esc(rid)}</h3></div>
      <dl class="kv">${Object.entries(r).filter(([k]) => k !== "id").map(([k, v]) => `<dt>${esc(k.replace(/_/g, " "))}</dt><dd class="mono">${esc(Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v)}</dd>`).join("")}</dl>
      <div class="insp-block"><h4>Evaluations by step · ${evals.length}</h4><div class="step-strip">${Array.from({length: maxT}, (_, i) => i + 1).map(t => { const list = byT.get(t); return `<button class="strip-cell ${list ? "st-" + worst(list) : ""}" ${list ? `data-ru="e:${list[0].index}"` : "disabled"} title="S${t}${list ? ": " + list.map(e => e.state).join(", ") : ""}"></button>`; }).join("")}</div></div>
      <div class="insp-block"><h4>Reasons</h4>${Object.entries(evals.reduce((m, e) => { const k = `${e.state}|${e.details?.reason || "—"}`; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, n]) => { const [s, reason] = k.split("|"); return `<div class="eval-row"><span class="badge ${EVAL_CLASS[s] || ""}">${esc(s)}</span><span>${esc(reason)}</span><span class="muted">×${n}</span></div>`; }).join("")}</div>`;
  }

  function evalInspector(e, index) {
    const ev = state.model.evidences.find(x => evidenceKey(x) === evidenceKey(e));
    return `<div class="insp-head"><span class="eyebrow">Rule evaluation #${index}</span><h3 class="mono">${esc(e.rule)}</h3>
        <div class="chip-row"><span class="badge ${EVAL_CLASS[e.state] || ""}">${esc(e.state)}</span><button class="step-chip" data-open-step="${e.t}">S${String(e.t).padStart(2, "0")}</button>${ev ? `<span class="badge info">evidence e${ev.eid} · ${esc(ev.status)}</span>` : ""}</div></div>
      <dl class="kv"><dt>reason</dt><dd>${esc(e.details?.reason || "—")}</dd>${Object.entries(e.details || {}).filter(([k]) => k !== "reason").map(([k, v]) => `<dt>${esc(k.replace(/_/g, " "))}</dt><dd class="mono">${esc(typeof v === "object" ? JSON.stringify(v) : v)}</dd>`).join("")}</dl>
      ${(e.refs || []).map((fid, i) => `<div class="insp-block"><h4>${i ? "Context fact" : "Bound fact"}</h4>${factInspector(state.model, fid, {compact: true})}</div>`).join("")}`;
  }

  function select(id) {
    state.selected = id;
    api.select(id);
    canvas.mark("is-selected", id ? [id] : []);
    highlight(id);
    const e = evalOf(id);
    api.inspector.innerHTML = !id ? overview() : id.startsWith("r:") ? ruleInspector(id.slice(2)) : e ? evalInspector(e, Number(id.slice(2)))
      : factInspector(state.model, Number(id.slice(2)));
  }

  function overview() {
    return `<div class="insp-head"><span class="eyebrow">Rules → evidence → facts</span><h3>${state.model.rules.length} rules · ${state.model.evaluations.length} evaluations</h3></div>
      <p class="muted">Each abstract rule is evaluated where it applies; violated evaluations are emitted as candidate evidence for the debugger. Evaluations reference the facts they bind and the facts that contextualise them.</p>
      <div class="insp-block"><h4>Rules</h4>${ruleIds().map(r => `<button class="sig-chip mono" data-ru="r:${esc(r)}">${esc(r)}</button>`).join("")}</div>`;
  }

  api.toolbar.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.state) { const s = b.dataset.state; state.states.has(s) ? state.states.delete(s) : state.states.add(s); }
    else if (b.dataset.rule) { const r = b.dataset.rule; state.hiddenRules.has(r) ? state.hiddenRules.delete(r) : state.hiddenRules.add(r); }
    else return;
    renderToolbar(); build();
  });

  return {
    update(model, {changed, first}) {
      const firstTime = !state.model;
      state.model = model;
      if (!model.dsl) return;
      if (firstTime || first || changed.has("evaluations") || changed.has("record")) { renderToolbar(); build(); api.inspector.innerHTML = state.selected ? "" : overview(); if (state.selected) select(state.selected); }
    },
    show(id) {
      if (!id || !state.model?.dsl) return;
      const nodeId = id.startsWith("eval-") ? `e:${id.slice(5)}` : id;
      const e = evalOf(nodeId);
      if (e && !state.states.has(e.state)) { state.states.add(e.state); renderToolbar(); build(); }
      select(nodeId);
      requestAnimationFrame(() => canvas.focus(nodeId));
    },
    destroy() { canvas.destroy(); },
  };
}
