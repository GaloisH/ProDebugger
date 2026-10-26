// First-visit guide for the Query Graph: a few cards, each pinned beside the control it names
// (or centred on the stage), shown once per browser; the header's Guide button replays them.
import {esc} from "../util.js";

const KEY = "qg-coach-v1";

export const coachSeen = () => { try { return localStorage.getItem(KEY) === "done"; } catch { return true; } };

// steps: [{title, text, target?: () => Element|null, before?: () => void, side?: "right"}]; a step whose target
// is missing or hidden (a narrow window folds the legend away) is skipped.
export function runCoach(root, steps, onEnd) {
  const card = document.createElement("div");
  card.className = "qg-coach";
  card.setAttribute("role", "dialog");
  root.append(card);
  let k = -1, lit = null;

  const visible = el => el && el.getClientRects().length > 0;
  const end = () => {
    lit?.classList.remove("qg-coach-target");
    card.remove();
    window.removeEventListener("resize", place);
    try { localStorage.setItem(KEY, "done"); } catch { /* private mode: show again next time */ }
    onEnd?.();
  };
  function place() {
    const box = root.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
    if (!lit) {
      card.style.left = `${(box.width - w) / 2}px`;
      card.style.top = `${Math.max(16, box.height * 0.3 - h / 2)}px`;
      card.dataset.side = "";
      return;
    }
    const r = lit.getBoundingClientRect();
    const x = r.left - box.left, y = r.top - box.top;
    // Beside the target when the step asks (or it is a tall panel) and there is room; else below, else above.
    let left = x + r.width / 2 - w / 2, top = y + r.height + 14, side = "below";
    // Beside a control inside a side panel means beside the panel (and its fold handle).
    const pane = lit.closest("aside")?.getBoundingClientRect() || r;
    const right = Math.max(r.right, pane.right + 28) - box.left;
    if (right + 14 + w < box.width - 8 && (steps[k].side === "right" || r.height > box.height * 0.4)) { left = right + 14; top = y; side = "right"; }
    else if (top + h > box.height - 8) { top = y - h - 14; side = "above"; }
    card.style.left = `${Math.max(8, Math.min(box.width - w - 8, left))}px`;
    card.style.top = `${Math.max(8, top)}px`;
    card.dataset.side = side;
  }
  function show(next) {
    lit?.classList.remove("qg-coach-target");
    lit = null;
    k = next;
    while (k < steps.length) {
      steps[k].before?.();
      const el = steps[k].target?.();
      if (!steps[k].target || visible(el)) { lit = el || null; break; }
      k++;
    }
    if (k >= steps.length) { end(); return; }
    const s = steps[k], last = k === steps.length - 1;
    lit?.classList.add("qg-coach-target");
    card.innerHTML = `<p class="qg-coach-n">${k + 1} / ${steps.length}</p><h3>${esc(s.title)}</h3><p>${s.text}</p>
      <div class="qg-coach-bar"><button data-coach="skip">${last ? "Close" : "Skip"}</button><button data-coach="next" class="qg-coach-go">${last ? "Got it" : "Next ›"}</button></div>`;
    place();
    card.querySelector(".qg-coach-go").focus({preventScroll: true});
  }
  card.addEventListener("click", e => {
    const b = e.target.closest("[data-coach]")?.dataset.coach;
    if (b === "skip") end();
    else if (b === "next") show(k + 1);
  });
  // Keys pressed on the card stay with it (space on a button must not also toggle playback).
  card.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") end(); });
  window.addEventListener("resize", place);
  show(0);
  return {end};
}
