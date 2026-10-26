// Tool calls in the side panel: one summary line per call (what was asked → what came back),
// expanding into the readable fields, with the raw arguments and result folded at the end.
// Field names follow the debugger tools (span/check/state/view/…, route_cases, plan_trace, query_logs, assess).
import {factChip} from "../case/format.js?v=edc30cc901";
import {esc, raw, short} from "../util.js?v=edc30cc901";

const S = t => `S${String(t).padStart(2, "0")}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const stepChip = t => `<button class="step-chip" data-goto-step="${t}">${S(t)}</button>`;

// Reads gather evidence, checks evaluate a Fact, decisions hand the phase on.
const KIND = {
  span: "read", view: "read", state: "read", view_evidence: "read", neighbours: "read", query_logs: "read",
  check: "check",
  route_cases: "decide", finish: "decide", reroute: "decide", plan_trace: "decide", assess: "decide",
};
const ICON = {
  read: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  decide: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>',
};
// Decisions have their own section above the tool list; their row stays one line.
const SHOWN_ABOVE = new Set(["route_cases", "finish", "plan_trace", "query_logs", "assess"]);

// "f88 · S29 reflection" for a Fact id.
function factRef(fid, facts) {
  const f = facts?.get(Number(fid));
  return f ? `f${fid} · ${S(f.t)} ${f.slot || f.side || ""}`.trim() : `f${fid}`;
}

// "entity:req:color | steps:1:5 | detail:full" -> "entity:req:color · S01–S05 · detail:full"
function viewSpec(spec) {
  return String(spec || "").split("|").map(s => s.trim()).filter(Boolean)
    .map(s => s.replace(/^steps:(\d+):(\d+)$/, (_, a, b) => `${S(a)}–${S(b)}`)).join(" · ");
}

const countKeys = data => Object.entries(data || {}).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${v.length} ${k.replace(/_/g, " ")}`);

// ---------- per-tool summaries: {input, output, body} ----------
const SUMMARY = {
  span(t, ctx) {
    const text = typeof t.result?.data === "string" ? t.result.data : "";
    const f = ctx.facts?.get(Number(t.args?.fid));
    return {
      input: factRef(t.args?.fid, ctx.facts),
      output: text ? `“${short(text.replace(/\s+/g, " "), 90)}”` : "empty span",
      body: `${f ? factChip(f) : ""}${text ? `<div class="text-box">${esc(text)}</div>` : ""}`,
    };
  },
  check(t, ctx) {
    const d = t.result?.data || {};
    const tone = d.value === true ? "ok" : d.value === false ? "bad" : "warn";
    const value = d.value === true ? "true" : d.value === false ? "false" : String(d.value ?? "?");
    return {
      input: factRef(t.args?.fid, ctx.facts),
      output: `<span class="badge ${tone}">${esc(value)}</span> ${esc(short(d.reason || "", 80))}`, outputHtml: true,
      body: `${d.reason ? `<p>${esc(d.reason)}</p>` : ""}
        ${(d.operands || []).length ? `<ul class="tool-list">${d.operands.map(o => `<li>${esc(short(String(o), 300))}</li>`).join("")}</ul>` : ""}
        ${(d.cites || []).length ? `<div class="chip-col">${d.cites.map(fid => ctx.facts?.get(Number(fid))).filter(Boolean).map(f => factChip(f)).join("")}</div>` : ""}`,
    };
  },
  state(t) {
    const d = t.result?.data || {};
    const entries = Object.entries(d);
    const reqs = entries.filter(([k]) => k.startsWith("satisfied("));
    const met = reqs.filter(([, v]) => v === true).length;
    return {
      input: t.args?.step != null ? `state at ${S(t.args.step)}` : "state",
      output: `${plural(entries.length, "fact")}${reqs.length ? ` · ${met}/${reqs.length} requirements met` : ""}`,
      body: `${reqs.length ? `<dl class="kv">${reqs.map(([k, v]) => `<dt class="mono">${esc(k.slice(10, -1))}</dt><dd><span class="badge ${v === true ? "ok" : v === false ? "bad" : ""}">${v === true ? "met" : v === false ? "unmet" : "unknown"}</span></dd>`).join("")}</dl>` : ""}
        <ul class="tool-list mono">${entries.filter(([k]) => !k.startsWith("satisfied(")).slice(0, 14).map(([k, v]) => `<li>${esc(short(k, 90))}${v === true ? "" : ` = ${esc(short(typeof v === "string" ? v : JSON.stringify(v), 60))}`}</li>`).join("")}</ul>
        ${entries.length - reqs.length > 14 ? `<p class="muted">+${entries.length - reqs.length - 14} more facts</p>` : ""}`,
    };
  },
  view(t) {
    const d = t.result?.data || {};
    const family = String(t.args?.spec || "").split("|")[0].split(":")[0].trim();
    const own = VIEW[family]?.(d);
    const counts = countKeys(d);
    const truncated = d.truncation?.truncated ? " · truncated" : "";
    return {
      input: viewSpec(t.args?.spec),
      output: (own?.output || counts.slice(0, 2).join(" · ") || "no data") + truncated,
      body: (own?.body || (counts.length ? `<p class="muted">${esc(counts.join(" · "))}</p>` : "")) +
        (d.truncation?.truncated && d.truncation.instruction ? `<p class="muted">Truncated: ${esc(d.truncation.instruction)}</p>` : ""),
    };
  },
  view_evidence(t) {
    const a = t.args || {}, d = t.result?.data || {};
    const filters = ["requirement", "kind", "rule", "status"].filter(k => a[k]).map(k => `${k}=${a[k]}`);
    if (Array.isArray(a.steps) && a.steps.length === 2) filters.push(`${S(a.steps[0])}–${S(a.steps[1])}`);
    return {input: a.eid ? `evidence #${a.eid}` : filters.join(" · ") || "all evidence", output: countKeys(d).slice(0, 2).join(" · ") || "no data", body: ""};
  },
  neighbours(t, ctx) {
    const d = t.result?.data || {};
    return {input: `${factRef(t.args?.fid, ctx.facts)} ± ${t.args?.span ?? "?"}`, output: `${plural((d.passed || []).length, "Fact")}${d.note ? ` · ${d.note}` : ""}`, body: ""};
  },
  route_cases(t) {
    const n = (t.args?.candidates || []).length;
    return {input: plural(n, "anchor case"), output: t.result?.data?.window_version ? `accepted · version ${t.result.data.window_version}` : "accepted"};
  },
  finish: t => ({input: t.args?.status || "?", output: short(t.args?.reason || "", 90)}),
  plan_trace(t) {
    const a = t.args || {};
    return {input: `${plural((a.assignments || []).length, "assignment")} · ${plural((a.decision_rules || []).length, "rule")}`, output: "plan accepted"};
  },
  query_logs(t) {
    const d = t.result?.data || {};
    return {input: `SQL · ${t.args?.candidate_id || ""}`, output: `${d.returned_rows ?? (d.rows || []).length} rows${d.partial ? " · partial" : ""}${d.truncated ? " · truncated" : ""}`};
  },
  assess(t) {
    const c = t.args?.candidates || [];
    return {input: t.args?.window_id || "", output: c.length ? `${plural(c.length, "candidate")} · ${[...new Set(c.map(x => x.step).filter(Boolean))].map(S).join(" ")}` : "no candidate"};
  },
};

// view results by spec family; the rest fall back to counts of their list fields.
const VIEW = {
  entity(d) {
    const st = d.status || {};
    return {
      output: `${st.state || "?"} · ${plural((d.evidence || []).length, "evidence step")}${(d.gaps || []).length ? ` · ${plural(d.gaps.length, "gap")}` : ""}`,
      body: `<dl class="kv"><dt>entity</dt><dd class="mono">${esc(d.entity?.id || "")}</dd><dt>status</dt><dd>${esc(st.state || "?")}${st.reason ? ` — ${esc(st.reason)}` : ""}</dd></dl>
        ${(d.evidence || []).length ? `<div class="chip-row">${d.evidence.map(e => stepChip(e.step)).join("")}</div>` : ""}
        ${(d.gaps || []).map(g => `<p class="muted">${esc(String(g.kind || "").replace(/_/g, " "))}</p>`).join("")}`,
    };
  },
  requirements(d) {
    const reqs = d.requirements || [];
    return {
      output: `${plural(reqs.length, "requirement")} · ${reqs.map(r => r.status?.state).filter(Boolean).join(", ") || "?"}`,
      body: `${d.task_contract?.verbatim ? `<blockquote>${esc(d.task_contract.verbatim)}</blockquote>` : ""}
        <dl class="kv">${reqs.map(r => `<dt class="mono">${esc(r.entity?.id || "")}</dt><dd>${esc(r.status?.state || "?")}${(r.gaps || []).length ? ` · ${plural(r.gaps.length, "gap")}` : ""}</dd>`).join("")}</dl>`,
    };
  },
  episodes(d) {
    const eps = d.episodes || [];
    return {
      output: plural(eps.length, "episode"),
      body: `<ul class="tool-list">${eps.map(e => `<li>${stepChip(e.step)} ${esc((e.signals || []).join(", ").replace(/_/g, " "))}</li>`).join("")}</ul>`,
    };
  },
  changes(d) {
    const ch = d.changes || [];
    return {
      output: plural(ch.length, "state change"),
      body: `<ul class="tool-list">${ch.map(c => `<li>${stepChip(c.step)} <span class="mono">${esc(c.relation || "")}</span> ${esc((c.from || []).join(", "))} → ${esc((c.to || []).join(", "))}${c.span ? `<br><span class="muted">${esc(short(c.span, 120))}</span>` : ""}</li>`).join("")}</ul>`,
    };
  },
  local_audits(d) {
    const audits = d.audits || [];
    return {
      output: `${plural(audits.length, "step audit")}${d.coverage?.whole_trajectory_complete ? " · whole trajectory" : ""}`,
      body: `<div class="chip-row">${audits.map(a => stepChip(a.step)).join("")}</div>`,
    };
  },
  scan: d => ({output: `${plural((d.episodes || []).length, "episode")} · ${plural((d.requirements || []).length, "requirement")}`}),
  packet: d => ({output: `debug packet · ${plural((d.linear_scan || []).length, "step")}`}),
};

// A rejected call still shows what it asked for: its input comes from the arguments alone.
function summarize(t, ctx) {
  if (t.error) {
    let input = "";
    try { input = SUMMARY[t.name]?.({...t, result: null}, ctx).input || ""; } catch { /* arguments too malformed to read */ }
    return {input, output: `${t.error.code || "error"}: ${short(t.error.message || "", 90)}`, body: `<p>${esc(t.error.message || JSON.stringify(t.error))}</p>`};
  }
  return SUMMARY[t.name]?.(t, ctx) || {input: "", output: countKeys(t.result?.data).slice(0, 2).join(" · ")};
}

export function toolRow(t, ctx) {
  const kind = KIND[t.name] || "read";
  const s = summarize(t, ctx);
  const input = s.input;
  const state = t.error ? "is-error" : !t.committed ? "is-pending" : "";
  const output = !t.committed && !t.error ? "pending" : s.output;
  const outText = s.outputHtml ? output.replace(/<[^>]+>/g, "") : output;
  const above = SHOWN_ABOVE.has(t.name) && !t.error;
  return `<details class="tool-row kind-${kind} ${state}">
    <summary title="${esc(`${t.name} ${input} → ${outText}`)}"><svg class="tool-ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[kind]}</svg>
      <span class="tool-name mono">${esc(t.name)}</span><span class="tool-in mono">${esc(input)}</span>
      <span class="tool-out">${t.error ? "✕ " : "→ "}${s.outputHtml && !t.error ? output : esc(output)}</span></summary>
    <div class="tool-body">${above ? `<p class="muted">Shown in full above.</p>` : s.body || ""}
      <details class="tool-raw"><summary>Raw</summary><h4>Arguments</h4>${raw(t.args)}${t.committed ? `<h4>Result</h4>${raw(t.result?.data ?? t.result)}` : ""}</details>
    </div>
  </details>`;
}

export function toolList(tools, ctx) {
  return `<div class="tool-rows">${tools.map(t => toolRow(t, ctx)).join("")}</div>`;
}
