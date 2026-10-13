// Home page: a light, business-style overview with its own header. In-page links scroll
// instead of changing the hash, which belongs to the router.
import {CaseStore} from "../case/store.js";
import {createCaseViews, TABS} from "../case/views.js";
import {caseHref} from "../routes.js";
import {esc} from "../util.js";

// The showcase case: a fully correct reference run kept under artifacts/.
export const DEMO_REF = ["runs", "dsl-route-causal-timeline-high-unlimited-alf18-20261007-live", "GPT-4o_018_alfworld_task_018"];

const icon = paths => `<svg class="h-icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ARROW = icon('<path d="M5 12h14M13 6l6 6-6 6"/>');

const PAINS = [
  ["Hundreds of steps to read", "A single run mixes observations, memory, plans and actions; the decisive moment is buried."],
  ["Symptoms show up late", "The failing step is rarely the faulty one. The real mistake happened several steps earlier."],
  ["Verdicts without evidence", "A model saying “step 7 was wrong” is hard to trust when you cannot check why."],
];

const CAPABILITIES = [
  ["Root cause, not symptoms", '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
   "Pinpoints the decisive step, the module that went wrong — memory, reflection, plan or action — and the fault type, not just where things broke."],
  ["Evidence you can verify", '<path d="M12 3 5 6v6c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
   "Every finding quotes the original trajectory and links to compiled facts. When the evidence is not enough, it answers “uncertain” instead of guessing."],
  ["Watch it think, live", '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
   "Follow each stage and every window review as the run writes it, or replay a finished diagnosis step by step."],
  ["See the structure", '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="8" cy="18" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.3 7 15.6 7M7 8.4l.7 7.1M10.4 17.8l5.1-.6M17.9 9.5l.1 5"/>',
   "Trajectories compile into fact, entity and goal graphs, shown side by side with the debugger's own decisions."],
];

const STAGES = [
  ["map", "MAP", "Map the goal", "Reads the task requirements into one authoritative goal map, so every later judgement uses the same yardstick.", "Goal map"],
  ["route", "ROUTE", "Route to suspects", "Scans the full action–feedback timeline with compiled facts and their provenance, and picks the few windows worth a closer look.", "Review windows"],
  ["trace", "TRACE", "Trace the evidence", "Reviews each window independently across memory, reflection, plan and action, quoting the exact source text for every candidate.", "Validated candidates"],
  ["submit", "SUBMIT", "Submit the verdict", "Compares all candidates against the full history and returns one root cause with step, module, fault type and fix — or abstains.", "Root cause or uncertain"],
];

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

// Read-only workbench views for DEMO_REF inside a dark app window. Tab changes and
// in-view links stay inside the window; "Open in workbench" carries the current view.
function mountDemo(section) {
  const body = section.querySelector(".demo-body");
  const open = section.querySelector(".demo-open");
  const store = new CaseStore(DEMO_REF);
  const views = createCaseViews(body, {store, ref: DEMO_REF, embedded: true, navigate: (tab, ...extra) => show({tab, extra})});
  let route = {tab: "trajectory", extra: []};

  function show(next) {
    route = next;
    const tab = views.tabFor(next.tab).id;
    section.querySelectorAll("[data-demo-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.demoTab === tab)));
    open.href = caseHref(DEMO_REF, tab, ...next.extra);
    return views.show(next);
  }

  function unavailable(message) {
    store.stop();
    body.innerHTML = `<div class="demo-status"><strong>The demo case is not available here.</strong>
      <span>It reads <code>artifacts/dsl_debugger/${esc(DEMO_REF[1])}/${esc(DEMO_REF[2])}</code>${message ? ` (${esc(message)})` : ""}.</span></div>`;
  }

  store.on("change", ({changed, first}) => {
    if (first && store.error) { unavailable(store.error); return; }
    const model = store.model;
    section.querySelector(".demo-caption").textContent = [model.task && `“${model.task}”`, model.taskType].filter(Boolean).join(" · ");
    views.update(model, {changed, first});
    if (first) { body.querySelector(".demo-status")?.remove(); show(route); }
  });
  store.start().catch(error => unavailable(error.message));
  section.querySelector(".demo-tabs").addEventListener("click", event => {
    const b = event.target.closest("[data-demo-tab]");
    if (b) show({tab: b.dataset.demoTab, extra: []});
  });
  return {destroy() { store.stop(); views.destroy(); }};
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

      <section class="home-section" id="capabilities">
        <div class="section-head">
          <div class="h-eyebrow">The problem</div>
          <h2 class="section-title">Agent failures surface far from their cause.</h2>
          <p class="section-lede">When an agent fails at the last step, the decision that doomed it usually happened much earlier. Finding it by hand is slow, and an unexplained verdict is hard to act on.</p>
        </div>
        <div class="pain-row">
          ${PAINS.map(([title, text]) => `<div class="pain"><h3>${title}</h3><p>${text}</p></div>`).join("")}
        </div>
        <h3 class="solution-title"><span class="h-eyebrow">The solution</span>ProDebugger turns a failed run into a verified diagnosis.</h3>
        <div class="cap-grid">
          ${CAPABILITIES.map(([title, paths, text]) => `<article class="cap-card">
            <span class="cap-icon">${icon(paths)}</span><h3>${title}</h3><p>${text}</p></article>`).join("")}
        </div>
      </section>

      <section class="home-section alt" id="how">
        <div class="section-head">
          <div class="h-eyebrow">How it works</div>
          <h2 class="section-title">Four stages, one verified verdict.</h2>
          <p class="section-lede">Each stage runs in its own isolated model context and hands a structured result to the next, so every conclusion can be traced back to the source.</p>
        </div>
        <ol class="stage-row">
          ${STAGES.map(([id, name, title, text, output], i) => `<li class="stage stage-${id}">
            <div class="stage-top"><span class="stage-num">0${i + 1}</span><span class="stage-name">${name}</span></div>
            <h3>${title}</h3><p>${text}</p>
            <div class="stage-out"><span>Output</span>${output}</div></li>`).join("")}
        </ol>
        <div class="how-more">
          <button type="button" class="h-btn" data-open-diagram>${icon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}View the technical diagram</button>
        </div>
      </section>

      <section class="home-section" id="demo">
        <div class="section-head">
          <div class="h-eyebrow">Product</div>
          <h2 class="section-title">See it on a real case.</h2>
          <p class="section-lede">A household agent failed its task. Explore the diagnosis the way an engineer would: the trajectory beside the debugger's decisions, the compiled facts, and the final verdict.</p>
        </div>
        <div class="demo-window">
          <div class="demo-bar">
            <span class="demo-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <div class="demo-tabs" role="tablist" aria-label="Demo views">
              ${TABS.map(t => `<button type="button" role="tab" data-demo-tab="${t.id}" aria-selected="${t.id === "trajectory"}">${t.label}</button>`).join("")}
            </div>
            <span class="demo-caption"></span>
            <a class="demo-open" href="${caseHref(DEMO_REF)}">Open in workbench ${ARROW}</a>
          </div>
          <div class="demo-body"><p class="demo-status">Loading the case…</p></div>
        </div>
      </section>

      <footer class="home-footer">
        <span class="home-brand"><span class="home-mark" aria-hidden="true">[/]</span><span><strong>PRO</strong>DEBUGGER</span></span>
        <nav aria-label="Footer">
          <a href="#/runs">Runs</a><a href="#/chat">Chat</a><button type="button" data-scroll="how">How it works</button>
        </nav>
        <span class="home-note">Internal preview</span>
      </footer>

      <dialog class="diagram-dialog" aria-label="Technical diagram">
        <div class="diagram-bar"><strong>MAP → ROUTE → TRACE → SUBMIT · technical diagram</strong>
          <button type="button" class="h-btn small" data-close-diagram>Close</button></div>
        <img src="./img/methodology.png" alt="Pipeline from raw trajectory and canonical DSL compilation through MAP, ROUTE, TRACE and SUBMIT, with validation loops and post-run evaluation" decoding="async">
      </dialog>
    </div>`;

  const dialog = root.querySelector(".diagram-dialog");
  const onClick = event => {
    const target = event.target.closest("[data-scroll]");
    if (target) root.querySelector("#" + target.dataset.scroll)?.scrollIntoView({behavior: "smooth", block: "start"});
    if (event.target.closest("[data-open-diagram]")) dialog.showModal();
    // A click on the backdrop lands on the dialog element itself.
    if (event.target.closest("[data-close-diagram]") || event.target === dialog) dialog.close();
  };
  root.addEventListener("click", onClick);
  // The demo loads a whole case, so it starts only when its section comes near.
  let demo = null;
  const demoSection = root.querySelector("#demo");
  const nearDemo = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    nearDemo.disconnect();
    demo = mountDemo(demoSection);
  }, {rootMargin: "600px 0px"});
  nearDemo.observe(demoSection);

  window.scrollTo(0, 0);
  return {unmount() { root.removeEventListener("click", onClick); nearDemo.disconnect(); demo?.destroy(); }};
}
