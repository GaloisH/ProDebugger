// Thin client for web/server.py. Paths are built from validated route segments.
// On the static project site (web/export_static.py) every call goes to static-site.js.
import * as site from "./static-site.js";

export const STATIC = site.enabled;
const enc = parts => parts.map(encodeURIComponent).join("/");

async function request(url) {
  const response = await fetch(url, {cache: "no-store"});
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

export const getIndex = STATIC ? site.getIndex : async () => (await request("/api/index")).json();
export const listFiles = STATIC ? site.listFiles : async ref => (await request(`/api/files/${enc(ref)}`)).json();
export const getCatalog = STATIC ? site.getCatalog : async () => (await request("/api/catalog")).json();
export const getLaunch = STATIC ? site.getLaunch : async () => (await request("/api/launch")).json();
export const getReference = STATIC ? site.getReference : async tid => (await request(`/api/reference/${encodeURIComponent(tid)}`)).json();

// Launcher writes; errors carry the server's message.
async function post(url, body) {
  const response = await fetch(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || `${response.status} ${response.statusText}`);
  return value;
}
export const launchRun = STATIC ? site.launchRun : spec => post("/api/launch", spec);
export const stopRun = STATIC ? site.stopRun : () => post("/api/launch/stop", {});

async function serverJSON(ref, name, fallback) {
  try {
    return await (await request(`/api/file/${enc(ref)}/${name}`)).json();
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}
export const getJSON = STATIC ? site.getJSON : serverJSON;

// Follows an append-only JSONL file; each poll returns only rows added since the last one.
class ServerJsonlFollower {
  constructor(ref, name) { this.url = `/api/file/${enc(ref)}/${name}`; this.offset = 0; this.rows = []; }
  async poll() {
    let response;
    try { response = await request(`${this.url}?offset=${this.offset}`); }
    catch { return []; } // not created yet
    const size = Number(response.headers.get("X-File-Size"));
    if (size < this.offset) { this.offset = 0; this.rows = []; return this.poll(); } // truncated/rewritten
    const text = await response.text();
    this.offset = Number(response.headers.get("X-Next-Offset")) || this.offset;
    const added = text.split("\n").filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    this.rows.push(...added);
    return added;
  }
}
export const JsonlFollower = STATIC ? site.JsonlFollower : ServerJsonlFollower;
