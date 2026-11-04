import {esc} from "../util.js?v=27bf1baa85";

const W = 464, FX = 4, FW = 152, NX = 196, NW = 152, VX = 382, VW = 80, FH = 34, NH = 38, VH = 64, GAP = 7, TOP = 6, LANE = 18;

export function mountChain(root, {onPick} = {}) {
  root.insertAdjacentHTML("beforeend", `<section class="qg-chain" aria-label="How the verdict follows" hidden>
      <header><span>How the verdict follows</span><em></em></header>
      <div class="ch-cols"><span>From the log</span><span>So…</span><span>Verdict</span></div>
      <svg xmlns="http://www.w3.org/2000/svg"></svg></section>`);
  const el = root.querySelector(".qg-chain"), svg = el.querySelector("svg"), count = el.querySelector("header em");
  let laid = null, prev = -1;

  function layout(chain) {
    const facts = [...chain.facts.values()], steps = chain.nodes.filter(n => !n.verdict);
    const body = TOP * 2 + facts.length * (FH + GAP);
    const H = body + LANE;
    const spread = (list, h) => new Map(list.map((x, k) => [x.id, TOP + k * (body - TOP * 2 - h) / Math.max(1, list.length - 1)]));
    const fy = spread(facts, FH), ny = spread(steps, NH);
    ny.set("verdict", (body - VH) / 2);
    return {chain, facts, H, fy, ny};
  }

  const fact = (f, cls) => `<g class="cf${cls}" data-src="${f.src}" transform="translate(${FX} ${laid.fy.get(f.id)})"><rect width="${FW}" height="${FH}" rx="3"/>
      <text x="8" y="14">${esc(f.label)}</text><text class="cs" x="8" y="27">${esc(f.at || "")}</text></g>`;

  function render(at) {
    const {chain, facts, H, fy, ny} = laid;
    const fresh = at > prev ? new Set(chain.nodes.slice(prev + 1, at + 1).map(n => n.id)) : new Set();
    const shown = new Set(chain.nodes.slice(0, at + 1).map(n => n.id));
    const cur = chain.nodes[at];
    const lit = new Set(chain.nodes.slice(0, at + 1).flatMap(n => [...n.own, ...(n.verdict ? n.explains || [] : [])]));
    const now = new Set([...cur.own, ...(cur.verdict ? cur.explains || [] : [])]);
    const rank = new Map(chain.nodes.map((n, k) => [n.id, k]));
    const box = id => id === "verdict" ? {x: VX, y: ny.get(id), w: VW, h: VH} : {x: NX, y: ny.get(id), w: NW, h: NH};
    const edges = [];
    const edge = (d, n, extra = "") => edges.push(`<path class="ce${n === cur ? " is-hot" : ""}${fresh.has(n.id) ? " is-new" : ""}${extra}" pathLength="1" d="${d}" marker-end="url(#ch-${extra ? "b" : "a"})"/>`);
    for (const n of chain.nodes) {
      if (!shown.has(n.id)) continue;
      const b = box(n.id), ty = b.y + b.h / 2;
      for (const src of n.from || []) {
        if (chain.facts.has(src)) {
          const sy = fy.get(src) + FH / 2;
          if (n.verdict) edge(`M${FX + FW} ${sy} C${FX + FW + 120} ${sy} ${VX - 60} ${ty} ${VX - 3} ${ty}`, n);
          else edge(`M${FX + FW} ${sy} C${FX + FW + 22} ${sy} ${NX - 22} ${ty} ${NX - 3} ${ty}`, n);
        } else if (shown.has(src)) {
          const sy = ny.get(src) + NH / 2;
          if (n.verdict) edge(`M${NX + NW} ${sy} C${NX + NW + 16} ${sy} ${VX - 16} ${ty} ${VX - 3} ${ty}`, n);
          else {
            const off = 9 + 5 * Math.abs(rank.get(n.id) - rank.get(src));
            edge(`M${NX + NW} ${sy} C${NX + NW + off} ${sy} ${NX + NW + off} ${ty} ${NX + NW + 3} ${ty}`, n);
          }
        }
      }
      if (n.verdict) for (const f of n.explains || []) {
        const sy = fy.get(f) + FH / 2, lane = H - LANE / 2;
        edge(`M${VX + VW / 2} ${b.y + b.h} L${VX + VW / 2} ${lane} L${FX + FW + 14} ${lane} Q${FX + FW + 6} ${lane} ${FX + FW + 6} ${sy + 8} L${FX + FW + 3} ${sy}`, n, " is-back");
      }
    }
    const node = (n, k) => {
      const b = box(n.id), on = shown.has(n.id);
      const cls = `cn${on ? " is-on" : ""}${n === cur ? " is-now" : ""}${n.verdict ? " is-verdict" : ""}${fresh.has(n.id) ? " is-new" : ""}`;
      const title = !on ? "" : n.verdict ? wrap(n.title, 12).map((l, j) => `<text x="8" y="${18 + j * 15}">${esc(l)}</text>`).join("") : `<text x="9" y="16">${esc(n.title)}</text>`;
      return `<g class="${cls}" data-k="${k}" transform="translate(${b.x} ${b.y})"><rect width="${b.w}" height="${b.h}" rx="3"/>${title}
        <text class="cs" x="${n.verdict ? 8 : 9}" y="${n.verdict ? b.h - 8 : 30}">${on && !n.verdict ? esc(cut(n.sub || "", 25)) : ""}</text></g>`;
    };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `<defs>
        <marker id="ch-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="cm"/></marker>
        <marker id="ch-b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="cm is-back"/></marker></defs>
      ${edges.join("")}${facts.map(f => fact(f, `${lit.has(f.id) ? " is-on" : ""}${now.has(f.id) ? " is-now" : ""}`)).join("")}${chain.nodes.map(node).join("")}`;
    count.textContent = `${at + 1} / ${chain.nodes.length}`;
    prev = at;
  }

  svg.addEventListener("click", e => {
    const g = e.target.closest(".cn[data-k]");
    if (g && onPick) onPick(Number(g.dataset.k));
  });

  return {
    show(chain, at) {
      if (laid?.chain !== chain) { laid = layout(chain); prev = -1; }
      render(at);
      el.hidden = false;
      root.classList.add("has-chain");
    },
    hide() {
      if (el.hidden) return;
      el.hidden = true;
      root.classList.remove("has-chain");
      prev = -1;
    },
  };
}

function wrap(t, n) {
  const out = [];
  for (const w of String(t).split(" ")) {
    if (out.length && (out[out.length - 1] + " " + w).length <= n) out[out.length - 1] += " " + w;
    else out.push(w);
  }
  return out.slice(0, 3);
}
const cut = (t, n) => t.length > n ? t.slice(0, n - 1) + "…" : t;
