// Home page: a light, business-style overview with its own header. In-page links scroll
// instead of changing the hash, which belongs to the router.
import {caseHref} from "../routes.js";

// The showcase case: a fully correct reference run kept under artifacts/.
export const DEMO_REF = ["runs", "dsl-route-causal-timeline-high-unlimited-alf18-20261007-live", "GPT-4o_018_alfworld_task_018"];

const ARROW = '<svg class="h-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

// Decorative: a trajectory that fails at the end, traced back to the step that caused it.
function heroArt() {
  const n = 11, x0 = 36, dx = 42, y = 150, cause = 3, fail = n - 1;
  const nodes = Array.from({length: n}, (_, i) => {
    const cls = i === fail ? "is-fail" : i === cause ? "is-cause" : i > cause ? "is-after" : "";
    return `<circle class="ha-node ${cls}" cx="${x0 + i * dx}" cy="${y}" r="${i === cause || i === fail ? 9 : 6}"/>`;
  }).join("");
  const xc = x0 + cause * dx, xf = x0 + fail * dx;
  return `<svg class="hero-art" viewBox="0 0 520 240" role="img" aria-label="A failing trajectory traced back to its root cause">
    <line class="ha-line" x1="${x0}" y1="${y}" x2="${xf}" y2="${y}"/>
    <path class="ha-trace" d="M${xf} ${y - 14} C ${xf - 60} 40, ${xc + 60} 40, ${xc} ${y - 14}"/>
    ${nodes}
    <g class="ha-tag" transform="translate(${xc - 52} ${y + 26})"><rect width="104" height="28" rx="14"/><text x="52" y="18.5">Root cause</text></g>
    <g class="ha-tag is-fail" transform="translate(${xf - 44} ${y + 26})"><rect width="88" height="28" rx="14"/><text x="44" y="18.5">Failure</text></g>
    <text class="ha-note" x="${(xc + xf) / 2}" y="44">traced back with evidence</text>
  </svg>`;
}

export function mountHome(root) {
  root.innerHTML = `
    <div class="home">
      <header class="home-header">
        <a class="home-brand" href="#/" aria-label="ProDebugger home">
          <span class="home-mark" aria-hidden="true">[/]</span><span><strong>PRO</strong>DEBUGGER</span>
        </a>
        <nav class="home-nav" aria-label="Sections">
          <button type="button" data-scroll="capabilities">Capabilities</button>
          <button type="button" data-scroll="how">How it works</button>
          <button type="button" data-scroll="demo">Demo</button>
          <button type="button" data-scroll="use-cases">Use cases</button>
        </nav>
        <nav class="home-actions" aria-label="Pages">
          <a href="#/runs">Runs</a>
          <a href="#/chat">Chat</a>
          <a class="h-btn primary small" href="#/runs">Open workbench</a>
        </nav>
      </header>

      <section class="home-hero">
        <div class="hero-copy">
          <div class="h-eyebrow">Agent failure diagnosis</div>
          <h1 class="hero-title">Find why your agent <em>failed.</em></h1>
          <p class="hero-sub">ProDebugger traces every agent failure back to its root cause — with evidence you can verify.</p>
          <div class="hero-ctas">
            <a class="h-btn primary" href="#/chat">Try a live diagnosis ${ARROW}</a>
            <a class="h-btn" href="#/runs">Explore runs</a>
            <a class="h-btn ghost" href="${caseHref(DEMO_REF, "result")}">See a case ${ARROW}</a>
          </div>
        </div>
        <div class="hero-visual">${heroArt()}</div>
      </section>

      <footer class="home-footer">
        <span class="home-brand"><span class="home-mark" aria-hidden="true">[/]</span><span><strong>PRO</strong>DEBUGGER</span></span>
        <nav aria-label="Footer">
          <a href="#/runs">Runs</a><a href="#/chat">Chat</a><button type="button" data-scroll="how">How it works</button>
        </nav>
        <span class="home-note">Internal preview</span>
      </footer>
    </div>`;

  const onClick = event => {
    const target = event.target.closest("[data-scroll]");
    if (target) root.querySelector("#" + target.dataset.scroll)?.scrollIntoView({behavior: "smooth", block: "start"});
  };
  root.addEventListener("click", onClick);
  window.scrollTo(0, 0);
  return {unmount() { root.removeEventListener("click", onClick); }};
}
