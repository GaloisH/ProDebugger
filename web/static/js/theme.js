// Light/dark theme for every page except home, which keeps its own palette. The choice is
// "system", "light" or "dark", stored in localStorage; "system" follows prefers-color-scheme.
const KEY = "pd-theme";
const ORDER = ["system", "light", "dark"];
const LABEL = {system: "System", light: "Light", dark: "Dark"};
const ICON = {
  system: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
};
const prefersLight = matchMedia("(prefers-color-scheme: light)");
let onHome = false;
let forced = null; // a page that only has one palette (the query graph is dark only)

const choice = () => ORDER.includes(localStorage.getItem(KEY)) ? localStorage.getItem(KEY) : "system";
const resolved = () => { if (forced) return forced; const c = choice(); return c === "system" ? (prefersLight.matches ? "light" : "dark") : c; };

function apply() {
  const root = document.documentElement;
  if (onHome) root.removeAttribute("data-theme");
  else root.dataset.theme = resolved();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", !onHome && resolved() === "light" ? "#fbfaf7" : "#0c1015");
  const button = document.getElementById("theme-toggle");
  if (!button) return;
  const c = choice(), next = ORDER[(ORDER.indexOf(c) + 1) % ORDER.length];
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[c]}</svg>`;
  button.title = `Theme: ${LABEL[c]} (click for ${LABEL[next]})`;
  button.setAttribute("aria-label", button.title);
}

export function setThemePage(home, force = null) { onHome = home; forced = force; apply(); }

export function initTheme() {
  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    localStorage.setItem(KEY, ORDER[(ORDER.indexOf(choice()) + 1) % ORDER.length]);
    apply();
  });
  prefersLight.addEventListener("change", apply);
  apply();
}
