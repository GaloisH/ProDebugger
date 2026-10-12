// Benchmark-agnostic step layout: each field of a step is assigned a role by its name.
// State = what the agent saw, Reasoning = how it thought, Action = what it did,
// Outcome = the next step's state. Anything unmatched stays visible under Other.
const RULES = [
  ["action", /(^|_)(action|act|command|tool_?call|operation)s?($|_)/],
  ["reasoning", /(plan|thought|think|reason|reflect|memory|rationale|analysis|critique|intent)/],
  ["state", /(^|_)(env|obs|observation|state|screen|page|percept|input|context|feedback)($|_)/],
];
const SKIP = new Set(["t", "step", "index", "id"]);
export const ROLE_LABEL = {state: "State", reasoning: "Reasoning", action: "Action", outcome: "Outcome", other: "Other"};

const humanise = key => key.replace(/[_.]+/g, " ").replace(/\b(text|str)\b/g, "").trim().replace(/^\w/, c => c.toUpperCase()) || key;
const roleOf = key => (RULES.find(([, re]) => re.test(key.toLowerCase())) || ["other"])[0];

function flatten(step) {
  const fields = [];
  for (const [key, value] of Object.entries(step || {})) {
    if (SKIP.has(key) || value == null || value === "") continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.values(value).every(v => v == null || typeof v === "string")) {
      for (const [sub, text] of Object.entries(value)) {
        if (text) fields.push({key: sub, path: `${key}.${sub}`, label: humanise(sub), value: text, role: roleOf(sub)});
      }
    } else {
      fields.push({key, path: key, label: humanise(key), value, role: Array.isArray(value) ? "other" : roleOf(key)});
    }
  }
  // A string that already contains every structured sub-field is the raw source; fold it.
  const nested = fields.filter(f => f.path.includes(".")).map(f => String(f.value).trim());
  for (const f of fields) {
    if (!f.path.includes(".") && typeof f.value === "string" && nested.length && nested.every(n => f.value.includes(n))) {
      f.role = "other"; f.raw = true;
    }
  }
  return fields;
}

export function stepRoles(step, nextStep) {
  const fields = flatten(step);
  const byRole = {state: [], reasoning: [], action: [], other: []};
  fields.forEach(f => byRole[f.role].push(f));
  const outcome = flatten(nextStep).filter(f => f.role === "state");
  return {...byRole, outcome};
}

// Short single-line action label for collapsed cards.
export function actionLabel(roles) {
  const value = roles.action[0]?.value;
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/^[\s'"`]+|[\s'"`]+$/g, "").replace(/\s+/g, " ");
}
