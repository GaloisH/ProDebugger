// Hash router: #/ lists runs; #/case/<source>/<group>/<trajectory>/<tab> opens the workbench.
import {esc} from "./util.js";
import {parseRoute} from "./routes.js";
import {mountRuns} from "./pages/runs.js";
import {mountWorkbench} from "./pages/workbench.js";

const app = document.getElementById("app");
const crumbs = document.getElementById("crumbs");
let current = null;

function setCrumbs(route) {
  if (route.page !== "case") { crumbs.innerHTML = `<span class="current">Runs</span>`; return; }
  const [source, group, trajectory] = route.ref;
  crumbs.innerHTML = `<a href="#/">Runs</a><span class="sep">/</span><a href="#/?group=${encodeURIComponent(group)}">${source === "sessions" ? "session" : "run"} · ${esc(group)}</a><span class="sep">/</span><span class="current" title="${esc(trajectory)}">${esc(trajectory)}</span>`;
}

function render() {
  const route = parseRoute();
  setCrumbs(route);
  // Switching tabs inside the same case keeps the loaded store alive.
  const key = route.page === "case" ? route.ref.join("/") : "runs";
  if (current && current.key === key && current.update) { current.update(route); return; }
  current?.unmount?.();
  app.innerHTML = "";
  current = {key, ...(route.page === "case" ? mountWorkbench(app, route) : mountRuns(app, route))};
}

window.addEventListener("hashchange", render);
render();
