import {cap, faultText, question, stepList, suspicion} from "./narrate.js?v=23f9bfd6b4";
import {SIGNAL_LABEL} from "./model.js?v=signs-82";
import {buildShots} from "./shots.js?v=chain-5";
import {applyCopy} from "./copy.js?v=chain-5";

export const ACT_NAME = {START: "START", PARSE: "PARSE", MAP: "MAP", ROUTE: "ROUTE", MANAGER: "MANAGER", TRACE: "TRACE", SUBMIT: "SUBMIT"};
const ACT_ORDER = ["START", "PARSE", "MAP", "ROUTE", "MANAGER", "TRACE", "SUBMIT"];

const rangeOf = ev => {
  const m = String(ev.spec || "").match(/steps:(\d+):(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const overlaps = (a, b) => a[0] <= b[1] && b[0] <= a[1];
const len = r => r[1] - r[0];
const span = rs => {
  const s = [...rs].sort((a, b) => a[0] - b[0]).reduce((out, r) => {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]); else out.push([...r]);
    return out;
  }, []);
  const words = s.map(([a, b]) => a === b ? `${a}` : `${a}–${b}`);
  return `step${s.length === 1 && s[0][0] === s[0][1] ? "" : "s"} ${words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0]}`;
};

const ROUND_TITLE = {
  global: () => "Look over the whole run",
  focus: rs => `Zoom in on ${span(rs)}`,
  lock: rs => `Narrow down to ${span(rs)}`,
  contrast: rs => `Read ${span(rs)} for contrast`,
  widen: rs => `Widen the view to ${span(rs)}`,
};
const ROUND_WHY = {
  global: "to find where trouble signs gather",
  focus: "around where the trouble signs gather",
  lock: "to pin the fault to fewer steps",
  contrast: "to test whether the trouble started earlier or lies later",
  widen: "to see how the trouble develops around the steps it suspects",
};

function routeRounds(events, idx) {
  const rounds = [];
  let focus = null;
  for (const i of idx) {
    const r = rangeOf(events[i]);
    let cls;
    if (!r) cls = rounds.length ? null : "global";
    else if (!focus) { cls = "focus"; focus = r; }
    else if (overlaps(r, focus)) {
      if (len(r) < len(focus) && r[0] >= focus[0] && r[1] <= focus[1]) { cls = "lock"; focus = r; }
      else if (len(r) > len(focus)) cls = "widen";
      else cls = rounds[rounds.length - 1]?.cls === "lock" ? "lock" : "focus";
    } else cls = "contrast";
    const last = rounds[rounds.length - 1];
    if (last && (cls == null || cls === last.cls)) { last.events.push(i); if (r) last.ranges.push(r); }
    else rounds.push({cls: cls || "global", events: [i], ranges: r ? [r] : []});
  }
  return rounds;
}

function mergeSignals(evs) {
  const hits = new Map();
  for (const ev of evs) for (const [s, list] of ev.signalHits || []) {
    const m = hits.get(s) || hits.set(s, new Map()).get(s);
    for (const h of list) if (!m.has(h.step)) m.set(h.step, h);
  }
  const hitMap = new Map([...hits].map(([s, m]) => [s, [...m.values()]]));
  const signals = [...hitMap].map(([s, l]) => [s, l.length]).sort((a, b) => b[1] - a[1]);
  return {signals, hitMap};
}

const clip = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; };
const ruleName = id => String(id || "").replace(/_/g, " ");

function sayRound(r, failedAt, steps) {
  const sp = span(r.ranges);
  switch (r.cls) {
    case "global": return `With no lead yet, ROUTE reads all ${steps} steps for trouble signs instead of reading the log line by line.`;
    case "focus": return `${failedAt != null && r.ranges.some(x => x[0] <= failedAt && failedAt <= x[1]) ? `The goal check failed at step ${failedAt}, so` : "Where the signs gather,"} ROUTE zooms in on ${sp}.`;
    case "lock": return `It narrows to ${sp}, where the clues gather.`;
    case "widen": return `It widens the view to ${sp}, to see how the trouble develops.`;
    default: return `To test whether the trouble started earlier or lies later, it reads ${sp} for contrast.`;
  }
}
function sayEvent(ev, scene) {
  const goalPhrase = g => {
    const type = g.constraints.find(c => c.property?.index === "object_type")?.expected;
    return type ? `${g.count > 1 ? g.count : "a"} ${type} must end up ${g.rel} ${String(g.target).split(":").pop().replace(/_/g, " ")}` : String(g.key).replace(/^req:/, "").replace(/_/g, " ");
  };
  switch (ev.name) {
    case "compile": return `ProDebugger first turns the ${scene.meta.steps}-step log into ${scene.facts.length} facts: one for everything the world showed or the agent wrote, each tied to its step.`;
    case "route_cases": {
      const ws = scene.windows.filter(w => ev.windows.includes(w.id));
      return `ROUTE stops searching and marks ${stepList(ws.map(w => w.step))} as suspect. ${ws[0] ? clip(suspicion(ws[0]), 170) : ""}`;
    }
    case "plan_trace": {
      const l = scene.lanes.find(x => ev.lanes.includes(x.id));
      return `The manager turns the suspicion into one question for TRACE${scene.rules.length ? ` and, before any evidence comes in, fixes ${scene.rules.length} rules for judging the answer` : ""}: “${l ? question(l, 120) : ""}”`;
    }
    case "query_logs": {
      const l = scene.lanes.find(x => ev.lanes.includes(x.id));
      return `TRACE goes back to the raw log with that question and reads ${l?.rows.length ?? 0} rows from ${l?.steps.length ?? 0} steps.`;
    }
    case "assess": {
      const c = scene.candidates.find(x => ev.candidates.includes(x.id));
      return c ? `It blames step ${c.step}'s ${c.module}: ${clip(c.proposition, 160)}` : "It blames no step.";
    }
    case "submit": {
      const r = scene.root;
      if (!r) return "SUBMIT stops without naming a root cause.";
      return `SUBMIT weighs the candidates against the manager's rules${r.rule?.id ? ` and applies “${ruleName(r.rule.id)}”` : ""}: the root cause is step ${r.step}'s ${r.module}${r.faultClass ? `, which ${faultText(r.faultClass)}` : ""}.`;
    }
    default:
      if (ev.phase === "MAP") return `MAP turns the task into a requirement to check against: ${scene.goals.map(goalPhrase).join("; ")}.${ev.goal ? ` At the end of the run it is ${ev.goal.state}.` : ""}`;
      return ev.caption || "";
  }
}

export function buildBeats(scene, model) {
  const {events} = scene;
  const shots = model ? buildShots(scene, model) : new Map();
  const beats = [];
  const steps = scene.meta.steps;
  beats.push({
    act: "START", phase: "START", events: [], i: -1, focus: [], kind: "START",
    title: `An agent failed this task in ${steps} steps. Which step broke it, and on what evidence?`,
    text: "Each floor of this tower is one stage of the debugger. It starts from the whole log at the bottom and narrows, floor by floor, to one root cause at the top. Press Next or → to walk through it.",
  });

  const played = events.map((e, i) => i).filter(i => !events[i].error);
  const failedAt = scene.facts.filter(f => f.rel === "satisfied" && f.value === false && f.t > 0).sort((a, b) => a.t - b.t)[0]?.t ?? null;
  const routeQueries = played.filter(i => events[i].phase === "ROUTE" && events[i].name !== "route_cases");
  const rounds = routeRounds(events, routeQueries);
  const roundAt = new Map(rounds.map(r => [r.events[0], r]));
  const inRound = new Set(rounds.flatMap(r => r.events));
  for (const i of played) {
    const ev = events[i];
    if (inRound.has(i)) {
      const r = roundAt.get(i);
      if (!r) continue;
      if (r === rounds[0]) beats.push({act: "ROUTE", phase: "ROUTE", events: [], i: played[played.indexOf(i) - 1] ?? i, kind: null, key: "routeIntro", focus: []});
      const n = rounds.indexOf(r) + 1;
      const evs = r.events.map(k => events[k]);
      const fids = [...new Set(evs.flatMap(e => e.fids))];
      const sig = mergeSignals(evs);
      const title = ROUND_TITLE[r.cls](r.ranges);
      beats.push({
        act: "ROUTE", phase: "ROUTE", events: r.events, i: r.events[r.events.length - 1], kind: `ROUND ${n}`,
        focus: evs.map(e => e.cluster).filter(Boolean), round: {n, cls: r.cls, ranges: r.ranges, fids, ...sig},
        title: `Round ${n} · ${title}`, say: sayRound(r, failedAt, steps),
        text: `ROUTE sends ${evs.length === 1 ? "one query" : `${evs.length} queries`} ${ROUND_WHY[r.cls]}: ${fids.length} facts come back${sig.signals.length ? `, with trouble signs such as ${sig.signals.slice(0, 2).map(([s, k]) => `${SIGNAL_LABEL[s] || s.replace(/_/g, " ")} at ${k} step${k === 1 ? "" : "s"}`).join(" and ")}` : ""}.`,
      });
      continue;
    }
    beats.push({
      act: ACT_NAME[ev.phase] ? ev.phase : "ROUTE", phase: ev.phase, events: [i], i, kind: null,
      focus: [], title: ev.title || cap(ev.name), text: ev.caption || "", say: sayEvent(ev, scene),
    });
    for (const sub of shots.get(i) || []) beats.push({act: ACT_NAME[ev.phase] ? ev.phase : "ROUTE", phase: ev.phase, events: [], i, kind: null, ...sub, focus: sub.focus || (sub.shot ? [sub.shot.cloud] : [])});
  }

  if (model) applyCopy(beats, scene, model);

  const acts = ACT_ORDER.map(name => ({name, beats: beats.map((b, k) => b.act === name ? k : -1).filter(k => k >= 0)})).filter(a => a.beats.length);
  beats.forEach((b, k) => {
    const a = acts.findIndex(x => x.name === b.act);
    b.actNo = a; b.beatNo = acts[a].beats.indexOf(k);
  });
  const beatOf = i => { const k = beats.findIndex(b => b.events.includes(i)); return k >= 0 ? k : beats.findLastIndex(b => b.i <= i); };
  return {beats, acts, beatOf};
}
