// Route parsing shared by the router and views.
export function parseRoute(hash = location.hash) {
  const [path, search = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const query = new URLSearchParams(search);
  if (parts[0] === "chat") {
    return {page: "chat", ref: parts.length >= 3 ? ["runs", parts[1], parts[2]] : null, query};
  }
  if (parts[0] === "case" && parts.length >= 4) {
    return {page: "case", ref: parts.slice(1, 4), tab: parts[4] || "trajectory", extra: parts.slice(5), query};
  }
  if (parts[0] === "runs") return {page: "runs", query};
  return {page: "home", query};
}

export const runsHref = group => "#/runs" + (group ? "?group=" + encodeURIComponent(group) : "");

export const chatHref = (group, trajectory) =>
  "#/chat" + (group ? "/" + [group, trajectory].map(s => encodeURIComponent(String(s))).join("/") : "");

export const caseHref = (ref, tab = "trajectory", ...extra) =>
  "#/" + ["case", ...ref, tab, ...extra].map(s => encodeURIComponent(String(s))).join("/");
