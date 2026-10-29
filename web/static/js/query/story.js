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
  const w0 = scene.windows[0];
  if (w0) {
    const said = w0.fids.map(f => scene.factById.get(f)).filter(f => f && (f.slot === "plan" || f.slot === "act")).slice(0, 2);
    cards.push({row: "anchor", phase: "ROUTE", title: `Suspect: step ${w0.step}`, lines: [
      {text: suspicion(w0), quiet: true},
      ...said.map(f => ({label: cap(SLOT_LABEL[f.slot]), text: `“${agentWords(f)}”`, quote: true})),
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
    {text: `“${question(lanes[0], 150)}”`, quiet: true},
    ...scene.rules.slice(0, 4).map(r => ({label: OUTCOME[r.outcome] || cap(r.outcome), text: clip(firstSentence(r.conclusion), 110), rule: r.id})),
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
    ...(root.faultClass ? [{text: cap(faultText(root.faultClass)), strong: true}] : []),
    ...(root.quote ? [{text: `“${clip(root.quote, 150)}”`, quote: true}] : []),
    ...(rule ? [{label: "Rule", text: clip(firstSentence(rule.conclusion), 110)}] : []),
    ...rivals.map(r => ({label: "Set aside", text: `step ${r.step}'s ${r.module}`})),
  ]});

  rows.forEach(r => { r.focus = r.focus.filter(id => id && byCluster(id)); });
  return {steps: n, rows, cards};
}
