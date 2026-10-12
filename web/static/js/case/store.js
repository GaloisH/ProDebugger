// Loads one case and keeps it current: rewritten JSON files are refetched when their
// mtime changes, JSONL logs are followed from their last byte offset.
import {getJSON, JsonlFollower, listFiles} from "../api.js";
import {Emitter} from "../util.js";
import {buildCase} from "./model.js";

const LIVE_SECONDS = 180;
const RUN_JSON = {canonical_record: "canonical_record.json", input: "input.json", rules: "rules.json",
                  evidences: "evidences.json", evaluations: "evaluations.json", goal_map: "goal_map.json",
                  trace_windows: "trace_windows.json", trace_graph: "trace_graph.json",
                  route_candidates: "route_candidates.json", result: "result.json", usage: "usage.json"};
const RUN_JSONL = {messages: "messages.jsonl", tool_calls: "tool_calls.jsonl", phase_events: "phase_events.jsonl",
                   usage_rows: "usage.jsonl", window_trace: "window_trace.jsonl", direct_submit: "direct_submit.jsonl"};
const SESSION_JSON = {record: "record.json", steps: "steps.json"};

export class CaseStore extends Emitter {
  constructor(ref) {
    super();
    this.ref = ref;
    this.kind = ref[0] === "sessions" ? "session" : "run";
    this.raw = {};
    this.mtimes = {};
    this.followers = Object.fromEntries(this.kind === "run"
      ? Object.entries(RUN_JSONL).map(([k, name]) => [k, new JsonlFollower(ref, name)]) : []);
    this.model = null;
    this.live = false;
    this.error = null;
    this.timer = null;
    this.stopped = false;
  }

  async start() {
    if (this.kind === "run") this.raw.manifest = await getJSON(this.ref.slice(0, 2), "manifest.json", null);
    await this.poll(true);
  }

  stop() { this.stopped = true; clearTimeout(this.timer); }

  schedule() {
    if (this.stopped) return;
    // Fast while a run is being written; slow otherwise so a resumed run is still noticed.
    this.timer = setTimeout(() => this.poll(false), this.live ? 1500 : 8000);
  }

  async poll(first) {
    const changed = new Set();
    try {
      const {files, now} = await listFiles(this.ref);
      const table = this.kind === "run" ? RUN_JSON : SESSION_JSON;
      await Promise.all(Object.entries(table).map(async ([key, name]) => {
        const mtime = files[name]?.mtime;
        if (mtime == null || mtime === this.mtimes[name]) return;
        this.raw[key] = await getJSON(this.ref, name, null);
        this.mtimes[name] = mtime;
        changed.add(key);
      }));
      await Promise.all(Object.entries(this.followers).map(async ([key, follower]) => {
        if ((await follower.poll()).length || first) { this.raw[key] = follower.rows; changed.add(key); }
      }));
      const newest = Math.max(0, ...Object.values(files).map(f => f.mtime));
      const result = files["result.json"]?.mtime;
      const others = Math.max(0, ...Object.entries(files).filter(([k]) => k !== "result.json").map(([, f]) => f.mtime));
      const live = this.kind === "run" && now - newest < LIVE_SECONDS && (result == null || result + 0.5 < others);
      if (live !== this.live) { this.live = live; changed.add("live"); }
      this.error = null;
    } catch (error) {
      if (this.error !== error.message) changed.add("error");
      this.error = error.message;
    }
    if (changed.size && !this.stopped) {
      this.model = buildCase(this.kind, this.raw);
      this.emit("change", {changed, first});
    }
    this.schedule();
  }
}
