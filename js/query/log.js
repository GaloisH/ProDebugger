import {esc} from "../util.js?v=27bf1baa85";
import {SLOT_LABEL} from "./model.js?v=signs-82";
import {faultText} from "./narrate.js?v=23f9bfd6b4";

const SLOT_ORDER = ["obs", "mem", "refl", "plan", "act", "chk"];
const SOURCE = {obs: "world", mem: "agent", refl: "agent", plan: "agent", act: "agent", chk: "check"};

function cellText(facts) {
  const spans = [...new Set(facts.map(f => f.span).filter(Boolean))];
  const lines = spans.join("\n").split("\n").map(x => x.trim()).filter(Boolean);
  const body = lines.length > 1 && !lines[0].startsWith("-") && lines.slice(1).some(x => x.startsWith("-")) ? lines.slice(1) : lines;
  return body.map(x => x.replace(/^-\s*/, "")).join(" · ");
}
const norm = t => String(t || "").replace(/\s+/g, " ").trim();

export function mountLog(root, scene, stage) {
  const steps = scene.meta.steps;
  const cell = (t, slot) => scene.facts.filter(f => f.t === t && f.slot === slot);
  const rows = [];
  for (let t = 0; t <= steps; t++) {
    const mods = SLOT_ORDER.map(slot => [slot, cell(t, slot)]).filter(([slot, fs]) => fs.length && slot !== "chk" || fs.some(f => f.rel === "satisfied"));
    if (!mods.length) continue;
    rows.push(`<li class="lg-step is-fold" data-step="${t}">
      <button class="lg-head" type="button" data-lg-toggle="${t}"><b>${t ? `Step ${t}` : "Task"}</b><span class="lg-tags"></span><em>${esc(norm(cell(t, "act")[0]?.span || "").replace(/^'(.*)'$/, "$1"))}</em></button>
      ${mods.map(([slot, fs]) => {
        const text = slot === "chk" ? fs.filter(f => f.rel === "satisfied").map(f => `goal check: ${f.value === true ? "met" : f.value === false ? "not met" : "open"}`).join(" · ") : cellText(fs);
        return `<div class="lg-mod" data-slot="${slot}" data-src="${SOURCE[slot]}" data-fids="${fs.map(f => f.fid).join(",")}"><span>${SLOT_LABEL[slot] || slot}</span><p data-raw="${esc(text)}">${esc(text)}</p></div>`;
      }).join("")}
    </li>`);
  }
  root.insertAdjacentHTML("beforeend", `
    <aside class="qg-log" aria-label="Original log" hidden>
      <header><button class="lg-fold" type="button" aria-expanded="false" title="Show or fold the original log"><span class="lg-kicker">Original log</span><i aria-hidden="true">▸</i></button><h3>${esc(scene.meta.task || "")}</h3><button class="lg-close" type="button" title="Close" aria-label="Close">×</button></header>
      <div class="lg-card" hidden></div>
      <ol class="lg-steps">${rows.join("")}</ol>
    </aside>`);
  const panel = root.querySelector(".qg-log"), list = panel.querySelector(".lg-steps"), card = panel.querySelector(".lg-card");
  const focusColor = getComputedStyle(root).getPropertyValue("--qg-focus").trim() || "#e0b867";
  let current = null;

  function highlight(p, quotes) {
    let html = esc(p.dataset.raw), hit = false;
    for (const q of quotes) {
      const want = norm(q).replace(/[“”"]/g, "");
      for (let n = want.length; n >= 24; n = Math.floor(n * 0.75)) {
        const part = esc(want.slice(0, n).replace(/\s+\S*$/, ""));
        if (part.length >= 20 && html.includes(part)) { html = html.replace(part, `<mark>${part}</mark>`); hit = true; break; }
      }
    }
    p.innerHTML = html;
    return hit;
  }

  function tags(li, list) { li.querySelector(".lg-tags").innerHTML = list.map(([cls, t]) => `<i class="lg-tag ${cls}">${t}</i>`).join(""); }

  function renderCard(log) {
    const r = scene.root;
    if (!log.card || !r) { card.hidden = true; return; }
    const rule = r.rule?.id ? scene.rules.find(x => x.id === r.rule.id) : null;
    const step = (s, t) => `<button type="button" data-lg-goto="${s}">${t || `step ${s}`}</button>`;
    card.innerHTML = `<h4>Verdict</h4><dl>
      <div><dt>Root cause</dt><dd>${step(r.step, `step ${r.step} · ${esc(r.module)}`)}</dd></div>
      ${r.faultClass ? `<div><dt>What went wrong</dt><dd>${esc(faultText(r.faultClass))}: ${esc(r.proposition)}</dd></div>` : ""}
      <div><dt>Evidence</dt><dd>${log.cited.map(s => step(s)).join(" ")}</dd></div>
      ${log.clues.length ? `<div><dt>First suspected at</dt><dd>${log.clues.map(s => step(s)).join(" ")}</dd></div>` : ""}
      ${log.failed != null ? `<div><dt>Failure shows at</dt><dd>${step(log.failed, `step ${log.failed} · goal check not met`)}</dd></div>` : ""}
      ${rule ? `<div><dt>Decided by</dt><dd title="${esc(rule.conclusion)}">the rule “${esc(rule.id.replace(/_/g, " "))}”, fixed before the evidence came in</dd></div>` : ""}
    </dl>`;
    card.hidden = false;
  }

  function goTo(s, flash = true) {
    const li = list.querySelector(`.lg-step[data-step="${s}"]`);
    if (!li) return;
    li.classList.remove("is-fold");
    const top = Math.max(0, list.scrollTop + li.getBoundingClientRect().top - list.getBoundingClientRect().top - (list.clientHeight - Math.min(li.offsetHeight, list.clientHeight)) / 2);
    list.scrollTo({top, behavior: "smooth"});
    setTimeout(() => { if (Math.abs(list.scrollTop - top) > 4 && list.scrollHeight - list.clientHeight > top - 4) list.scrollTop = top; }, 700);
    if (flash) { li.classList.remove("is-flash"); void li.offsetWidth; li.classList.add("is-flash"); }
    const fids = [...li.querySelectorAll(".lg-mod")].flatMap(m => m.dataset.fids.split(",").map(Number));
    stage.markFacts([{fids, color: focusColor, label: null}]);
  }

  panel.addEventListener("click", e => {
    const t = e.target.closest("[data-lg-toggle]");
    if (t) t.closest(".lg-step").classList.toggle("is-fold");
    const g = e.target.closest("[data-lg-goto]");
    if (g) goTo(Number(g.dataset.lgGoto));
    if (e.target.closest(".lg-close")) api.hide();
    if (e.target.closest(".lg-fold")) fold(!panel.classList.contains("lg-folded"));
  });
  panel.addEventListener("mouseover", e => {
    const m = e.target.closest(".lg-mod");
    if (m) stage.markFacts([{fids: m.dataset.fids.split(",").map(Number), color: focusColor, label: null}]);
  });
  panel.addEventListener("mouseleave", () => api.idle ? api.idle() : stage.markFacts([]));

  function fold(on) {
    panel.classList.toggle("lg-folded", on);
    const b = panel.querySelector(".lg-fold");
    b.setAttribute("aria-expanded", String(!on));
    b.querySelector("i").textContent = on ? "▸" : "▾";
    if (!on && current) requestAnimationFrame(() => goTo(current.scrollTo, false));
    if (on) api.idle ? api.idle() : stage.markFacts([]);
  }

  const api = {
    idle: null,
    goTo,
    get open() { return !panel.hidden; },
    show(log) {
      if (panel.hidden) fold(true);
      panel.hidden = false;
      root.classList.add("has-log");
      if (current !== log) {
        current = log;
        list.querySelectorAll(".lg-step").forEach(li => {
          const s = Number(li.dataset.step);
          const marks = [];
          if (log.clues.includes(s)) marks.push(["is-clue", "suspect"]);
          if (s === log.root) marks.push(["is-root", "root cause"]);
          if (s === log.failed) marks.push(["is-fail", "goal not met"]);
          if (log.cited.includes(s) && s !== log.root) marks.push(["is-cited", "evidence"]);
          tags(li, marks);
          li.classList.toggle("is-marked", marks.length > 0);
          li.classList.toggle("is-fold", !log.focus.includes(s));
          li.querySelectorAll(".lg-mod").forEach(m => {
            m.classList.toggle("is-root", s === log.root && m.dataset.slot === log.rootSlot);
            const p = m.querySelector("p");
            if (log.focus.includes(s) && ["mem", "refl", "plan"].includes(m.dataset.slot)) highlight(p, log.quotes);
            else p.textContent = p.dataset.raw;
          });
        });
      }
      renderCard(log);
      if (!panel.classList.contains("lg-folded")) requestAnimationFrame(() => goTo(log.scrollTo, false));
    },
    hide() {
      if (panel.hidden) return;
      panel.hidden = true;
      root.classList.remove("has-log");
      stage.markFacts([]);
      current = null;
    },
  };
  return api;
}
