// Turns one run's case model into chat messages: the request, one message per phase
// (MANAGER's plan, one per TRACE assignment), the live "working" indicator and run
// notices. Built from the model calls, like the process graph.
import {CALL_PHASES} from "../case/calls.js?v=27bf1baa85";
import {assessOf, planOf, queryOf} from "../views/trace.js?v=27bf1baa85";

const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);

function activity(calls) {
  return {
    calls,
    turns: calls.length,
    tools: sum(calls, c => c.tools.length),
    tokens: sum(calls, c => (c.usage?.input_tokens || 0) + (c.usage?.output_tokens || 0)),
    errors: sum(calls, c => c.tools.filter(t => t.error).length),
    seconds: sum(calls, c => c.seconds),
  };
}

// Requirements as MAP handed them to ROUTE (goal_map.json once the run finishes).
function goalMap(d) {
  if (d.goalMap) return d.goalMap;
  return d.phaseEvents.find(e => e.from === "MAP")?.handoff?.goal_map || null;
}

const accepted = (calls, name) => calls.flatMap(c => c.tools).filter(t => t.name === name && t.committed && !t.error);

// ROUTE anchors: route_candidates.json at the end, the accepted route_cases call while live.
function anchors(d, calls) {
  const versions = Array.isArray(d.routeCandidates) ? d.routeCandidates : [];
  if (versions.length) return versions[versions.length - 1].windows || [];
  return accepted(calls, "route_cases").at(-1)?.args?.candidates || [];
}

export function buildMessages(model, {live, chat, reference}) {
  const d = model.debugger;
  const messages = [{id: "request", role: "user", task: model.task, taskType: model.taskType,
                     trajectoryId: model.trajectoryId, manifest: d?.manifest, chat}];
  if (!d) return messages;
  const byPhase = Object.fromEntries(CALL_PHASES.map(p => [p, d.calls.filter(c => c.phase === p)]));
  const reached = CALL_PHASES.filter(p => p !== "PARSE" && (byPhase[p].length || d.phaseEvents.some(e => e.to === p)));
  const pending = d.calls.filter(c => c.status === "pending").at(-1);
  const current = live ? pending?.phase || reached.at(-1) : null;
  const plan = d.managerPlan || byPhase.MANAGER.map(planOf).filter(Boolean).at(-1) || null;

  for (const phase of reached) {
    const calls = byPhase[phase];
    const base = {role: "assistant", phase, working: phase === current, activity: activity(calls)};
    if (phase === "MAP") messages.push({...base, id: "MAP", goalMap: goalMap(d)});
    if (phase === "ROUTE") messages.push({...base, id: "ROUTE", anchors: anchors(d, calls),
                                          finish: accepted(calls, "finish").at(-1)?.args || null});
    if (phase === "MANAGER") messages.push({...base, id: "MANAGER", plan, anchors: anchors(d, byPhase.ROUTE)});
    if (phase === "TRACE") {
      // One message per assignment, in plan order; calls of an unplanned case still get one.
      const ids = [...(plan?.assignments || []).map(a => a.agent_id), ...calls.map(c => c.caseId)].filter((x, i, a) => x && a.indexOf(x) === i);
      ids.forEach(id => {
        const mine = calls.filter(c => c.caseId === id);
        if (!mine.length && !live) return;
        messages.push({...base, id: `trace-${id}`, working: live && mine.some(c => c.status === "pending"), activity: activity(mine),
                       assignment: plan?.assignments?.find(a => a.agent_id === id) || {agent_id: id},
                       query: mine.map(queryOf).filter(Boolean).at(-1) || null,
                       assessment: mine.map(assessOf).filter(Boolean).at(-1) || null, started: mine.length > 0});
      });
    }
    if (phase === "SUBMIT") {
      messages.push({...base, id: "SUBMIT", result: d.result || null,
                     candidates: sum(byPhase.TRACE, c => assessOf(c)?.candidates?.length || 0)});
    }
  }

  // TRACE without candidates ends the run before SUBMIT.
  if (d.result?.status === "no_candidate") messages.push({id: "outcome", role: "system", tone: "warn", outcome: d.result});

  // Benchmark labels only after the run has ended; the launcher never passes them to the debugger.
  if (!live && d.result && reference) messages.push({id: "reference", role: "reference", reference, result: d.result});

  if (live) {
    messages.push({id: "working", role: "working", phase: current || "MAP", waiting: Boolean(pending), model: pending?.model});
  } else if (chat?.state === "failed" || chat?.state === "stopped") {
    messages.push({id: "notice", role: "system", tone: chat.state === "failed" ? "bad" : "warn", chat});
  } else if (!d.result) {
    messages.push({id: "notice", role: "system", tone: "warn", incomplete: true});
  }
  return messages;
}
