// Plain-English wording for a fact's journey, for readers who do not know the DSL: what the
// fact is in the agent's own words, and short sentences built from fixed templates plus text
// the run already holds (the agent's span, a window's hypothesis, a lane's question, a verdict).
const NOUN = {obs: "observation", mem: "memory", refl: "reflection", plan: "plan", act: "action", chk: "check"};
const WROTE = {
  obs: t => `The environment showed this to the agent at step ${t}.`,
  mem: t => `The agent wrote this into its memory at step ${t}.`,
  refl: t => `The agent wrote this reflection at step ${t}.`,
  plan: t => `The agent wrote this plan at step ${t}.`,
  act: t => `The agent took this action at step ${t}.`,
  chk: t => `This check was recorded at step ${t}.`,
};
const VERDICT = {viol: " A direct check flagged it as breaking a rule.", unk: " A direct check could not decide either way.", sat: " A direct check found nothing wrong with it."};

// The page's surface vocabulary: every name a reader sees on the stage, the caption or a card
// comes from these, so tool names, case ids, lane ids and rule ids stay in the Details.
const FAULT = {
  constraint_ignorance: "ignored a task constraint", progress_misjudge: "misjudged its progress",
  causal_misattribution: "blamed the wrong cause", inefficient_plan: "planned inefficiently",
};
export const faultText = f => f ? FAULT[f] || String(f).replace(/_/g, " ") : "";
export const statusText = s => s === "uncertain" ? "possible error" : s || "";
export const VERDICT_WORD = {viol: "broke a rule", unk: "undecided", sat: "fine"};
export const goalText = key => String(key || "").replace(/^req:/, "").replace(/_/g, " ");
export const cap = s => s ? s[0].toUpperCase() + s.slice(1) : "";
export const stepList = steps => { const s = steps.map(x => `step ${x}`); return s.length > 1 ? `${s.slice(0, -1).join(", ")} and ${s[s.length - 1]}` : s[0] || ""; };

const clip = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; };
const sentences = t => String(t || "").replace(/\s+/g, " ").split(/(?<=[.?!])\s+(?=[A-Z“"'])/).filter(Boolean);
export const stepThing = (step, module) => `step ${step}'s ${module}`;

export const factName = f => `The agent's ${NOUN[f.slot] || "record"} at step ${f.t}`;

// The agent's own words for a fact: its span without the prompt's header line, the answer
// part of a "question? answer" line, first sentence only.
export function agentWords(f) {
  let lines = String(f.span || "").split("\n").map(x => x.trim()).filter(Boolean);
  if (lines.length > 1 && !lines[0].startsWith("-") && lines.slice(1).every(x => x.startsWith("-"))) lines = lines.slice(1);
  const line = lines.map(x => x.replace(/^-\s*/, "")).map(x => x.includes("? ") ? x.slice(x.lastIndexOf("? ") + 2) : x).find(Boolean);
  if (line) return clip(sentences(line)[0], 180);
  return typeof f.value === "string" && f.value !== "stated" ? clip(f.value, 180) : "";
}

// The sentence of a window's hypothesis that talks about its own step, else its first one.
export function suspicion(w) {
  const all = sentences(w.hypothesis);
  const own = new RegExp(`\\bstep[- ]?${w.step}\\b`, "i");
  return clip(all.find(s => own.test(s)) || all[0], 240);
}

export const question = (lane, n = 220) => clip(sentences(lane.question)[0], n);

// One sentence per stop kind; `seen` counts the reads before this one, `verdict` is a direct
// check's verdict on the fact if one ran in that read.
export function sayStop(kind, {f, c, ev, seen, verdict}) {
  switch (kind) {
    case "core": return {say: (WROTE[f.slot] || WROTE.chk)(f.t)};
    case "query": {
      const intent = String(ev.intent || ev.name).replace(/\bS(\d+)–(\d+)/, "in steps $1–$2");
      return {say: `${seen ? "It came up again when the debugger" : "The debugger first came across it when it"} set out to ${intent}.${VERDICT[verdict] || ""}`};
    }
    case "window": return {say: `It was flagged as a clue that something went wrong at step ${c.ref.step}. The debugger's suspicion:`, quote: suspicion(c.ref)};
    case "lane": return {say: "To settle the suspicion, the debugger searched the logs with one question, and the search brought it back:", quote: question(c.ref)};
    case "candidate": return {
      say: `The check concluded that ${stepThing(c.ref.step, c.ref.module)} ${c.ref.status === "error" ? "is" : "may be"} where things went wrong:`,
      quote: clip(c.ref.proposition, 260),
    };
    case "root": return {say: "Final verdict: this is the root cause, the step where the task started to fail."};
    default: return {say: ""};
  }
}

export const START_SAY = {
  window: "It was flagged without any earlier read returning it.",
  lane: "It skipped the screening: the log search found it directly.",
  candidate: "It skipped the screening and the log search: the check named it directly.",
  root: "The final verdict named it directly.",
};

export function sayEnd(why) {
  switch (why.kind) {
    case "unread": return "Nothing in the debugger's search ever returned it.";
    case "read": return "It stops here: the debugger read it but never flagged it as a clue.";
    case "missed": return "It stops here: the log search for this suspicion did not bring it back.";
    case "unassigned": return `It stops here: no one was assigned to check the suspicion at step ${why.step}.`;
    case "blamedOther": return `It stops here: the check blamed ${why.blamed.map(b => stepThing(b.step, b.module)).join(" and ")} instead.`;
    case "noBlame": return "It stops here: the check blamed no step.";
    case "otherRoot": return `It stops here: the final verdict picked ${stepThing(why.root.step, why.root.module)} instead.`;
    case "noRoot": return "It stops here: the debugger named no root cause.";
    default: return "";
  }
}
