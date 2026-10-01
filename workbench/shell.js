"use strict";

(() => {
  const mount = document.getElementById("workbench-header");
  if (!mount) return;
  const view = document.body.dataset.view || "evidence";
  const integrated = view === "evidence" ||
    (location.protocol !== "file:" && location.pathname.startsWith("/experiments/"));
  mount.innerHTML = `<header class="wb-topbar">
    <div class="wb-brand"><span class="wb-brand-mark">P·</span><span>PRODEBUGGER<small>证据与实验工作台</small></span></div>
    <nav class="wb-nav" aria-label="工作台视图">
      <a id="nav-evidence" ${view === "evidence" ? 'aria-current="page"' : ""}>证据浏览</a>
      <a id="nav-experiments" ${view === "experiments" ? 'aria-current="page"' : ""}>实验 Debug</a>
    </nav>
    <span class="wb-local"><span class="wb-live-dot"></span>${integrated ? "本地只读" : "离线只读"}</span>
  </header><p class="wb-context-note" id="workbench-note" hidden></p>`;

  const evidence = document.getElementById("nav-evidence");
  const experiments = document.getElementById("nav-experiments");
  const note = document.getElementById("workbench-note");
  function setContext({ trace = null, run = null, domain = null } = {}) {
    const params = new URLSearchParams();
    if (trace) params.set("trace", trace);
    if (run) params.set("run", run);
    const suffix = params.size ? `?${params}` : "";
    experiments.href = integrated ? `/experiments/${suffix}` : `index.html${suffix}`;
    const supported = !domain || ["webshop", "alfworld"].includes(domain);
    evidence.removeAttribute("aria-disabled");
    evidence.removeAttribute("title");
    evidence.href = `/${suffix}`;
    note.hidden = true;
    if (!integrated || !supported) {
      evidence.removeAttribute("href");
      evidence.setAttribute("aria-disabled", "true");
      evidence.title = !integrated ? "请从本地工作台服务进入以查看证据" : "该领域暂不支持证据浏览";
      note.textContent = !integrated
        ? "正在浏览离线实验页面。证据浏览需要本地服务，请启动工作台并从其「实验 Debug」入口进入。"
        : "该案例的领域暂不支持证据浏览；实验记录和对照功能仍可完整查看。";
      note.hidden = false;
    }
  }
  window.WorkbenchShell = { setContext };
  const params = new URLSearchParams(location.search);
  setContext({ trace: params.get("trace"), run: params.get("run") });
})();
