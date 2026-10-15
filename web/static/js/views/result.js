// Result tab. A diagnosed run gets the AgentDebugger treatment: one root-cause card
// with its step chain, evidence cards beside it and the compared TRACE candidates.
// Any other status explains where and why the run stopped.
import {entityChip} from "../graph/inspect.js";
import {factText, SIDE_CLASS} from "../case/format.js";
import {actionLabel, stepRoles} from "../case/roles.js";
import {esc, number, short} from "../util.js";
import {anchorsByStep} from "./route.js";
import {answerOf} from "./submit.js";
import {assessOf, candidateIndex, queryOf} from "./trace.js";

const human = s => String(s || "").replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
const S = t => `S${String(t).padStart(2, "0")}`;

export function createView(root, ctx) {
  let model = null;

  // Evidence coverage per step, strongest mark wins: root > TRACE candidate > SQL-returned > ROUTE anchor.
  function coverageStrip(m) {
    const d = m.debugger, n = m.steps.length;
    if (!n) return "";
    const anchors = anchorsByStep(d.routeCandidates);
    const queried = new Set(d.calls.flatMap(c => queryOf(c)?.returned_steps || []));
    const candidates = new Set(d.calls.flatMap(c => (assessOf(c)?.candidates || []).map(x => x.step)));
    const root = d.result?.root?.step;
    const LEVELS = [["is-root", "root cause"], ["is-candidate", "TRACE candidate"], ["is-queried", "returned by a TRACE query"], ["is-anchor", "ROUTE anchor"]];
    const level = t => t === root ? 0 : candidates.has(t) ? 1 : queried.has(t) ? 2 : anchors.has(t) ? 3 : null;
    return `<div class="cov-strip" aria-label="Evidence coverage">${m.steps.map((s, i) => {
      const t = s.t ?? i + 1, l = level(t);
      const marks = [anchors.has(t) && "anchor", queried.has(t) && "queried", candidates.has(t) && "candidate", t === root && "root"].filter(Boolean);
      return `<button class="cov-cell ${l == null ? "" : LEVELS[l][0]} ${anchors.has(t) ? "has-anchor" : ""}" data-step="${t}" title="${S(t)} · ${marks.join(", ") || "not reached"}"></button>`;
    }).join("")}</div><div class="cov-legend">${LEVELS.map(([cls, label]) => `<span class="cov-cell ${cls}"></span>${label}`).join(" ")}
      <span class="cov-cell"></span>not reached · ${queried.size}/${n} steps returned by queries</div>`;
  }

  function usageBlock(m) {
    const u = m.debugger?.result?.usage || m.debugger?.usage;
    if (!u) return "";
    const phases = Object.entries(u.by_phase || {});
    return `<details class="result-usage"><summary>Run usage · ${number(u.model_calls)} model calls · ${number(u.input_tokens)} in / ${number(u.output_tokens)} out</summary>
      <table class="usage-table"><thead><tr><th>Phase</th><th>Calls</th><th>Input</th><th>Output</th><th>Cache hit</th></tr></thead><tbody>
      ${phases.map(([p, v]) => `<tr><td><span class="phase-dot phase-${esc(p)}"></span>${esc(p)}</td><td>${number(v.model_calls)}</td><td>${number(v.input_tokens)}</td><td>${number(v.output_tokens)}</td><td>${number(v.cache_hit_input_tokens)}</td></tr>`).join("")}
      </tbody></table></details>`;
  }

  // Where a run without a root cause stopped, and the call to open in the process graph.
  function stopPoint(m, r) {
    const calls = m.debugger.calls;
    const last = phase => calls.filter(c => c.phase === phase).at(-1);
    if (r.status === "no_candidate") return {title: "TRACE found no candidate.",
      text: "Every investigation finished without an error at a single step, so SUBMIT was skipped.", call: last("TRACE")};
    if (r.status === "error" && r.phase === "SUBMIT") return {title: "The SUBMIT answer was rejected.",
      text: "SUBMIT must choose among the existing TRACE candidates; its answer failed validation.", call: last("SUBMIT")};
    if (r.phase === "ROUTE") return {title: "ROUTE ended without anchor cases.",
      text: "ROUTE did not find a concrete, evidence-backed lead for TRACE to investigate.", call: last("ROUTE")};
    return {title: r.status === "uncertain" ? "No root cause accepted." : `Status: ${human(r.status)}.`, text: "", call: calls.at(-1)};
  }

  function investigations(m) {
    const calls = m.debugger.calls.filter(c => c.phase === "TRACE");
    const ids = [...new Set(calls.map(c => c.caseId))];
    if (!ids.length) return "";
    return `<h4>Investigations</h4><ul class="inv-list">${ids.map(id => {
      const mine = calls.filter(c => c.caseId === id);
      const a = mine.map(assessOf).filter(Boolean).at(-1), q = mine.map(queryOf).filter(Boolean).at(-1);
      const last = mine.at(-1);
      return `<li><button class="link mono" data-call="${last.n}">${esc(id)}</button>
        <span class="muted">${q ? `${q.returned_rows ?? (q.rows || []).length} rows · ` : ""}${a ? `${(a.candidates || []).length} candidates` : "not assessed"}</span>
        ${a?.conclusion?.uncertainty ? `<p class="result-text muted">${esc(short(a.conclusion.uncertainty, 420))}</p>` : ""}</li>`;
    }).join("")}</ul>`;
  }

  function statusOnly(m, r) {
    const stop = stopPoint(m, r);
    return `<section class="result-status">
      <div class="eyebrow">Failure attribution</div>
      <h2 class="result-title">${esc(stop.title)}</h2>
      <article class="status-card">
        <div class="chip-row"><span class="badge warn">${esc(human(r.status))}</span>${r.phase ? `<span class="badge phase-${esc(r.phase)}">stopped in ${esc(r.phase)}</span>` : ""}<span class="badge">${esc(r.policy || "")}</span></div>
        ${stop.text ? `<p>${esc(stop.text)}</p>` : ""}
        <dl class="kv"><dt>stop reason</dt><dd>${esc(r.stop_reason || "—")}</dd></dl>
        ${stop.call ? `<button class="btn" data-call="${stop.call.n}">Open call #${stop.call.n} in the process graph →</button>` : ""}
        ${r.status === "no_candidate" ? investigations(m) : ""}
        ${r.reasoning ? `<h4>Reasoning</h4><p class="result-text">${esc(r.reasoning)}</p>` : ""}
        ${r.uncertainty && r.uncertainty !== r.stop_reason ? `<h4>Uncertainty</h4><p class="result-text muted">${esc(r.uncertainty)}</p>` : ""}
        <h4>Evidence coverage</h4>${coverageStrip(m)}
      </article>
      ${usageBlock(m)}
    </section>`;
  }

  // Every TRACE candidate with SUBMIT's comparison; the selected one first and highlighted.
  function compareTable(m, r) {
    const index = candidateIndex(m.debugger.calls);
    const submit = m.debugger.calls.filter(c => c.phase === "SUBMIT").at(-1);
    const answer = submit ? answerOf(submit) : null;
    const reasons = new Map([...(answer?.comparisons || []), ...(r.candidate_comparisons || [])].map(c => [c.candidate_id, c.reasoning]));
    const selected = r.root?.root_id || answer?.selected_candidate_id;
    const rows = [...index].sort(([a], [b]) => (b === selected) - (a === selected));
    if (!rows.length) return "";
    return `<details class="result-compare" open><summary>Compared candidates · ${rows.length}</summary>
      <table class="compare-table"><thead><tr><th>Candidate</th><th>Step</th><th>Module</th><th>Fault</th><th>Role</th><th>SUBMIT comparison</th></tr></thead><tbody>
      ${rows.map(([id, h]) => {
        const c = h.candidate;
        return `<tr class="${id === selected ? "is-chosen" : ""}"><td><button class="link mono" data-call="${h.call.n}">${esc(id.replace(/^trace-window:/, ""))}</button>${id === selected ? ' <span class="badge ok">selected</span>' : ""}</td>
          <td><button class="link mono" data-step="${c.step}">${S(c.step)}</button></td><td>${esc(c.module || "")}</td><td class="mono">${esc(human(c.fault_class))}</td>
          <td>${c.is_root_cause === false ? '<span class="badge">not root</span>' : `<span class="badge ${c.status === "error" ? "bad" : "warn"}">${esc(c.status)}</span>`}</td>
          <td class="compare-reason">${esc(reasons.get(id) || "")}</td></tr>`;
      }).join("")}</tbody></table></details>`;
  }

  function diagnosed(m, r) {
    const rc = r.root;
    const step = m.steps.find((s, i) => (s.t ?? i + 1) === rc.step);
    const idx = m.steps.indexOf(step);
    const roles = step ? stepRoles(step, m.steps[idx + 1]) : null;
    const facts = m.dsl?.factsById;
    const fact = fid => facts?.get(Number(fid));
    const chain = [
      ["Task goal", m.task, ""],
      [human(rc.module), rc.output_quote || rc.proposition, "is-error"],
      ["Action", roles ? actionLabel(roles) : "—", ""],
      ["Observation", roles?.outcome[0]?.value ? short(roles.outcome[0].value, 220) : "—", ""],
    ];
    const cards = [
      ...(r.supporting_evidence || []).map(fid => ({kind: "support", fid})),
      ...(r.counterevidence || []).map(fid => ({kind: "counter", fid})),
    ];
    return `<section class="result-diagnosed">
      <div class="result-headline"><button class="btn" data-nav="trajectory">← Trajectory</button><div><div class="eyebrow">Failure attribution</div><h2 class="result-title">One root cause. Connected evidence.</h2></div></div>
      <div class="result-grid">
        <article class="root-card">
          <div class="eyebrow root-eyebrow">One root cause · ${S(rc.step)}</div>
          <h3>${esc(human(rc.fault_class))}</h3>
          <p>${esc(rc.proposition || r.reasoning || "")}</p>
          <ol class="root-chain">${chain.map(([label, text, cls], i) => `<li class="${cls}" style="--i:${i}"><span class="chain-label">${esc(label)}${cls ? '<em>error layer</em>' : ""}</span><span class="chain-text">${esc(text)}</span></li>`).join("")}</ol>
          ${rc.output_quote ? `<blockquote class="root-quote">“${esc(rc.output_quote)}”</blockquote>` : ""}
          <div class="chip-row">${(rc.goal_links || []).map(entityChip).join("")}</div>
          <div class="root-actions"><button class="btn primary" data-step="${rc.step}">Inspect ${S(rc.step)} →</button>${rc.fid != null ? `<button class="btn" data-fid="${rc.fid}">Fact f${rc.fid} in graph</button>` : ""}</div>
        </article>
        <div class="evidence-col">
          <div class="eyebrow">Supporting evidence</div>
          ${cards.map((c, i) => { const f = fact(c.fid); return `<article class="evidence-card ${c.kind} tone-${c.kind === "counter" ? "plain" : (SIDE_CLASS[f?.side] === "teal" ? "teal" : SIDE_CLASS[f?.side] === "violet" ? "violet" : "info")}" style="--i:${i}">
            <h4>${c.kind === "counter" ? "Counterevidence" : f ? human(f.slot) + " · " + S(f.t) : "Fact"}</h4>
            <p class="mono">${esc(f ? factText(f) : `f${c.fid}`)}</p>${f?.span ? `<p class="muted">${esc(short(f.span, 200))}</p>` : ""}
            <button class="link" data-fid="${c.fid}">f${c.fid} ↗</button>${f ? ` · <button class="link" data-step="${f.t}">${S(f.t)} ↗</button>` : ""}</article>`; }).join("")}
          ${r.repair ? `<article class="evidence-card tone-ok" style="--i:${cards.length}"><h4>Suggested repair</h4><p>${esc(r.repair)}</p></article>` : ""}
        </div>
      </div>
      ${compareTable(m, r)}
      <div class="result-coverage"><div class="eyebrow">Evidence coverage</div>${coverageStrip(m)}</div>
      ${usageBlock(m)}
    </section>`;
  }

  function render() {
    const d = model?.debugger;
    if (!d) { root.innerHTML = `<p class="empty">Compiled sessions have no debugger result.</p>`; return; }
    const r = d.result;
    if (!r) {
      root.innerHTML = `<section class="result-status"><div class="eyebrow">Failure attribution</div><h2 class="result-title">${ctx.store.live ? "The debugger is still working." : "No result was written."}</h2>
        <article class="status-card"><p class="muted">${ctx.store.live ? "The result appears here as soon as SUBMIT completes. Follow the run in the Trajectory tab." : "This run stopped before SUBMIT; inspect the trajectory for the last recorded event."}</p>
        <button class="btn" data-nav="trajectory">Open trajectory</button></article></section>`;
      return;
    }
    root.innerHTML = r.root ? diagnosed(model, r) : statusOnly(model, r);
  }

  root.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.nav) ctx.navigate(b.dataset.nav);
    else if (b.dataset.call) ctx.navigate("trajectory", "call", b.dataset.call);
    else if (b.dataset.step) ctx.navigate("trajectory", "step", b.dataset.step);
    else if (b.dataset.fid) ctx.navigate("graph", "facts", b.dataset.fid);
    else if (b.dataset.entity) ctx.navigate("graph", "goals", b.dataset.entity);
  });

  return {
    update(next, {changed}) {
      const had = model?.debugger?.result;
      model = next;
      if (!had || changed.has("result") || changed.has("all") || changed.has("live")) render();
    },
    show() { root.querySelectorAll(".evidence-card, .root-chain li").forEach(el => { el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; }); },
  };
}
