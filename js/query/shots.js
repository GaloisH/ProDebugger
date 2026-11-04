import {SLOT_LABEL} from "./model.js?v=signs-82";
import {agentWords, faultText, stepList} from "./narrate.js?v=23f9bfd6b4";
import {buildChain} from "./chain.js?v=chain-5";

const SLOT_ORDER = ["obs", "mem", "refl", "plan", "act", "chk"];
const SOURCE = {obs: "world", chk: "check", act: "action", mem: "memory", refl: "reflection", plan: "plan"};
const MAX_LABELS = 6;

let TITLES = new Map();
export function plainName(key) {
  const [kind, ...rest] = String(key).split(":");
  const index = rest.join(":");
  if (kind === "agent") return "the agent";
  if (kind === "req") return "the goal";
  if (kind === "product") return TITLES.get(key) || `item ${index}`;
  if (kind === "value" && /[^a-z0-9_ ]/i.test(index)) return `“${index}”`;
  if (/^\d+$/.test(index)) return `${kind} ${index}`;
  return index.replace(/_(\d+)$/, " $1").replace(/_/g, " ");
}
const clip = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; };
const valueText = v => typeof v === "string" ? v : JSON.stringify(v);

export const dslLine = f => clip(`${f.rel}(${f.args.map(plainName).join(", ")}) = ${valueText(f.value)}`, 64);

export function factWords(f, goalWords = []) {
  const [a, b, c] = f.args.map(plainName);
  const yes = f.value === true, no = f.value === false;
  let text = "";
  if (f.slot === "act") text = String(f.span || f.value || f.rel).replace(/^'(.*)'$/, "$1");
  else if (f.slot === "mem" || f.slot === "refl" || f.slot === "plan") text = `“${keySentence(f, goalWords)}”`;
  else switch (f.rel) {
    case "has": text = b === "object type" ? `${a} is a ${c}` : `${a} has ${b} ${c}`; break;
    case "in": text = yes ? `${a} is in ${b}` : no ? `${a} is no longer in ${b}` : `${a} in ${b}?`; break;
    case "holding": text = yes ? `${a} holds ${b}` : `${a} no longer holds ${b}`; break;
    case "at": text = `${a} is at ${b}`; break;
    case "visible_empty": text = yes ? `${a} is empty` : `${a} has things in it`; break;
    case "open": text = yes ? `${a} is open` : `${a} is closed`; break;
    case "satisfied": text = yes ? "goal check: met" : no ? "goal check: not met" : "goal check: open"; break;
    default: text = `${f.rel.replace(/_/g, " ")} ${f.args.map(plainName).join(", ")}${yes ? "" : ` = ${valueText(f.value)}`}`;
  }
  return {text: clip(`S${f.t} · ${SOURCE[f.slot] || f.slot} · ${text}`, 92), sub: dslLine(f)};
}

function keySentence(f, goalWords) {
  const parts = String(f.span || "").split(/\n|(?<=[.?!])\s+/).map(x => x.replace(/^-\s*/, "").trim())
    .map(x => x.includes("? ") ? x.slice(x.lastIndexOf("? ") + 2) : x).filter(x => x.length > 12);
  const score = x => goalWords.filter(w => x.toLowerCase().includes(w)).length;
  const best = parts.reduce((m, x) => score(x) > score(m ?? "") ? x : m, null);
  const line = best && score(best) ? best : agentWords(f) || f.span || f.rel;
  const at = Math.min(...goalWords.map(w => line.toLowerCase().indexOf(w)).filter(i => i >= 0));
  if (line.length > 70 && Number.isFinite(at) && at > 45) return clip("…" + line.slice(line.lastIndexOf(" ", at - 30) + 1), 70);
  return clip(line, 70);
}

const labelsOf = (fids, scene, goalWords) => new Map(fids.map(fid => [fid, factWords(scene.factById.get(fid), goalWords)]));

export const typeOfIn = (scene, key) => {
  const f = scene.facts.find(x => x.rel === "has" && x.args[0] === key && x.args[1] === "attribute:object_type");
  return f ? String(f.args[2]).replace(/^value:/, "") : null;
};
export const neededType = scene => scene.goals.flatMap(g => g.constraints).find(c => c.property?.index === "object_type" && typeof c.expected === "string")?.expected || null;

export function actionText(f) {
  const v = typeof f.value === "string" ? f.value.replace(/^'(.*)'$/, "$1").trim() : "";
  const verb = f.rel.replace(/_/g, " ");
  if (!v) return `${verb} ${f.args.filter(a => !a.startsWith("agent:")).map(plainName).join(", ")}`.trim();
  return v.toLowerCase().startsWith(verb) ? v : `${verb} “${v}”`;
}

export function servesText(it, scene) {
  const reqs = (it?.serves || []).map(r => String(r.index || r).replace(/^req:/, ""));
  if (!reqs.length) return "";
  return scene.goals.length <= 1 ? "serves the goal" : `serves ${reqs.map(r => r.replace(/_/g, " ")).join(", ")}`;
}

export function windowWords(f, scene) {
  const need = neededType(scene);
  const clash = keys => {
    for (const k of keys) { const t = typeOfIn(scene, k); if (need && t && t !== need) return `world: a ${t} ≠ needed ${need}`; }
    return null;
  };
  const head = `S${f.t} · ${SOURCE[f.slot] || f.slot} · `;
  if (f.slot === "act") return {text: clip(head + actionText(f), 80), sub: dslLine(f)};
  if (f.slot === "plan") {
    const it = f.purpose && scene.intentions[f.purpose];
    const objs = [...(it?.objects || []), ...(it?.parameters || []).filter(x => x.value_type === "entity").map(x => x.value)]
      .map(o => typeof o === "string" ? o : `${o.kind}:${o.index}`).filter((o, k, all) => all.indexOf(o) === k);
    const what = it?.verb ? `${it.verb}${objs.length ? ` ${objs.slice(0, 2).map(plainName).join(" from ")}` : ""}` : "its next move";
    const serves = servesText(it, scene);
    return {text: clip(`${head}${what}${serves ? ` → ${serves}` : ""}`, 80), sub: dslLine(f), warn: clash(objs.slice(0, 1))};
  }
  if (f.slot === "obs" || f.slot === "chk") return factWords(f);
  return {text: "", sub: dslLine(f)};
}

export function buildShots(scene, model) {
  const {factById} = scene;
  TITLES = new Map();
  for (const f of scene.facts) {
    if (f.rel !== "has" || f.args[1] !== "attribute:title" || !f.args[0].startsWith("product:") || TITLES.has(f.args[0])) continue;
    const words = String(f.args[2] || "").replace(/^value:/, "").split(/\s+/).slice(0, 3).join(" ");
    if (words) TITLES.set(f.args[0], `${words}…`);
  }
  const byId = new Map(model.clusters.map(c => [c.id, c]));
  const core = byId.get("core");
  const goalWords = [...new Set(scene.goals.flatMap(g => [...g.constraints.map(c => c.expected), plainName(g.target)]))]
    .filter(w => typeof w === "string" && w.length > 2).map(w => w.toLowerCase());
  const fact = fid => factById.get(fid);
  const w0 = scene.windows[0];
  const failed = scene.facts.filter(f => f.rel === "satisfied" && f.value === false && f.t > 0).sort((a, b) => a.t - b.t)[0] || null;
  const act = w0?.fids.map(fact).find(f => f?.slot === "act");
  const thing = act?.args.find(a => !a.startsWith("agent:") && core.groups.some(g => g.key === a && !g.other)) || null;

  const need = scene.goals.flatMap(g => g.constraints).find(c => c.property?.index === "object_type" && typeof c.expected === "string")?.expected || null;
  const seenTypes = new Set(scene.facts.filter(f => f.rel === "has" && f.args[1] === "attribute:object_type").map(f => String(f.args[2]).replace(/^value:/, "")));
  const ghost = need && !seenTypes.has(need) && !scene.entities.some(e => e.kind === need || e.index.replace(/_\d+$/, "") === need)
    ? {name: need, note: "the task asks for it · never seen in the run"} : null;
  const typeOf = key => { const f = scene.facts.find(x => x.rel === "has" && x.args[0] === key && x.args[1] === "attribute:object_type"); return f ? String(f.args[2]).replace(/^value:/, "") : null; };

  const out = new Map();
  const add = (i, beat) => { if (!out.has(i)) out.set(i, []); out.get(i).push({...beat, say: beat.say || beat.text}); };

  for (const [i, ev] of scene.events.entries()) {
    if (ev.error) continue;
    if (ev.name === "compile") {
      const at = w0?.step ?? 1;
      const pick = (thing && scene.facts.find(f => f.t === at && f.slot === "obs" && f.args[0] === thing && f.args[1] === "attribute:object_type"))
        || (thing && scene.facts.find(f => f.t >= at && f.slot === "obs" && f.args.includes(thing)))
        || scene.facts.find(f => f.t === at && f.slot === "obs") || scene.facts.find(f => f.slot === "obs");
      if (pick) {
        const who = {obs: "the world · observation", chk: "the world · check", mem: "the agent · memory", refl: "the agent · reflection", plan: "the agent · plan", act: "the agent · action"}[pick.slot];
        const label = {...factWords(pick, goalWords), card: [["step", pick.t], ["written by", who], ["relation", `${pick.rel}(${pick.args.map(plainName).join(", ")})`], ["value", valueText(pick.value)], ["original", `“${clip(pick.span, 70)}”`]]};
        add(i, {
          key: "anatomy", title: "One point is one fact",
          text: "Each point is one fact in four parts: the step, who wrote it, a relation about named things, and its value; the original sentence stays attached. Solid points are what the world showed, hollow ones what the agent wrote.",
          shot: {cloud: "core", open: null, labels: new Map([[pick.fid, label]]), names: new Map(), keep: null},
        });
      }
      const groups = core.groups.filter(g => !g.other);
      const named = [...new Set([groups.find(g => g.key.startsWith("agent:"))?.key, thing, ...groups.map(g => g.key)].filter(Boolean))].slice(0, 4);
      add(i, {
        key: "entities", title: "Facts gather around the things they mention",
        text: `Opened, the record splits by entity: each ring is one thing, with its facts on spokes around it. ${named.map(k => `${plainName(k)} (${groups.find(g => g.key === k).fids.length})`).join(", ")} are mentioned most.`,
        shot: {cloud: "core", open: "entities", labels: new Map(), names: new Map(named.map(k => [k, plainName(k)])), keep: null, ghost},
      });
      const thingStory = () => {
        const g = core.groups.find(x => x.key === thing), type = typeOf(thing), name = plainName(thing);
        const seenAt = [...new Set(g.fids.map(fact).filter(f => f.rel === "has" && f.args[1] === "attribute:object_type").map(f => f.t))];
        const acts = g.fids.map(fact).filter(f => f.slot === "act").slice(0, 2);
        return [
          need ? `The task needs a ${need}${ghost ? `, and no ${need} ever appears in the run` : ""}.` : "",
          type ? `The world calls ${name} a ${type}${seenAt.length ? ` every time it shows it (${seenAt.length > 4 ? `${seenAt.length} times` : stepList(seenAt)})` : ""}.` : "",
          acts.length ? `Yet the agent ${acts.map(f => `does “${clip(f.span || f.value, 50)}” at step ${f.t}`).join(" and ")}.` : "",
        ].filter(Boolean).join(" ");
      };
      if (thing) {
        const g = core.groups.find(x => x.key === thing);
        const from = w0?.step ?? 1, to = (failed?.t ?? scene.meta.steps) + 1, cells = new Map(), seen = new Set(), pick = [];
        for (const fid of g.fids) {
          const f = fact(fid);
          if (!["obs", "act", "chk"].includes(f.slot) || f.t < from || f.t > to) continue;
          const k = `${f.t}:${SLOT_ORDER.indexOf(f.slot)}`;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(f);
        }
        for (const fs of [...cells].sort(([a], [b]) => a.split(":")[0] - b.split(":")[0] || a.split(":")[1] - b.split(":")[1]).map(([, v]) => v)) {
          const f = fs.find(x => !seen.has(x.rel)) || (fs[0].slot === "act" ? fs[0] : null);
          if (!f) continue;
          seen.add(f.rel); pick.push(f.fid);
          if (pick.length >= MAX_LABELS) break;
        }
        add(i, {
          key: "story", title: `One thing's story: ${plainName(thing)}`,
          text: thingStory(),
          shot: {cloud: "core", open: thing, labels: labelsOf(pick, scene, goalWords), names: new Map([[thing, plainName(thing)]]), keep: null, ghost},
        });
      }
    } else if (ev.phase === "MAP" && failed) {
      const doing = scene.facts.filter(f => f.t === failed.t && f.slot === "act");
      add(i, {
        key: "mapfail", title: `The goal check fails at step ${failed.t}`,
        text: `At step ${failed.t} the agent ${doing[0] ? `does “${clip(doing[0].span || doing[0].value, 60)}”` : "acts"}, and the check says the goal is still not met. This is where the failure shows, not yet where it started.`,
        shot: {cloud: "core", open: null, labels: labelsOf([...doing.map(f => f.fid), failed.fid], scene, goalWords), names: new Map(), keep: null},
      });
    } else if (ev.name === "route_cases") {
      for (const id of ev.windows) {
        const w = scene.windows.find(x => x.id === id);
        const list = w.fids.map(fact).filter(Boolean).sort((a, b) => a.t - b.t || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
        const slots = [...new Set(list.map(f => SLOT_LABEL[f.slot] || f.slot))];
        add(i, {
          key: "clues", title: `Read the clues at step ${w.step}`,
          text: `The window holds ${list.length} clue fact${list.length === 1 ? "" : "s"}${slots.length > 1 ? `, the agent's ${slots.slice(0, -1).join(", ")} and ${slots[slots.length - 1]}` : ""}, in the order they were written. Read them top to bottom: this is what ROUTE suspects.`,
          shot: {cloud: id, open: "list", labels: new Map(list.slice(0, 8).map(f => [f.fid, windowWords(f, scene)])), names: new Map(), keep: null},
        });
      }
    } else if (ev.name === "submit" && scene.root) {
      const r = scene.root, rf = r.fid != null ? fact(r.fid) : null;
      const clueSteps = [...new Set(scene.windows.map(w => w.step))];
      const cited = new Set([r.step, ...[...String(r.reasoning).matchAll(/\bsteps?[- ](\d+)/gi)].map(m => +m[1]).filter(x => x >= 1 && x <= scene.meta.steps)]);
      const quotes = [r.quote, ...scene.windows.flatMap(w => w.fids.map(fact).filter(f => f && ["mem", "refl", "plan"].includes(f.slot)).map(f => keySentence(f, goalWords).replace(/^…|…$/g, "")))].filter(Boolean);
      const log = {focus: [...new Set([...clueSteps, r.step, ...(failed ? [failed.t] : [])])].sort((a, b) => a - b), root: r.step, rootSlot: rf?.slot || null,
                   clues: clueSteps, failed: failed?.t ?? null, cited: [...cited].sort((a, b) => a - b), quotes};
      const chain = buildChain(scene);
      if (chain) {
        const used = new Set();
        chain.nodes.forEach((n, k) => {
          const at = n.own.length ? n.own : [...new Set((n.from || []).flatMap(id => chain.byId.get(id)?.own || []))];
          const aim = n.verdict ? [...new Set([...chain.nodes.flatMap(x => x.own).filter(id => chain.facts.get(id)?.fids.includes(r.fid)), ...(n.explains || [])])] : at;
          const labels = new Map();
          for (const id of aim) {
            const f = chain.facts.get(id);
            f?.fids.forEach((fid, j) => labels.set(fid, j ? {text: "", sub: ""} : {text: `${f.label} · ${f.at}`, sub: factWords(fact(fid), goalWords).sub}));
          }
          aim.forEach(id => chain.facts.get(id)?.fids.forEach(fid => used.add(fid)));
          add(i, {
            key: "chain", title: n.title, text: `${n.because} So ${n.so[0].toLowerCase()}${n.so.slice(1)}`,
            log: {...log, scrollTo: chain.facts.get(aim[0])?.fids.map(fact).find(Boolean)?.t ?? r.step, folded: true},
            chain: {data: chain, at: k},
            shot: {cloud: "core", open: null, labels, names: new Map(), keep: new Set(used), aim: [...labels.keys()]},
            focus: [],
          });
        });
      }
      add(i, {
        key: "closed", title: "Case closed",
        text: `${need && typeOf(thing) ? `The task needed a ${need}; the agent took a ${typeOf(thing)}. ` : ""}The root cause is step ${r.step}'s ${r.module}${r.faultClass ? `, which ${faultText(r.faultClass)}` : ""}${r.rule?.id ? `, decided by a rule the manager fixed before the evidence came in` : ""}. Click any part of the verdict to see it in the log.`,
        log: {...log, scrollTo: r.step, card: true}, outro: true,
        focus: ["root"],
      });
    } else if (ev.name === "assess" && ev.lanes[0]) {
      const l = scene.lanes.find(x => x.id === ev.lanes[0]);
      const cands = scene.candidates.filter(c => ev.candidates.includes(c.id));
      const text = [...cands.map(c => `${c.proposition} ${c.argument}`), l.assessNote].join(" ");
      const cited = new Set([...text.matchAll(/\bsteps?[- ](\d+)/gi)].map(m => +m[1]).filter(s => s >= 1 && s <= scene.meta.steps));
      cands.forEach(c => cited.add(c.step));
      const keep = new Set(l.fids.filter(fid => cited.has(fact(fid)?.t)));
      if (!keep.size || keep.size === l.fids.length) continue;
      const blamed = cands.map(c => c.fid).filter(fid => fid != null && keep.has(fid));
      add(i, {
        key: "rests", title: `Of ${l.steps.length} steps read, the verdict rests on ${cited.size <= 4 ? stepList([...cited].sort((a, b) => a - b)) : `${cited.size} steps`}`,
        text: `The search brought back ${l.rows.length} log rows; everything outside the steps the verdict cites fades out. What is left is the evidence TRACE hands on.`,
        shot: {cloud: l.id, open: null, labels: labelsOf(blamed, scene, goalWords), names: new Map(), keep},
      });
    }
  }
  return out;
}
