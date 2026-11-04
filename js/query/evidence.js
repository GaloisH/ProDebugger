import {SLOT_LABEL} from "./model.js?v=signs-82";
import {faultText} from "./narrate.js?v=23f9bfd6b4";

const SLOT_ORDER = ["obs", "mem", "refl", "plan", "act"];
const MOD = {observation: "obs", observations: "obs", feedback: "obs", memory: "mem", reflection: "refl", reflections: "refl",
             plan: "plan", planning: "plan", action: "act", actions: "act"};
const MODS = Object.keys(MOD).join("|");
const STEP_MODS = new RegExp(`\\bsteps?[- ](\\d+)(?:\\s*(?:/|–|-|and|to)\\s*(\\d+))?(?:'s)?\\s+((?:original\\s+|[a-z]+(?:-[a-z]+)+\\s+)?(?:${MODS})(?:\\s*(?:,|and|/)\\s*(?:original\\s+)?(?:${MODS}))*)\\b`, "gi");
const BARE_MOD = new RegExp(`\\b(?:the|its|this)\\s+(?:original\\s+)?(${MODS})\\b`, "gi");

export const ROLE_LABEL = {root: "root cause", world: "world shows", context: "agent's view", correction: "correction",
                           repeat: "repeats it", rival: "rival", effect: "effect"};

const squash = t => String(t || "").replace(/\s+/g, " ").trim();
const clip = (t, n) => { t = squash(t); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; };
const sentences = t => squash(t).split(/(?<=[.!?])\s+(?=[A-Z“"])/).filter(Boolean);
const words = t => new Set(String(t || "").toLowerCase().match(/[a-z]{4,}/g) || []);
const ruleWords = id => String(id || "").replace(/_/g, " ");
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t;

function clauseAt(sentence, at) {
  const cuts = [...sentence.matchAll(/;\s+|,\s+(?=(?:but|while|so|yet|though|and then|whereas|and (?:the )?(?:step|later|earlier))\b)|:\s+/g)];
  let start = 0, end = sentence.length;
  for (const m of cuts) {
    if (m.index < at) start = m.index + m[0].length;
    else { end = m.index; break; }
  }
  return cap(squash(sentence.slice(start, end)).replace(/^(?:but|and|so|yet|thus|then)\s+/i, "").replace(/[.;:,]+$/, ""));
}

function cellSentences(facts) {
  const spans = [...new Set(facts.map(f => f.span).filter(Boolean))];
  const lines = spans.join("\n").split("\n").map(x => x.trim()).filter(Boolean);
  const body = lines.length > 1 && !lines[0].startsWith("-") && lines.slice(1).some(x => x.startsWith("-")) ? lines.slice(1) : lines;
  return body.map(x => x.replace(/^-\s*/, "").replace(/^[^?]{8,140}\?\s+(?=\S)/, "").replace(/^If the action did not[^.]*?step\.\s*/i, ""))
    .flatMap(sentences).filter(s => s.length > 12);
}

function pickQuote(facts, reading, extra) {
  const ss = cellSentences(facts);
  if (!ss.length) return "";
  const want = new Set([...words(reading), ...extra]);
  const score = s => [...words(s)].filter(w => want.has(w)).length;
  return clip(ss.reduce((best, s) => score(s) > score(best) ? s : best, ss[0]), 130);
}

export function buildEvidence(scene) {
  const r = scene.root;
  if (!r) return null;
  const result = scene.source?.result || {};
  const over = scene.source?.board || {};
  const cell = (t, slot) => scene.facts.filter(f => f.t === t && f.slot === slot);
  const rootSlot = r.fid != null ? scene.factById.get(r.fid)?.slot : MOD[String(r.module).toLowerCase()] || null;
  const comparisons = result.candidate_comparisons || [];

  const found = new Map();
  const note = (t, slot, reading) => {
    const k = `${t}:${slot}`;
    if (t < 1 || t > scene.meta.steps || !cell(t, slot).length) return;
    if (!found.has(k)) found.set(k, {step: t, slot, reading});
  };
  for (const s of sentences(r.reasoning)) {
    const named = [];
    const at = s.match(/^(?:At|In|By) step[- ](\d+),/i);
    for (const m of s.matchAll(STEP_MODS)) {
      if (at && +m[1] !== +at[1] && !m[2] && /\b(?:from|than|over|unlike|instead of)\s+(?:the\s+)?$/i.test(s.slice(0, m.index))) { named.push([m.index, m.index + m[0].length]); continue; }
      const steps = m[2] ? [+m[1], +m[2]] : [+m[1]];
      const mods = m[3].toLowerCase().match(new RegExp(MODS, "g")) || [];
      named.push([m.index, m.index + m[0].length]);
      for (const t of steps) for (const w of mods) note(t, MOD[w], clauseAt(s, m.index));
    }
    if (at) for (const m of s.matchAll(BARE_MOD)) {
      if (named.some(([a, b]) => m.index >= a && m.index < b)) continue;
      note(+at[1], MOD[m[1].toLowerCase()], clauseAt(s, m.index));
    }
  }
  if (rootSlot) {
    const k = `${r.step}:${rootSlot}`;
    if (!found.has(k)) found.set(k, {step: r.step, slot: rootSlot, reading: r.proposition});
  }

  let rival = null;
  const other = scene.candidates.find(c => c.id !== r.candidate && !(c.step === r.step && c.module === r.module));
  if (other) {
    const lane = scene.lanes.find(l => l.id === other.lane);
    const cmp = comparisons.find(c => lane && String(c.candidate_id).includes(`:${lane.agent}:`));
    rival = {step: other.step, slot: MOD[String(other.module).toLowerCase()] || null, module: other.module,
             claim: clip(other.proposition, 160), why: cmp ? clip(sentences(cmp.reasoning).slice(0, 2).join(" "), 230) : ""};
  } else {
    const ss = sentences(r.reasoning);
    const named = new RegExp(STEP_MODS.source, "i");
    const k = ss.findIndex(s => /\brival\b/i.test(s) && named.test(s));
    if (k >= 0) {
      const m = [...ss[k].matchAll(STEP_MODS)][0];
      const w = (m[3].toLowerCase().match(new RegExp(MODS)) || [])[0];
      rival = {step: +m[1], slot: MOD[w], module: w, claim: clip(clauseAt(ss[k], m.index), 160), why: clip(ss[k + 1] || "", 230)};
    }
  }

  if (rival?.slot && !found.has(`${rival.step}:${rival.slot}`) && cell(rival.step, rival.slot).length)
    found.set(`${rival.step}:${rival.slot}`, {step: rival.step, slot: rival.slot, reading: rival.claim});

  const goalWords = new Set(scene.goals.flatMap(g => g.constraints.map(c => String(c.expected).toLowerCase())).filter(w => w.length > 3));
  const roleOf = row => {
    if (row.step === r.step && row.slot === rootSlot) return "root";
    if (rival && row.step === rival.step && row.slot === rival.slot) return "rival";
    if (/\b(correct|recogni[sz]|wrong item|mismatch|resume|redirect|realiz)/i.test(row.reading)) return "correction";
    if (row.slot === "obs") return row.step > r.step ? "effect" : "world";
    return row.step <= r.step ? "context" : "repeat";
  };
  let rows = [...found.values()].sort((a, b) => a.step - b.step || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  if (over.rows?.length) rows = over.rows.map(o => ({step: o.step, slot: o.slot, reading: o.reading || found.get(`${o.step}:${o.slot}`)?.reading || "", role: o.role, quote: o.quote}));
  if (rows.length > 9) {
    const keep = new Set(rows.map((x, i) => [i, Math.abs(x.step - r.step) - (roleOf(x) === "root" || roleOf(x) === "rival" ? 99 : 0)]).sort((a, b) => a[1] - b[1]).slice(0, 9).map(([i]) => i));
    rows = rows.filter((x, i) => keep.has(i));
  }
  rows = rows.map(row => {
    const fs = cell(row.step, row.slot);
    const role = row.role || roleOf(row);
    return {...row, role, module: SLOT_LABEL[row.slot] || row.slot, fids: fs.map(f => f.fid),
            reading: clip(row.reading, 150),
            quote: row.quote || (role === "root" && r.quote ? clip(r.quote, 130) : pickQuote(fs, row.reading, goalWords))};
  });

  const pool = [...sentences(r.reasoning), ...comparisons.flatMap(c => sentences(c.reasoning))];
  const rules = scene.rules.map((rule, i) => {
    const o = over.rules?.[rule.id] || {};
    const said = pool.filter(s => s.includes(rule.id));
    let status = rule.id === r.rule?.id ? "applies"
      : said.some(s => /\bnot (?:established|supported|met|satisfied)|\brefuted\b|does not apply|is not\b|isn't\b|fails?\b/i.test(s)) ? "not met"
      : said.length ? "weighed" : "not cited";
    if (o.status) status = o.status;
    const s = said[0], k = s ? s.indexOf(rule.id) : -1;
    const after = s ? s.slice(k + rule.id.length).match(/^[^:]*?:\s+(.+)$/)?.[1] : null;
    const named = new RegExp(`(?:the\\s+)?(?:manager(?:'s|’s|\\W{1,3}s)?\\s+)?(?:rule\\s+)?${rule.id}(?:\\s+rule)?`, "i");
    const reason = o.reason || (after ? clip(cap(after), 150)
      : s ? clip(clauseAt(s, k).replace(named, "the rule").replace(/^(?:Thus|So|Hence)\s+/i, ""), 150).replace(/^the rule/, "The rule")
      : status === "not cited" ? "SUBMIT's reasoning does not cite it." : "");
    return {id: rule.id, n: i + 1, name: o.name || cap(ruleWords(rule.id)), status, reason, when: clip(rule.finding, 220)};
  });

  const verdict = {step: r.step, module: r.module, fault: faultText(r.faultClass) || "", say: over.verdict?.say || clip(r.proposition, 200),
                   fids: r.fid != null ? [r.fid] : cell(r.step, rootSlot).map(f => f.fid)};
  if (rival && over.rival?.why) rival.why = over.rival.why;
  if (rival && over.rival?.claim) rival.claim = over.rival.claim;
  if (rival) rival.fids = cell(rival.step, rival.slot).map(f => f.fid);
  const uncertainty = over.uncertainty || clip(sentences(result.uncertainty || "")[0] || "", 200);
  return {rows, rules, verdict, rival, uncertainty};
}
