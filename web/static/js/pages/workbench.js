// Case workbench (placeholder until the data layer lands).
import {esc} from "../util.js";

export function mountWorkbench(root, route) {
  root.innerHTML = `<p class="empty">Workbench for ${esc(route.ref.join(" / "))} is not available yet.</p>`;
  return {};
}
