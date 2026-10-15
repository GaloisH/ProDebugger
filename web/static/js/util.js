// Small DOM and formatting helpers shared by every view.
export const esc = value => String(value ?? "").replace(/[&<>"']/g,
  c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);

export const short = (value, n = 140) => {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

export const pretty = value => typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
export const raw = value => `<pre class="raw">${esc(pretty(value))}</pre>`;
export const number = v => Number(v || 0).toLocaleString("en-US");

export function ago(seconds) {
  if (!seconds) return "—";
  const d = Math.max(0, Date.now() / 1000 - seconds);
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return new Date(seconds * 1000).toLocaleDateString("en-CA");
}

// Status vocabulary from result.json plus the server's running/incomplete/compiled.
const STATUS = {
  running: ["live", "Running"], incomplete: ["warn", "Incomplete"], compiled: ["teal", "Compiled"],
  accepted: ["ok", "Accepted"], diagnosed: ["ok", "Diagnosed"], uncertain: ["warn", "Uncertain"], dry_run: ["", "Dry run"],
  rejected: ["bad", "Rejected"], error: ["bad", "Error"], interrupted: ["bad", "Interrupted"],
  stopped: ["warn", "Stopped"], failed: ["bad", "Failed"],
};
export function statusBadge(status, accepted) {
  const [kind, label] = accepted ? STATUS.accepted : STATUS[status] || ["", status || "unknown"];
  const dot = kind === "live" ? '<span class="live-dot"></span>' : "";
  return `<span class="badge ${kind}">${dot}${esc(label)}</span>`;
}

// Shared loading indicator: the [/] brand mark drawing itself, shown only after a short delay
// so fast loads never flash it. inline=true gives a one-line variant for lists and side panels.
export const loader = (label = "Loading…", inline = false) =>
  `<div class="loader${inline ? " is-inline" : ""}" role="status"><svg class="loader-mark" viewBox="0 0 32 32" aria-hidden="true">
    <path class="loader-bracket" d="M12 8H7v16h5M20 8h5v16h-5" pathLength="1"/><path class="loader-slash" d="M18 11l-4 10" pathLength="1"/></svg>
    <span class="loader-label">${esc(label)}</span></div>`;

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Simple pub/sub used by stores.
export class Emitter {
  #handlers = new Map();
  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(fn);
    return () => this.#handlers.get(type).delete(fn);
  }
  emit(type, detail) { (this.#handlers.get(type) || []).forEach(fn => fn(detail)); }
}
