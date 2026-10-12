// Placeholder view; replaced in a later layer.
import {esc} from "../util.js";

export function createView(root) {
  return {
    update(model) {
      root.innerHTML = `<p class="empty">trajectory view · ${esc(model.steps.length)} steps · ${esc(model.debugger?.events.length ?? 0)} debugger events · ${esc(model.dsl?.facts.length ?? 0)} facts</p>`;
    },
  };
}
