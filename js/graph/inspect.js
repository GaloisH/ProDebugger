// Shared inspector panels for graph subviews.
import {entityId} from "../case/model.js?v=edc30cc901";
import {EVAL_CLASS, factChip, factText, SIDE_CLASS} from "../case/format.js?v=edc30cc901";
import {esc, pretty, short} from "../util.js?v=edc30cc901";
import {callTitle} from "../views/process.js?v=edc30cc901";

export const entityChip = id => `<button class="entity-chip" data-entity="${esc(id)}">${esc(id)}</button>`;

// fid -> model calls citing it, and fid -> dependents, computed once per model.
const cache = new WeakMap();
export function factIndex(model) {
  if (cache.has(model)) return cache.get(model);
  const dependents = new Map(), cited = new Map(), evals = new Map();
  model.dsl?.facts.forEach(f => (f.basis || []).forEach(b => { if (!dependents.has(b)) dependents.set(b, []); dependents.get(b).push(f.fid); }));
  model.debugger?.calls.forEach(c => (c.fids || []).forEach(fid => { if (!cited.has(fid)) cited.set(fid, []); cited.get(fid).push(c); }));
  model.evaluations.forEach((e, i) => (e.refs || []).forEach(fid => { if (!evals.has(fid)) evals.set(fid, []); evals.get(fid).push({...e, index: i}); }));
  const index = {dependents, cited, evals};
  cache.set(model, index);
  return index;
}

export function factInspector(model, fid, {compact = false} = {}) {
  const f = model.dsl?.factsById.get(Number(fid));
  if (!f) return `<p class="empty">Fact ${esc(fid)} is not in this record.</p>`;
  const idx = factIndex(model);
  const deps = idx.dependents.get(f.fid) || [];
  const calls = idx.cited.get(f.fid) || [];
  const evals = idx.evals.get(f.fid) || [];
  const chips = list => list.map(id => factChip(model.dsl.factsById.get(id))).join("") || `<p class="muted">None.</p>`;
  return `<div class="insp-head"><span class="eyebrow">Fact f${f.fid}</span>
      <h3 class="mono">${esc(factText(f))}</h3>
      <div class="chip-row"><span class="badge ${SIDE_CLASS[f.side] || ""}">${esc(f.side)}</span><span class="badge">${esc(f.slot)}</span>
      <button class="step-chip" data-open-step="${f.t}">S${String(f.t).padStart(2, "0")}</button>${f.situation != null ? `<span class="badge">situation ${esc(f.situation)}</span>` : ""}</div></div>
    <dl class="kv"><dt>relation</dt><dd class="mono">${esc(f.rel)}</dd>
      <dt>arguments</dt><dd>${(f.args || []).map(a => entityChip(entityId(a))).join(" ")}</dd>
      <dt>value</dt><dd class="mono">${esc(typeof f.value === "object" ? JSON.stringify(f.value) : short(f.value, 300))} <span class="muted">${esc(f.value_type || "")}</span></dd>
      ${f.purpose ? `<dt>purpose</dt><dd>${entityChip(entityId(f.purpose))}</dd>` : ""}</dl>
    ${f.span ? `<div class="insp-block"><h4>Source span</h4><div class="text-box">${esc(f.span)}</div></div>` : ""}
    ${compact ? `<button class="link" data-fid="${f.fid}">Open in fact graph →</button>` : `
    <div class="insp-block"><h4>Basis · ${(f.basis || []).length}</h4><div class="chip-col">${chips(f.basis || [])}</div></div>
    <div class="insp-block"><h4>Dependents · ${deps.length}</h4><div class="chip-col">${chips(deps.slice(0, 30))}</div></div>
    ${evals.length ? `<div class="insp-block"><h4>Rule evaluations · ${evals.length}</h4>${evals.map(e => `<div class="eval-row"><span class="badge ${EVAL_CLASS[e.state] || ""}">${esc(e.state)}</span><button class="link mono" data-rule-eval="${e.index}">${esc(e.rule)}</button><span class="muted">${esc(e.details?.reason || "")}</span></div>`).join("")}</div>` : ""}
    ${model.debugger ? `<div class="insp-block"><h4>Cited by debugger · ${calls.length}</h4>${calls.map(c => `<button class="event-link phase-${esc(c.phase)}" data-open-call="${c.n}"><span class="phase-dot"></span><span class="mono">#${c.n}</span> ${esc(callTitle(c))}<small>${esc(c.phase)}</small></button>`).join("") || `<p class="muted">Not cited yet.</p>`}</div>` : ""}
    <details class="insp-block"><summary>Raw fact</summary><pre class="raw">${esc(pretty(f))}</pre></details>`}`;
}

// Delegated handlers shared by every inspector: open steps/calls in the trajectory, facts/entities in graphs.
export function wireInspector(el, api, onFact) {
  el.addEventListener("click", e => {
    const t = e.target.closest("[data-open-step]");
    if (t) { api.ctx.navigate("trajectory", "step", t.dataset.openStep); return; }
    const call = e.target.closest("[data-open-call]");
    if (call) { api.ctx.navigate("trajectory", "call", call.dataset.openCall); return; }
    const fid = e.target.closest("[data-fid]");
    if (fid) { onFact ? onFact(Number(fid.dataset.fid)) : api.goto("facts", fid.dataset.fid); return; }
    const ent = e.target.closest("[data-entity]");
    if (ent) { api.goto("entities", ent.dataset.entity); return; }
    const rule = e.target.closest("[data-rule-eval]");
    if (rule) api.goto("rules", `eval-${rule.dataset.ruleEval}`);
  });
}
