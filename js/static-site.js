// Stand-in for web/server.py and web/launcher.py on the static project site, which
// web/export_static.py writes with window.PD_STATIC set and a ./data/ tree:
//   data/index.json, data/catalog.json, data/reference/<trajectory>.json
//   data/runs/<group>/manifest.json
//   data/runs/<group>/<trajectory>/{files.json, replay.json, <run files>}
// "Launching" a run replays a recorded one in the browser: replay.json lists when each
// file appeared or grew (web/simulate_live.py order), and the clock decides how much of
// it a launched run shows. JSONL sizes and offsets count rows, not bytes.
export const enabled = Boolean(globalThis.PD_STATIC);

const DATA = "./data/";
const STORE_KEY = "pd-static-runs";
const LIVE_SECONDS = 180; // case/store.js treats files older than this as finished
const enc = parts => parts.map(encodeURIComponent).join("/");

const cache = new Map();
function cached(url, read) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then(response => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      return read(response);
    }).catch(error => { cache.delete(url); throw error; }));
  }
  return cache.get(url);
}
const json = url => cached(url, r => r.json());
const jsonRows = url => cached(url, async r => (await r.text()).split("\n").filter(Boolean).flatMap(line => {
  try { return [JSON.parse(line)]; } catch { return []; }
}));

// ---------- launched (replayed) runs, kept for the browser session ----------
let runs = (() => {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) || []; } catch { return []; }
})();
const save = () => sessionStorage.setItem(STORE_KEY, JSON.stringify(runs));
const launchedRun = group => runs.find(r => r.run_id === group);
const sourceFolder = run => DATA + "runs/" + enc(run.source) + "/";
const timeline = run => json(sourceFolder(run) + "replay.json");

// Files a launched run shows at its current replay time: name -> {size, mtime}.
async function progress(run) {
  const {duration, events} = await timeline(run);
  const start = Date.parse(run.launched_at) / 1000;
  const elapsed = (run.ended_at ? Date.parse(run.ended_at) / 1000 : Date.now() / 1000) - start;
  if (run.state === "running" && elapsed >= duration) {
    Object.assign(run, {state: "finished", ended_at: new Date((start + duration) * 1000).toISOString()});
    save();
  }
  const files = {};
  for (const [t, name, size] of events) {
    if (t > elapsed) break;
    files[name] = {size, mtime: start + t};
  }
  return files;
}

const publicRun = run => run && {...run};
const activeRun = () => runs.find(r => r.state === "running");
async function settle() { await Promise.all(runs.filter(r => r.state === "running").map(progress)); }

async function launchedGroup(run, base) {
  const files = await progress(run);
  const source = base.groups.find(g => g.id === run.source[0]);
  const real = source?.trajectories.find(t => t.id === run.source[1]);
  const live = run.state === "running";
  const mtime = Math.max(Date.parse(run.launched_at) / 1000, ...Object.values(files).map(f => f.mtime));
  const status = live ? "running" : files["result.json"] ? real?.status || "finished" : run.state;
  return {source: "runs", id: run.run_id, created_at: run.launched_at, mode: source?.mode, model: source?.model,
          policy: source?.policy, chat: {mode: "replay", state: run.state, launched_at: run.launched_at, source: run.source},
          live, mtime, files: ["chat.json", "manifest.json"],
          trajectories: [{id: run.trajectory_id, status, live, mtime}]};
}

// ---------- the api.js surface ----------
export async function getIndex() {
  const base = await json(DATA + "index.json");
  const launched = await Promise.all(runs.map(run => launchedGroup(run, base)));
  return {generated_at: Date.now() / 1000, groups: [...launched.reverse(), ...base.groups]};
}

export async function listFiles(ref) {
  const run = launchedRun(ref[1]);
  if (!run) return {...await json(DATA + "runs/" + enc(ref.slice(1)) + "/files.json"), now: Date.now() / 1000};
  const files = await progress(run);
  // A stopped replay is over even though its newest file is recent.
  return {files, now: Date.now() / 1000 + (run.state === "running" ? 0 : LIVE_SECONDS)};
}

export const getCatalog = () => json(DATA + "catalog.json");
export const getReference = tid => json(DATA + "reference/" + encodeURIComponent(tid) + ".json");

export async function getLaunch() {
  await settle();
  const last = runs.filter(r => r.state !== "running").at(-1);
  return {active: publicRun(activeRun()), last: publicRun(last), defaults: {}};
}

export async function launchRun(spec) {
  await settle();
  if (spec.mode !== "replay") throw new Error("The project site replays recorded runs; run ProDebugger locally for live diagnoses.");
  const active = activeRun();
  if (active) throw new Error(`run ${active.run_id} is still active; stop it first`);
  const base = await json(DATA + "index.json");
  const [group, tid] = spec.source || [];
  if (tid !== spec.trajectory_id || !base.groups.some(g => g.id === group && g.trajectories.some(t => t.id === tid))) {
    throw new Error("replay source must be a recorded run of the same trajectory");
  }
  const now = new Date();
  const run = {schema: "chat-launch/v1", run_id: now.toISOString().replace(/[-:]|\.\d+/g, "") + "-chat-" + Math.random().toString(16).slice(2, 8),
               trajectory_id: tid, mode: "replay", source: [group, tid], config: {}, launched_at: now.toISOString(), state: "running", log: []};
  runs.push(run);
  save();
  return {run: publicRun(run)};
}

export async function stopRun() {
  const run = activeRun();
  if (run) { Object.assign(run, {state: "stopped", ended_at: new Date().toISOString()}); save(); }
  return {stopped: Boolean(run)};
}

export async function getJSON(ref, name, fallback) {
  try {
    const run = launchedRun(ref[1]);
    if (run && ref.length === 2) {
      if (name === "chat.json") return publicRun(run);
      return await json(DATA + "runs/" + enc([run.source[0], name]));
    }
    // A launched run's store only asks for files its listing already shows.
    const folder = run ? sourceFolder(run) : DATA + "runs/" + enc(ref.slice(1)) + "/";
    return await json(folder + name.split("/").map(encodeURIComponent).join("/"));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

export class JsonlFollower {
  constructor(ref, name) { this.ref = ref; this.name = name; this.offset = 0; this.rows = []; }
  async poll() {
    const run = launchedRun(this.ref[1]);
    const folder = run ? sourceFolder(run) : DATA + "runs/" + enc(this.ref.slice(1)) + "/";
    const listed = run ? (await progress(run))[this.name] : (await json(folder + "files.json")).files[this.name];
    if (!listed || listed.size <= this.offset) return [];
    let all;
    try { all = await jsonRows(folder + this.name.split("/").map(encodeURIComponent).join("/")); } catch { return []; }
    const added = all.slice(this.offset, listed.size);
    this.offset = listed.size;
    this.rows.push(...added);
    return added;
  }
}
