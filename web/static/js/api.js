// Thin client for web/server.py. Paths are built from validated route segments.
const enc = parts => parts.map(encodeURIComponent).join("/");

async function request(url) {
  const response = await fetch(url, {cache: "no-store"});
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

export const getIndex = async () => (await request("/api/index")).json();
export const listFiles = async ref => (await request(`/api/files/${enc(ref)}`)).json();

export async function getJSON(ref, name, fallback) {
  try {
    return await (await request(`/api/file/${enc(ref)}/${name}`)).json();
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

// Follows an append-only JSONL file; each poll returns only rows added since the last one.
export class JsonlFollower {
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
