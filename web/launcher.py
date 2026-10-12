"""Starts debugger runs for the workbench's chat page.

The server stays free of prodebugger/core imports: every run is a subprocess
(`python -m prodebugger.run_experiment` for live diagnosis, web/simulate_live.py
for a paced replay of a finished run), and the parquet catalog is read by
web/catalog.py in a subprocess as well. One run at a time; it can be stopped.

Each launched run gets <runs>/<run_id>/chat.json, which marks it as started
from the chat page and records how it ended (exit code, last log lines).
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = Path(__file__).resolve().parent
# Config keys forwarded to run_experiment from the newest online manifest.
FORWARD = ("model", "base_url", "api_key_env", "env_file", "reasoning_effort", "window_size",
           "trace_top_p", "trace_top_k", "max_turns", "max_tool_calls", "max_input_tokens",
           "max_output_tokens", "max_tokens", "timeout", "retries",
           "map_model", "route_model", "trace_model", "submit_model")
EFFORTS = ("none", "low", "high", "max")
MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/\-]{0,99}$")
REPLAY_DELAY = 0.3
LOG_LINES = 80


class LaunchError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_python() -> str:
    for candidate in (ROOT / ".venv" / "Scripts" / "python.exe", ROOT / ".venv" / "bin" / "python"):
        if candidate.is_file():
            return str(candidate)
    return sys.executable


def kill_tree(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True)
    else:
        os.killpg(process.pid, signal.SIGTERM)


class Launcher:
    def __init__(self, runs: Path, data_dir: Path, python: str | None = None) -> None:
        self.runs = runs.resolve()
        self.data_dir = data_dir.resolve()
        self.python = python or default_python()
        self.lock = threading.Lock()
        self.active: dict | None = None
        self.last: dict | None = None
        self.process: subprocess.Popen | None = None
        self.catalog_cache: tuple[tuple, dict] | None = None

    # ---------- catalog ----------
    def catalog(self) -> dict:
        stamp = tuple(sorted((p.name, p.stat().st_mtime) for p in self.data_dir.glob("*.parquet")))
        if self.catalog_cache and self.catalog_cache[0] == stamp:
            return self.catalog_cache[1]
        if not stamp:
            return {"cases": [], "error": f"no parquet files in {self.data_dir}"}
        done = subprocess.run([self.python, "-B", str(WEB / "catalog.py"), "--data-dir", str(self.data_dir)],
                              cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if done.returncode:
            return {"cases": [], "error": (done.stderr.strip().splitlines() or ["catalog failed"])[-1]}
        value = json.loads(done.stdout)
        self.catalog_cache = (stamp, value)
        return value

    def public_catalog(self) -> dict:
        value = self.catalog()
        # Reference labels stay server-side until a run has finished.
        return {**value, "cases": [{k: v for k, v in c.items() if k != "reference"} for c in value["cases"]]}

    def reference(self, trajectory_id: str) -> dict | None:
        case = next((c for c in self.catalog()["cases"] if c["trajectory_id"] == trajectory_id), None)
        return case and {"trajectory_id": trajectory_id, **case["reference"]}

    # ---------- defaults ----------
    def defaults(self) -> dict:
        newest, config = "", {}
        for manifest in self.runs.glob("*/manifest.json"):
            try:
                value = json.loads(manifest.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if value.get("mode") == "online" and (value.get("config") or {}).get("model") \
                    and str(value.get("created_at", "")) > newest:
                newest, config = str(value["created_at"]), value["config"]
        return {k: config.get(k) for k in FORWARD if config.get(k) is not None}

    # ---------- status ----------
    def status(self) -> dict:
        with self.lock:
            return {"active": self.public(self.active), "last": self.public(self.last), "defaults": self.defaults()}

    @staticmethod
    def public(run: dict | None) -> dict | None:
        return run and {k: (list(v) if isinstance(v, deque) else v) for k, v in run.items()}

    # ---------- launch ----------
    def launch(self, spec: dict, sources) -> dict:
        mode = spec.get("mode")
        if mode == "custom":
            raise LaunchError(501, "Custom tasks are not implemented yet.")
        if mode not in ("online", "replay"):
            raise LaunchError(400, "mode must be online, replay or custom")
        tid = str(spec.get("trajectory_id") or "")
        case = next((c for c in self.catalog()["cases"] if c["trajectory_id"] == tid), None)
        if case is None:
            raise LaunchError(400, f"unknown trajectory {tid!r}")
        if not case["supported"]:
            raise LaunchError(400, f"task_type {case['task_type']!r} is not supported by the debugger")
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-chat-" + uuid.uuid4().hex[:6]
        config: dict = {}
        source = None
        if mode == "online":
            config = self.defaults()
            overrides = spec.get("config") or {}
            if overrides.get("model"):
                if not MODEL.match(str(overrides["model"])):
                    raise LaunchError(400, "invalid model name")
                config["model"] = str(overrides["model"])
            if overrides.get("reasoning_effort"):
                if overrides["reasoning_effort"] not in EFFORTS:
                    raise LaunchError(400, "invalid reasoning effort")
                config["reasoning_effort"] = overrides["reasoning_effort"]
            if overrides.get("window_size") not in (None, ""):
                size = int(overrides["window_size"])
                if not 1 <= size <= 30:
                    raise LaunchError(400, "window size must be between 1 and 30")
                config["window_size"] = size
            if not config.get("model"):
                raise LaunchError(400, "no model configured; choose one under Advanced")
            command = [self.python, "-B", "-m", "prodebugger.run_experiment", tid, "--run-id", run_id,
                       "--output-dir", str(self.runs), "--data-dir", str(self.data_dir)]
            for key, value in config.items():
                command += ["--" + key.replace("_", "-"), str(value)]
        else:
            group, source_tid = (list(spec.get("source") or []) + [None, None])[:2]
            folder = sources.directory("runs", str(group or ""), str(source_tid or ""))
            if folder is None or source_tid != tid or not (folder / "result.json").is_file() \
                    or not (folder / "messages.jsonl").is_file():
                raise LaunchError(400, "replay source must be a finished run of the same trajectory")
            source = [group, source_tid]
            command = [self.python, "-B", str(WEB / "simulate_live.py"), str(folder), "--output-dir", str(self.runs),
                       "--run-id", run_id, "--delay", str(REPLAY_DELAY)]

        with self.lock:
            if self.active:
                raise LaunchError(409, f"run {self.active['run_id']} is still active; stop it first")
            env = dict(os.environ, PYTHONHASHSEED="42", PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
            flags = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
            self.process = subprocess.Popen(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                            text=True, encoding="utf-8", errors="replace", **flags)
            self.active = {"schema": "chat-launch/v1", "run_id": run_id, "trajectory_id": tid, "mode": mode,
                           "source": source, "config": config, "launched_at": now_iso(), "state": "running",
                           "pid": self.process.pid, "log": deque(maxlen=LOG_LINES)}
            run = self.active
        threading.Thread(target=self.follow, args=(self.process, run), daemon=True).start()
        return self.public(run)

    def follow(self, process: subprocess.Popen, run: dict) -> None:
        marker = self.runs / run["run_id"] / "chat.json"
        threading.Thread(target=self.mark, args=(process, run, marker), daemon=True).start()
        for line in process.stdout:
            with self.lock:
                run["log"].append(line.rstrip())
        code = process.wait()
        with self.lock:
            run.update(state="stopped" if run.get("stopping") else ("finished" if code == 0 else "failed"),
                       returncode=code, ended_at=now_iso())
            run.pop("stopping", None)
            self.last, self.active, self.process = run, None, None
            self.write_marker(marker, run)

    def mark(self, process: subprocess.Popen, run: dict, marker: Path) -> None:
        # run_experiment refuses an existing run directory, so mark it once it appears.
        while process.poll() is None and not marker.parent.is_dir():
            time.sleep(0.2)
        with self.lock:
            if marker.parent.is_dir() and not marker.exists():
                self.write_marker(marker, run)

    def write_marker(self, marker: Path, run: dict) -> None:
        if not marker.parent.is_dir():
            return
        value = {k: v for k, v in self.public(run).items() if k not in ("pid", "stopping")}
        value["log"] = value["log"][-20:]
        marker.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")

    def stop(self) -> bool:
        with self.lock:
            if not self.active or not self.process:
                return False
            self.active["stopping"] = True
            process = self.process
        kill_tree(process)
        return True
