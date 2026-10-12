// Turns one run's case model into chat messages: the request, one message per
// phase (one per TRACE window), the live "working" indicator and run notices.
// Depends only on file formats, like case/model.js.
import {PHASES} from "../case/model.js";

const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);

function activity(events) {
  const models = events.filter(e => e.kind === "model");
  return {
    events,
    turns: models.length,
    tools: events.filter(e => e.kind === "tool").length,
    tokens: sum(models, e => (e.usage?.input_tokens || 0) + (e.usage?.output_tokens || 0)),
    errors: events.filter(e => e.status === "error").length,
  };
}

// Requirements as MAP handed them to ROUTE (goal_map.json once the run finishes).
function goalMap(d) {
  if (d.goalMap) return d.goalMap;
  return d.phaseEvents.find(e => e.from === "MAP")?.handoff?.goal_map || null;
}

// ROUTE anchors: route_candidates.json at the end, the trace_window call while live.
function anchors(d) {
  const versions = Array.isArray(d.routeCandidates) ? d.routeCandidates : [];
  if (versions.length) return versions[versions.length - 1].windows || [];
  const call = d.events.filter(e => e.kind === "tool" && e.title === "trace_window" && e.data.event === "committed").pop();
  return call?.data.arguments?.candidates || [];
}

export function buildMessages(model, {live, chat}) {
  const d = model.debugger;
  const messages = [{id: "request", role: "user", task: model.task, taskType: model.taskType,
                     trajectoryId: model.trajectoryId, manifest: d?.manifest, chat}];
  if (!d) return messages;
  const byPhase = Object.fromEntries(PHASES.map(p => [p, d.events.filter(e => e.phase === p)]));
  const reached = PHASES.filter(p => byPhase[p].length || d.phaseEvents.some(e => e.to === p));
  const current = live ? reached[reached.length - 1] : null;

  for (const phase of reached) {
    const base = {role: "assistant", phase, working: phase === current, activity: activity(byPhase[phase]),
                  seconds: d.usage?.by_phase?.[phase]?.latency_seconds};
    if (phase === "MAP") messages.push({...base, id: "MAP", goalMap: goalMap(d)});
    if (phase === "ROUTE") messages.push({...base, id: "ROUTE", anchors: anchors(d), done: reached.includes("TRACE")});
    if (phase === "TRACE") {
      const assessed = new Map(d.windows.map(w => [w.window_id, w]));
      messages.push({...base, id: "TRACE", anchors: anchors(d), assessed, coverage: d.traceWindows});
      d.windows.forEach(w => messages.push({role: "assistant", phase, id: `window-${w.window_id}`, window: w}));
    }
    if (phase === "SUBMIT") {
      const answer = d.events.filter(e => e.kind === "answer").pop()?.data;
      messages.push({...base, id: "SUBMIT", result: d.result || answer?.result || null,
                     candidates: d.windows.reduce((n, w) => n + (w.candidates || []).length, 0)});
    }
  }

  if (live) {
    const waiting = d.events.filter(e => e.kind === "inflight").pop();
    messages.push({id: "working", role: "working", phase: current || "MAP", waiting: Boolean(waiting),
                   model: waiting?.data.requested_model});
  } else if (chat?.state === "failed" || chat?.state === "stopped") {
    messages.push({id: "notice", role: "system", tone: chat.state === "failed" ? "bad" : "warn", chat});
  } else if (!d.result) {
    messages.push({id: "notice", role: "system", tone: "warn", incomplete: true});
  }
  return messages;
}
