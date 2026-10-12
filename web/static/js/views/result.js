// Result tab. A diagnosed run gets the AgentDebugger treatment: one root-cause card
// with its step chain, and evidence cards flying in beside it. Any other status
// shows the status and its explanation only.
import {entityChip} from "../graph/inspect.js";
import {factText, SIDE_CLASS} from "../case/format.js";
import {actionLabel, stepRoles} from "../case/roles.js";
import {esc, number, short} from "../util.js";

const human = s => String(s || "").replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
const S = t => `S${String(t).padStart(2, "0")}`;

export function createView(root, ctx) {
  let model = null;

  function coverageStrip(m) {
    const cov = m.debugger?.result?.coverage || m.debugger?.traceWindows || {};
    const assessed = new Set(cov.assessed_steps || []), selected = new Set(cov.selected_steps || []);
    const n = m.steps.length;
    if (!n) return "";
    return `<div class="cov-strip" aria-label="Window coverage">${m.steps.map((s, i) => {
      const t = s.t ?? i + 1;
      return `<button class="cov-cell ${assessed.has(t) ? "is-assessed" : selected.has(t) ? "is-selected" : ""}" data-step="${t}" title="${S(t)} · ${assessed.has(t) ? "assessed" : selected.has(t) ? "selected, not assessed" : "outside windows"}"></button>`;
    }).join("")}</div><div class="cov-legend"><span class="cov-cell is-assessed"></span>assessed <span class="cov-cell is-selected"></span>in a window <span class="cov-cell"></span>not covered · ${assessed.size}/${n} steps assessed</div>`;
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

  function statusOnly(m, r) {
    return `<section class="result-status">
      <div class="eyebrow">Failure attribution</div>
      <h2 class="result-title">${r.status === "uncertain" ? "No root cause accepted." : `Status: ${esc(human(r.status))}.`}</h2>
      <article class="status-card">
        <div class="chip-row"><span class="badge warn">${esc(human(r.status))}</span><span class="badge">${esc(r.policy || "")}</span>${r.evaluation_mode ? `<span class="badge mono">${esc(r.evaluation_mode)}</span>` : ""}</div>
        <dl class="kv"><dt>stop reason</dt><dd>${esc(r.stop_reason || "—")}</dd><dt>verdict</dt><dd>${esc(r.semantic_verdict || "—")}</dd></dl>
        ${r.reasoning ? `<h4>Reasoning</h4><p class="result-text">${esc(r.reasoning)}</p>` : ""}
        ${r.uncertainty ? `<h4>Uncertainty</h4><p class="result-text muted">${esc(r.uncertainty)}</p>` : ""}
        <h4>Window coverage</h4>${coverageStrip(m)}
      </article>
      ${usageBlock(m)}
    </section>`;
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
      ${(r.candidate_comparisons || []).length ? `<details class="result-compare"><summary>Compared candidates · ${(r.candidate_comparisons || []).length}</summary>${r.candidate_comparisons.map(c => `<div class="compare-row"><span class="mono">${esc(c.candidate_id)}</span><p>${esc(c.reasoning || "")}</p></div>`).join("")}</details>` : ""}
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
