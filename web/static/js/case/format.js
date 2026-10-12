// Display helpers for DSL objects and debugger events.
import {entityId} from "./model.js";
import {esc, short} from "../util.js";

export function factText(f) {
  if (!f) return "";
  const args = (f.args || []).map(entityId).join(", ");
  const value = f.value === true || f.value == null ? "" : ` = ${typeof f.value === "string" ? short(f.value, 60) : JSON.stringify(f.value)}`;
  return `${f.rel}(${args})${value}`;
}

export const SIDE_CLASS = {env: "teal", mind: "info", task: "violet"};
export const EVAL_CLASS = {violated: "bad", unknown: "warn", satisfied: "ok", not_applicable: ""};

export function factChip(f, extra = "") {
  return `<button class="fact-chip side-${esc(f.side)}" data-fid="${f.fid}" title="${esc(f.span || "")}">
    <span class="mono fid">f${f.fid}</span><span class="fact-text">${esc(factText(f))}</span>${extra}</button>`;
}

const PATHS = {
  handoff: '<path d="M4 12h12M12 6l6 6-6 6"/><path d="M20 5v14"/>',
  model: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4H8M2 14h2M20 14h2M9 13v2M15 13v2"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  assessment: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  answer: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>',
  attempt: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  inflight: '<circle cx="12" cy="12" r="9" stroke-dasharray="4 3"/><path d="M12 7v5l3 2"/>',
  step: '<circle cx="12" cy="12" r="9"/><path d="M2 12h20M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  fact: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h5"/>',
};
export const icon = (name, cls = "icon") =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || PATHS.step}</svg>`;
