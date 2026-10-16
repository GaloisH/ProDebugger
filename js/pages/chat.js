// Chat page: every debugger run reads as a conversation; new runs start from the composer.
import {getIndex, getJSON, getReference} from "../api.js?v=50f8681a13";
import {CaseStore} from "../case/store.js?v=50f8681a13";
import {buildMessages} from "../chat/messages.js?v=50f8681a13";
import {createStream} from "../chat/stream.js?v=50f8681a13";
import {createComposer} from "../chat/composer.js?v=50f8681a13";
import {chatHref, caseHref} from "../routes.js?v=50f8681a13";
import {ago, debounce, esc, loader, statusBadge} from "../util.js?v=50f8681a13";
import {describeTrajectory, domainIcon} from "./runs.js?v=50f8681a13";

const POLL_MS = 3000;

export function mountChat(root, route) {
  const state = {route, index: null, error: null, filter: ""};
  root.classList.add("app-chat");
  root.innerHTML = `
    <div class="chat-layout">
      <aside class="chat-side" aria-label="Conversations">
        <div class="chat-side-head">
          <span class="eyebrow">Conversations</span>
          <a class="btn primary chat-new" href="${chatHref()}">+ New</a>
        </div>
        <input id="chat-filter" class="input" type="search" placeholder="Filter runs…" aria-label="Filter conversations">
        <div id="chat-list" class="chat-list"></div>
      </aside>
      <section class="chat-main">
        <header class="chat-head" id="chat-head"></header>
        <div class="chat-scroll" id="chat-scroll"><div class="chat-stream" id="chat-stream" aria-live="polite"></div></div>
        <div class="chat-composer" id="chat-composer"></div>
      </section>
    </div>`;
  const $ = id => root.querySelector("#" + id);
  const stream = createStream($("chat-stream"), $("chat-scroll"));
  let conv = null; // {key, ref, store, chat, chatSig}
  const composer = createComposer($("chat-composer"), {
    index: () => state.index,
    currentRef: () => state.route.ref,
    onLaunched(run) {
      location.hash = chatHref(run.run_id, run.trajectory_id);
      burst(12, ["runs", run.run_id, run.trajectory_id]); // the run directory appears within a second or two
    },
    onEnded: () => refresh(),
  });

  // Flattened run trajectories; chat-launched ones first, newest first.
  function conversations() {
    const items = (state.index?.groups || []).filter(g => g.source === "runs").flatMap(g =>
      g.trajectories.map(t => ({group: g.id, chat: g.chat, ...t})));
    const q = state.filter;
    return items.filter(t => !q || `${t.group} ${t.id}`.toLowerCase().includes(q))
      .sort((a, b) => (Boolean(b.chat) - Boolean(a.chat)) || b.mtime - a.mtime);
  }

  function item(t) {
    const d = describeTrajectory(t.id);
    const active = state.route.ref && state.route.ref[1] === t.group && state.route.ref[2] === t.id;
    const how = t.chat ? `<span class="badge teal">${t.chat.mode === "replay" ? "replay" : "live"}</span>` : "";
    return `<a class="chat-item ${active ? "is-active" : ""} ${t.live ? "is-live" : ""}" href="${chatHref(t.group, t.id)}" title="${esc(t.group)} / ${esc(t.id)}" ${active ? 'aria-current="true"' : ""}>
      <span class="chat-item-top">${domainIcon(d.domain)}<strong>${esc(d.model || t.id)}${d.index ? ` · ${esc(d.index)}` : ""}</strong>${statusBadge(t.status)}</span>
      <span class="chat-item-sub mono">${esc(t.group)}</span>
      <span class="chat-item-foot">${how}<span>${ago(t.mtime)}</span></span>
    </a>`;
  }

  function renderList() {
    if (state.error && !state.index) { $("chat-list").innerHTML = `<div class="error-box">${esc(state.error)}</div>`; return; }
    if (!state.index) { $("chat-list").innerHTML = loader("Loading…", true); return; }
    const all = conversations();
    const mine = all.filter(t => t.chat), others = all.filter(t => !t.chat);
    const section = (title, list) => list.length ? `<div class="chat-list-section"><span class="eyebrow">${title}</span>${list.map(item).join("")}</div>` : "";
    $("chat-list").innerHTML = section("Started here", mine) + section("Debugger runs", others) ||
      `<p class="muted chat-list-note">No runs yet.</p>`;
  }

  function renderHead() {
    const ref = state.route.ref;
    root.querySelector(".chat-main").classList.toggle("is-new", !ref); // new conversation: welcome + composer centered
    if (!ref) { $("chat-head").innerHTML = ""; return; }
    const t = conversations().find(x => x.group === ref[1] && x.id === ref[2]);
    $("chat-head").innerHTML = `<div class="chat-head-text"><div class="eyebrow">${esc(ref[1])}</div>
        <h1 class="chat-title mono">${esc(ref[2])}</h1></div>
      <div class="chat-head-tools">${t ? statusBadge(t.status) : ""}
        <a class="btn" href="${caseHref(ref)}">Open in workbench</a></div>`;
  }

  const groupOf = ref => state.index?.groups.find(g => g.source === "runs" && g.id === ref[1]);
  const known = ref => Boolean(groupOf(ref)?.trajectories.some(t => t.id === ref[2]));

  // One CaseStore per open conversation; it follows the run files while they are written.
  function openConversation() {
    const ref = state.route.ref;
    const key = ref ? ref.join("/") : "";
    if (conv?.key === key) return;
    conv?.store.stop();
    conv = null;
    stream.reset();
    if (!ref) { renderWelcome(); return; }
    if (!known(ref)) {
      const starting = composer.active()?.run_id === ref[1];
      $("chat-stream").innerHTML = `<p class="muted chat-wait">${starting ? `<span class="typing"><i></i><i></i><i></i></span> Starting the run…`
        : state.index ? "Waiting for this run to appear…" : "Loading…"}</p>`;
      return;
    }
    $("chat-stream").innerHTML = "";
    const store = new CaseStore(ref);
    conv = {key, ref, store, chat: null, chatSig: "", reference: undefined};
    store.on("change", draw);
    store.start().catch(error => { $("chat-stream").innerHTML = `<div class="error-box">Could not load this run: ${esc(error.message)}</div>`; });
    syncChat();
  }

  // chat.json carries how a chat-launched run ended (exit code, log tail).
  async function syncChat() {
    if (!conv) return;
    const marker = groupOf(conv.ref)?.chat;
    const sig = JSON.stringify(marker || null);
    if (sig === conv.chatSig) return;
    conv.chatSig = sig;
    const current = conv;
    const chat = marker ? await getJSON(conv.ref.slice(0, 2), "chat.json", null) : null;
    if (conv !== current) return;
    conv.chat = chat;
    draw();
  }

  function draw() {
    if (!conv?.store.model) return;
    const ended = ["failed", "stopped", "finished"].includes(conv.chat?.state);
    const live = conv.store.live && !ended;
    if (!live && conv.store.model.debugger?.result && conv.reference === undefined) loadReference(conv);
    stream.update(buildMessages(conv.store.model, {live, chat: conv.chat, reference: conv.reference}),
                  {caseRef: conv.ref, model: conv.store.model});
    // A finished run reads from the top; a live one follows the newest message.
    if (!conv.drawn) { conv.drawn = true; $("chat-scroll").scrollTo({top: live ? $("chat-scroll").scrollHeight : 0}); }
  }

  // Fetched once the run has a result; trajectories outside the catalog have none.
  async function loadReference(current) {
    current.reference = null;
    const tid = current.store.model.trajectoryId || current.ref[2];
    try { current.reference = await getReference(tid); } catch { return; }
    if (conv === current) draw();
  }

  function renderWelcome() {
    $("chat-stream").innerHTML = `<div class="chat-welcome">
      <div class="eyebrow">ProDebugger chat</div>
      <h2>Watch the debugger work.</h2>
    </div>`;
  }

  // Quick index polls right after a launch, then back to the normal pace.
  let burstTimer = null;
  function burst(times, ref) {
    clearTimeout(burstTimer);
    if (times <= 0 || known(ref)) return;
    burstTimer = setTimeout(() => refresh().then(() => burst(times - 1, ref)), 600);
  }

  let signature = "";
  async function refresh() {
    try {
      const index = await getIndex();
      state.error = null;
      const next = JSON.stringify(index.groups);
      if (next === signature) return;
      signature = next;
      state.index = index;
    } catch (error) { state.error = error.message; signature = ""; }
    renderList();
    renderHead();
    openConversation();
    syncChat();
    composer.update();
  }

  function show(routeNow) {
    state.route = routeNow;
    renderList();
    renderHead();
    openConversation();
    composer.update();
  }

  $("chat-filter").addEventListener("input", debounce(e => { state.filter = e.target.value.trim().toLowerCase(); renderList(); }));
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  const onVisible = () => { if (!document.hidden) refresh(); };
  document.addEventListener("visibilitychange", onVisible);
  show(route);
  refresh();
  return {
    update: show,
    unmount() { clearInterval(timer); clearTimeout(burstTimer); document.removeEventListener("visibilitychange", onVisible); conv?.store.stop(); composer.destroy(); root.classList.remove("app-chat"); },
  };
}
