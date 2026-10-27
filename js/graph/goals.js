// Goal graph: task → requirements → constraints, and the facts that serve or test
// each requirement. Runs add the MAP goal_map status (met/unmet, gaps, steps).
import {entityId} from "../case/model.js?v=27bf1baa85";
import {factChip, factText} from "../case/format.js?v=27bf1baa85";
import {esc, short} from "../util.js?v=27bf1baa85";
import {entityChip, wireInspector} from "./inspect.js?v=27bf1baa85";

const COLS = [0, 360, 700, 1060], TW = 300, RW = 290, CW = 300, FW = 250, RH = 50, CH = 44, FH = 34, GAP = 12, BLOCK_GAP = 40, MAX_FACTS = 8;
const human = s => String(s).replace(/^qualifier_\d+_/, "").replace(/_/g, " ");

export function createSubview(api, createCanvas) {
  const state = {model: null, selected: null, index: null};
  api.legend.innerHTML = `<span class="lg lg-met"></span>met <span class="lg lg-unmet"></span>unmet / not proven <span class="lg lg-unmodeled"></span>unmodeled (free text) <span class="muted">Constraint badges count facts whose value matches the expected text.</span>`;
  const canvas = createCanvas(api.stage, {
    onClick: id => { if (id.startsWith("f:")) api.goto("facts", id.slice(2)); else select(id); },
    onBackground: () => select(null),
    onHover: id => canvas.mark("is-hover", id ? [id] : [], id ? (a, b) => a === id || b === id : null),
    tooltip: id => tip(id),
  });
  wireInspector(api.inspector, api);

  function statusOf(name) {
    const reqs = state.model.debugger?.goalMap?.requirements || [];
    return reqs.find(r => r.entity?.id === `req:${name}`);
  }

  function indexGoals() {
    const {goals, facts} = state.model.dsl;
    return goals.map(g => {
      const id = `req:${g.name}`;
      const evidence = facts.filter(f => (f.args || []).some(a => entityId(a) === id) || entityId(f.purpose) === id);
      const constraints = (g.constraints || []).map((c, i) => {
        const prop = entityId(c.property);
        const expected = String(c.expected ?? "").toLowerCase();
        const matches = expected ? facts.filter(f => (f.args || []).some(a => entityId(a) === prop) && typeof f.value === "string" && f.value.toLowerCase().includes(expected)) : [];
        return {...c, id: `c:${g.name}:${i}`, prop, matches};
      });
      return {goal: g, id, evidence, constraints, status: statusOf(g.name)};
    });
  }

  function build() {
    state.index = indexGoals();
    const nodes = [], edges = [];
    let y = 0;
    const blocks = state.index.map(item => {
      const rows = Math.max(1, item.constraints.length, Math.min(item.evidence.length, MAX_FACTS) + (item.evidence.length > MAX_FACTS ? 1 : 0));
      const h = Math.max(RH, rows * (FH + GAP) - GAP);
      const block = {item, y, h};
      y += h + BLOCK_GAP;
      return block;
    });
    const totalH = Math.max(y - BLOCK_GAP, RH);
    nodes.push({id: "task", x: COLS[0], y: totalH / 2 - 40, w: TW, h: 80, label: short(state.model.task, 40), sub: `${state.index.length} requirement${state.index.length === 1 ? "" : "s"}`, cls: "goal-task", title: state.model.task});
    blocks.forEach(({item, y: by, h}) => {
      const g = item.goal, st = item.status?.status?.state;
      const cls = g.status_mode === "unmodeled" ? "is-unmodeled" : st === "met" ? "is-met" : "is-unmet";
      const target = g.target ? entityId(g.target) : "";
      nodes.push({id: item.id, x: COLS[1], y: by + h / 2 - RH / 2, w: RW, h: RH, label: short(human(g.name), 34),
                  sub: `${g.count ?? 1}× ${g.of_kind || ""} ${g.rel || ""} ${target}`.trim(), cls: `goal-req ${cls}`, badge: st || g.status_mode || ""});
      edges.push({from: "task", to: item.id, cls: "goal-edge", route: "horizontal"});
      item.constraints.forEach((c, i) => {
        const cy = by + i * (CH + GAP);
        nodes.push({id: c.id, x: COLS[2], y: cy, w: CW, h: CH, label: short(`${c.prop.split(":")[1] || c.prop} ${c.operator} ${c.expected}`, 36),
                    sub: `${c.mode || ""} · conf ${c.confidence ?? "—"}`, cls: "goal-constraint", badge: c.matches.length ? String(c.matches.length) : ""});
        edges.push({from: item.id, to: c.id, cls: "goal-edge", route: "horizontal"});
      });
      item.evidence.slice(0, MAX_FACTS).forEach((f, i) => {
        nodes.push({id: `f:${f.fid}`, x: COLS[3], y: by + i * (FH + GAP), w: FW, h: FH, label: short(factText(f), 30), sub: `f${f.fid} · S${f.t} · ${f.slot}`, cls: `fact side-${f.side}`});
        edges.push({from: item.id, to: `f:${f.fid}`, cls: "goal-edge evidence", route: "horizontal"});
      });
      if (item.evidence.length > MAX_FACTS) {
        nodes.push({id: `more:${item.id}`, x: COLS[3], y: by + MAX_FACTS * (FH + GAP), w: FW, h: FH, label: `+${item.evidence.length - MAX_FACTS} more facts`, cls: "ghost"});
        edges.push({from: item.id, to: `more:${item.id}`, cls: "goal-edge evidence", route: "horizontal"});
      }
    });
    const labels = [{x: COLS[0], y: -18, text: "TASK"}, {x: COLS[1], y: -18, text: "REQUIREMENTS"}, {x: COLS[2], y: -18, text: "CONSTRAINTS"}, {x: COLS[3], y: -18, text: "FACTS SERVING / TESTING"}];
    canvas.setScene({nodes, edges, labels});
  }

  function tip(id) {
    if (id === "task") return `<div>${esc(state.model.task)}</div>`;
    const item = state.index.find(x => x.id === id || id === `more:${x.id}`);
    if (item) return `<strong class="mono">${esc(item.id)}</strong><div class="muted">${item.evidence.length} related facts</div>`;
    const c = state.index.flatMap(x => x.constraints).find(x => x.id === id);
    if (c) return `<strong>${esc(c.prop)} ${esc(c.operator)} ${esc(c.expected)}</strong><div class="muted">span “${esc(c.span || "")}”</div>`;
    const f = state.model.dsl.factsById.get(Number(id.slice(2)));
    return f ? `<span class="mono">${esc(factText(f))}</span>` : "";
  }

  function inspector() {
    const id = state.selected;
    const gm = state.model.debugger?.goalMap;
    if (!id || id === "task") {
      const tc = gm?.task_contract;
      return `<div class="insp-head"><span class="eyebrow">Task contract</span><h3>${esc(state.model.task)}</h3></div>
        ${tc ? `<dl class="kv">${Object.entries(tc).filter(([k]) => k !== "verbatim").map(([k, v]) => `<dt>${esc(k.replace(/_/g, " "))}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : `<p class="muted">Compiled sessions carry goals but no MAP status; run the debugger to see met/unmet.</p>`}
        <div class="insp-block"><h4>Requirements</h4>${state.index.map(x => `<button class="sig-chip" data-goal="${esc(x.id)}">${esc(human(x.goal.name))} <span class="muted">${esc(x.status?.status?.state || x.goal.status_mode || "")}</span></button>`).join("")}</div>`;
    }
    const c = state.index.flatMap(x => x.constraints).find(x => x.id === id);
    if (c) return `<div class="insp-head"><span class="eyebrow">Constraint</span><h3 class="mono">${esc(c.prop)} ${esc(c.operator)} ${esc(c.expected)}</h3>
        <div class="chip-row"><span class="badge">${esc(c.mode || "")}</span><span class="badge">${esc(c.value_type || "")}</span><span class="badge">confidence ${esc(c.confidence ?? "—")}</span></div></div>
      <dl class="kv"><dt>property</dt><dd>${entityChip(c.prop)}</dd><dt>source span</dt><dd>“${esc(c.span || "")}”</dd>${c.unit ? `<dt>unit</dt><dd>${esc(c.unit)}</dd>` : ""}</dl>
      <div class="insp-block"><h4>Facts with a matching value · ${c.matches.length}</h4><div class="chip-col">${c.matches.slice(0, 30).map(f => factChip(f, `<span class="slot mono">S${f.t}</span>`)).join("") || `<p class="muted">No recorded value contains “${esc(c.expected)}”.</p>`}</div></div>`;
    const item = state.index.find(x => x.id === id || id === `more:${x.id}`);
    if (!item) return "";
    const s = item.status;
    const st = s?.status;
    return `<div class="insp-head"><span class="eyebrow">Requirement</span><h3>${esc(human(item.goal.name))}</h3>
        <div class="chip-row">${st ? `<span class="badge ${st.state === "met" ? "ok" : "warn"}">${esc(st.state)}</span>` : ""}<span class="badge">${esc(item.goal.status_mode || "")}</span>${entityChip(item.id)}</div></div>
      ${st ? `<p>${esc(st.reason || "")}</p><dl class="kv"><dt>recorded met</dt><dd>${esc(st.recorded_met)} / ${esc(st.required_count)}</dd>
        ${["qualifying_steps", "fully_qualifying_steps", "decision_steps"].map(k => `<dt>${k.replace(/_/g, " ")}</dt><dd>${(st[k] || []).map(t => `<button class="step-chip" data-open-step="${t}">S${String(t).padStart(2, "0")}</button>`).join(" ") || "—"}</dd>`).join("")}</dl>` : ""}
      ${s?.gaps?.length ? `<div class="insp-block"><h4>Gaps</h4>${s.gaps.map(g => `<p class="tone-text-warn">${esc(String(g.kind).replace(/_/g, " "))}</p>`).join("")}</div>` : ""}
      <div class="insp-block"><h4>Definition</h4><dl class="kv"><dt>count</dt><dd>${esc(item.goal.count)}</dd><dt>of kind</dt><dd>${esc(item.goal.of_kind)}</dd><dt>relation</dt><dd class="mono">${esc(item.goal.rel)}</dd><dt>target</dt><dd>${item.goal.target ? entityChip(entityId(item.goal.target)) : "—"}</dd>
        ${(item.goal.attrs || []).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>
      <div class="insp-block"><h4>Related facts · ${item.evidence.length}</h4><div class="chip-col">${item.evidence.map(f => factChip(f, `<span class="slot mono">S${f.t}</span>`)).join("") || `<p class="muted">None.</p>`}</div></div>`;
  }

  function select(id) {
    if (id?.startsWith("more:")) id = id.slice(5);
    state.selected = id;
    api.select(id);
    api.inspector.innerHTML = inspector();
    canvas.mark("is-selected", id ? [id] : []);
    if (id && id !== "task") {
      const ids = new Set([id, "task"]);
      const item = state.index.find(x => x.id === id) || state.index.find(x => x.constraints.some(c => c.id === id));
      if (item) { ids.add(item.id); item.constraints.forEach(c => ids.add(c.id)); item.evidence.forEach(f => ids.add(`f:${f.fid}`)); ids.add(`more:${item.id}`); }
      canvas.mark("is-lineage", ids, (a, b) => ids.has(a) && ids.has(b));
      canvas.dim(true);
    } else { canvas.mark("is-lineage", []); canvas.dim(false); }
  }

  api.inspector.addEventListener("click", e => {
    const b = e.target.closest("[data-goal]");
    if (b) { select(b.dataset.goal); canvas.focus(b.dataset.goal); }
  }, true);

  return {
    update(model, {changed, first}) {
      const firstTime = !state.model;
      state.model = model;
      if (!model.dsl) return;
      if (firstTime || first || changed.has("goal_map")) { build(); api.inspector.innerHTML = inspector(); if (state.selected) select(state.selected); }
    },
    show(id) { if (id && state.index) { select(id); requestAnimationFrame(() => canvas.focus(id)); } },
    destroy() { canvas.destroy(); },
  };
}
