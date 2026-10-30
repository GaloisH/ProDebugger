// Stage details: for each phase, one sentence beside the tower saying what ProDebugger did in
// this case, and behind its "more details" a popup (how it did it) and a rail (what came out).
// Both name the same entities and steps; pointing at one lights it everywhere, on the tower too.
import {esc} from "../util.js";
import {SIGNAL_LABEL, SLOT_LABEL} from "./model.js";
import {agentWords, cap, faultText, goalText, question, statusText, stepList, VERDICT_WORD} from "./narrate.js";

const SLOT_ORDER = ["obs", "mem", "refl", "plan", "act", "chk"];
// Who wrote a line: the environment, or the agent itself (memory, reflection, plan, action).
const SOURCE = {obs: "env", mem: "agent", refl: "agent", plan: "agent", act: "agent", chk: "check"};
const MODULE_SLOT = {observation: "obs", memory: "mem", reflection: "refl", plan: "plan", action: "act", check: "chk"};
// Entity kinds that never appear by name in the agent's text.
const UNNAMED = new Set(["agent", "attribute", "value", "int", "req"]);
// A ROUTE query by what it sets out to do: check the goal, look over the run, audit it step by
// step, or inspect single facts.
function queryKind(e) {
  if (e.name === "inspect" || e.name === "view_evidence") return "INSPECT";
  const base = String(e.spec || "").split("|")[0].trim();
  if (base === "requirements" || base.startsWith("entity:req:")) return "GOAL";
  if (/^(local_audits|steps)\b/.test(base)) return "AUDIT";
  if (/^(packet|statement_discovery|module|rules)\b/.test(base) || base.startsWith("entity:")) return "INSPECT";
  return "SCAN";
}
// How bad a trouble sign is: it bears on the task, the agent is spinning, or it is a soft hint.
const SIGNAL_SEVERITY = {
  no_new_task_evidence: "task", constraint_substitution: "task", wrong_task_decision: "task", contradicted_completion: "task",
  claims_task_complete: "task", alignment_violation: "task", failed_precondition: "task", missing_effect: "task",
  schema_repetition: "spin", repeated_action: "spin", near_duplicate_action: "spin", no_effect: "spin", invalid_action: "spin",
};
const signalSeverity = s => SIGNAL_SEVERITY[s] || "soft";
const clip = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The names a reader meets in the text, each tied to the entity (or the goal's required value)
// it stands for and the facts that name it. Longer names win, so "countertop 1" is the entity
// and a bare "countertop" is the goal's.
function nameIndex(scene) {
  const byName = new Map();
  const add = (name, key, fids) => { const k = name.toLowerCase(); if (name.length >= 3 && !byName.has(k)) byName.set(k, {key, name, fids}); };
  for (const g of scene.goals) for (const c of g.constraints) if (typeof c.expected === "string") add(c.expected, `goal:${c.expected}`, g.facts);
  for (const e of scene.entities) {
    if (UNNAMED.has(e.kind)) continue;
    add(/^\d+$/.test(e.index) ? `${e.kind} ${e.index}` : e.index.replace(/_/g, " "), e.key, e.facts);
  }
  // A bare type ("soapbottle") stands for its object when the run has only one of that type.
  const bases = new Map();
  for (const e of scene.entities) if (!UNNAMED.has(e.kind) && /_\d+$/.test(e.index)) { const b = e.index.replace(/_\d+$/, "").replace(/_/g, " "); bases.set(b, bases.has(b) ? null : e); }
  for (const [b, e] of bases) if (e) add(b, e.key, e.facts);
  // What a name is to the task: a word of the goal (or its target), a thing the agent handled,
  // or the rest of the scenery. The page colours them apart.
  const goalWords = new Set(scene.goals.flatMap(g => [...g.constraints.map(c => c.expected), entName(g.target)]).filter(w => typeof w === "string").map(w => w.toLowerCase()));
  const acted = new Set(scene.facts.filter(f => f.slot === "act").flatMap(f => f.args));
  const ents = new Map(scene.entities.map(e => [e.key, e]));
  const whereWords = new Set(scene.goals.map(g => entName(g.target).toLowerCase()));
  const role = key => {
    if (key.startsWith("goal:")) return whereWords.has(key.slice(5).toLowerCase()) ? "where" : "goal";
    const e = ents.get(key);
    if (!e) return "other";
    const base = e.index.replace(/_\d+$/, "").replace(/_/g, " ");
    if (whereWords.has(e.kind) || whereWords.has(base)) return "where";
    if (goalWords.has(e.kind) || goalWords.has(base)) return "goal";
    return acted.has(key) && e.kind !== "place" && e.parent !== "place" ? "held" : "other";
  };
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = names.length ? new RegExp(`\\b(${names.join("|")})\\b`, "gi") : null;
  const facts = new Map([...byName.values()].map(v => [v.key, v.fids]));
  const label = new Map();
  for (const v of byName.values()) if (!label.has(v.key)) label.set(v.key, v.name);
  // Escapes the text, then wraps every name in a link to its entity.
  const mark = text => {
    const s = esc(text);
    return re ? s.replace(re, m => { const v = byName.get(m.toLowerCase()); return `<b class="qg-ent" data-ent="${esc(v.key)}" data-role="${role(v.key)}">${m}</b>`; }) : s;
  };
  return {mark, facts, label, role};
}

const entName = key => { const [kind, ...rest] = key.split(":"); const i = rest.join(":"); return /^\d+$/.test(i) ? `${kind} ${i}` : i.replace(/_/g, " "); };
const factCall = f => `${f.rel}(${f.args.filter(a => !a.startsWith("attribute:")).map(a => entName(a)).join(", ")})`;
// The agent's own text for a cell, without the prompt's scaffold line.
function cellText(facts) {
  const spans = [...new Set(facts.map(f => f.span).filter(Boolean))];
  const lines = spans.join("\n").split("\n").map(x => x.trim()).filter(Boolean);
  const body = lines.length > 1 && !lines[0].startsWith("-") && lines.slice(1).some(x => x.startsWith("-")) ? lines.slice(1) : lines;
  return body.map(x => x.replace(/^-\s*/, "")).join(" · ");
}

// One row per step: a small strip of the run, with marks for the steps a phase cares about.
function strip(steps, marks) {
  const cells = [];
  for (let s = 1; s <= steps; s++) {
    const m = marks.get(s);
    cells.push(`<button class="sd-cell${m ? ` is-${m.tone}` : ""}" data-goto="step:${s}" title="${esc(`step ${s}${m ? ` · ${m.label}` : ""}`)}"></button>`);
  }
  return `<div class="sd-strip" style="--n:${steps}">${cells.join("")}</div><div class="sd-strip-ax"><span>1</span><span>${steps}</span></div>`;
}

export function buildDetails(scene, model) {
  const {mark, facts: entFacts, label, role} = nameIndex(scene);
  const steps = scene.meta.steps;
  const cell = (t, slot) => scene.facts.filter(f => f.t === t && f.slot === slot);
  const windowSteps = new Map(scene.windows.map(w => [w.step, w]));
  const root = scene.root;
  const fids = list => list.join(",");
  // The agent's sentence that names the most of the task's own words, else its first one.
  const goalWords = [...new Set(scene.goals.flatMap(g => [...g.constraints.map(c => c.expected), entName(g.target)]).filter(w => typeof w === "string" && w.length > 2).map(w => w.toLowerCase()))];
  const words = f => {
    const parts = String(f.span || "").split(/\n|(?<=[.?!])\s+/).map(x => x.replace(/^-\s*/, "").trim()).filter(x => x.length > 12);
    const score = x => goalWords.filter(w => x.toLowerCase().includes(w)).length;
    const best = parts.reduce((a, x) => score(x) > score(a ?? "") ? x : a, null);
    return clip(best && score(best) ? best : agentWords(f) || f.span || factCall(f), 220);
  };
  const factRow = (f, extra = "") => `<li data-fids="${f.fid}" data-step="${f.t}"><span class="sd-k">step ${f.t} · ${SLOT_LABEL[f.slot] || f.slot}</span><span>${mark(words(f))}</span>${extra}</li>`;
  // Facts of one window, one row per distinct sentence.
  const factRows = list => { const seen = new Set(); return list.filter(f => { const k = words(f); if (seen.has(k)) return false; seen.add(k); return true; }).map(f => factRow(f)).join(""); };

  // The entities this case turns on: the ones the suspect windows and the root name, then the
  // most-mentioned others.
  const keyFids = new Set([...scene.windows.flatMap(w => w.fids), ...(root?.fid != null ? [root.fid] : [])]);
  const ranked = scene.entities.filter(e => !UNNAMED.has(e.kind) && label.has(e.key))
    .map(e => ({e, hot: e.facts.filter(f => keyFids.has(f)).length}))
    .sort((a, b) => (b.hot - a.hot) || (b.e.facts.length - a.e.facts.length)).map(x => x.e);
  const ent = key => `<b class="qg-ent" data-ent="${esc(key)}" data-role="${role(key)}">${esc(label.get(key) || entName(key))}</b>`;
  const entChip = e => `<button class="sd-chip" data-ent="${esc(e.key)}" data-role="${role(e.key)}" data-goto="ent:${esc(e.key)}"${e.key.startsWith("goal:") ? ` title="the task names it; no object of this kind appears in the run"` : ""}><b>${esc(label.get(e.key))}</b><em>${e.key.startsWith("goal:") ? "never seen" : e.facts.length}</em></button>`;

  // Shared pieces of a result line: where its facts sit in the run, its trouble signs, the
  // windows whose clue facts it returned.
  const miniStrip = (at, tone = "") => `<span class="sd-mini${tone ? ` is-${tone}` : ""}" style="--n:${steps}" title="steps it touches">${Array.from({length: steps}, (_, i) => `<i class="${at.has(i + 1) ? "is-on" : ""}${windowSteps.has(i + 1) ? " is-win" : ""}"></i>`).join("")}</span>`;
  const stepsOf = list => new Set(list.map(fid => scene.factById.get(fid)?.t));
  const signalPills = sig => (sig || []).slice(0, 3).map(([s, n]) => `<span class="sd-sig" data-sev="${signalSeverity(s)}">${esc(SIGNAL_LABEL[s])} <b>×${n}</b></span>`).join("");
  const hitsOf = list => { const got = new Set(list); const h = scene.windows.map(w => ({w, n: w.fids.filter(f => got.has(f)).length})).filter(x => x.n); return h.length ? h : null; };
  const hitChips = hit => (hit || []).map(h => `<span class="sd-hit" data-goto="step:${h.w.step}" title="returned ${h.n} of the window's ${h.w.fids.length} clue facts">→ ${esc(h.w.caseId)} · ${h.n}/${h.w.fids.length}</span>`).join("");
  const num = (n, unit) => `<b class="sd-qn">${n}</b><span class="sd-k">${unit}</span>`;
  const stepNo = html => html.replace(/\bsteps? \d+(?:[–-]\d+)?/g, m => `<b class="sd-stepno">${m}</b>`);

  const out = {};

  // PARSE: every step, the agent's text with its entities marked, and the facts it became.
  {
    const top = ranked.slice(0, 3);
    // The steps the case turns on stay lit; the rest step back.
    const key = new Set([...windowSteps.keys(), ...(root ? [root.step] : [])]);
    const first = Math.min(...key);
    const rows = [];
    for (let t = 0; t <= steps; t++) {
      const cells = SLOT_ORDER.map(slot => [slot, cell(t, slot)]).filter(([, fs]) => fs.length);
      if (!cells.length) continue;
      const tag = t === root?.step ? `<i class="sd-tag is-root">root</i>` : windowSteps.has(t) ? `<i class="sd-tag">suspect window</i>` : "";
      rows.push(`<li class="sd-step ${key.has(t) ? "is-key" : key.size ? "is-dim" : ""}" data-step="${t}"><h5>${t ? `Step ${t}` : "Task"}${tag}</h5>${cells.map(([slot, fs]) => {
        const calls = fs.slice(0, 4).map(f => `<code>#${f.fid} ${esc(factCall(f))}</code>`).join("") + (fs.length > 4 ? `<code class="sd-more">+${fs.length - 4}</code>` : "");
        return `<div class="sd-cellrow" data-src="${SOURCE[slot]}" data-fids="${fids(fs.map(f => f.fid))}"><span class="sd-k sd-src">${SLOT_LABEL[slot]}</span><p>${mark(clip(cellText(fs), 260))}</p><div class="sd-calls"><span class="sd-arrow">→</span>${calls}</div></div>`;
      }).join("")}</li>`);
    }
    const bySlot = SLOT_ORDER.map(s => [s, scene.facts.filter(f => f.slot === s).length]).filter(([, n]) => n);
    out.PARSE = {
      say: `ProDebugger compiles the agent's ${steps}-step log into a DSL record: ${scene.facts.length} facts, each saying who saw, thought or did what at which step, about ${top.map(e => ent(e.key)).join(", ")}${ranked.length > top.length ? ` and ${ranked.length - top.length} other entities` : ""}.`,
      title: "How each step became facts",
      lead: `Each line of the log is read by a fixed template; the entities it names become nodes, and each statement becomes one fact.`,
      body: `${key.size ? `<button class="sd-jump" data-goto="step:${first}">→ Step ${first}: ${first === root?.step ? "the root cause is here" : "the suspect window is here"}${first === root?.step && windowSteps.has(first) ? " (also the suspect window)" : ""}</button>` : ""}<ol class="sd-steps">${rows.join("")}</ol>`,
      focus: key.size ? first : null,
      rail: `<h4>DSL record</h4><dl class="sd-stats">${[["facts", scene.facts.length], ["entities", scene.entities.length], ["steps", steps]].map(([k, v]) => `<div><dd>${v}</dd><dt>${k}</dt></div>`).join("")}</dl>
        <h4>Facts by source</h4><ul class="sd-bars">${bySlot.map(([s, n]) => `<li data-src="${SOURCE[s]}"><span>${SLOT_LABEL[s]}</span><i style="--w:${(n / scene.facts.length * 100).toFixed(1)}%"></i><em>${n}</em></li>`).join("")}</ul>
        <h4>Entities <small>facts</small></h4><div class="sd-groups" data-fly>${[["goal", "the task asks for"], ["held", "the agent handled"], ["other", "the rest"]].map(([r, name]) => {
          // The goal's own words come first, even when no object of that kind ever showed up.
          const asked = r !== "goal" ? [] : [...new Set(scene.goals.flatMap(g => g.constraints.map(c => c.expected)).filter(w => typeof w === "string"))]
            .filter(w => !scene.entities.some(e => e.kind === w || e.index.replace(/_\d+$/, "") === w)).map(w => ({key: `goal:${w}`, facts: []}));
          const es = [...asked, ...ranked.filter(e => role(e.key) === r)].slice(0, r === "other" ? 8 : 6);
          return es.length ? `<div class="sd-group" data-role="${r}"><span class="sd-k">${name}</span><div class="sd-chips">${es.map(entChip).join("")}</div></div>` : "";
        }).join("")}</div>`,
      fly: true,
    };
  }

  // MAP: the task sentence, the requirement it becomes, and the facts that bear on it.
  {
    const goalEv = scene.events.find(e => e.phase === "MAP" && e.goal) || scene.events.find(e => e.goal);
    const state = goalEv?.goal?.state;
    const phrase = g => {
      const type = g.constraints.find(c => c.property?.index === "object_type")?.expected;
      return type ? `${g.count > 1 ? g.count : "a"} ${type} must end up ${g.rel} ${entName(g.target)}` : goalText(g.key);
    };
    // Things the agent acted on whose recorded type is not the one the goal asks for.
    const acted = new Set(scene.facts.filter(f => f.slot === "act").flatMap(f => f.args));
    const off = [];
    for (const g of scene.goals) for (const c of g.constraints) {
      const attr = c.property?.index;
      if (!attr || typeof c.expected !== "string") continue;
      for (const f of scene.facts) {
        if (f.args[1] !== `attribute:${attr}` || !acted.has(f.args[0]) || f.value === false) continue;
        const v = f.args[2]?.replace(/^value:/, "");
        if (v && v !== c.expected && !off.some(o => o.f.args[0] === f.args[0])) off.push({f, c, v});
      }
    }
    // Two goal shapes: placing an object somewhere (ALFWorld), or one item meeting several
    // attributes (WebShop: every attribute is its own goal on attribute:<name>).
    const typeOf = g => g.constraints.find(c => c.property?.index === "object_type")?.expected;
    const whereOf = g => entName(g.target);
    const isAttr = g => g.target.startsWith("attribute:");
    const attrGoals = scene.goals.filter(isAttr), placeGoals = scene.goals.filter(g => !isAttr(g));
    const attrName = g => entName(g.target).replace(/_/g, " ");
    const OP = {eq: "=", lt: "<", le: "≤", gt: ">", ge: "≥", semantic_match: "≈"};
    const MODE = {observation: "must be seen", selection: "must be chosen", semantic: "matched by meaning"};
    const SLOT_NAME = {action: "ACTION", count: "COUNT", what: "WHAT", rel: "RELATION", where: "WHERE"};
    // The task sentence cut into its words, each tagged with the slot it fills; a run of words
    // from one long value is named once, on its first word.
    const STOP = new Set(["a", "an", "the", "and", "or", "with", "of", "for", "in", "on", "to"]);
    const diagram = () => {
      const tag = new Map();
      const put = (w, slot, label, key) => { if (w && !tag.has(w)) tag.set(w, {slot, label, key}); };
      for (const g of placeGoals) {
        const type = typeOf(g), where = whereOf(g);
        put(String(type || "").toLowerCase(), "what", "WHAT", type ? `goal:${type}` : null);
        put(where.toLowerCase(), "where", "WHERE", `goal:${where}`);
        put(String(g.rel).toLowerCase(), "rel", "RELATION");
      }
      for (const g of attrGoals) for (const c of g.constraints) {
        const label = attrName(g).toUpperCase();
        if (typeof c.expected === "number") put(`#${c.expected}`, "attr", label);
        else if (typeof c.expected === "string") c.expected.toLowerCase().split(/[\s,]+/).filter(w => w && !STOP.has(w)).forEach(w => put(w, /\s/.test(c.expected) ? "desc" : "attr", label));
      }
      let first = true, prev = null;
      return scene.meta.task.split(/(\s+)/).map(t => {
        if (!t.trim()) return " ";
        const word = t.replace(/[.,;:!?]+$/, ""), punct = t.slice(word.length), w = word.toLowerCase();
        const num = Number.isFinite(parseFloat(w)) ? tag.get(`#${parseFloat(w)}`) : null;
        let hit = first ? {slot: "action", label: "ACTION"} : num || tag.get(w) || (placeGoals.length && /^(a|an|one|\d+)$/.test(w) ? {slot: "count", label: "COUNT"} : null);
        first = false;
        const label = hit && !(prev && prev.slot === hit.slot && prev.label === hit.label) ? hit.label : "";
        prev = hit;
        const tok = `<span class="sd-tok"${hit ? ` data-slot="${hit.slot}"` : ""}${hit?.key ? ` data-ent="${esc(hit.key)}"` : ""}><b>${esc(word)}</b>${hit ? `<i>${label || " "}</i>` : ""}</span>`;
        return tok + (punct ? `<span class="sd-tok"><b>${esc(punct)}</b></span>` : "");
      }).join("");
    };
    const slotWord = (slot, w, key) => `<span class="sd-slot" data-slot="${slot}"${key ? ` data-ent="${esc(key)}"` : ""}>${esc(w)}</span>`;
    const status = () => state ? `<dt>STATUS</dt><dd><span class="sd-state${/unmet|unsat|unres|fail|false|viol/i.test(state) ? " is-bad" : " is-ok"}">${esc(state)}</span>${goalEv.goal.decided?.length ? ` <span class="sd-k">decided at</span> <b class="sd-stepno">${esc(stepList(goalEv.goal.decided))}</b>` : ""}</dd>` : "";
    const placeCard = g => {
      const type = typeOf(g), where = whereOf(g), what = type || g.ofKind;
      const typeC = g.constraints.find(c => c.property?.index === "object_type");
      return `<dl class="sd-req" data-fids="${fids(g.facts)}">
        <dt>WHAT</dt><dd>${slotWord("what", what, type ? `goal:${type}` : null)}${typeC ? ` <span class="sd-k">object type · ${esc(MODE[typeC.mode] || typeC.mode)}</span>` : ""}</dd>
        <dt>HOW MANY</dt><dd>${slotWord("count", String(g.count ?? 1))}</dd>
        <dt>WHERE</dt><dd>${esc(g.rel)} ${slotWord("where", where, `goal:${where}`)}</dd>
        <dt>DONE WHEN</dt><dd>the run shows ${g.count > 1 ? g.count : "one"} ${slotWord("what", what)} ${esc(g.rel)} the ${slotWord("where", where)}</dd>
        ${status()}</dl>`;
    };
    const attrCard = () => {
      const item = attrGoals.find(g => g.ofKind && g.ofKind !== "value")?.ofKind || "item";
      return `<dl class="sd-req">
        <dt>WHAT</dt><dd>${slotWord("what", `one ${item}`)}</dd>
        ${attrGoals.map(g => g.constraints.map(c => `<dt>${esc(attrName(g).toUpperCase())}</dt><dd data-fids="${fids(g.facts)}"><b class="sd-op">${esc(OP[c.operator] || c.operator || "=")}</b> ${slotWord(typeof c.expected === "string" && /\s/.test(c.expected) ? "desc" : "attr", typeof c.expected === "string" ? c.expected : String(c.expected))} <span class="sd-k">${esc(MODE[c.mode] || c.mode || "")}</span></dd>`).join("")).join("")}
        <dt>DONE WHEN</dt><dd>the run ends with ${slotWord("what", `one ${item}`)} meeting all ${attrGoals.reduce((n, g) => n + g.constraints.length, 0)} conditions</dd>
        ${status()}</dl>`;
    };
    out.MAP = {
      say: `ProDebugger reads the task “${mark(scene.meta.task)}” as ${scene.goals.length === 1 ? "one requirement" : `${scene.goals.length} requirements`}: ${scene.goals.map(g => mark(phrase(g))).join("; ")}.${state ? ` At the end of the run it is <b class="sd-bad">${esc(state)}</b>.` : ""}`,
      title: "What the task maps to",
      lead: `Every suspicion raised later has to name the requirement it hurts.`,
      body: `<div class="sd-sec"><div class="sd-k">the task, word by word</div><div class="sd-diagram">${diagram()}</div></div>
        <div class="sd-sec"><div class="sd-k">the requirement it becomes</div>${placeGoals.map(placeCard).join("")}${attrGoals.length ? attrCard() : ""}</div>
        <div class="sd-sec"><div class="sd-k">facts that check the goal</div><ul class="sd-list">${scene.goals.flatMap(g => g.facts).map(fid => scene.factById.get(fid)).filter(Boolean).slice(0, 8).map(f => factRow(f, `<code>${esc(String(f.value ?? "open"))}</code>`)).join("") || `<li class="sd-k">none</li>`}</ul></div>
        ${off.length ? `<div class="sd-sec"><div class="sd-k">things the agent handled, by recorded type</div><ul class="sd-list">${off.slice(0, 6).map(({f, c, v}) => `<li data-fids="${f.fid}" data-step="${f.t}"><span class="sd-k">step ${f.t} · #${f.fid}</span><span>${ent(f.args[0])} is a ${mark(v)} <b class="sd-bad">≠ ${esc(c.expected)}</b></span></li>`).join("")}</ul></div>` : ""}`,
      rail: `<h4>Goal</h4>${scene.goals.map(g => `<div class="sd-card"><p>${mark(phrase(g))}</p><div class="sd-chips">${g.constraints.filter(c => typeof c.expected === "string").map(c => `<span class="sd-chip" data-ent="goal:${esc(c.expected)}" data-role="${role(`goal:${c.expected}`)}"><b>${esc(c.expected)}</b></span>`).join("")}</div></div>`).join("")}
        ${state ? `<h4>Status</h4><p class="sd-bad">${esc(state)}${goalEv.goal.decided?.length ? ` <span class="sd-k">decided at ${esc(stepList(goalEv.goal.decided))}</span>` : ""}</p>` : ""}
        ${off.length ? `<h4>Wrong type in hand</h4><div class="sd-chips">${off.slice(0, 6).map(o => `<button class="sd-chip" data-ent="${esc(o.f.args[0])}" data-goto="ent:${esc(o.f.args[0])}"><b>${esc(entName(o.f.args[0]))}</b></button>`).join("")}</div>` : ""}`,
    };
  }

  // ROUTE: the queries it ran and the windows it opened.
  {
    const views = scene.events.filter(e => e.phase === "ROUTE" && !e.error && e.name !== "route_cases");
    const actOf = w => w.fids.map(fid => scene.factById.get(fid)).find(f => f?.slot === "act");
    const ws = scene.windows;
    const signs = new Map();
    views.forEach(e => (e.signals || []).forEach(([k, n]) => signs.set(k, Math.max(signs.get(k) || 0, n))));
    // Per query, the windows whose clue facts it returned, and how many of them.
    const hits = views.map(e => hitsOf(e.fids));
    out.ROUTE = {
      say: `ProDebugger queries the record ${plural(views.length, "time")} for trouble signs and opens ${ws.length === 1 ? "one suspect window" : `${ws.length} suspect windows`}: ${ws.map(w => { const a = actOf(w); return `step ${w.step}${a ? `, where the agent acts “${mark(clip(a.span, 80))}”` : ""}`; }).join("; ") || "none"}.`,
      title: "What the scan found",
      lead: `ROUTE only screens: a window is a place to look, not a verdict.`,
      body: `${ws.map(w => `<div class="sd-sec sd-win" data-step="${w.step}"><div class="sd-k">window ${esc(w.caseId)} · step ${w.step} · facts ${esc(w.fids.map(f => `#${f}`).join(" "))}</div>
          <ul class="sd-list">${factRows(w.fids.map(fid => scene.factById.get(fid)).filter(Boolean))}</ul>
          <details><summary>ROUTE's hypothesis</summary><p>${mark(w.hypothesis)}</p></details></div>`).join("")}
        <div class="sd-sec"><div class="sd-k">how it got there · ${plural(views.length, "query", "queries")}${hits.some(Boolean) ? ` · lit rows reached ${ws.length === 1 ? "the window" : "a window"}` : ""}</div><ol class="sd-queries">${views.map((e, k) => {
          const kind = queryKind(e), hit = hits[k];
          return `<li class="${hit ? "is-hit" : hits.some(Boolean) ? "is-dim" : ""}" data-fids="${fids(e.fids)}">
            <span class="sd-qtag" data-kind="${kind}" title="${esc(e.raw || e.name)}">${kind}</span>
            <div><p>${esc(cap(e.intent || e.name))}</p>
              <div class="sd-qres">${miniStrip(stepsOf(e.fids))}${num(e.fids.length, "facts")}${signalPills(e.signals)}${hitChips(hit)}</div></div></li>`;
        }).join("")}</ol></div>`,
      rail: `<h4>Suspect steps</h4>${strip(steps, new Map(ws.map(w => [w.step, {tone: "hot", label: `window ${w.caseId}`}])))}
        <div class="sd-chips">${ws.map(w => `<button class="sd-chip is-hot" data-goto="step:${w.step}" data-fids="${fids(w.fids)}"><b>${esc(w.caseId)}</b><em>step ${w.step}</em></button>`).join("")}</div>
        ${signs.size ? `<h4>Trouble signs</h4><ul class="sd-bars">${[...signs].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `<li data-sev="${signalSeverity(k)}"><span>${esc(SIGNAL_LABEL[k])}</span><i style="--w:${Math.min(100, n / steps * 100 * 3).toFixed(1)}%"></i><em>${n}</em></li>`).join("")}</ul>` : ""}`,
    };
  }

  // MANAGER: the question each window becomes, and the rules fixed before any answer.
  {
    const ls = scene.lanes;
    const usedRule = root?.rule?.id || null;
    // The original text, folded away under the structured line.
    const fold = text => text ? `<details class="sd-full"><summary>full text</summary><p>${mark(text)}</p></details>` : "";
    const firstSentence = t => clip(String(t || "").split(/(?<=[.;])\s+/)[0], 150);
    // A search target as one line: its verb, the words to look for, the modules, the steps.
    const MODULES = [["observation", "env"], ["feedback", "env"], ["memory", "agent"], ["reflection", "agent"], ["plan", "agent"], ["action", "agent"]];
    const targetRow = (t, l) => {
      const verb = (t.match(/^\s*([A-Za-z]+)/) || [])[1] || "";
      const quoted = [...new Set([...t.matchAll(/(?:^|[\s(,])'(.{2,40}?)'(?=[\s,.;:)]|$)/g)].map(m => m[1]))];
      const named = [...new Set([...mark(t).matchAll(/data-ent="([^"]+)"[^>]*>([^<]+)</g)].map(m => m[2].toLowerCase()))].filter(w => !quoted.includes(w));
      const words = [...quoted, ...named].slice(0, 6);
      const mods = MODULES.filter(([m]) => new RegExp(`\\b${m}`, "i").test(t));
      const range = t.match(/steps? (\d+)\s*(?:through|to|-|–)\s*(?:step )?(\d+)/i) || t.match(/(\d+)\s*(?:through|to|–)\s*(\d+)/);
      const until = !range && t.match(/through step (\d+)/i);
      const [a, b] = range ? [+range[1], +range[2]] : until ? [l.step, +until[1]] : [null, null];
      const span = a != null ? new Set(Array.from({length: Math.max(0, b - a + 1)}, (_, i) => a + i)) : new Set([...t.matchAll(/step[- ](\d+)/gi)].map(m => +m[1]));
      return `<li><span class="sd-verb">${esc(verb.toUpperCase())}</span><div>
        <div class="sd-qres">${words.map(w => `<span class="sd-chip">${mark(w)}</span>`).join("")}${mods.map(([m, src]) => `<span class="sd-modtag" data-src="${src}">${m}</span>`).join("")}${span.size ? `${miniStrip(span)}<span class="sd-k">${a != null ? `steps ${a}–${b}` : stepList([...span])}</span>` : ""}</div>
        ${fold(t)}</div></li>`;
    };
    // A quote the manager hands over, coloured by who wrote it.
    const quoteCard = ev => {
      const [, step, module] = String(ev.source_id || "").split(":");
      const src = /observation|feedback/.test(module) ? "env" : "agent";
      return `<blockquote class="sd-quote-card" data-src="${src}" data-step="${esc(step || "")}"><span class="sd-k">step ${esc(step || "?")} · ${esc(module || "")}</span>${mark(ev.quote)}</blockquote>`;
    };
    // A decision rule as one branch: the outcome TRACE may report, the rule, what follows.
    const ruleRow = r => `<li class="${usedRule ? (usedRule === r.id ? "is-used" : "is-dim") : ""}">
        <span class="sd-outcome" data-outcome="${esc(r.outcome)}">${esc(r.outcome || "?")}</span>
        <div><b class="sd-rule-name">${esc(r.id.replace(/_/g, " "))}</b>${usedRule === r.id ? `<span class="sd-used">used by SUBMIT</span>` : ""}
          <p>→ ${mark(firstSentence(r.conclusion))}</p>
          <details class="sd-full"><summary>full text</summary>${r.finding ? `<p><span class="sd-k">if</span> ${mark(r.finding)}</p>` : ""}<p><span class="sd-k">then</span> ${mark(r.conclusion)}</p>${r.caveat ? `<p><span class="sd-k">caveat</span> ${mark(r.caveat)}</p>` : ""}</details></div></li>`;
    out.MANAGER = {
      say: ls.length === 1
        ? `ProDebugger turns the step-${ls[0].step} suspicion into one question for a trace agent: “${mark(question(ls[0], 170))}”`
        : `ProDebugger turns the suspicions into ${ls.length} questions, one per trace agent, for ${stepList(ls.map(l => l.step))}.`,
      title: "The questions handed to TRACE",
      lead: scene.rules.length ? `Before any evidence comes in, the manager fixes ${plural(scene.rules.length, "decision rule")} for judging the answers.` : "",
      body: `${ls.map(l => `<div class="sd-sec" data-step="${l.step}"><div class="sd-k">agent ${esc(l.agent)} · window ${esc(l.anchor)} · step ${l.step}</div>
          <p class="sd-question">${mark(question(l, 200))}</p>${fold(l.question)}</div>
          ${l.evidence.length ? `<div class="sd-sec"><div class="sd-k">what it is shown · ${plural(l.evidence.length, "quote")}</div>${l.evidence.slice(0, 3).map(quoteCard).join("")}${l.evidence.length > 3 ? `<details class="sd-full"><summary>${l.evidence.length - 3} more</summary>${l.evidence.slice(3).map(quoteCard).join("")}</details>` : ""}</div>` : ""}
          ${l.targets.length ? `<div class="sd-sec"><div class="sd-k">what to search</div><ol class="sd-targets">${l.targets.map(t => targetRow(t, l)).join("")}</ol></div>` : ""}`).join("")}
        ${scene.rules.length ? `<div class="sd-sec"><div class="sd-k">if TRACE finds… then</div><ol class="sd-rules">${scene.rules.map(ruleRow).join("")}</ol></div>` : ""}`,
      rail: `<h4>Assignments</h4><div class="sd-chips">${ls.map(l => `<button class="sd-chip is-hot" data-goto="step:${l.step}"><b>${esc(l.agent)}</b><em>← ${esc(l.anchor)} · step ${l.step}</em></button>`).join("")}</div>
        ${scene.rules.length ? `<h4>Rules</h4><ul class="sd-rule-mini">${scene.rules.map(r => `<li${usedRule === r.id ? ` class="is-used"` : ""}><span class="sd-outcome" data-outcome="${esc(r.outcome)}">${esc(r.outcome || "?")}</span>${esc(r.id.replace(/_/g, " "))}</li>`).join("")}</ul>` : ""}`,
    };
  }

  // TRACE: per lane, the evidence it wants, the DSL it writes, the log rows that come back.
  {
    const ls = scene.lanes;
    const sqlOf = l => scene.events.find(e => e.name === "query_logs" && e.lanes.includes(l.id))?.sql || "";
    const cands = l => scene.candidates.filter(c => c.lane === l.id);
    const rowsBy = l => { const m = new Map(); for (const r of l.rows) { if (!m.has(r.step)) m.set(r.step, []); m.get(r.step).push(r); } return [...m].sort((a, b) => a[0] - b[0]); };
    const sql = s => esc(s).split("\n").map(line => line.trim().startsWith("--") ? `<span class="sd-cm">${line}</span>` : line).join("\n");
    const nRows = ls.reduce((n, l) => n + l.rows.length, 0), nSteps = new Set(ls.flatMap(l => l.steps)).size;
    const blamed = scene.candidates;
    const named = [...new Set(blamed.map(c => `step ${c.step}'s ${c.module}`))];
    const one = ls.length === 1, v = (s1, s2) => one ? s1 : s2;
    out.TRACE = {
      say: `${one ? "A trace agent writes one DSL query" : `${ls.length} trace agents each write a DSL query`} over the logs, ${v("reads", "read")} ${plural(nRows, "row")} from ${plural(nSteps, "step")}, and ${named.length ? `${v("blames", "blame")} ${named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}` : named[0]}` : `${v("blames", "blame")} no step`}.`,
      title: "Evidence sought · DSL · steps read",
      lead: "",
      body: ls.map(l => `<div class="sd-lane">
          <div class="sd-sec"><div class="sd-k">agent ${esc(l.agent)} · evidence it wants</div><p>${mark(l.purpose || question(l, 260))}</p></div>
          <div class="sd-sec"><div class="sd-k">DSL query</div><pre class="sd-sql">${sql(sqlOf(l))}</pre></div>
          <div class="sd-sec"><div class="sd-k">log rows back · ${plural(l.rows.length, "row")} from ${plural(l.steps.length, "step")}</div>
            <ol class="sd-steps">${rowsBy(l).map(([s, rs]) => `<li class="sd-step" data-step="${s}"><h5>Step ${s}${s === l.step ? `<i class="sd-tag">window</i>` : ""}${cands(l).some(c => c.step === s) ? `<i class="sd-tag is-root">blamed</i>` : ""}</h5>${rs.map(r => [r, goalWords.filter(w => String(r.text).toLowerCase().includes(w)).length]).sort((a, b) => b[1] - a[1]).map(([r]) => r).slice(0, 3).map(r => `<div class="sd-cellrow" data-fids="${fids(cell(r.step, MODULE_SLOT[r.module] || r.module).map(f => f.fid))}"><span class="sd-k">${esc(r.module)}</span><p>${mark(clip(r.text, 200))}</p></div>`).join("")}${rs.length > 3 ? `<span class="sd-k">+${rs.length - 3} more rows</span>` : ""}</li>`).join("")}</ol></div>
          ${cands(l).length ? `<div class="sd-sec"><div class="sd-k">what it concludes</div><ul class="sd-list">${cands(l).map(c => `<li data-step="${c.step}"${c.fid != null ? ` data-fids="${c.fid}"` : ""}><span class="sd-k">step ${c.step} · ${esc(c.module)} · ${esc([statusText(c.status), faultText(c.faultClass)].filter(Boolean).join(", "))}</span><span>${mark(clip(c.proposition, 260))}</span></li>`).join("")}</ul></div>` : ""}
        </div>`).join(""),
      rail: ls.map(l => `<h4>Steps read · ${esc(l.agent)}</h4>${strip(steps, new Map([...l.steps.map(s => [s, {tone: "read", label: "read"}]), [l.step, {tone: "hot", label: "window"}], ...cands(l).map(c => [c.step, {tone: "root", label: `blamed ${c.module}`}])]))}`).join("")
        + `<h4>Blamed</h4><div class="sd-chips">${blamed.map(c => `<button class="sd-chip is-root" data-goto="step:${c.step}"${c.fid != null ? ` data-fids="${c.fid}"` : ""}><b>step ${c.step}</b><em>${esc(c.module)}</em></button>`).join("") || `<span class="sd-k">none</span>`}</div>`,
    };
  }

  // SUBMIT: the verdict, the agent's own words at the root, and why.
  {
    out.SUBMIT = root ? {
      say: `ProDebugger names step ${root.step}'s ${esc(root.module)} as the root cause: ${mark(clip(root.proposition, 200))}`,
      title: "Verdict and why",
      lead: root.rule?.id ? `Decided by the manager's rule ${esc(root.rule.id.replace(/_/g, " "))}.` : "",
      body: `<div class="sd-sec" data-step="${root.step}"${root.fid != null ? ` data-fids="${root.fid}"` : ""}><div class="sd-k">root · step ${root.step} · ${esc(root.module)}${root.faultClass ? ` · ${esc(faultText(root.faultClass))}` : ""}</div>
          ${root.quote ? `<blockquote>${mark(root.quote)}</blockquote>` : ""}<p>${mark(root.proposition)}</p></div>
        ${root.reasoning ? `<div class="sd-sec"><div class="sd-k">reasoning</div><p>${mark(root.reasoning)}</p></div>` : ""}`,
      rail: `<h4>Root</h4><div class="sd-card is-root"${root.fid != null ? ` data-fids="${root.fid}"` : ""}><b>step ${root.step} · ${esc(root.module)}</b><span class="sd-k">${esc(faultText(root.faultClass))}</span></div>
        ${strip(steps, new Map([[root.step, {tone: "root", label: "root"}]]))}
        <h4>Status</h4><p>${root.accepted ? "accepted" : esc(root.status || "not accepted")}</p>`,
    } : {
      say: "ProDebugger stops without naming a root cause.", title: "No verdict", lead: "", body: "", rail: "",
    };
  }

  // The footer caption for one tour event: an action tag, the title with its key words lit,
  // and one line of what the action produced.
  const VERDICT_TONE = {viol: "task", unk: "soft", sat: "ok"};
  const goalEv = scene.events.find(e => e.goal);
  function caption(ev) {
    const title = stepNo(mark(ev.title || ""));
    const lane = ev.lanes?.length ? scene.lanes.find(l => l.id === ev.lanes[0]) : null;
    if (ev.error) return {kind: "REJECTED", title, line: `<span class="sd-k">${esc(clip(ev.error.message, 140))}</span>`};
    switch (ev.name) {
      case "compile": {
        const env = scene.facts.filter(f => f.slot === "obs").length, chk = scene.facts.filter(f => f.slot === "chk").length, all = scene.facts.length;
        return {kind: "COMPILE", title, line: `${num(all, "facts")}${num(scene.entities.length, "entities")}${num(steps, "steps")}<span class="sd-split" title="who wrote the lines"><i data-src="env" style="flex:${env}">env ${env}</i><i data-src="agent" style="flex:${all - env - chk}">agent ${all - env - chk}</i>${chk ? `<i data-src="check" style="flex:${chk}" title="checks">${chk}</i>` : ""}</span>`};
      }
      case "view": case "view_evidence": {
        if (ev.phase === "MAP") {
          const st = ev.goal?.state || goalEv?.goal?.state, at = ev.goal?.decided || goalEv?.goal?.decided || [];
          const words = [...new Set(scene.goals.flatMap(g => [...g.constraints.filter(c => typeof c.expected === "string" && c.expected !== entName(g.target)).map(c => c.expected), `${g.rel} ${entName(g.target)}`]))];
          return {kind: "GOAL", title, line: `${words.map(w => `<span class="sd-chip" data-role="${w.includes(" ") ? "where" : "goal"}">${mark(w)}</span>`).join("")}${st ? `<span class="sd-state${/unmet|unsat|fail|false|viol/i.test(st) ? " is-bad" : ""}">${esc(st)}</span>` : ""}${at.length ? `<span class="sd-k">decided at</span><b class="sd-stepno">${esc(stepList(at))}</b>` : ""}`};
        }
        return {kind: queryKind(ev), title, line: `${miniStrip(stepsOf(ev.fids))}${num(ev.fids.length, "facts")}${signalPills(ev.signals)}${hitChips(hitsOf(ev.fids))}`};
      }
      case "inspect":
        return {kind: "INSPECT", title, line: `${miniStrip(stepsOf(ev.fids))}${(ev.verdicts || []).map(([v, n]) => `<span class="sd-sig" data-sev="${VERDICT_TONE[v] || "soft"}"><b>${n}</b> ${esc(VERDICT_WORD[v] || v)}</span>`).join("")}${hitChips(hitsOf(ev.fids))}`};
      case "route_cases": {
        const ws = scene.windows.filter(w => ev.windows.includes(w.id));
        return {kind: "WINDOW", title, line: `${miniStrip(new Set())}${ws.map(w => {
          const a = w.fids.map(f => scene.factById.get(f)).find(f => f?.slot === "act");
          return `<span class="sd-hit" data-goto="step:${w.step}">${esc(w.caseId)} · step ${w.step}</span>${num(w.fids.length, "clue facts")}${a ? `<span class="sd-quote">“${mark(clip(a.span, 60))}”</span>` : ""}`;
        }).join("")}`};
      }
      case "plan_trace": {
        const ls = scene.lanes.filter(l => ev.lanes.includes(l.id));
        return {kind: "PLAN", title, line: `${ls.map(l => `<span class="sd-chip is-hot"><b>${esc(l.agent)}</b><em>← ${esc(l.anchor)} · step ${l.step}</em></span>`).join("")}${scene.rules.length ? num(scene.rules.length, "decision rules") : ""}`};
      }
      case "query_logs":
        return {kind: "SEARCH", title, line: `${miniStrip(new Set(lane?.steps || []))}${num(lane?.rows.length ?? 0, "rows")}${num(lane?.steps.length ?? 0, "steps")}`};
      case "assess": {
        const cs = scene.candidates.filter(c => ev.candidates.includes(c.id));
        return {kind: "ASSESS", title, line: cs.map(c => `<span class="sd-cand${c.status === "error" ? " is-bad" : ""}">step ${c.step} · ${esc(c.module)} · ${esc(statusText(c.status))}</span><span class="sd-k">${esc(faultText(c.faultClass))}</span>`).join("") || `<span class="sd-k">no step blamed</span>`};
      }
      case "submit":
        return root
          ? {kind: "ROOT", title, line: `${miniStrip(new Set([root.step]), "root")}<span class="sd-cand is-bad">step ${root.step} · ${esc(root.module)}</span><span class="sd-k">${esc(faultText(root.faultClass))}</span>${root.rule?.id ? `<span class="sd-chip"><em>rule</em> <b>${esc(root.rule.id.replace(/_/g, " "))}</b></span>` : ""}<span class="sd-state${root.accepted ? " is-ok" : ""}">${root.accepted ? "accepted" : esc(root.status || "not accepted")}</span>`}
          : {kind: "ROOT", title, line: `<span class="sd-k">no root cause</span>`};
      default:
        return {kind: ev.phase, title, line: `<span class="sd-k">${esc(clip(ev.caption, 160))}</span>`};
    }
  }

  return {phases: out, mark, entFacts, caption};
}

// Mounts the sentence, the popup and the rail on the page, and wires them together.
export function createDetails(root, scene, model, stage, {onOpen} = {}) {
  const {phases, mark, entFacts, caption} = buildDetails(scene, model);
  const h1 = root.querySelector(".qg-title h1");
  if (h1) h1.innerHTML = mark(scene.meta.task || scene.meta.tid);
  root.insertAdjacentHTML("beforeend", `
    <div class="qg-sd-say" hidden><span class="qg-sd-ph"></span><p></p><button class="qg-sd-more" type="button">more details</button></div>
    <section class="qg-sd-pop" aria-label="Stage details" hidden><header><span class="qg-sd-ph"></span><h3></h3><button class="qg-sd-close" type="button" title="Close (Esc)" aria-label="Close">×</button></header><p class="qg-sd-lead"></p><div class="qg-sd-body"></div></section>
    <aside class="qg-sd-rail" aria-label="What this stage produced" hidden><div class="qg-sd-railbody"></div></aside>`);
  const say = root.querySelector(".qg-sd-say"), pop = root.querySelector(".qg-sd-pop"), rail = root.querySelector(".qg-sd-rail");
  const focusColor = getComputedStyle(root).getPropertyValue("--qg-focus").trim() || "#e0b867";
  let phase = null, open = false, flyTimer = 0;

  function fill() {
    const d = phases[phase];
    if (!d) return;
    root.querySelectorAll(".qg-sd-ph").forEach(el => { el.textContent = phase; el.dataset.phase = phase; });
    say.dataset.phase = phase;
    say.querySelector("p").innerHTML = d.say;
    pop.querySelector("h3").textContent = d.title;
    pop.querySelector(".qg-sd-lead").innerHTML = d.lead || "";
    pop.querySelector(".qg-sd-lead").hidden = !d.lead;
    pop.querySelector(".qg-sd-body").innerHTML = d.body;
    pop.querySelector(".qg-sd-body").scrollTop = 0;
    rail.querySelector(".qg-sd-railbody").innerHTML = d.rail;
  }

  // The rail's entities fly in from where the popup first names them.
  function fly() {
    const chips = [...rail.querySelectorAll("[data-fly] [data-ent]")];
    const box = pop.querySelector(".qg-sd-body").getBoundingClientRect();
    chips.forEach(c => { c.style.opacity = "0"; });
    chips.forEach((chip, k) => {
      const from = [...pop.querySelectorAll(`.qg-ent[data-ent="${CSS.escape(chip.dataset.ent)}"]`)]
        .find(el => { const r = el.getBoundingClientRect(); return r.top >= box.top && r.bottom <= box.bottom; });
      setTimeout(() => {
        if (!open) return;
        if (!from) { chip.style.opacity = ""; return; }
        const a = from.getBoundingClientRect(), b = chip.getBoundingClientRect(), base = root.getBoundingClientRect();
        const ghost = document.createElement("b");
        ghost.className = "qg-sd-ghost";
        ghost.textContent = from.textContent;
        ghost.style.left = `${a.left - base.left}px`;
        ghost.style.top = `${a.top - base.top}px`;
        root.append(ghost);
        from.classList.add("is-hl");
        ghost.animate([{transform: "translate(0,0)", opacity: 1}, {transform: `translate(${b.left - a.left}px,${b.top - a.top}px)`, opacity: .9}],
          {duration: 650, easing: "cubic-bezier(.5,0,.2,1)"}).onfinish = () => { ghost.remove(); chip.style.opacity = ""; from.classList.remove("is-hl"); };
      }, 380 + k * 90);
    });
  }

  function setOpen(on) {
    open = on;
    // The popup and rail start under the case title, however many lines it takes.
    const title = root.querySelector(".qg-title")?.getBoundingClientRect();
    if (title) root.style.setProperty("--qg-sd-top", `${title.bottom - root.getBoundingClientRect().top + 10}px`);
    clearTimeout(flyTimer);
    root.classList.toggle("has-sd", on);
    pop.hidden = rail.hidden = false;
    requestAnimationFrame(() => { pop.classList.toggle("is-in", on); rail.classList.toggle("is-in", on); });
    if (!on) { light(null, null); setTimeout(() => { if (!open) pop.hidden = rail.hidden = true; }, 360); }
    else {
      const d = phases[phase], body = pop.querySelector(".qg-sd-body");
      const at = d?.focus != null ? body.querySelector(`[data-step="${d.focus}"]`) : null;
      // Under the sticky jump bar, with a line of the step before showing.
      if (at) body.scrollTop += at.getBoundingClientRect().top - body.getBoundingClientRect().top - (body.querySelector(".sd-jump")?.offsetHeight || 0) - 14;
      if (d?.fly) fly();
    }
  }

  // Pointing at an entity or a fact row lights its twins on the page and its facts on the tower.
  let lit = null;
  const light = (key, list) => {
    if (lit === (key || list)) return;
    lit = key || list;
    root.querySelectorAll(".qg-ent.is-hl, .sd-chip.is-hl").forEach(el => el.classList.remove("is-hl"));
    if (key) root.querySelectorAll(`[data-ent="${CSS.escape(key)}"]`).forEach(el => el.classList.add("is-hl"));
    if (root.classList.contains("is-story")) return;
    const f = key ? entFacts.get(key) : list ? list.split(",").map(Number) : null;
    stage.markFacts(f?.length ? [{fids: f, color: focusColor}] : []);
  };
  root.addEventListener("mouseover", e => {
    const t = e.target.closest?.("[data-ent], [data-fids]");
    if (!t || !t.closest(".qg-sd-say, .qg-sd-pop, .qg-sd-rail, .qg-title")) { if (lit) light(null, null); return; }
    t.dataset.ent ? light(t.dataset.ent, null) : light(null, t.dataset.fids);
  });
  // A rail chip or strip cell scrolls the popup to the first place it names, and flashes it.
  const goto = e => {
    const go = e.target.closest("[data-goto]")?.dataset.goto;
    if (!go) return;
    const [kind, ...rest] = go.split(":"), v = rest.join(":");
    const body = pop.querySelector(".qg-sd-body");
    const hit = kind === "step" ? body.querySelector(`[data-step="${v}"]`) || [...body.querySelectorAll("[data-step]")].find(el => Number(el.dataset.step) >= Number(v))
      : body.querySelector(`.qg-ent[data-ent="${CSS.escape(v)}"]`);
    if (!hit) return;
    hit.scrollIntoView({block: "center", behavior: "smooth"});
    hit.classList.remove("is-flash"); void hit.offsetWidth; hit.classList.add("is-flash");
  };
  rail.addEventListener("click", goto);
  pop.addEventListener("click", goto);
  say.querySelector(".qg-sd-more").addEventListener("click", () => { onOpen?.(); setOpen(true); });
  pop.querySelector(".qg-sd-close").addEventListener("click", () => setOpen(false));

  return {
    get isOpen() { return open; },
    // The tour moved to a phase: the sentence follows it, and an open popup with it.
    show(ph) {
      if (ph === phase) return;
      phase = ph;
      fill();
      say.hidden = !phases[ph];
      say.classList.remove("is-new"); void say.offsetWidth; say.classList.add("is-new");
      if (open && phases[ph]?.fly) fly();
    },
    close() { if (open) setOpen(false); },
    // The footer caption in the same shape as the popup's rows.
    caption(ev) {
      const c = caption(ev), box = root.querySelector(".qg-caption");
      if (!box) return;
      box.classList.add("is-rich");
      box.querySelector(".qg-cap-title").innerHTML = `<span class="sd-qtag" data-kind="${c.kind}" title="${esc(ev.raw || ev.name || "")}">${c.kind}</span><span>${c.title}</span>`;
      box.querySelector(".qg-cap-text").innerHTML = `<span class="sd-qres">${c.line}</span>`;
    },
  };
}
