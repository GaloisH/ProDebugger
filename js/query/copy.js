import {SIGNAL_LABEL} from "./model.js?v=signs-79eb29e";
import {faultText, question, suspicion} from "./narrate.js?v=23f9bfd6b4";
import {plainName} from "./shots.js?v=p12-1";

export const SIGNAL_RULE = {
  no_new_task_evidence: "Every step should learn something new about the goal",
  schema_repetition: "Don't keep making the same kind of move",
  repeated_action: "Don't repeat an action word for word",
  near_duplicate_action: "Don't nearly repeat an earlier action",
  unbound_intention: "A plan must name a concrete target",
  invalid_action: "The environment must accept the command",
  no_effect: "An action must change something",
  failed_precondition: "An action's preconditions must hold first",
  missing_effect: "The action's expected effect must show up",
  terminal_cutoff: "The run must not end before the goal is met",
  claims_task_complete: "A claim of being done needs proof",
  contradicted_completion: "A claim of being done must match the record",
  constraint_substitution: "Don't swap a constraint the task asked for",
  wrong_task_decision: "A decision must not contradict the task",
  alignment_violation: "The action must carry out the plan",
};
const GOAL_SIGNS = ["constraint_substitution", "wrong_task_decision", "contradicted_completion", "claims_task_complete"];

const clip = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; };
const list = xs => xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] || "";
const stepsText = rs => {
  rs = rs.filter((r, k) => rs.findIndex(x => x[0] === r[0] && x[1] === r[1]) === k);
  const s = [...rs].sort((a, b) => a[0] - b[0]).map(([a, b]) => a === b ? `${a}` : `${a}–${b}`);
  return `Step${rs.length === 1 && rs[0][0] === rs[0][1] ? "" : "s"} ${list(s)}`;
};
const nums = xs => list([...new Set(xs)].sort((a, b) => a - b).map(String));

export function applyCopy(beats, scene, model) {
  const {factById} = scene, steps = scene.meta.steps;
  const fact = fid => factById.get(fid);
  const facts = scene.facts;
  const world = facts.filter(f => f.slot === "obs").length, checks = facts.filter(f => f.slot === "chk").length;
  const failed = facts.filter(f => f.rel === "satisfied" && f.value === false && f.t > 0).sort((a, b) => a.t - b.t)[0] || null;
  const need = scene.goals.flatMap(g => g.constraints).find(c => c.property?.index === "object_type" && typeof c.expected === "string")?.expected || null;
  const typeOf = key => { const f = facts.find(x => x.rel === "has" && x.args[0] === key && x.args[1] === "attribute:object_type"); return f ? String(f.args[2]).replace(/^value:/, "") : null; };
  const seenTypes = new Set(facts.filter(f => f.rel === "has" && f.args[1] === "attribute:object_type").map(f => String(f.args[2]).replace(/^value:/, "")));
  const w0 = scene.windows[0];
  const thing = w0?.fids.map(fact).find(f => f?.slot === "act")?.args.find(a => !a.startsWith("agent:")) || null;
  const actsOn = key => facts.filter(f => f.slot === "act" && f.args[0] === key);
  const placedAtFail = failed ? facts.find(f => f.t === failed.t && f.slot === "act" && f.args.length > 1) : null;
  const root = scene.root;
  const rules = scene.rules || [];
  const ruleNo = id => rules.findIndex(r => r.id === id) + 1;
  const goalBreaks = new Set(beats.filter(b => b.round).flatMap(b => GOAL_SIGNS.flatMap(s => (b.round.hitMap.get(s) || []).map(h => h.step))));
  const firstRound = beats.find(b => b.round);
  const clues = scene.windows.reduce((n, w) => n + w.fids.length, 0);

  const say = (b, title, line) => { b.title = title; b.say = line; b.text = line; };

  for (const b of beats) {
    const ev = b.i >= 0 ? scene.events[b.i] : null;
    if (b.act === "START") {
      say(b, "Which step made this agent fail?",
        `Point = one fact from the log · cloud = the facts one question returned · ${scene.facts.length} facts → ${firstRound ? `${firstRound.round.fids.length} read → ` : ""}${clues ? `${clues} clues → ` : ""}1 root cause`);
    } else if (b.key === "anatomy") {
      say(b, "One point = one fact", "Step · writer · relation · value, with the original sentence. Solid = the world, hollow = the agent.");
    } else if (b.key === "entities") {
      const named = [...b.shot.names.keys()];
      say(b, "Facts grouped by the thing they name", named.map(k => `${plainName(k)} ${model.byId.get("core").groups.find(g => g.key === k)?.fids.length ?? ""}`).join(" · "));
    } else if (b.key === "story") {
      const name = plainName(thing), type = typeOf(thing), acts = actsOn(thing);
      say(b, type && need && type !== need ? `${name} is a ${type} · the task needs a ${need}` : `${name}, step by step`,
        [need ? `${need} in the run: ${seenTypes.has(need) ? "present" : "none"}` : "", ...acts.slice(0, 2).map(f => `step ${f.t}: ${clip(f.span || f.value, 40)}`)].filter(Boolean).join(" · "));
    } else if (b.key === "mapfail") {
      const placed = placedAtFail ? typeOf(placedAtFail.args[0]) : null;
      say(b, `Step ${failed.t}: goal check fails`,
        placed && need ? `Placed: ${placed} · required: ${need}` : `Action: ${clip(placedAtFail?.span || "", 60)}`);
    } else if (b.key === "routeIntro") {
      say(b, "ROUTE: question the record",
        "Goal met? · What changed? · Does each step fit the task and what the agent saw?");
    } else if (b.round) {
      const r = b.round, where = r.cls === "global" ? `All ${steps} steps` : stepsText(r.ranges);
      const goal = GOAL_SIGNS.flatMap(s => (r.hitMap.get(s) || []).map(h => ({s, step: h.step}))).sort((a, b2) => a.step - b2.step);
      const spin = r.signals.filter(([s]) => !GOAL_SIGNS.includes(s));
      const lockTale = r.cls === "lock" && thing && placedAtFail?.args[0] === thing && actsOn(thing).some(f => f.t === w0.step);
      let title, line;
      if (lockTale) {
        title = `Round ${r.n} · ${where}: ${typeOf(thing) || plainName(thing)} placed at ${failed.t} = taken at ${w0.step}`;
        const take = actsOn(thing).find(f => f.t === w0.step);
        line = `step ${w0.step}: ${clip(take.span || take.value, 40)} · step ${failed.t}: ${clip(placedAtFail.span || placedAtFail.value, 40)}`;
      } else if (goal.length) {
        title = `Round ${r.n} · ${where}: goal rules break at ${nums(goal.map(g => g.step))}`;
        line = goal.filter((g, k) => goal.findIndex(x => x.step === g.step) === k).map(g => `step ${g.step}: “${SIGNAL_RULE[g.s]}”`).join(" · ");
      } else {
        title = `Round ${r.n} · ${where}: only circling signs`;
        line = spin.length ? `${spin.slice(0, 2).map(([s, n]) => `${SIGNAL_LABEL[s] || s} ${n}`).join(" · ")}${r.cls === "contrast" && goalBreaks.size ? ` → the goal breaks only at ${nums([...goalBreaks])}` : ` · rule most broken: “${SIGNAL_RULE[spin[0][0]] || spin[0][0]}”`}` : "Trouble signs: none";
      }
      say(b, title, line);
    } else if (b.key === "clues") {
      const w = scene.windows.find(x => x.id === b.shot.cloud);
      const slots = [...new Set(w.fids.map(fact).filter(Boolean).sort((a, c) => a.t - c.t).map(f => ({obs: "observation", mem: "memory", refl: "reflection", plan: "plan", act: "action", chk: "check"})[f.slot]))];
      say(b, `Step ${w.step} in the agent's own words`, `Top to bottom: ${slots.join(" → ")}`);
    } else if (b.key === "rests") {
      const l = scene.lanes.find(x => x.id === b.shot.cloud);
      const kept = [...new Set([...b.shot.keep].map(fid => fact(fid)?.t))];
      say(b, `Evidence: steps ${nums(kept)}`, `${l.steps.length} steps read · the rest fade out`);
    } else if (b.key === "log") {
      say(b, `In the log: step ${root.step} ${root.module}`, `“${clip(root.quote, 110).replace(/[.!?]+$/, "")}”${failed ? ` · fails at step ${failed.t}` : ""}`);
    } else if (b.key === "journey") {
      say(b, "The root fact, from record to verdict", "Each numbered stop is a stage that read, flagged, searched or judged it");
    } else if (b.key === "closed") {
      const type = thing ? typeOf(thing) : null;
      say(b, "Case closed", type && need && type !== need && failed
        ? `Step ${w0.step}: ${type} taken as the ${need} · step ${failed.t}: check fails · root: step ${root.step} ${root.module}`
        : `Root: step ${root.step} ${root.module}${root.faultClass ? ` · ${faultText(root.faultClass)}` : ""}${root.rule?.id ? ` · rule ${ruleNo(root.rule.id)}` : ""}`);
    } else if (ev?.name === "compile") {
      say(b, `${facts.length} facts from ${steps} steps`, `World ${world} · agent ${facts.length - world - checks} · checks ${checks}`);
    } else if (ev?.phase === "MAP") {
      const cons = scene.goals.flatMap(g => g.constraints).filter(c => typeof c.expected === "string" || typeof c.expected === "number");
      const target = scene.goals[0] ? plainName(scene.goals[0].target) : "";
      say(b, need ? `Goal: a ${need} in ${target}` : `Goal: ${scene.goals.length} requirement${scene.goals.length === 1 ? "" : "s"}`,
        `${cons.slice(0, 4).map(c => `${String(c.property?.index || "").replace(/_/g, " ")} = ${clip(c.expected, 30)}`).join(" · ")}${ev.goal ? ` · ${ev.goal.state}` : ""}`);
    } else if (ev?.name === "route_cases") {
      const ws = scene.windows.filter(w => ev.windows.includes(w.id));
      say(b, `Suspect: step${ws.length > 1 ? "s" : ""} ${nums(ws.map(w => w.step))} · ${ws.reduce((n, w) => n + w.fids.length, 0)} clues`, ws[0] ? clip(suspicion(ws[0]), 120) : "");
    } else if (ev?.name === "plan_trace") {
      const ls = scene.lanes.filter(l => ev.lanes.includes(l.id));
      say(b, `${ls.length} question${ls.length === 1 ? "" : "s"} · ${rules.length} rules, fixed before the evidence`, ls[0] ? `“${question(ls[0], 100)}”` : "");
    } else if (ev?.name === "query_logs") {
      const l = scene.lanes.find(x => ev.lanes.includes(x.id));
      const by = fn => [...new Set((l?.scopes || []).filter(s => s.fn === fn).map(s => String(s.args[0]).replace(/_/g, " ")))];
      const words = by("SEARCH_TEXT").slice(0, 3), claims = by("FIND_CLAIMS").slice(0, 3), acts = by("TRACK_ACTION").slice(0, 3);
      say(b, `Search the raw log: ${l?.rows.length ?? 0} rows from ${l?.steps.length ?? 0} steps`,
        [words.length ? `words ${words.map(w => `“${w}”`).join(", ")}` : "", claims.length ? `claims: ${claims.join(", ")}` : "", acts.length ? `actions: ${acts.join(", ")}` : ""].filter(Boolean).join(" · "));
    } else if (ev?.name === "assess") {
      const c = scene.candidates.find(x => ev.candidates.includes(x.id));
      say(b, c ? `Blamed: step ${c.step} ${c.module} · ${c.status}` : "No step blamed", c ? clip(c.proposition, 110) : "");
    } else if (ev?.name === "submit") {
      say(b, root ? `Root cause: step ${root.step} ${root.module}` : "No root cause",
        root ? [root.rule?.id ? `rule ${ruleNo(root.rule.id)} of ${rules.length}: “${root.rule.id.replace(/_/g, " ")}”` : "", faultText(root.faultClass)].filter(Boolean).join(" · ") : "");
    }
  }
  let act = null;
  for (const b of beats) {
    b.question = b.act !== act ? ACT_QUESTION[b.act] || "" : "";
    act = b.act;
  }
  return beats;
}

const ACT_QUESTION = {
  PARSE: "What in a log can be checked?",
  MAP: "What counts as success?",
  ROUTE: "Where did the failure start?",
  MANAGER: "How will the suspicion be judged?",
  TRACE: "What does the raw log say?",
  SUBMIT: "Which step is the cause?",
};
