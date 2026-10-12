// Chat page: every debugger run reads as a conversation; new runs start from the composer.
import {getIndex, getJSON} from "../api.js";
import {CaseStore} from "../case/store.js";
import {buildMessages} from "../chat/messages.js";
import {createStream} from "../chat/stream.js";
import {chatHref, caseHref} from "../routes.js";
import {ago, debounce, esc, statusBadge} from "../util.js";
import {describeTrajectory, domainIcon} from "./runs.js";

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
    if (!state.index) { $("chat-list").innerHTML = `<p class="muted chat-list-note">Loading…</p>`; return; }
    const all = conversations();
    const mine = all.filter(t => t.chat), others = all.filter(t => !t.chat);
    const section = (title, list) => list.length ? `<div class="chat-list-section"><span class="eyebrow">${title}</span>${list.map(item).join("")}</div>` : "";
    $("chat-list").innerHTML = section("Started here", mine) + section("Debugger runs", others) ||
      `<p class="muted chat-list-note">No runs yet.</p>`;
  }

  function renderHead() {
    const ref = state.route.ref;
    if (!ref) {
      $("chat-head").innerHTML = `<div><div class="eyebrow">New conversation</div><h1 class="chat-title">Debug an agent trajectory</h1></div>`;
      return;
    }
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
      $("chat-stream").innerHTML = `<p class="muted chat-wait">${state.index ? "Waiting for this run to appear…" : "Loading…"}</p>`;
      return;
    }
    $("chat-stream").innerHTML = "";
    const store = new CaseStore(ref);
    conv = {key, ref, store, chat: null, chatSig: ""};
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
    stream.update(buildMessages(conv.store.model, {live, chat: conv.chat}), {caseRef: conv.ref, model: conv.store.model});
    // A finished run reads from the top; a live one follows the newest message.
    if (!conv.drawn) { conv.drawn = true; $("chat-scroll").scrollTo({top: live ? $("chat-scroll").scrollHeight : 0}); }
  }

  function renderWelcome() {
    $("chat-stream").innerHTML = `<div class="chat-welcome">
      <div class="eyebrow">ProDebugger chat</div>
      <h2>Pick a benchmark trajectory and watch the debugger work.</h2>
      <p class="lede">MAP reads the unmet requirements, ROUTE ranks issue anchors, TRACE judges each window against the raw text, and SUBMIT selects a root cause — every phase arrives here as a message. Any earlier run on the left can be read the same way.</p>
    </div>`;
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
  }

  function show(routeNow) {
    state.route = routeNow;
    renderList();
    renderHead();
    openConversation();
  }

  $("chat-filter").addEventListener("input", debounce(e => { state.filter = e.target.value.trim().toLowerCase(); renderList(); }));
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  show(route);
  refresh();
  return {
    update: show,
    unmount() { clearInterval(timer); conv?.store.stop(); root.classList.remove("app-chat"); },
  };
}
