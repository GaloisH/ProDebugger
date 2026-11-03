import {esc} from "../util.js?v=27bf1baa85";

const PHASES = {
  PARSE: ["Read the original log", "Turns the task, observations, and agent statements into records the debugger can inspect."],
  MAP: ["Understand the task", "Reads the task requirements to establish what the agent needs to achieve."],
  ROUTE: ["Find where to investigate", "Looks for decisions that may explain the failure and selects the ones that need a closer look."],
  MANAGER: ["Plan the investigation", "Sets the investigation’s focus and defines the evidence needed to support or rule out each explanation."],
  TRACE: ["Investigate a possible cause", "Searches the original log to check whether a suspected mistake happened and affected later steps."],
  SUBMIT: ["Choose the final diagnosis", "Compares the investigated explanations to select the cause best supported by the evidence."],
};
const CHECKS = {
  plan: ["Check the plan", "Checks whether the agent’s plans use the available evidence to move the task forward."],
  memory: ["Check the agent’s memory", "Checks the agent’s memory against the original log to identify unsupported recollections."],
  reflection: ["Check its self-assessment", "Compares the agent’s assessment of its progress with what actually happened."],
  action: ["Check the action", "Checks whether the commands follow execution rules and carry out the agent’s stated plans."],
};
const CHECK_KIND = {mem: "memory", memory: "memory", refl: "reflection", reflection: "reflection", act: "action", action: "action", plan: "plan"};
const INVESTIGATE = {
  inefficient_plan: "Investigates whether the plan wasted steps without bringing the agent closer to the goal.",
  hallucination: "Looks for details the agent claimed to remember that were never reported in the original log.",
  over_simplification: "Checks whether the agent left important details out of its recollection of earlier events.",
  misalignment: "Compares the agent’s command with its stated plan to investigate a possible mismatch.",
};
const list = values => [...new Set(values)].filter(Boolean);
const stepList = values => list(values.map(Number)).filter(n => n > 0).sort((a, b) => a - b);
function stepRanges(values) {
  const runs = [];
  stepList(values).forEach(n => {
    const last = runs.at(-1);
    if (last && last[1] === n - 1) last[1] = n;
    else runs.push([n, n]);
  });
  return runs.map(([a, b]) => a === b ? String(a) : `${a}–${b}`).join(", ");
}

const excerpt = value => {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 95 ? text.slice(0, 92).replace(/\s+\S*$/, "") + "…" : text;
};
function concreteIntent(call, key, factsById, task) {
  if (!call) return "";
  const kind = key?.split(":").at(-1);
  const targets = (call.tools || []).filter(t => t.name === "check").map(t => factsById?.get(Number(t.args?.fid))).filter(Boolean);
  const records = targets.filter(f => CHECK_KIND[f.slot] === kind);
  if (kind === "memory") {
    const at = records.find(f => f.rel === "at" && f.value !== false);
    const place = at?.args?.find(a => a.kind !== "agent");
    if (place) {
      const location = `${place.kind === "place" ? "" : place.kind + " "}${place.index || ""}`.replace(/[:_]/g, " ").trim();
      return `Checks the agent’s memory against the log, including its claim of being at ${location}.`;
    }
  }
  if (kind === "plan") {
    const plan = records.find(f => /I should\s+[^.?!]+/i.test(f.span || ""));
    const action = excerpt(plan?.span?.match(/I should\s+([^.?!]+)/i)?.[1]?.split(/\s+to\s+(?:identify|find|locate|determine|gather|see|check)\b/i)[0]);
    if (action) return `Checks the plans against the available evidence, including the decision to “${action}”.`;
  }
  if (kind === "action") {
    const command = excerpt(records.find(f => typeof f.value === "string" && f.value !== "stated")?.value);
    if (command) return `Checks whether commands such as “${command}” follow execution rules and carry out the agent’s plan.`;
  }
  if (key?.startsWith("assess:")) {
    const candidate = (call.tools || []).flatMap(t => t.name === "assess" ? t.args?.candidates || [] : []).find(c => CHECK_KIND[c.module] === kind);
    const quote = excerpt(candidate?.output_quote?.replace(/^I should\s+/i, ""));
    if (quote) {
      if (kind === "plan") return `Investigates whether the plan to “${quote.replace(/[.]$/, "")}” helped the agent move toward the goal.`;
      if (kind === "memory") return `Checks the memory claim “${quote}” against the original log.`;
      if (kind === "action") return `Investigates whether the command “${quote}” matched the agent’s stated plan.`;
    }
  }
  if (key === "goal" && task) return `Reads the task “${excerpt(task)}” to identify what the agent needs to achieve.`;
  return "";
}

export function intentHtml({call, phase, factsById, task}) {
  const name = call?.phase || phase?.phase || "OTHER";
  const fallback = PHASES[name] || ["Review the recorded evidence", "Inspect the available records to decide what needs further investigation."];
  const activities = new Map();
  const add = (key, title, text, steps = []) => {
    if (!activities.has(key)) activities.set(key, {key, title, text, steps: []});
    activities.get(key).steps.push(...steps);
  };
  if (call) for (const tool of call.tools || []) {
    const a = tool.args || {};
    const f = factsById?.get(Number(a.fid));
    const slot = String(f?.slot || "").toLowerCase();
    const kind = CHECK_KIND[slot] || (f?.rel === "admissibility" ? "action" : null);
    switch (tool.name) {
      case "check": {
        const copy = CHECKS[kind] || ["Check the evidence", "Checks this recorded statement against the available evidence." ];
        add(kind || "check", ...copy, f?.t ? [f.t] : []); break;
      }
      case "view": {
        const spec = String(a.spec || "");
        const range = spec.match(/\bsteps:(\d+):(\d+)/);
        const lo = Number(range?.[1]), hi = Number(range?.[2]);
        const steps = range && hi >= lo && hi - lo <= 1000 ? Array.from({length: hi - lo + 1}, (_, i) => lo + i) : [];
        if (/requirements|entity:req:/.test(spec)) add("goal", "Review the goal", "Reads the task requirements to establish what successful completion would look like.");
        else if (/local_audits/.test(spec)) add("audit", "Review each decision", "Reviews the agent’s reasoning, actions, and outcomes together to look for inconsistencies.", steps);
        else if (/changes/.test(spec)) add("changes", "Look for changes in the world", "Examines what changed after each action to identify progress and actions with no effect.", steps);
        else if (/episodes|scan/.test(spec)) add("scan", "Look for suspicious patterns", "Scans the run for repeated actions, stalled progress, and decisions that move away from the goal.", steps);
        else add("read", "Read the relevant records", "Reads the relevant records to establish what the agent knew, decided, and observed.", steps);
        break;
      }
      case "contrast": add("compare", "Compare related records", "Compares the agent’s statements and actions with the environment’s responses to look for contradictions.", (a.fids || []).map(id => factsById?.get(Number(id))?.t)); break;
      case "view_evidence": add("rules", "Review rule checks", "Reviews recorded rule checks and their evidence to locate issues worth investigating."); break;
      case "state": add("state", "Inspect the world state", "Inspects the known environment state to establish the context for the agent’s decision.", a.step ? [a.step] : []); break;
      case "span": case "neighbours": add("source", "Read the surrounding evidence", "Reads the original log and nearby records to verify the evidence in context.", f?.t ? [f.t] : []); break;
      case "query_logs": add("search", "Search the original log", "Searches the original log for evidence that supports or contradicts the suspected mistake."); break;
      case "assess": {
        const candidates = a.candidates || [];
        if (!candidates.length) add("assess", "Review possible mistakes", "Reviews the evidence for possible mistakes that contributed to the failure.");
        candidates.forEach(c => {
          const kind = CHECK_KIND[c.module], copy = CHECKS[kind];
          const title = kind === "memory" ? "Investigate the agent’s memory" : kind === "reflection" ? "Investigate its self-assessment" : kind ? `Investigate the ${kind}` : "Review a possible mistake";
          add(`assess:${kind || "other"}`, title, INVESTIGATE[c.fault_class] || copy?.[1] || "Investigates whether this decision contributed to the failure.", [c.step]);
        });
        break;
      }
      case "route_cases": case "trace_window": add("choose", "Choose investigation targets", "Selects suspicious decisions and the surrounding steps for closer investigation.", (a.candidates || []).map(c => c.issue_step)); break;
      case "plan_trace": add("plan", "Set the investigation questions", "Defines each investigation’s focus and the evidence needed to support or reject an explanation."); break;
      case "hold": add("hold", "Keep evidence for the investigation", "Keeps relevant records available for the next stage of the investigation.", (a.fids || []).map(id => factsById?.get(Number(id))?.t)); break;
      case "finish": add("finish", "Complete this stage", "Brings this stage’s evidence together for the next stage of the investigation."); break;
      case "reroute": add("reroute", "Reconsider the investigation", "Reconsiders where to investigate based on the evidence gathered so far."); break;
      default: break;
    }
  }
  const items = [...activities.values()];
  const priority = ["assess", "search", "choose", "plan", "memory", "reflection", "action", "check", "compare"];
  items.sort((a, b) => {
    const rank = x => { const i = priority.indexOf(x.key.split(":")[0]); return i < 0 ? 99 : i; };
    return rank(a) - rank(b);
  });
  const main = items[0];
  const description = concreteIntent(call, main?.key, factsById, task) || main?.text || fallback[1];
  const scope = stepRanges(items.flatMap(i => i.steps));
  return `<div class="intent-head"><span id="tj-intent-title">${esc(name)}${call ? ` · #${call.n}` : ""} <span class="intent-label">Insight</span></span><button data-close-intent aria-label="Close insight">×</button></div>
    <p class="intent-copy">${esc(description)}</p>
    ${scope ? `<p class="intent-scope">Steps ${esc(scope)}</p>` : ""}`;
}
