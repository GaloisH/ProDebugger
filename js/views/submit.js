// SUBMIT calls: one tool-less answer that must choose among the existing TRACE candidates
// (direct_submit, policy window-candidates-submit/v5-manager-forced-choice).
import {esc, raw} from "../util.js?v=d7ea551f31";
import {candidateCard, candidateIndex} from "./trace.js?v=d7ea551f31";

const S = t => `S${String(t).padStart(2, "0")}`;

export function answerOf(call) {
  const text = call.message?.content;
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* tolerate fenced or prefixed JSON */ }
  const m = String(text).match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

export function submitTitle(call) {
  const a = answerOf(call);
  if (!a) return call.rejection ? "Answer rejected" : null;
  const status = call.rejection ? "rejected" : a.status || "answer";
  return a.selected_candidate_id ? `${status} · ${a.selected_candidate_id.replace(/^trace-window:/, "")}` : status;
}

const traceLink = hit => hit ? `<button class="btn" data-goto-call="${hit.call.index}">TRACE #${hit.call.n} · ${esc(hit.caseId)}</button>` : "";

// Phase overview: the latest answer and the candidate it chose.
export function submitOverview(p, ctx) {
  const call = [...p.calls].reverse().find(answerOf);
  const a = call && answerOf(call);
  if (!a) return "";
  const hit = candidateIndex(ctx.model?.debugger?.calls || []).get(a.selected_candidate_id);
  return `<div class="side-section"><h4>Answer ${a.status ? `<span class="badge ${a.status === "diagnosed" ? "ok" : "warn"}">${esc(a.status)}</span>` : ""}${call.rejection ? ' <span class="badge bad">rejected</span>' : ""} <button class="btn" data-goto-call="${call.index}">Open #${call.n}</button></h4>
    ${hit ? candidateCard(hit.candidate) : a.selected_candidate_id ? `<p class="mono">${esc(a.selected_candidate_id)}</p>` : `<p class="muted">No candidate selected.</p>`}</div>`;
}

export function submitDetail(call, ctx) {
  const a = answerOf(call);
  const calls = ctx.model?.debugger?.calls || [];
  const index = candidateIndex(calls);
  const parts = [];
  if (call.rejection) parts.push(`<div class="detail-block tone-bad"><h4>Answer rejected</h4><p>${esc(call.rejection)}</p></div>`);
  if (!a) return parts.join("");
  const hit = index.get(a.selected_candidate_id);
  parts.push(`<div class="side-section"><h4>Selected ${a.status ? `<span class="badge ${a.status === "diagnosed" ? "ok" : "warn"}">${esc(a.status)}</span>` : ""}</h4>
    ${hit ? candidateCard(hit.candidate) : a.selected_candidate_id ? `<p class="mono">${esc(a.selected_candidate_id)}</p>` : `<p class="muted">No candidate selected.</p>`}
    ${a.fault_class && hit && a.fault_class !== hit.candidate.fault_class ? `<p class="muted">SUBMIT reclassified the fault as <span class="mono">${esc(a.fault_class)}</span>.</p>` : ""}
    ${traceLink(hit)}</div>`);
  if (a.reasoning) parts.push(`<details class="detail-block tone-info" open><summary>Reasoning</summary><div class="text-box">${esc(a.reasoning)}</div></details>`);
  if (a.repair) parts.push(`<details class="detail-block tone-ok"><summary>Suggested repair</summary><div class="text-box">${esc(a.repair)}</div></details>`);
  const comparisons = a.comparisons || a.candidate_comparisons || [];
  if (comparisons.length) {
    parts.push(`<div class="side-section"><h4>Compared candidates · ${comparisons.length}</h4>${comparisons.map(c => {
      const h = index.get(c.candidate_id);
      const chosen = c.candidate_id === a.selected_candidate_id;
      return `<div class="detail-block ${chosen ? "tone-ok" : ""}"><h4><span class="mono">${esc(c.candidate_id.replace(/^trace-window:/, ""))}</span>
          ${h ? `<span class="chip-row"><button class="step-chip" data-goto-step="${h.candidate.step}">${S(h.candidate.step)}</button><span class="mono">${esc(h.candidate.module)}</span></span>` : ""}${chosen ? '<span class="badge ok">selected</span>' : ""}</h4>
        <p>${esc(c.reasoning || "")}</p>${h && !chosen ? traceLink(h) : ""}</div>`;
    }).join("")}</div>`);
  }
  parts.push(`<details class="detail-block"><summary>Raw answer</summary>${raw(a)}</details>`);
  return parts.join("");
}
