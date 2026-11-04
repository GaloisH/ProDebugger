import {SIGNAL_LABEL} from "./model.js?v=signs-82";
import {faultText, question, suspicion} from "./narrate.js?v=23f9bfd6b4";
import {actionText, neededType, plainName, servesText, typeOfIn} from "./shots.js?v=chain-5";

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
  const lastCheck = t => facts.filter(f => f.rel === "satisfied" && f.t > 0 && f.t <= t).sort((a, b) => b.t - a.t)[0] || null;
  const doneClaim = t => {
    const f = facts.find(x => x.t === t && x.slot === "refl");
    const parts = String(f?.span || "").split(/\n|(?<=[.?!])\s+/).map(x => x.replace(/^-\s*/, "").trim());
    const hit = parts.find(x => !x.endsWith("?") && /\b(complet|achiev|accomplish|done|finish)/i.test(x));
    return hit ? clip(hit.replace(/[“”"]/g, "'").replace(/\s+·\s+/g, ", "), 64).replace(/[.!]+$/, "") : null;
  };
  function goalRow(t, sigs) {
    const has = s => sigs.includes(s);
    const act = facts.find(f => f.t === t && f.slot === "act");
    const chk = lastCheck(t), unmet = chk?.value === false, open = chk && chk.value == null;
    const check = chk ? `satisfied(goal)@${chk.t} = ${chk.value == null ? "unknown" : String(chk.value)}` : null;
    const still = unmet ? ", yet the goal check is still not met" : open ? ", yet no goal check ever confirms it" : "";
    if (has("constraint_substitution") && act?.args.length >= 2) {
      const [o, d] = act.args, ty = typeOf(o), swapped = need && ty && ty !== need;
      const parts = [`${act.rel}(${plainName(o)}, ${plainName(d)})@${t}`];
      if (swapped) parts.push(`type(${plainName(o)}) = ${ty} ≠ ${need}`);
      if (has("wrong_task_decision") && check) parts.push(check);
      const why = ["✗ swaps a goal constraint", has("wrong_task_decision") ? "✗ decision misses the goal" : null].filter(Boolean);
      return {say: `step ${t}: puts ${plainName(o)} on ${plainName(d)}${swapped ? `, but the task asks for ${an(need)}` : ""}`,
              expr: `${parts.join(" ∧ ")} ⇒ ${why.join("  ")}`};
    }
    if (has("contradicted_completion") || has("claims_task_complete")) {
      const q = doneClaim(t);
      return {say: `step ${t}: ${q ? `says “${q}”` : "claims the task is done"}${still}`,
              expr: `claim(done)@${t}${check ? ` ∧ ${check}` : ""} ⇒ ✗ ${has("contradicted_completion") ? "claim contradicts the record" : "claims done without proof"}`};
    }
    if (has("wrong_task_decision") && act) {
      return {say: `step ${t}: commits to “${clip(act.span || act.value, 40)}”${still}`,
              expr: `${act.rel}(${act.args.map(plainName).join(", ")})@${t}${check ? ` ∧ ${check}` : ""} ⇒ ✗ decision misses the goal`};
    }
    return {say: `step ${t}: “${SIGNAL_RULE[sigs[0]]}”`, expr: null};
  }
  const SIGN_SHORT = {
    no_new_task_evidence: "no progress toward the goal", schema_repetition: "keeps making the same kind of move",
    repeated_action: "repeats an action word for word", near_duplicate_action: "nearly repeats an earlier action",
    unbound_intention: "plan names no concrete target", invalid_action: "command the environment refuses",
    no_effect: "action changes nothing", failed_precondition: "acts before its preconditions hold",
    missing_effect: "expected effect never shows up", terminal_cutoff: "run ends before the goal is met",
    alignment_violation: "action does not carry out the plan",
  };
  const actAt = t => facts.find(f => f.t === t && f.slot === "act") || null;
  const actText = t => { const a = actAt(t); return a ? clip(String(a.span || a.value || a.rel).trim().replace(/^'(.*)'$/, "$1").replace(/[“”"]/g, "'"), 40) : null; };
  const an = w => `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`;
  const stepsList = xs => xs.length > 4 ? `${xs.slice(0, 3).join(", ")} +${xs.length - 3}` : xs.join(", ");
  const longestRun = xs => {
    const s = [...new Set(xs)].sort((a, b) => a - b);
    let best = [s[0], s[0]], at = s[0];
    for (let k = 1; k <= s.length; k++) {
      if (k < s.length && s[k] === s[k - 1] + 1) continue;
      if (s[k - 1] - at > best[1] - best[0]) best = [at, s[k - 1]];
      at = s[k];
    }
    return best;
  };
  function spinRow(s, hits) {
    const n = hits.length, why = `✗ ${SIGN_SHORT[s] || SIGNAL_LABEL[s] || s}`;
    const of = n > 1 ? `, 1 of ${n} such steps` : "";
    if (!n) return {say: `${SIGNAL_LABEL[s] || s}: “${SIGNAL_RULE[s] || s}”`, expr: null};
    if (s === "no_new_task_evidence") {
      const [a, z] = longestRun(hits.map(h => h.step)), about = need ? ` about the ${need}` : " about the goal";
      return a === z
        ? {say: `step ${a}: learns nothing new${about}${of}`, expr: `new_evidence(${a}) = false ⇒ ${why}`}
        : {say: `steps ${a}–${z}: ${z - a + 1} steps in a row learn nothing new${about}`, expr: `∀t ∈ [${a}, ${z}]: new_evidence(t) = false ⇒ ${why}`};
    }
    if (s === "repeated_action" || s === "near_duplicate_action" || s === "schema_repetition") {
      const h = hits.reduce((m, x) => x.prior.length > m.prior.length ? x : m, hits[0]), act = actAt(h.step), text = actText(h.step);
      const prior = h.prior.slice().sort((a, b) => a - b);
      if (!prior.length || !act) return {say: `step ${h.step}: ${text ? `“${text}” ` : ""}${SIGN_SHORT[s]}${of}`, expr: `${s}(act@${h.step}) ⇒ ${why}`};
      if (s === "schema_repetition") return {
        say: `step ${h.step}: “${text}” is the same kind of move as ${prior.length} earlier step${prior.length === 1 ? "" : "s"}`,
        expr: `kind(act@${h.step}) = kind(act@{${stepsList(prior)}}) = ${act.rel} ⇒ ${why}`};
      const op = s === "repeated_action" ? "=" : "≈";
      return {
        say: `step ${h.step}: “${text}” again, ${s === "repeated_action" ? "word for word " : "almost "}as at step${prior.length === 1 ? "" : "s"} ${nums(prior)}`,
        expr: `act@${h.step} ${op} ${prior.length > 4 ? `act@{${stepsList(prior)}}` : prior.map(p => `act@${p}`).join(` ${op} `)} ⇒ ${why}`};
    }
    const t = hits[0].step, text = actText(t), chk = lastCheck(t);
    switch (s) {
      case "unbound_intention": return {say: `step ${t}: the plan names no concrete target${of}`, expr: `target(plan@${t}) = ∅ ⇒ ${why}`};
      case "invalid_action": return {say: `step ${t}: ${text ? `“${text}”` : "the command"} is refused by the environment${of}`, expr: `accepted(act@${t}) = false ⇒ ${why}`};
      case "no_effect": return {say: `step ${t}: ${text ? `“${text}”` : "the action"} changes nothing${of}`, expr: `effect(act@${t}) = ∅ ⇒ ${why}`};
      case "terminal_cutoff": return {say: `step ${t}: the run ends while the goal is ${chk?.value === false ? "still not met" : "still unconfirmed"}`,
        expr: `end@${t}${chk ? ` ∧ satisfied(goal)@${chk.t} = ${chk.value == null ? "unknown" : String(chk.value)}` : ""} ⇒ ${why}`};
      default: return {say: `step ${t}: ${text ? `“${text}”, ` : ""}${SIGN_SHORT[s] || SIGNAL_LABEL[s] || s}${of}`, expr: `${s}(act@${t}) ⇒ ${why}`};
    }
  }
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
        const take = actsOn(thing).find(f => f.t === w0.step), ty = typeOf(thing), wrong = need && ty && ty !== need;
        const [, dest] = placedAtFail.args, src = take.args[1];
        line = `step ${w0.step}: takes ${plainName(thing)}${src ? ` from ${plainName(src)}` : ""}${wrong ? `, ${an(ty)}, not the ${need} the task needs` : ""}`
          + ` · step ${failed.t}: puts that same ${plainName(thing)} on ${plainName(dest)}`;
        const chk = lastCheck(failed.t);
        b.logic = [
          `${take.rel}(${take.args.map(plainName).join(", ")})@${w0.step}${wrong ? ` ∧ type(${plainName(thing)}) = ${ty} ≠ ${need}` : ""} ⇒ ✗ takes an object the task did not ask for`,
          `${placedAtFail.rel}(${placedAtFail.args.map(plainName).join(", ")})@${failed.t} ∧ obj(${placedAtFail.rel}@${failed.t}) = obj(${take.rel}@${w0.step})${chk ? ` ∧ satisfied(goal)@${chk.t} = ${chk.value == null ? "unknown" : String(chk.value)}` : ""} ⇒ ✗ the wrong object reaches the goal`,
        ];
      } else if (goal.length) {
        title = `Round ${r.n} · ${where}: goal rules break at ${nums(goal.map(g => g.step))}`;
        const rows = [...new Set(goal.map(g => g.step))].map(t => goalRow(t, goal.filter(g => g.step === t).map(g => g.s)));
        line = rows.map(x => x.say).join(" · ");
        b.logic = rows.map(x => x.expr);
      } else {
        title = `Round ${r.n} · ${where}: only circling signs`;
        const picked = spin.map(([s]) => s).filter(s => s !== "near_duplicate_action" || !spin.some(([x]) => x === "repeated_action")).slice(0, 2);
        const rows = picked.map(s => spinRow(s, r.hitMap.get(s) || []));
        if (r.cls === "contrast" && goalBreaks.size) rows.push({say: `→ the goal breaks only at ${nums([...goalBreaks])}`, expr: null});
        line = rows.length ? rows.map(x => x.say).join(" · ") : "Trouble signs: none";
        b.logic = rows.map(x => x.expr);
      }
      say(b, title, line);
    } else if (b.key === "clues") {
      const w = scene.windows.find(x => x.id === b.shot.cloud);
      const slots = [...new Set(w.fids.map(fact).filter(Boolean).sort((a, c) => a.t - c.t).map(f => ({obs: "observation", mem: "memory", refl: "reflection", plan: "plan", act: "action", chk: "check"})[f.slot]))];
      const act = w.fids.map(fact).find(f => f?.slot === "act");
      const plan = w.fids.map(fact).find(f => f?.slot === "plan");
      const obj = act?.args.find(a => !a.startsWith("agent:"));
      const got = obj ? typeOfIn(scene, obj) : null, want = neededType(scene);
      const serves = servesText(plan?.purpose && scene.intentions[plan.purpose], scene);
      const verb = act ? act.rel.replace(/_/g, " ").replace(/(s|sh|ch|x)$/, "$1e") + "s" : null;
      if (act && got && want && got !== want) {
        say(b, `Step ${w.step}: ${verb} a ${got} for a goal that needs a ${want}`,
            `world: ${plainName(obj)} is a ${got} · goal: needs a ${want}${serves ? ` · plan says it ${serves}` : ""}`);
      } else if (act) {
        say(b, `Step ${w.step}: ${clip(actionText(act), 56)}`, `${slots.join(" → ")}${serves ? ` · plan says it ${serves}` : ""}`);
      } else say(b, `Step ${w.step}: ROUTE flags the agent's ${list(slots)}`, `${w.fids.length} clue fact${w.fids.length === 1 ? "" : "s"} · no action at this step`);
    } else if (b.key === "rests") {
      const l = scene.lanes.find(x => x.id === b.shot.cloud);
      const kept = [...new Set([...b.shot.keep].map(fid => fact(fid)?.t))];
      say(b, `Evidence: steps ${nums(kept)}`, `${l.steps.length} steps read · the rest fade out`);
    } else if (b.key === "log") {
      say(b, `In the log: step ${root.step} ${root.module}`, `“${clip(root.quote, 110).replace(/[.!?]+$/, "")}”${failed ? ` · fails at step ${failed.t}` : ""}`);
    } else if (b.key === "chain") {
      const n = b.chain.data.nodes[b.chain.at], so = n.so.replace(/\.$/, "");
      say(b, n.title, `${n.because.replace(/\.$/, "").replace(/\s+[·→]\s+/g, ", ")} → so ${so[0].toLowerCase()}${so.slice(1).replace(/\s+[·→]\s+/g, ", ")}`);
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
