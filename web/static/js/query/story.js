// The Story mode's case board: the debugger's run told as one row per question on a shared axis
// of agent steps (S1…Sn), from the task's goal down to the root cause. Each row says what the
// debugger asked, answers it in a sentence, puts its marks on the step axis, and names the tower
// clouds it stands for; four evidence cards carry the text the axis cannot.
import {agentWords, cap, faultText, goalText, question, statusText, stepList, suspicion} from "./narrate.js";
import {SLOT_LABEL} from "./model.js";

// Routing signals in three kinds: routine noise, actions that had no effect, and the few
// that touch the goal itself.
const GOAL = new Set(["constraint_substitution", "wrong_task_decision", "claims_task_complete", "contradicted_completion"]);
const INVALID = new Set(["invalid_action", "no_effect", "failed_precondition", "missing_effect"]);
const NOISE = new Set(["no_new_task_evidence", "schema_repetition", "near_duplicate_action", "repeated_action", "unbound_intention", "alignment_violation"]);

const clip = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; };
const firstSentence = t => String(t || "").replace(/\s+/g, " ").split(/(?<=[.?!])\s+/)[0] || "";
const OUTCOME = {supported: "Supported", refuted: "Refuted", unknown: "Unknown"};
// What each kind of finding does to the suspect, as the manager's rules decide it.
const VERDICT_OF = {supported: "counts as the cause", refuted: "drop this suspect", unknown: "no verdict yet"};

// Every per-step signal list anywhere in the tool results (step audits, scans, episodes).
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
  return kind;
}

const rangeOf = spec => { const m = String(spec || "").match(/\bsteps:(\d+):(\d+)\b/); return m ? [Number(m[1]), Number(m[2])] : null; };
const span = ([a, b]) => a === b ? `step ${a}` : `steps ${a}–${b}`;


// The evidence thread: the object the suspect step acted on, followed fact by fact from the
// anchor to where the goal check failed. Environment facts say what the world showed, agent
// facts what the agent believed or did; consecutive facts are linked in time order, and the
// trace runs back from the failed check to the anchor.
const SLOT_ORDER = ["obs", "mem", "refl", "plan", "act", "chk"];
// "portable:soapbottle_1" reads "soapbottle 1"; a bare number keeps its kind: "cabinet 3".
const nameOf = key => { const [kind, ...rest] = String(key || "").split(":"); const i = rest.join(":").replace(/_/g, " "); return /^\d+$/.test(i) ? `${kind} ${i}` : i || kind; };

// A short piece of the agent's text around its first mention of the object.
function around(span, name) {
  const text = String(span || "").replace(/\s+/g, " ").replace(/^.*?(?:history\.|outcome|next step)\s*/i, "").replace(/-\s*Step \d+[^:]*:\s*/g, "");
  const i = text.toLowerCase().indexOf(name.toLowerCase());
  if (i < 0) return "";
  const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, i - 10)));
  // To the end of the sentence that mentions it, at most ~60 characters past the mention.
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
      env.set(f.t, e);
    } else if (f.t === w.step && w.fids.includes(f.fid) && f.slot !== "obs" && f.slot !== "chk") {
      // Only what the agent said about the object; a plan or action counts even without naming it.
      const words = f.slot === "act" ? String(f.value) : around(f.span, obj) || (f.slot === "plan" ? agentWords(f) : "");
      if (words) nodes.push({step: f.t, lane: "agent", fids: [f.fid], slot: f.slot, label: `${SLOT_LABEL[f.slot]}: ${words}`, full: f.span});
    } else if (f.slot === "act" && about && f.t > w.step) {
      nodes.push({step: f.t, lane: "agent", fids: [f.fid], slot: "act", label: `action: ${f.value}`, full: f.span});
    } else if (f.slot === "chk" && f.rel === "satisfied" && f.value === false && f.args.some(a => a.startsWith("req:"))) {
      nodes.push({step: f.t, lane: "goal", fids: [f.fid], slot: "chk", label: "goal check: not met", full: f.span});
    }
  }
  // One environment node per step, worded by what changed for the object.
  let seen = false;
  for (const e of [...env.values()].sort((a, b) => a.step - b.step)) {
    let label;
    if (!seen && e.parts.place) label = `sees ${obj} in ${e.parts.place}`;
    else if (e.parts.holding && !holding) label = `picked up ${obj}`;
    else if (e.parts.place && e.parts.place !== place) label = `${obj} on ${e.parts.place}`;
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


// The evidence bridge: what the goal needs on one rail, what the world shows on the other,
// and the agent's own statements (from TRACE's structured read of its text) as the links it
// drew between them: a tentative guess, a commitment, a repeat. The first commitment at the
// suspect step is the root; the trace runs back to it from the failed check.
const LINK_TOPICS = new Set(["hypothesis", "completion", "decision_basis", "expected_gain"]);
function buildBridge(scene, thread, w) {
  const reqs = (scene.goalMap?.requirements || []).filter(r => r.status?.state && r.status.state !== "met");
  const want = reqs.flatMap(r => (r.definition?.constraints || []).map(c => ({attr: String(c.attribute || c.property || "").replace(/^attribute:/, ""), need: String(c.expected)})));
  // The constraint the object breaks: an observed attribute with another value.
  let clash = null;
  for (const f of scene.facts) {
    if (f.slot !== "obs" || f.rel !== "has" || f.value !== true || !f.args.includes(thread.objKey)) continue;
    const attr = f.args.find(a => a.startsWith("attribute:"))?.slice(10), got = f.args.find(a => a.startsWith("value:"))?.slice(6);
    const c = want.find(x => x.attr === attr && got && x.need !== got);
    if (c) { clash = {attr: attr.replace(/_/g, " "), need: c.need, got, step: f.t}; break; }
  }
  const objWord = thread.obj.replace(/\s+\d+$/, "");
  const names = [thread.obj, objWord, clash?.need].filter(Boolean).map(x => x.toLowerCase());
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
  // One bridge per step and kind: guesses (tentative hypotheses), commitments (everything else).
  const kindOf = l => l.topic === "hypothesis" && l.modality === "tentative" ? "guess" : "commit";
  const bridges = [];
  for (const l of links.sort((a, b) => a.step - b.step)) {
    const kind = kindOf(l), b = bridges.find(x => x.step === l.step && x.kind === kind);
    if (b) { b.quotes.push(`${l.module}: ${l.quote}`); continue; }
    bridges.push({step: l.step, kind, module: l.module, topic: l.topic, quotes: [`${l.module}: ${l.quote}`], detail: l.detail, subject: l.subject});
  }
  const rootStep = scene.root?.step;
  const firstCommit = bridges.find(b => b.kind === "commit" && (rootStep == null || b.step === rootStep)) || bridges.find(b => b.kind === "commit");
  const verbAt = step => String(scene.facts.find(f => f.t === step && f.slot === "act" && f.args.includes(thread.objKey))?.value || "").split(" ")[0];
  for (const b of bridges) {
    b.role = b.kind === "guess" ? "guess" : b === firstCommit ? "root" : b.step >= (firstCommit?.step ?? 0) ? "repeat" : "commit";
    const said = clip(`${b.subject || ""} → ${b.detail || ""}`.replace(/^ → /, ""), 34);
    if (b.kind === "guess") b.label = clash ? `could be the ${clash.need}` : said;
    else if (["completion", "expected_gain"].includes(b.topic) && verbAt(b.step)) b.label = `${verbAt(b.step)} it = task done`;
    else b.label = b.role === "repeat" ? "relies on it again" : said;
  }
  if (!bridges.some(b => b.role === "root")) return null;
  const fail = thread.nodes.find(n => n.lane === "goal")?.step ?? thread.trace?.from;
  const world = thread.nodes.filter(n => n.lane === "env").map((n, i) => ({step: n.step, label: i === 0 && clash ? `${clash.attr}: ${clash.got}` : n.label.replace(thread.obj, "").replace(/\s+/g, " ").replace(/^sees in /, "seen in ").trim() || n.label, full: n.full}));
  const root = bridges.find(b => b.role === "root"), guess = bridges.find(b => b.role === "guess"), repeat = bridges.filter(b => b.role === "repeat");
  const need = clash ? `${clash.attr} = ${clash.need}` : goalText(reqs[0]?.entity?.id) || "the goal";
  const got = clash ? `${thread.obj} · ${clash.attr} = ${clash.got}` : thread.obj;
  return {
    from: thread.from, to: thread.to, anchor: thread.anchor, fail, need, got, world, bridges,
    beats: [
      `The goal needs ${need}.`,
      `The world shows ${got}.`,
      guess ? `At step ${guess.step} the agent guesses ${thread.obj} ${guess.label}.` : `At step ${root.step} the agent links ${thread.obj} to the goal.`,
      `At step ${root.step} it commits: ${root.label}. Nothing in the world supports that link.`,
      `${repeat.length ? `At step ${repeat.map(r => r.step).join(", ")} it repeats the link` : "The link stands"}${fail ? `, and the goal check fails at step ${fail}` : ""}.`,
      `Tracing back from the failure, the first commitment is step ${root.step}'s ${root.module}: the root cause.`,
    ],
  };
}

export function buildStory(scene, model) {
  const n = scene.meta.steps;
  const ev = scene.events;
  const last = (pred) => { let k = -1; ev.forEach((e, i) => { if (!e.error && pred(e)) k = i; }); return k; };
  const rows = [], cards = [];
  const byCluster = id => model.byId.get(id);

  // 1 · MAP: the goal and where it was decided.
  const reqs = scene.goalMap?.requirements || [];
  const failed = reqs.filter(r => r.status?.state && r.status.state !== "met");
  const decided = [...new Set(failed.flatMap(r => r.status?.decision_steps || []))].sort((a, b) => a - b);
  const mapAt = ev.findIndex(e => e.phase === "MAP" && !e.error);
  const goalName = reqs.length ? reqs.map(r => goalText(r.entity?.id)).join("; ") : scene.goals.map(g => goalText(g.key)).join("; ");
  // One goal reads "X is unmet"; several read "5 requirements (…): 1 unresolved, 4 unknown".
  const tally = Object.entries(reqs.reduce((m, r) => { const k = r.status?.state || "unknown"; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, v]) => `${v} ${k}`).join(", ");
  const goalLine = reqs.length > 1 ? `${reqs.length} requirements (${clip(goalName.replace(/; /g, ", "), 70)}): ${tally}`
    : `${cap(goalName || scene.meta.task || "the task")}${reqs[0]?.status?.state ? ` is ${reqs[0].status.state}` : ""}`;
  rows.push({
    key: "goal", phase: "MAP", question: "What does the task need, and what failed?",
    answer: `${goalLine}${decided.length ? `; the agent's finishing decision at ${stepList(decided)} broke a constraint` : ""}.`,
    event: mapAt >= 0 ? mapAt : 0, focus: mapAt >= 0 && ev[mapAt].cluster ? [ev[mapAt].cluster] : ["core"],
    marks: decided.map(step => ({type: "x", step, label: "goal failed"})),
  });
  const constraint = c => `${String(c.attribute || c.property || "").replace(/^attribute:/, "").replace(/_/g, " ")} = ${c.expected}`;
  cards.push({row: "goal", phase: "MAP", title: "The goal", lines: [
    ...reqs.slice(0, 3).map(r => ({text: cap(goalText(r.entity?.id)), strong: true})),
    ...reqs.slice(0, 1).flatMap(r => (r.definition?.constraints || []).map(c => ({text: `Must hold: ${clip(constraint(c), 90)}`}))),
    ...(failed.length ? [{text: `${cap(failed[0].status.state)}${failed[0].status.reason ? `: ${failed[0].status.reason}` : ""}`, tone: "bad"}] : []),
  ]});

  // 2 · ROUTE's whole-run scan: every step's signals sorted into three kinds.
  const kind = stepSignals(scene);
  const steps = k => [...kind].filter(([, v]) => v === k).map(([s]) => s).sort((a, b) => a - b);
  const goalSteps = steps("goal"), invalid = steps("invalid"), noise = steps("noise");
  const global = ev.map((e, i) => i).filter(i => ev[i].phase === "ROUTE" && !ev[i].error && ev[i].cluster && !rangeOf(ev[i].spec) && ev[i].name !== "route_cases");
  rows.push({
    key: "signals", phase: "ROUTE", question: "Where does the run look wrong?",
    answer: [noise.length && `routine noise on ${noise.length} steps`, invalid.length && `actions with no effect at ${invalid.join(", ")}`,
             goalSteps.length ? `only ${stepList(goalSteps)} ${goalSteps.length === 1 ? "touches" : "touch"} the goal` : "no step touches the goal directly"].filter(Boolean).map((t, i) => i ? t : cap(t)).join("; ") + ".",
    event: global.length ? global[global.length - 1] : Math.max(0, mapAt), focus: global.map(i => ev[i].cluster),
    marks: [...kind].map(([step, k]) => ({type: "signal", step, kind: k})),
  });

  // 3 · ROUTE's close reads: one bar per ranged query, solid where it covers a suspect step.
  const anchors = scene.windows.map(w => w.step);
  const ranged = ev.map((e, i) => [i, rangeOf(e.spec)]).filter(([i, r]) => r && !ev[i].error && ev[i].phase === "ROUTE");
  const near = r => anchors.some(s => s >= r[0] && s <= r[1]);
  const tight = ranged.map(([, r]) => r).filter(near).sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]))[0];
  // Ranges read for contrast, merged where they overlap: 20–30 inside 19–30 reads as 19–30.
  const merged = ranged.map(([, r]) => r).filter(r => !near(r)).sort((a, b) => a[0] - b[0])
    .reduce((out, r) => { const p = out[out.length - 1]; if (p && r[0] <= p[1] + 1) p[1] = Math.max(p[1], r[1]); else out.push([...r]); return out; }, []);
  const contrast = merged.map(([a, b], i) => `${i ? "" : "steps "}${a}–${b}`);
  rows.push({
    key: "ranges", phase: "ROUTE", question: "Where did ROUTE look closely?",
    answer: ranged.length ? `From all ${n} steps down to ${tight ? span(tight) : span(ranged[ranged.length - 1][1])}${contrast.length ? `, with ${contrast.join(" and ")} read for contrast` : ""}.` : "It read the whole run without narrowing to a range.",
    event: ranged.length ? ranged[ranged.length - 1][0] : global[global.length - 1] ?? 0, focus: ranged.map(([i]) => ev[i].cluster),
    marks: [{type: "range", a: 1, b: n, tone: "all"}, ...ranged.map(([i, r]) => ({type: "range", a: r[0], b: r[1], tone: near(r) ? "near" : "contrast", label: ev[i].title}))],
  });

  // 4 · The anchor: back from the symptom to the suspect step ROUTE opened a window on.
  // The symptom is where the goal visibly failed, later than every suspect step.
  const symptom = (decided.length ? decided : goalSteps).filter(s => s > Math.max(...anchors));
  const routeAt = ev.findIndex(e => e.name === "route_cases");
  rows.push({
    key: "anchor", phase: "ROUTE", question: "Where should the investigation start?",
    answer: scene.windows.length ? cap(`${symptom.length ? `Back from the failure at ${stepList(symptom.slice(0, 2))} to ` : ""}${[...scene.windows].sort((a, b) => a.step - b.step).map(w => `step ${w.step}, ${w.fids.length} clue${w.fids.length === 1 ? "" : "s"} (${[...new Set(w.fids.map(f => SLOT_LABEL[scene.factById.get(f)?.slot]).filter(Boolean))].join(", ")})`).join("; ")}.`) : "ROUTE opened no suspect window.",
    event: routeAt >= 0 ? routeAt : rows[rows.length - 1].event, focus: scene.windows.map(w => w.id),
    marks: [...scene.windows.flatMap(w => symptom.filter(s => s > w.step).slice(0, 1).map(s => ({type: "arrow", from: s, to: w.step}))),
            // One note for all anchors, by the leftmost: two notes a few steps apart would collide.
            ...[...scene.windows].sort((x, y) => x.step - y.step).map((w, i, all) => ({type: "anchor", step: w.step,
              label: i ? "" : all.length > 1 ? `suspects: ${stepList(all.map(x => x.step))}` : `suspect: step ${w.step}`}))],
  });
  // 4b · The evidence thread: the suspect step's object, followed to the failed check.
  const rootWindow = scene.windows.find(w => w.step === scene.root?.step) || scene.windows[0];
  const thread = rootWindow ? buildThread(scene, rootWindow, decided.length ? decided : goalSteps) : null;
  // Only a thread the world or the goal check speaks in: agent text alone is not evidence.
  if (thread && thread.nodes.some(n => n.lane !== "agent")) {
    const goalNode = thread.nodes.find(n => n.lane === "goal"), acts = thread.nodes.filter(n => n.lane === "agent" && n.step > thread.anchor);
    rows.push({
      key: "thread", phase: "ROUTE", question: `How does the failure lead back to step ${thread.anchor}?`,
      answer: `Follow ${thread.obj}: ${goalNode ? `the goal check fails at step ${goalNode.step}` : "the goal fails"}${acts.length ? ` after the agent ${acts.map(a => `${a.slot === "act" ? "acts on it" : "uses it"} at step ${a.step}`).join(", ")}` : ""}; it entered the run at step ${thread.anchor}, where the agent's ${[...new Set(thread.nodes.filter(n => n.step === thread.anchor && n.lane === "agent").map(n => SLOT_LABEL[n.slot]))].join(", ")} took it up.`,
      event: routeAt >= 0 ? routeAt : rows[rows.length - 1].event, focus: [rootWindow.id],
      marks: [...thread.nodes.map(n => ({type: "tnode", step: n.step, lane: n.lane})), ...(thread.trace ? [{type: "arrow", from: thread.trace.from, to: thread.trace.to}] : [])],
      thread, bridge: buildBridge(scene, thread, rootWindow),
    });
    const row = rows[rows.length - 1], br = row.bridge;
    if (br) row.marks = [
      ...br.world.map(w => ({type: "bworld", step: w.step})),
      ...br.bridges.map(b => ({type: "blink", step: b.step, role: b.role, shift: br.bridges.filter(x => x.step === b.step).length > 1 ? (b.role === "guess" ? -1 : 1) : 0})),
      ...(br.fail != null ? [{type: "bfail", step: br.fail}] : []),
    ];
  }
  const w0 = rootWindow;
  if (w0) {
    const said = w0.fids.map(f => scene.factById.get(f)).filter(f => f && (f.slot === "plan" || f.slot === "act")).slice(0, 2);
    // Structured points only; the window's hypothesis and the agent's words stay as hover text.
    cards.push({row: "anchor", phase: "ROUTE", title: `Suspect: step ${w0.step}`, lines: [
      {label: "Clues", text: [...new Set(w0.fids.map(f => SLOT_LABEL[scene.factById.get(f)?.slot]).filter(Boolean))].join(", "), rule: suspicion(w0)},
      ...(w0.goals.length ? [{label: "At stake", text: w0.goals.map(goalText).join(", ")}] : []),
      ...said.slice(0, 1).map(f => ({label: cap(SLOT_LABEL[f.slot]), text: clip(f.slot === "act" ? String(f.value) : agentWords(f), 60), rule: f.span})),
    ]});
  }

  // 5 · MANAGER: the question for each suspect, and the rules fixed before any evidence.
  const planAt = ev.findIndex(e => e.name === "plan_trace");
  const lanes = scene.lanes;
  rows.push({
    key: "manager", phase: "MANAGER", question: "What will the check ask, and how is it judged?",
    answer: lanes.length ? `${lanes.length === 1 ? `“${question(lanes[0], 120)}”` : `${lanes.length} questions, for ${stepList(lanes.map(l => l.step))}.`}${scene.rules.length ? ` ${scene.rules.length} rules are fixed before the search.` : ""}` : "No investigation was planned.",
    event: planAt >= 0 ? planAt : rows[rows.length - 1].event, focus: lanes.map(l => l.id),
    marks: lanes.map(l => ({type: "question", step: l.step})),
  });
  if (lanes.length) cards.push({row: "manager", phase: "MANAGER", title: "Judged by rules set in advance", lines: [
    {label: "Asks", text: question(lanes[0], 90), rule: lanes[0].question},
    ...scene.rules.slice(0, 4).map(r => ({label: OUTCOME[r.outcome] || cap(r.outcome), text: VERDICT_OF[r.outcome] || clip(firstSentence(r.conclusion), 60), rule: r.conclusion})),
  ]});

  // 6 · TRACE: the steps the log search brought back, and the step it blames.
  const assessAt = last(e => e.name === "assess");
  const hit = [...new Set(lanes.flatMap(l => l.steps))].sort((a, b) => a - b);
  const blamed = scene.candidates.filter((c, i, a) => a.findIndex(x => x.step === c.step && x.module === c.module) === i);
  const rows0 = lanes.reduce((k, l) => k + l.rows.length, 0);
  rows.push({
    key: "trace", phase: "TRACE", question: "What did the log search find?",
    answer: `${rows0} rows from ${hit.length} steps; ${blamed.length ? `TRACE blames ${blamed.map(c => `step ${c.step}'s ${c.module} (${[statusText(c.status), faultText(c.faultClass)].filter(Boolean).join(": ")})`).join("; ")}` : "TRACE blames no step"}.`,
    event: assessAt >= 0 ? assessAt : rows[rows.length - 1].event, focus: [...lanes.map(l => l.id), ...blamed.map(c => c.id)],
    marks: [...hit.map(step => ({type: "hit", step})), ...blamed.map(c => ({type: "blamed", step: c.step, label: `${c.module}`}))],
  });

  // 7 · SUBMIT: the root, the rule it rests on, and the rivals set aside.
  const root = scene.root;
  const rule = root?.rule?.id ? scene.rules.find(r => r.id === root.rule.id) : null;
  const rivalText = root?.reasoning?.match(/strongest rival[^.]*?\bstep[- ](\d+)(?:'s)?[- ](\w+)/i);
  const rivals = [
    ...blamed.filter(c => root && !(c.step === root.step && c.module === root.module)).map(c => ({step: c.step, module: c.module})),
    ...(rivalText && Number(rivalText[1]) !== root?.step ? [{step: Number(rivalText[1]), module: rivalText[2]}] : []),
  ].filter((r, i, a) => a.findIndex(x => x.step === r.step && x.module === r.module) === i);
  const submitAt = ev.findIndex(e => e.name === "submit");
  rows.push({
    key: "verdict", phase: "SUBMIT", question: "Which step is the root cause?",
    answer: root ? `Step ${root.step}'s ${root.module}${rule ? `, by the rule for a ${rule.outcome} finding` : ""}${rivals.length ? `; ${rivals.map(r => `step ${r.step}'s ${r.module}`).join(" and ")} weighed and set aside` : ""}.` : "SUBMIT named no root cause.",
    event: submitAt >= 0 ? submitAt : ev.length - 1, focus: root ? ["root"] : [],
    // A rival on the root's own step is named in the root's note, not as a second mark on top of it.
    marks: [...rivals.filter(r => r.step !== root?.step).map(r => ({type: "rival", step: r.step, label: `step ${r.step} ${r.module}`})),
            ...(root ? [{type: "root", step: root.step, label: `root: step ${root.step} ${root.module}${rivals.some(r => r.step === root.step) ? `, not the ${rivals.filter(r => r.step === root.step).map(r => r.module).join(" or ")}` : ""}`}] : [])],
  });
  if (root) cards.push({row: "verdict", phase: "SUBMIT", title: `Root cause: step ${root.step} ${root.module}`, lines: [
    ...(root.faultClass ? [{text: cap(faultText(root.faultClass)), strong: true, rule: root.quote}] : []),
    ...(rule ? [{label: "By rule", text: `${OUTCOME[rule.outcome] || cap(rule.outcome)} → ${VERDICT_OF[rule.outcome] || "decided"}`, rule: rule.conclusion}] : []),
    ...rivals.map(r => ({label: "Set aside", text: `step ${r.step}'s ${r.module}`})),
  ]});

  rows.forEach(r => { r.focus = r.focus.filter(id => id && byCluster(id)); });
  return {steps: n, rows, cards};
}
