// Hash router: #/ lists runs; #/case/<source>/<group>/<trajectory>/<tab> opens the workbench;
// #/chat[/<group>/<trajectory>] opens the chat page.
import {esc} from "./util.js";
import {parseRoute} from "./routes.js";
import {mountRuns} from "./pages/runs.js";
import {mountChat} from "./pages/chat.js";
import {mountWorkbench} from "./pages/workbench.js";

const app = document.getElementById("app");
const crumbs = document.getElementById("crumbs");
const nav = document.getElementById("site-nav");
let current = null;

function setCrumbs(route) {
  nav.querySelectorAll("a").forEach(a => a.setAttribute("aria-current", String(a.dataset.page === (route.page === "chat" ? "chat" : "runs"))));
  if (route.page === "chat") {
    crumbs.innerHTML = route.ref ? `<span class="sep">/</span><span class="current" title="${esc(route.ref[2])}">${esc(route.ref[2])}</span>` : "";
    return;
  }
  if (route.page !== "case") { crumbs.innerHTML = ""; return; }
  const [source, group, trajectory] = route.ref;
  crumbs.innerHTML = `<span class="sep">/</span><a href="#/?group=${encodeURIComponent(group)}">${source === "sessions" ? "session" : "run"} · ${esc(group)}</a><span class="sep">/</span><span class="current" title="${esc(trajectory)}">${esc(trajectory)}</span>`;
}

function render() {
  const route = parseRoute();
  setCrumbs(route);
  // Switching tabs inside the same case keeps the loaded store alive.
  // The chat page keeps its sidebar and composer while switching conversations.
  const key = route.page === "case" ? route.ref.join("/") : route.page;
  if (current && current.key === key && current.update) { current.update(route); return; }
  current?.unmount?.();
  app.innerHTML = "";
  const mount = {case: mountWorkbench, chat: mountChat, runs: mountRuns}[route.page];
  current = {key, ...mount(app, route)};
}

window.addEventListener("hashchange", render);
render();
