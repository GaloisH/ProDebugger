"""Read-only local server for the ProDebugger web workbench.

The server never imports prodebugger/core. It only lists directories and returns
the raw files the debugger already writes, so the frontend depends on file
formats alone. JSONL files can be read incrementally from a byte offset, which
lets the browser follow a run while run_experiment is still appending to it.

    python web/server.py            # http://127.0.0.1:8770
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import re
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
STATIC = Path(__file__).resolve().parent / "static"
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]*$")
FILE = re.compile(r"^(?:requests/)?[A-Za-z0-9][A-Za-z0-9_.\-]*\.(?:json|jsonl|md)$")
SKIP_DIRS = {"browser", "requests", "__pycache__"}
LIVE_SECONDS = 180.0
# Raw chunks are capped so a large log is streamed over several polls.
MAX_CHUNK = 4 * 1024 * 1024


class Sources:
    """Named data roots: `runs` (debugger outputs) and `sessions` (compiled inputs)."""

    def __init__(self, runs: Path, sessions: Path) -> None:
        self.roots = {"runs": runs.resolve(), "sessions": sessions.resolve()}

    def directory(self, source: str, *names: str) -> Path | None:
        root = self.roots.get(source)
        if root is None or not all(NAME.match(n) for n in names):
            return None
        path = root.joinpath(*names).resolve()
        return path if path.is_dir() and path.is_relative_to(root) else None

    def file(self, source: str, names: tuple[str, ...], filename: str) -> Path | None:
        if not FILE.match(filename):
            return None
        folder = self.directory(source, *names)
        if folder is None:
            return None
        path = (folder / filename).resolve()
        return path if path.is_file() and path.is_relative_to(folder) else None


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return default


def file_table(folder: Path) -> dict:
    table = {}
    for path in folder.iterdir():
        if path.is_file() and FILE.match(path.name):
            stat = path.stat()
            table[path.name] = {"size": stat.st_size, "mtime": stat.st_mtime}
    requests = folder / "requests"
    if requests.is_dir():
        table["requests/"] = {"size": sum(1 for _ in requests.glob("*.json")),
                              "mtime": requests.stat().st_mtime}
    return table


def trajectory_state(source: str, files: dict, now: float) -> dict:
    newest = max((f["mtime"] for f in files.values()), default=0.0)
    if source == "sessions":
        return {"status": "compiled", "live": False, "mtime": newest}
    result = files.get("result.json")
    others = max((f["mtime"] for k, f in files.items() if k != "result.json"), default=0.0)
    # result.json is written last; a newer log entry means the debugger is still working.
    live = now - newest < LIVE_SECONDS and (result is None or result["mtime"] + 0.5 < others)
    return {"status": "running" if live else ("finished" if result else "incomplete"),
            "live": live, "mtime": newest}


def group_index(sources: Sources, source: str, group: Path, now: float) -> dict:
    trajectories = []
    for child in sorted(group.iterdir()):
        if not child.is_dir() or child.name in SKIP_DIRS or not NAME.match(child.name):
            continue
        files = file_table(child)
        state = trajectory_state(source, files, now)
        if state["status"] == "finished":
            state["status"] = (read_json(child / "result.json", {}) or {}).get("status", "finished")
        trajectories.append({"id": child.name, **state})
    manifest = read_json(group / "manifest.json", {}) or {}
    config = manifest.get("config") or {}
    return {"source": source, "id": group.name, "created_at": manifest.get("created_at"),
            "mode": manifest.get("mode"), "model": config.get("model"),
            "policy": manifest.get("submission_policy"),
            "live": any(t["live"] for t in trajectories),
            "mtime": max((t["mtime"] for t in trajectories), default=group.stat().st_mtime),
            "files": sorted(n for n in file_table(group)), "trajectories": trajectories}


def build_index(sources: Sources) -> dict:
    now = time.time()
    out = {"generated_at": now, "groups": []}
    for source, root in sources.roots.items():
        if not root.is_dir():
            continue
        for group in root.iterdir():
            if group.is_dir() and NAME.match(group.name) and group.name not in SKIP_DIRS:
                out["groups"].append(group_index(sources, source, group, now))
    out["groups"].sort(key=lambda g: (not g["live"], -g["mtime"]))
    return out


class Handler(SimpleHTTPRequestHandler):
    sources: Sources

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def log_message(self, fmt, *args):  # keep polling quiet
        if not self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_body(self, body: bytes, content_type: str, headers: dict | None = None):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, value):
        self.send_body(json.dumps(value, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")

    def do_POST(self):
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    do_PUT = do_DELETE = do_PATCH = do_POST

    def do_GET(self):
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            return super().do_GET()
        parts = [unquote(p) for p in url.path.split("/")[2:] if p]
        query = parse_qs(url.query)
        try:
            self.route(parts, query)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def route(self, parts, query):
        # /api/index
        # /api/files/<source>/<group>[/<trajectory>]
        # /api/file/<source>/<group>[/<trajectory>]/<name>[?offset=N]
        if parts == ["index"]:
            return self.send_json(build_index(self.sources))
        if len(parts) in (3, 4) and parts[0] == "files":
            folder = self.sources.directory(parts[1], *parts[2:])
            if folder is None:
                return self.send_error(HTTPStatus.NOT_FOUND)
            return self.send_json({"files": file_table(folder), "now": time.time()})
        if len(parts) >= 4 and parts[0] == "file":
            filename = "/".join(parts[-2:]) if parts[-2] == "requests" else parts[-1]
            names = tuple(parts[2:-2] if parts[-2] == "requests" else parts[2:-1])
            if not 1 <= len(names) <= 2:
                return self.send_error(HTTPStatus.NOT_FOUND)
            path = self.sources.file(parts[1], names, filename)
            if path is None:
                return self.send_error(HTTPStatus.NOT_FOUND)
            return self.send_file(path, query)
        self.send_error(HTTPStatus.NOT_FOUND)

    def send_file(self, path: Path, query):
        if path.suffix != ".jsonl":
            kind = "application/json" if path.suffix == ".json" else "text/markdown"
            return self.send_body(path.read_bytes(), kind + "; charset=utf-8")
        try:
            offset = max(0, int(query.get("offset", ["0"])[0]))
        except ValueError:
            return self.send_error(HTTPStatus.BAD_REQUEST)
        with path.open("rb") as stream:
            size = stream.seek(0, 2)
            offset = min(offset, size)
            stream.seek(offset)
            chunk = stream.read(MAX_CHUNK)
        # Only complete lines: the writer may be mid-append.
        end = chunk.rfind(b"\n") + 1
        chunk = chunk[:end]
        self.send_body(chunk, "application/x-ndjson; charset=utf-8",
                       {"X-Next-Offset": offset + len(chunk), "X-File-Size": size})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument("--runs-dir", type=Path, default=ROOT / "artifacts" / "dsl_debugger")
    parser.add_argument("--sessions-dir", type=Path, default=ROOT / "prodebugger" / "sessions")
    args = parser.parse_args()
    mimetypes.add_type("text/javascript", ".js")
    Handler.sources = Sources(args.runs_dir, args.sessions_dir)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"ProDebugger workbench: http://{args.host}:{args.port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
