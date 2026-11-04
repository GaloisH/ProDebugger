import {agentWords, cap, faultText, goalText, question, statusText, stepList, suspicion} from "./narrate.js?v=23f9bfd6b4";
import {SIGNAL_LABEL, SLOT_LABEL} from "./model.js?v=signs-82";

const GOAL = new Set(["constraint_substitution", "wrong_task_decision", "claims_task_complete", "contradicted_completion"]);
const INVALID = new Set(["invalid_action", "no_effect", "failed_precondition", "missing_effect"]);
const NOISE = new Set(["no_new_task_evidence", "schema_repetition", "near_duplicate_action", "repeated_action", "unbound_intention", "alignment_violation"]);

const clip = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; };
const firstSentence = t => String(t || "").replace(/\s+/g, " ").split(/(?<=[.?!])\s+/)[0] || "";
const OUTCOME = {supported: "Supported", refuted: "Refuted", unknown: "Unknown"};
const VERDICT_OF = {supported: "counts as the cause", refuted: "drop this suspect", unknown: "no verdict yet"};

function stepSignals(scene) {
  const out = new Map();
  const walk = v => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const step = v.step ?? v.t, list = v.routing_signals || v.signals;
      if (Number.isInteger(step) && Array.isArray(list)) {
        if (!out.has(step)) out.set(step, new Set());
        list.forEach(s => typeof s === "string" && out.get(step).add(s));
      }
      Object.values(v).forEach(walk);
    }
  };
  scene.events.forEach(ev => !ev.error && walk(ev.call?.result?.data));
  const kind = new Map();
  for (const [step, set] of out) {
    const k = [...set].some(s => GOAL.has(s)) ? "goal" : [...set].some(s => INVALID.has(s)) ? "invalid" : [...set].some(s => NOISE.has(s)) ? "noise" : null;
    if (k) kind.set(step, k);
  }
  return {kind, raw: out};
}

function goalSlip(set) {
  if (!set) return null;
  if (set.has("claims_task_complete")) return {short: "claims done", say: set.has("contradicted_completion") ? "declares the task done, but the record contradicts it" : "declares the task done", kicker: "FALSE \u201cDONE\u201d"};
  if (set.has("constraint_substitution")) return {short: "swaps a constraint", say: "swaps a task constraint for another", kicker: "CONSTRAINT SWAPPED"};
  if (set.has("wrong_task_decision")) return {short: "wrong decision", say: "makes a wrong task decision", kicker: "WRONG DECISION"};
  return null;
}

const BASE_ATTRS = new Set(["object_type", "destination_type"]);
const attrOf = c => String(c.attribute || c.property || "").replace(/^attribute:/, "");
const qualifier = c => { const a = attrOf(c).replace(/_/g, " "), v = c.expected; return v === true || v === "true" ? a : v === false || v === "false" ? `not ${a}` : `${a} = ${v}`; };

const rangeOf = spec => { const m = String(spec || "").match(/\bsteps:(\d+):(\d+)\b/); return m ? [Number(m[1]), Number(m[2])] : null; };
const span = ([a, b]) => a === b ? `step ${a}` : `steps ${a}–${b}`;


const SLOT_ORDER = ["obs", "mem", "refl", "plan", "act", "chk"];
const nameOf = key => { const [kind, ...rest] = String(key || "").split(":"); const i = rest.join(":").replace(/_/g, " "); return /^\d+$/.test(i) ? `${kind} ${i}` : i || kind; };

function around(span, name) {
  const text = String(span || "").replace(/\s+/g, " ").replace(/^.*?(?:history\.|outcome|next step)\s*/i, "").replace(/-\s*Step \d+[^:]*:\s*/g, "");
  const i = text.toLowerCase().indexOf(name.toLowerCase());
  if (i < 0) return "";
  const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, i - 10)));
  const rest = text.slice(i + name.length);
  const stop = rest.search(/[.?!](\s|$)/);
  const end = i + name.length + (stop >= 0 && stop <= 60 ? stop : Math.min(60, rest.length));
  const cut = text.slice(start, end).trim().replace(/[\s,;:-]+$/, "");
  return (start > 0 ? "…" : "") + (end - i - name.length >= 60 && end < text.length ? cut.replace(/\s+\S*$/, "") + "…" : cut);
}

function buildThread(scene, w, symptom) {
  const clue = w.fids.map(f => scene.factById.get(f)).filter(Boolean);
  const act = clue.find(f => f.slot === "act");
  const objKey = act?.args.find(a => !a.startsWith("agent:")) || clue.flatMap(f => f.args).find(a => !a.startsWith("agent:") && !a.startsWith("req:"));
  if (!objKey) return null;
  const obj = nameOf(objKey);
  const failAt = symptom.find(s => s > w.step);
  const last = Math.min(scene.meta.steps, (failAt ?? w.step + 3) + 1);
  const from = Math.max(1, w.step - 1);
  const nodes = [];
  const env = new Map();
  let holding = false, place = null;
  for (const f of scene.facts.filter(f => f.t >= w.step && f.t <= last).sort((a, b) => a.t - b.t || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))) {
    const about = f.args.includes(objKey);
    if (f.slot === "obs" && about) {
      const e = env.get(f.t) || {step: f.t, lane: "env", fids: [], full: f.span, slot: "obs", parts: {}};
      e.fids.push(f.fid);
      if (f.rel === "in" && f.value === true) e.parts.place = nameOf(f.args.find(a => a !== objKey));
      if (f.rel === "holding" && f.value === true) e.parts.holding = true;
      if (f.rel === "has" && f.value === true && f.args.some(a => a.endsWith("object_type"))) e.parts.type = nameOf(f.args[f.args.length - 1]);
      else if (f.rel === "has" && f.value === true) {
        const attr = f.args.find(a => a.startsWith("attribute:"))?.slice(10), val = f.args.find(a => a.startsWith("value:"))?.slice(6);
        if (attr) e.parts.attr = val === "true" ? `is ${attr.replace(/_/g, " ")}` : `${attr.replace(/_/g, " ")}: ${val}`;
      }
      env.set(f.t, e);
    } else if (f.t === w.step && w.fids.includes(f.fid) && f.slot !== "obs" && f.slot !== "chk") {
      const words = f.slot === "act" ? String(f.value) : around(f.span, obj) || (f.slot === "plan" ? agentWords(f) : "");
      if (words) nodes.push({step: f.t, lane: "agent", fids: [f.fid], slot: f.slot, label: `${SLOT_LABEL[f.slot]}: ${words}`, full: f.span});
    } else if (f.slot === "act" && about && f.t > w.step) {
      nodes.push({step: f.t, lane: "agent", fids: [f.fid], slot: "act", label: `action: ${f.value}`, full: f.span});
    } else if (f.slot === "chk" && f.rel === "satisfied" && f.value === false && f.args.some(a => a.startsWith("req:"))) {
      nodes.push({step: f.t, lane: "goal", fids: [f.fid], slot: "chk", label: "goal check: not met", full: f.span});
    }
  }
  let seen = false;
  for (const e of [...env.values()].sort((a, b) => a.step - b.step)) {
    let label;
    if (!seen && e.parts.place) label = `sees ${obj} in ${e.parts.place}`;
    else if (e.parts.holding && !holding) label = `picked up ${obj}`;
    else if (e.parts.place && e.parts.place !== place) label = `${obj} on ${e.parts.place}`;
    else if (e.parts.attr) label = `${obj} ${e.parts.attr}`;
    if (e.parts.place) place = e.parts.place;
    holding = !!e.parts.holding;
    if (!label) continue;
    if (!seen && e.parts.type) e.sub = `type: ${e.parts.type}`;
    seen = true;
    nodes.push({...e, label});
  }
  nodes.sort((a, b) => a.step - b.step || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  nodes.forEach((n, i) => { n.id = `t${i}`; });
  const links = nodes.slice(1).map((n, i) => [nodes[i].id, n.id]);
  const back = nodes.find(n => n.lane === "goal")?.step ?? failAt;
  return {obj, objKey, from, to: last, anchor: w.step, nodes, links,
          trace: back ? {from: back, to: w.step, label: `back along ${obj} to step ${w.step}`} : null};
}


const LINK_TOPICS = new Set(["hypothesis", "completion", "decision_basis", "expected_gain"]);
function buildBridge(scene, thread, w, raw) {
  const reqs = (scene.goalMap?.requirements || []).filter(r => r.status?.state && r.status.state !== "met");
  const want = reqs.flatMap(r => (r.definition?.constraints || []).map(c => ({attr: attrOf(c), need: String(c.expected), c})));
  let clash = null;
  for (const f of scene.facts) {
    if (f.slot !== "obs" || f.rel !== "has" || f.value !== true || !f.args.includes(thread.objKey)) continue;
    const attr = f.args.find(a => a.startsWith("attribute:"))?.slice(10), got = f.args.find(a => a.startsWith("value:"))?.slice(6);
    const c = want.find(x => x.attr === attr && got && x.need !== got);
    if (c) { clash = {attr: attr.replace(/_/g, " "), need: c.need, got, step: f.t}; break; }
  }
  let gap = null;
  if (!clash) {
    const shown = scene.facts.filter(f => f.slot === "obs" && f.rel === "has" && f.value === true && f.args.includes(thread.objKey));
    const attrsSeen = new Set(shown.map(f => f.args.find(a => a.startsWith("attribute:"))?.slice(10)).filter(Boolean));
    const miss = want.find(x => !BASE_ATTRS.has(x.attr) && !attrsSeen.has(x.attr));
    if (miss) {
      const instead = shown.find(f => f.t >= thread.anchor && f.t <= thread.to && !f.args.some(a => /attribute:(object_type|destination_type)$/.test(a)));
      gap = {attr: miss.attr.replace(/_/g, " "), need: qualifier(miss.c),
             instead: instead ? instead.args.find(a => a.startsWith("attribute:")).slice(10).replace(/_/g, " ") : null, step: instead?.t};
    }
  }
  const objWord = thread.obj.replace(/\s+\d+$/, "");
  const names = [thread.obj, objWord, clash?.need, gap?.attr].filter(Boolean).map(x => x.toLowerCase());
  const seen = new Set(), links = [];
  for (const card of scene.lanes.flatMap(l => l.cards)) {
    if (seen.has(card.source_id) || card.step < thread.anchor || card.step > thread.to) continue;
    seen.add(card.source_id);
    for (const st of card.statements || []) {
      if (!LINK_TOPICS.has(st.topic) || st.polarity === "negative") continue;
      const text = `${st.subject_quote || ""} ${st.detail_quote || ""}`.toLowerCase();
      if (!names.some(nm => text.includes(nm))) continue;
      links.push({step: card.step, module: card.module, topic: st.topic, modality: st.modality, quote: card.quote, subject: st.subject_quote, detail: st.detail_quote});
    }
  }
  const kindOf = l => l.topic === "hypothesis" && l.modality === "tentative" ? "guess" : "commit";
  const bridges = [];
  for (const l of links.sort((a, b) => a.step - b.step)) {
    const kind = kindOf(l), b = bridges.find(x => x.step === l.step && x.kind === kind);
    if (b) { b.quotes.push(`${l.module}: ${l.quote}`); if (!b.modules.includes(l.module)) b.modules.push(l.module); continue; }
    bridges.push({step: l.step, kind, module: l.module, modules: [l.module], topic: l.topic, quotes: [`${l.module}: ${l.quote}`], detail: l.detail, subject: l.subject});
  }
  const rootStep = scene.root?.step;
  const firstCommit = bridges.find(b => b.kind === "commit" && (rootStep == null || b.step === rootStep)) || bridges.find(b => b.kind === "commit");
  const verbAt = step => String(scene.facts.find(f => f.t === step && f.slot === "act" && f.args.includes(thread.objKey))?.value || "").split(" ")[0];
  for (const b of bridges) {
    b.role = b.kind === "guess" ? "guess" : b === firstCommit ? "root" : b.step >= (firstCommit?.step ?? 0) ? "repeat" : "commit";
    const subjNamed = names.some(nm => String(b.subject || "").toLowerCase().includes(nm));
    const said = clip(b.detail && !subjNamed ? b.detail.replace(/^(?:should (?:be to|focus on)|is to|will|to)\s+/i, "")
      : `${b.subject || ""} → ${b.detail || ""}`.replace(/^ → /, ""), 50);
    if (b.kind === "guess") b.label = clash ? `could be the ${clash.need}` : said;
    else if (["completion", "expected_gain"].includes(b.topic) && verbAt(b.step)) b.label = `${verbAt(b.step)} it = task done`;
    else b.label = b.role === "repeat" ? "relies on it again" : said;
  }
  if (!bridges.some(b => b.role === "root")) return null;
  const fail = thread.nodes.find(n => n.lane === "goal")?.step ?? thread.trace?.from;
  const world = thread.nodes.filter(n => n.lane === "env").map((n, i) => ({step: n.step, label: i === 0 && clash ? `${clash.attr}: ${clash.got}` : n.label.replace(thread.obj, "").replace(/\s+/g, " ").replace(/^sees in /, "seen in ").trim() || n.label, full: n.full}));
  const root = bridges.find(b => b.role === "root"), guess = bridges.find(b => b.role === "guess"), repeat = bridges.filter(b => b.role === "repeat");
  const goalName = goalText(reqs[0]?.entity?.id) || "the goal";
  const quals = (reqs[0]?.definition?.constraints || []).filter(c => !BASE_ATTRS.has(attrOf(c))).map(qualifier);
  const need = clash ? `${clash.attr} = ${clash.need}` : quals.length ? `${goalName} · ${quals.join(", ")}` : goalName;
  const got = clash ? `${thread.obj} · ${clash.attr} = ${clash.got}` : gap ? `${thread.obj} · ${gap.instead ? `${gap.instead}, ` : ""}never ${gap.need}` : thread.obj;
  const checked = thread.nodes.some(n => n.lane === "goal" && n.step === fail);
  const slip = checked ? null : goalSlip(raw?.get(fail));
  const failKicker = checked ? "GOAL CHECK FAILS" : slip?.kicker || "GOAL FAILS";
  const failSay = checked ? `the goal check fails at step ${fail}` : slip ? `at step ${fail} it ${slip.say}` : `the goal fails at step ${fail}`;
  const worldAt = clash?.step ?? gap?.step ?? world[0]?.step;
  const table = {
    need: gap ? `${cap(objWord)} must be ${gap.need}` : clash ? `${cap(clash.attr)}: ${clash.need}` : cap(need),
    needSub: gap || clash ? `goal: ${goalName}` : "",
    world: clash ? `${cap(thread.obj)}: ${clash.attr} = ${clash.got}` : gap ? (gap.instead ? `${cap(thread.obj)} is ${gap.instead}` : `${cap(thread.obj)} is never ${gap.need}`) : cap(got),
    worldSub: gap?.instead ? `never ${gap.need}` : clash ? `not ${clash.need}` : "", worldStep: worldAt,
    guess: guess ? {step: guess.step, text: guess.label} : null,
    root: {step: root.step, module: root.module, text: root.label, quote: root.quotes.join("\n")},
    after: repeat.length ? `Relies on it again at ${repeat.map(r => `S${r.step}`).join(", ")}` : "",
    afterSub: slip ? `S${fail}: ${slip.say}` : "",
    outcome: checked ? "Goal check fails" : slip ? "Task not done" : "Goal fails", outcomeStep: fail,
  };
  return {
    from: thread.from, to: thread.to, anchor: thread.anchor, fail, failKicker, need, got, world, bridges, clash, gap, table,
    beats: [
      gap ? `The goal needs ${goalName}, and the ${objWord} must be ${gap.need}.` : `The goal needs ${need}.`,
      gap ? `The world shows ${thread.obj}${gap.instead ? ` ${gap.instead} at step ${gap.step}` : ""}, but never ${gap.need}.` : `The world shows ${got}.`,
      guess ? `At step ${guess.step} the agent guesses ${thread.obj} ${guess.label}.` : `At step ${root.step} the agent links ${thread.obj} to the goal.`,
      `At step ${root.step} it commits: \u201c${root.label}\u201d. ${gap ? `Nothing in the world shows the ${objWord} ${gap.need}.` : "Nothing in the world supports that link."}`,
      `${repeat.length ? `At ${stepList(repeat.map(r => r.step))} it relies on the link again` : "The link stands"}${fail ? `, and ${failSay}` : ""}.`,
      `Tracing back from the failure, the first commitment is step ${root.step}'s ${root.module}: the root cause.`,
    ],
  };
}


const SLOT_OF = {memory: "mem", reflection: "refl", plan: "plan", action: "act", observation: "obs"};
function bridgeTower(scene, model, br, thread, w, upto, mapCluster) {
  const cell = (step, module, prefer) => {
    const all = scene.facts.filter(f => f.t === step && f.slot === SLOT_OF[module]).map(f => f.fid);
    const own = all.filter(f => prefer.includes(f));
    return own.length ? own : all;
  };
  const shown = c => !c.error && c.event <= upto && (c.kind === "query" || c.kind === "window");
  const holding = fids => model.clusters.filter(c => shown(c) && c.fids.some(f => fids.includes(f))).map(c => c.id).slice(0, 4);
  const of = role => br.bridges.filter(b => b.role === role);
  const world = thread.nodes.filter(n => n.lane === "env").flatMap(n => n.fids);
  const guess = of("guess").flatMap(b => b.modules.flatMap(m => cell(b.step, m, w.fids)));
  const rootB = of("root")[0];
  const root = scene.root?.fid != null && scene.root.step === rootB.step ? [scene.root.fid] : cell(rootB.step, rootB.module, w.fids);
  const repeat = of("repeat").flatMap(b => b.modules.flatMap(m => cell(b.step, m, [])));
  const fail = thread.nodes.filter(n => n.lane === "goal").flatMap(n => n.fids);
  const M = [{fids: world, kind: "env", label: "1"}, {fids: guess, kind: "agent", label: "2"}, {fids: root, kind: "root", label: "3"},
             {fids: repeat, kind: "agent", label: "4"}, {fids: fail, kind: "goal", label: "5"}].filter(m => m.fids.length);
  const upTo = n => M.filter(m => Number(m.label) <= n);
  const beats = [
    {focus: mapCluster ? [mapCluster] : [], marks: []},
    {focus: holding(world), marks: upTo(1)},
    {focus: [w.id], marks: upTo(2)},
    {focus: [w.id], marks: upTo(3)},
    {focus: holding([...repeat, ...fail]), marks: upTo(5)},
    {focus: [w.id], marks: M.filter(m => m.kind === "root").map(m => ({...m, label: ""})), journey: root[0], upto},
  ];
  beats.marks = Object.fromEntries(M.map(m => [m.label, {fids: m.fids, focus: holding(m.fids).length ? holding(m.fids) : [w.id]}]));
  return beats;
}

const FOLD = 8;
export function fisheye(n, lo, hi, wide) {
  const left = lo > 3 ? [1, lo - 1] : null, right = hi < n - 2 ? [hi + 1, n] : null;
  const a = left ? lo : 1, b = right ? hi : n;
  const weight = s => s === wide && b - a > 2 ? 2.2 : 1;
  let total = 0;
  for (let s = a; s <= b; s++) total += weight(s);
  const room = 100 - FOLD * ((left ? 1 : 0) + (right ? 1 : 0));
  const cols = new Map();
  let at = 0;
  const fold = ([p, q]) => { const w = FOLD / (q - p + 1); for (let s = p; s <= q; s++) { cols.set(s, [at, w]); at += w; } };
  if (left) fold(left);
  for (let s = a; s <= b; s++) { const w = weight(s) / total * room; cols.set(s, [at, w]); at += w; }
  if (right) fold(right);
  const col = s => cols.get(Math.max(1, Math.min(n, s)));
  return {n, col, x: s => col(s)[0] + col(s)[1] / 2,
          span: (p, q) => [col(p)[0], col(q)[0] + col(q)[1] - col(p)[0]],
          folded: s => !!((left && s <= left[1]) || (right && s >= right[0])),
          bands: [left && {a: left[0], b: left[1], fold: true}, {a, b, fold: false}, right && {a: right[0], b: right[1], fold: true}].filter(Boolean)};
}

export function buildStory(scene, model) {
  const n = scene.meta.steps;
  const ev = scene.events;
  const last = (pred) => { let k = -1; ev.forEach((e, i) => { if (!e.error && pred(e)) k = i; }); return k; };
  const rows = [], cards = [];
  const byCluster = id => model.byId.get(id);

  const {kind, raw} = stepSignals(scene);
  const steps = k => [...kind].filter(([, v]) => v === k).map(([s]) => s).sort((a, b) => a - b);
  const goalSteps = steps("goal"), invalid = steps("invalid"), noise = steps("noise");
  const nums = list => list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : String(list[0] ?? "");

  const reqs = scene.goalMap?.requirements || [];
  const failed = reqs.filter(r => r.status?.state && r.status.state !== "met");
  const decided = [...new Set(failed.flatMap(r => r.status?.decision_steps || []))].sort((a, b) => a - b);
  const mapAt = ev.findIndex(e => e.phase === "MAP" && !e.error);
  const goalName = reqs.length ? reqs.map(r => goalText(r.entity?.id)).join("; ") : scene.goals.map(g => goalText(g.key)).join("; ");
  const tally = Object.entries(reqs.reduce((m, r) => { const k = r.status?.state || "unknown"; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, v]) => `${v} ${k}`).join(", ");
  const goalLine = reqs.length > 1 ? `${reqs.length} requirements (${clip(goalName.replace(/; /g, ", "), 70)}): ${tally}`
    : `${cap(goalName || scene.meta.task || "the task")}${reqs[0]?.status?.state ? ` is ${reqs[0].status.state}` : ""}`;
  const slips = decided.length ? [] : goalSteps.map(step => ({step, slip: goalSlip(raw.get(step))})).filter(x => x.slip);
  const slipSay = slips.length ? slips[0].slip : null, slipSteps = slips.map(x => x.step);
  const sList = list => list.map(x => `S${x}`).join(", ");
  const failNote = decided.length ? `goal failed · ${sList(decided)}` : slipSay ? `${slipSay.short} · ${sList(slipSteps)}` : "";
  rows.push({
    key: "goal", phase: "MAP", question: "What should the agent achieve?",
    answer: `${goalLine}${decided.length ? `; the agent's finishing decision at ${stepList(decided)} broke a constraint` : slipSay ? `; at ${stepList(slipSteps)} the agent ${slipSay.say}` : ""}.`,
    short: decided.length ? `Goal fails at step${decided.length > 1 ? "s" : ""} ${decided.join(", ")}` : slipSay ? `${slipSay.kicker === "FALSE \u201cDONE\u201d" ? "False \u201cdone\u201d" : cap(slipSay.short)} at step${slipSteps.length > 1 ? "s" : ""} ${slipSteps.join(", ")}` : reqs.length > 1 ? `${reqs.length} requirements: ${tally}` : clip(goalLine, 40),
    event: mapAt >= 0 ? mapAt : 0, focus: mapAt >= 0 && ev[mapAt].cluster ? [ev[mapAt].cluster] : ["core"],
    marks: (decided.length ? decided : slipSteps).map((step, i) => ({type: "x", step, label: i ? "" : failNote})),
  });
  const constraint = c => `${String(c.attribute || c.property || "").replace(/^attribute:/, "").replace(/_/g, " ")} = ${c.expected}`;
  cards.push({row: "goal", phase: "MAP", title: "The goal", lines: [
    ...reqs.slice(0, 3).map(r => ({text: cap(goalText(r.entity?.id)), strong: true})),
    ...reqs.slice(0, 1).flatMap(r => (r.definition?.constraints || []).map(c => ({text: `Must hold: ${clip(constraint(c), 90)}`}))),
    ...(failed.length ? [{text: `${cap(failed[0].status.state)}${failed[0].status.reason ? `: ${failed[0].status.reason}` : ""}`, tone: "bad"}] : []),
  ]});

  const global = ev.map((e, i) => i).filter(i => ev[i].phase === "ROUTE" && !ev[i].error && ev[i].cluster && !rangeOf(ev[i].spec) && ev[i].name !== "route_cases");
  rows.push({
    key: "signals", phase: "ROUTE", question: "Which steps look wrong?",
    answer: [noise.length && `routine steps with no new progress: ${noise.length}`, invalid.length && `actions with no effect at ${nums(invalid)}`,
             goalSteps.length ? `only ${stepList(goalSteps)} ${goalSteps.length === 1 ? "touches" : "touch"} the goal${slipSay ? ` (the agent ${slipSay.say})` : ""}` : "no step touches the goal directly"].filter(Boolean).map((t, i) => i ? t : cap(t)).join("; ") + ".",
    short: goalSteps.length ? goalSteps.length > 1 ? `Steps ${goalSteps.join(", ")} hit the goal` : `Only step ${goalSteps[0]} hits the goal` : `${kind.size} of ${n} steps look off`,
    event: global.length ? global[global.length - 1] : Math.max(0, mapAt), focus: global.map(i => ev[i].cluster),
    count: goalSteps.length || kind.size,
    marks: goalSteps.length ? goalSteps.map(step => ({type: "cell", a: step, b: step, tone: "fail", text: goalSlip(raw.get(step))?.short || "touches goal",
                                                      tip: `step ${step}: ${[...raw.get(step)].filter(x => SIGNAL_LABEL[x]).map(x => SIGNAL_LABEL[x]).join(", ")}`}))
      : [{type: "cell", a: 1, b: n, tone: "all", text: `${kind.size} of ${n} steps flagged`}],
  });

  const anchors = scene.windows.map(w => w.step);
  const ranged = ev.map((e, i) => [i, rangeOf(e.spec)]).filter(([i, r]) => r && !ev[i].error && ev[i].phase === "ROUTE");
  const near = r => anchors.some(s => s >= r[0] && s <= r[1]);
  const tight = ranged.map(([, r]) => r).filter(near).sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]))[0];
  const merged = ranged.map(([, r]) => r).filter(r => !near(r)).sort((a, b) => a[0] - b[0])
    .reduce((out, r) => { const p = out[out.length - 1]; if (p && r[0] <= p[1] + 1) p[1] = Math.max(p[1], r[1]); else out.push([...r]); return out; }, []);
  const contrast = merged.map(([a, b], i) => `${i ? "" : "steps "}${a}–${b}`);
  rows.push({
    key: "ranges", phase: "ROUTE", question: "Where did it look closely?",
    short: ranged.length ? `Read ${tight ? span(tight) : "a range"} closely` : `Read all ${n} steps`,
    answer: ranged.length ? `From all ${n} steps down to ${tight ? span(tight) : span(ranged[ranged.length - 1][1])}${contrast.length ? `, with ${contrast.join(" and ")} read for contrast` : ""}.` : "It read the whole run without narrowing to a range.",
    event: ranged.length ? ranged[ranged.length - 1][0] : global[global.length - 1] ?? 0, focus: ranged.map(([i]) => ev[i].cluster),
    count: tight ? tight[1] - tight[0] + 1 : n,
    marks: [tight ? {type: "cell", a: tight[0], b: tight[1], tone: "route", text: `S${tight[0]}–${tight[1]}`} : {type: "cell", a: 1, b: n, tone: "all", text: `all ${n} steps`}],
  });

  const symptom = (decided.length ? decided : goalSteps).filter(s => s > Math.max(...anchors));
  const routeAt = ev.findIndex(e => e.name === "route_cases");
  rows.push({
    key: "anchor", phase: "ROUTE", question: "Where should the search start?",
    short: scene.windows.length ? (() => { const ws = [...new Set(scene.windows.map(w => w.step))].sort((a, b) => a - b);
      return ws.length > 3 ? `${ws.length} suspect steps, ${ws[0]}–${ws[ws.length - 1]}` : `Suspect step${ws.length > 1 ? "s" : ""} ${nums(ws)}`; })() : "No suspect step",
    answer: scene.windows.length ? `${symptom.length ? `Working back from the failure at ${stepList(symptom.slice(0, 2))}, ` : ""}${scene.windows.length > 1 ? `${scene.windows.length} steps hold clues: ` : "one step holds clues: "}${[...scene.windows].sort((a, b) => a.step - b.step).map(w => `step ${w.step} (${[...new Set(w.fids.map(f => SLOT_LABEL[scene.factById.get(f)?.slot]).filter(Boolean))].join(", ")})`).join(", ")}.`.replace(/^./, c => c.toUpperCase()) : "The debugger opened no suspect window.",
    event: routeAt >= 0 ? routeAt : rows[rows.length - 1].event, focus: scene.windows.map(w => w.id),
    count: new Set(scene.windows.map(w => w.step)).size,
    marks: [...new Set(scene.windows.map(w => w.step))].map(step => ({type: "cell", a: step, b: step, tone: "suspect", text: `S${step}`})),
  });
  const rootWindow = scene.windows.find(w => w.step === scene.root?.step) || scene.windows[0];
  const thread = rootWindow ? buildThread(scene, rootWindow, decided.length ? decided : goalSteps) : null;
  if (thread && thread.nodes.some(n => n.lane !== "agent")) {
    const goalNode = thread.nodes.find(n => n.lane === "goal"), acts = thread.nodes.filter(n => n.lane === "agent" && n.step > thread.anchor);
    rows.push({
      key: "thread", phase: "ROUTE", question: `How does the failure lead back to step ${thread.anchor}?`,
      short: `${cap(thread.obj)} traced back to step ${thread.anchor}`,
      answer: `Follow ${thread.obj}: ${goalNode ? `the goal check fails at step ${goalNode.step}` : "the goal fails"}${acts.length ? ` after the agent ${acts.map(a => `${a.slot === "act" ? "acts on it" : "uses it"} at step ${a.step}`).join(", ")}` : ""}; it entered the run at step ${thread.anchor}, where the agent's ${[...new Set(thread.nodes.filter(n => n.step === thread.anchor && n.lane === "agent").map(n => SLOT_LABEL[n.slot]))].join(", ")} took it up.`,
      event: routeAt >= 0 ? routeAt : rows[rows.length - 1].event, focus: [rootWindow.id],
      marks: [...thread.nodes.map(n => ({type: "tnode", step: n.step, lane: n.lane})), ...(thread.trace ? [{type: "arrow", from: thread.trace.from, to: thread.trace.to}] : [])],
      thread, bridge: buildBridge(scene, thread, rootWindow, raw),
    });
    const row = rows[rows.length - 1], br = row.bridge;
    if (br?.clash) row.short = `${cap(br.clash.got)} taken for ${br.clash.need}`;
    else if (br?.gap?.instead) row.short = `${cap(br.gap.instead)} taken for ${br.gap.need}`;
    if (br) br.tower = bridgeTower(scene, model, br, thread, rootWindow, row.event, rows[0].focus[0]);
    const at = br?.bridges.find(b => b.role === "root")?.step ?? thread.anchor;
    row.count = 1;
    row.marks = [{type: "cell", a: at, b: at, tone: "root", text: `S${at}`, note: row.short}];
  }
  const w0 = rootWindow;
  if (w0) {
    const said = w0.fids.map(f => scene.factById.get(f)).filter(f => f && (f.slot === "plan" || f.slot === "act")).slice(0, 2);
    cards.push({row: "anchor", phase: "ROUTE", title: `Suspect: step ${w0.step}`, lines: [
      {label: "Clues", text: [...new Set(w0.fids.map(f => SLOT_LABEL[scene.factById.get(f)?.slot]).filter(Boolean))].join(", "), rule: suspicion(w0)},
      ...(w0.goals.length ? [{label: "At stake", text: w0.goals.map(goalText).join(", ")}] : []),
      ...said.slice(0, 1).map(f => ({label: cap(SLOT_LABEL[f.slot]), text: clip(f.slot === "act" ? String(f.value) : agentWords(f), 60), rule: f.span})),
    ]});
  }

  const planAt = ev.findIndex(e => e.name === "plan_trace");
  const lanes = scene.lanes;
  rows.push({
    key: "manager", phase: "MANAGER", question: "How will each suspect be judged?",
    short: lanes.length ? `${scene.rules.length} rules set before searching` : "Nothing to check",
    answer: lanes.length ? `${lanes.length === 1 ? `One question about step ${lanes[0].step}` : `${lanes.length} questions, for ${stepList(lanes.map(l => l.step))}`}; ${scene.rules.length ? `${scene.rules.length} rules are fixed before the search.` : "no rules were fixed."}` : "No investigation was planned.",
    event: planAt >= 0 ? planAt : rows[rows.length - 1].event, focus: lanes.map(l => l.id),
    marks: [],
  });
  if (lanes.length) cards.push({row: "manager", phase: "MANAGER", title: "Judged by rules set in advance", lines: [
    {label: "Asks", text: question(lanes[0], 90), rule: lanes[0].question},
    ...scene.rules.slice(0, 4).map(r => ({label: OUTCOME[r.outcome] || cap(r.outcome), text: VERDICT_OF[r.outcome] || clip(firstSentence(r.conclusion), 60), rule: r.conclusion})),
  ]});

  const assessAt = last(e => e.name === "assess");
  const hit = [...new Set(lanes.flatMap(l => l.steps))].sort((a, b) => a - b);
  const blamed = scene.candidates.filter((c, i, a) => a.findIndex(x => x.step === c.step && x.module === c.module) === i);
  const rows0 = lanes.reduce((k, l) => k + l.rows.length, 0);
  rows.push({
    key: "trace", phase: "TRACE", question: "What did the log search find?",
    short: (() => { const bs = [...new Set(blamed.map(c => c.step))].sort((a, b) => a - b);
      return !bs.length ? "Blames no step" : bs.length === 1 ? `Blames step ${bs[0]}'s ${blamed.map(c => c.module).join(", ")}`
        : `Blames ${bs.length} steps${bs.length <= 3 ? `: ${nums(bs)}` : ""}`; })(),
    answer: `The log search returned ${rows0} rows from ${hit.length} steps; ${blamed.length ? `it blames ${blamed.map(c => `step ${c.step}'s ${c.module} (${[statusText(c.status), faultText(c.faultClass)].filter(Boolean).join(": ")})`).join("; ")}` : "it blames no step"}.`,
    event: assessAt >= 0 ? assessAt : rows[rows.length - 1].event, focus: [...lanes.map(l => l.id), ...blamed.map(c => c.id)],
    marks: blamed.map(c => ({type: "blamed", step: c.step, label: `${c.module}`})),
  });

  const root = scene.root;
  const rule = root?.rule?.id ? scene.rules.find(r => r.id === root.rule.id) : null;
  const rivalText = root?.reasoning?.match(/strongest rival[^.]*?\bstep[- ](\d+)(?:'s)?[- ](\w+)/i);
  const rivals = [
    ...blamed.filter(c => root && !(c.step === root.step && c.module === root.module)).map(c => ({step: c.step, module: c.module})),
    ...(rivalText && Number(rivalText[1]) !== root?.step ? [{step: Number(rivalText[1]), module: rivalText[2]}] : []),
  ].filter((r, i, a) => a.findIndex(x => x.step === r.step && x.module === r.module) === i);
  const submitAt = ev.findIndex(e => e.name === "submit");
  rows.push({
    key: "verdict", phase: "SUBMIT", question: "Which step caused the failure?",
    short: root ? `Root cause: step ${root.step}'s ${root.module}` : "No root cause named",
    answer: root ? `Step ${root.step}'s ${root.module}${rule ? `, by the rule for a ${rule.outcome} finding` : ""}${rivals.length > 3 ? `; ${rivals.length} other candidates weighed and set aside` : rivals.length ? `; ${rivals.map(r => `step ${r.step}'s ${r.module}`).join(" and ")} weighed and set aside` : ""}.` : "The debugger named no root cause.",
    event: submitAt >= 0 ? submitAt : ev.length - 1, focus: root ? ["root"] : [],
    marks: [...(root ? [{type: "root", step: root.step, label: `root cause · S${root.step} ${root.module}`}] : [])],
  });
  if (root) cards.push({row: "verdict", phase: "SUBMIT", title: `Root cause: step ${root.step} ${root.module}`, lines: [
    ...(root.faultClass ? [{text: cap(faultText(root.faultClass)), strong: true, rule: root.quote}] : []),
    ...(rule ? [{label: "By rule", text: `${OUTCOME[rule.outcome] || cap(rule.outcome)} → ${VERDICT_OF[rule.outcome] || "decided"}`, rule: rule.conclusion}] : []),
    ...rivals.map(r => ({label: "Set aside", text: `step ${r.step}'s ${r.module}`})),
  ]});

  rows.forEach(r => { r.focus = r.focus.filter(id => id && byCluster(id)); });

  const sus = rootWindow?.step, sym = sus != null ? symptom.find(s => s > sus) ?? symptom[0] : null, rootAt = root?.step ?? sus;
  const cols = [...(sym != null ? [{step: sym, tone: "fail"}] : []), ...(sus != null ? [{step: sus, tone: "suspect"}] : []),
                ...(rootAt != null && rootAt !== sus ? [{step: rootAt, tone: "suspect"}] : [])];
  const turn = [...anchors, root?.step, sym].filter(s => s != null);
  const axis = fisheye(n, turn.length ? Math.max(1, Math.min(...turn) - 1) : 1, turn.length ? Math.min(n, Math.max(...turn) + 1) : n, sus);
  const path = sus != null ? {fail: sym, sus, root: rootAt} : null;
  return {steps: n, rows, cards, cols, axis, path};
}
