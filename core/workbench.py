#!/usr/bin/env python
"""Local, read-only trajectory workbench.

Run from the package root: .venv/Scripts/python.exe -B core/workbench.py
Evidence APIs do not read gold labels or create a Session. The separate
experiment surface only serves generated, saved-log browser files.
"""

import argparse
import json
import os
import re
import sys
import traceback
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(ROOT, "workbench")
sys.path.insert(0, HERE)

from data_io import load, unpack  # noqa: E402
from compile_run import build, segment  # noqa: E402
from profiles import alfworld, webshop  # noqa: E402
from views import _episodes_view, _fact, _intention_row, _requirements_view, _scan_view, entity_view  # noqa: E402


PROFILES = {"webshop": webshop, "alfworld": alfworld}
STATIC = {"/": ("index.html", "text/html; charset=utf-8"),
          "/app.css": ("app.css", "text/css; charset=utf-8"),
          "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/theme.css": ("theme.css", "text/css; charset=utf-8"),
          "/shell.js": ("shell.js", "text/javascript; charset=utf-8")}
EXPERIMENTS = Path(ROOT) / "frontend" / "case_browser" / "output"
EXPERIMENT_ASSETS = {"viewer.css": "text/css; charset=utf-8",
                     "viewer.js": "text/javascript; charset=utf-8",
                     "theme.css": "text/css; charset=utf-8",
                     "shell.js": "text/javascript; charset=utf-8"}


def experiment_file(directory, path):
    """Resolve only browser output files, never arbitrary run logs or symlinks."""
    name = unquote(path[len("/experiments/"):]) or "index.html"
    if name not in EXPERIMENT_ASSETS and not re.fullmatch(r"(?:index|case-[0-9]{3,})\.html", name):
        raise MissingLookup("实验页面不存在")
    root = Path(directory).resolve()
    target = root / name
    if target.resolve().parent != root:
        raise MissingLookup("实验页面不存在")
    mime = EXPERIMENT_ASSETS.get(name, "text/html; charset=utf-8")
    if not target.is_file():
        if name == "index.html":
            return Path(WEB) / "experiments-empty.html", mime
        raise MissingLookup("实验页面不存在")
    return target, mime


class MissingLookup(Exception):
    pass


class WorkbenchData:
    def __init__(self, rows=None):
        rows = load() if rows is None else rows
        self.rows = {row["trajectory_id"]: row for row in rows
                     if row.get("task_type") in PROFILES}

    def traces(self):
        result = []
        for tid, row in self.rows.items():
            _, task, env, _, _ = unpack(row)
            result.append({"id": tid, "domain": row["task_type"],
                           "task": task, "steps": len(env)})
        return sorted(result, key=lambda x: (x["domain"], x["id"]))

    @lru_cache(maxsize=4)
    def record(self, tid):
        row = self.rows.get(tid)
        if row is None:
            raise MissingLookup("未知轨迹")
        trajectory_id, task, env, agent, admissible = unpack(row)
        steps = segment(env, agent, admissible)
        return build(trajectory_id, task, steps, PROFILES[row["task_type"]])

    @staticmethod
    def _goal_steps(R, goal_id, view):
        steps = set(view["status"]["qualifying_steps"] +
                    view["status"]["decision_steps"])
        for item in view["evidence"]:
            if isinstance(item.get("step"), int) and item["step"] > 0:
                steps.add(item["step"])
        for step in range(1, R.length() + 1):
            intention = R.intentions.get("int:i{}".format(step))
            # `serves` is broad purpose bookkeeping and can include every goal
            # on every step. Highlight only explicit mentions and direct evidence.
            if intention and any(str(entity) == goal_id for entity in intention.mentions):
                steps.add(step)
        return sorted(steps)

    def overview(self, tid):
        R = self.record(tid)
        requirements = _requirements_view(R)
        for goal in requirements["requirements"]:
            view = entity_view(R, "req", goal["entity"]["id"].split(":", 1)[1])
            goal["related_steps"] = self._goal_steps(R, goal["entity"]["id"], view)
        scan = _scan_view(R)
        return {"id": tid, "domain": R.domain, "task_contract": requirements["task_contract"],
                "goals": requirements["requirements"], "steps": scan["episodes"],
                "fact_count": len(R.F)}

    def step(self, tid, number):
        R = self.record(tid)
        if number < 1 or number > R.length():
            raise MissingLookup("步骤不存在")
        episode = _episodes_view(R)["episodes"][number - 1]
        source = R.source_steps[number]
        return {"step": number, "episode": episode,
                "source": {"observation": source.observation,
                           "modules": source.modules,
                           "admissible": list(source.admissible)},
                "intention_row": _intention_row(R, number)}

    def entity(self, tid, kind, index):
        R = self.record(tid)
        try:
            return entity_view(R, kind, index)
        except KeyError as exc:
            raise MissingLookup("实体不存在") from exc

    def fact(self, tid, fid):
        R = self.record(tid)
        if fid < 0 or fid >= len(R.F):
            raise MissingLookup("事实不存在")
        fact = R.fact(fid)
        return {"fact": _fact(R, fact, with_support=True),
                "basis_facts": [_fact(R, R.fact(parent), with_support=True)
                                for parent in fact.basis]}


def route(data, path):
    parts = [unquote(part) for part in path.split("/") if part]
    if parts == ["api", "traces"]:
        return {"traces": data.traces()}
    if len(parts) < 3 or parts[:2] != ["api", "traces"]:
        raise MissingLookup("接口不存在")
    tid = parts[2]
    if tid not in data.rows:
        raise MissingLookup("未知轨迹")
    if len(parts) == 3:
        return data.overview(tid)
    if len(parts) == 5 and parts[3] == "steps":
        if not parts[4].isdigit():
            raise ValueError("无效步骤编号")
        return data.step(tid, int(parts[4]))
    if len(parts) == 6 and parts[3] == "entities":
        return data.entity(tid, parts[4], parts[5])
    if len(parts) == 5 and parts[3] == "facts":
        if not parts[4].isdigit():
            raise ValueError("无效事实 ID")
        return data.fact(tid, int(parts[4]))
    raise MissingLookup("接口不存在")


def make_handler(data, experiments_dir=EXPERIMENTS):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, body, content_type):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status, value):
            body = json.dumps(value, ensure_ascii=False, default=str).encode("utf-8")
            self._send(status, body, "application/json; charset=utf-8")

        def do_GET(self):
            url = urlsplit(self.path)
            path = url.path
            try:
                if path == "/experiments":
                    self.send_response(302)
                    self.send_header("Location", "/experiments/" + ("?" + url.query if url.query else ""))
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if path in STATIC:
                    name, mime = STATIC[path]
                    self._send(200, (Path(WEB) / name).read_bytes(), mime)
                    return
                if path.startswith("/experiments/"):
                    target, mime = experiment_file(experiments_dir, path)
                    self._send(200, target.read_bytes(), mime)
                    return
                self._json(200, route(data, path))
            except MissingLookup as exc:
                self._json(404, {"error": str(exc)})
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
            except Exception:
                traceback.print_exc(file=sys.stderr)
                self._json(500, {"error": "数据加载失败，请检查服务日志"})

        def log_message(self, fmt, *args):
            print("workbench: " + fmt % args, file=sys.stderr)

    return Handler


def make_server(data, port=8765, experiments_dir=EXPERIMENTS):
    # Browsers can open idle speculative connections before loading assets.
    # A threaded server keeps those connections from blocking every view.
    return ThreadingHTTPServer(("127.0.0.1", port), make_handler(data, experiments_dir))


def main(argv=None):
    parser = argparse.ArgumentParser(description="本地只读轨迹调试台")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--experiments-dir", type=Path, default=EXPERIMENTS,
                        help="实验浏览器构建输出目录（只读）")
    args = parser.parse_args(argv)
    data = WorkbenchData()
    server = make_server(data, args.port, args.experiments_dir)
    print("轨迹调试台：http://127.0.0.1:{}/ （{} 条轨迹）".format(
        server.server_port, len(data.rows)), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
