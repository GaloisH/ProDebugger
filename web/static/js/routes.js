// Route parsing shared by the router and views.
export function parseRoute(hash = location.hash) {
  const [path, search = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const query = new URLSearchParams(search);
  if (parts[0] === "case" && parts.length >= 4) {
    return {page: "case", ref: parts.slice(1, 4), tab: parts[4] || "trajectory", extra: parts.slice(5), query};
  }
  return {page: "runs", query};
}

export const caseHref = (ref, tab = "trajectory", ...extra) =>
  "#/" + ["case", ...ref, tab, ...extra].map(s => encodeURIComponent(String(s))).join("/");
