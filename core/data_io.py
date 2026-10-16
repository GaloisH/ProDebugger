"""Parquet to Step lists. The only place that knows the corpus file format.

It reads rows from the splits, extracts three parallel lists per trajectory
(what the environment said, what the agent said, and which actions were
admissible) and, separately, the reference annotation. Parsing any of that into
facts is the profile's job, not this file's.
"""
import ast
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))
SPLITS = ("train", "validation", "test")


def read_rows(root: Optional[str] = None, columns: Optional[List[str]] = None,
              trajectory_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Rows from every present split, each tagged with `_split`."""
    root = root or os.path.join(HERE, "data")
    filters = [("trajectory_id", "=", trajectory_id)] if trajectory_id is not None else None
    rows: List[Dict[str, Any]] = []
    for sp in SPLITS:
        p = os.path.join(root, f"{sp}.parquet")
        if not os.path.exists(p):
            continue
        for r in pq.read_table(p, columns=columns, filters=filters).to_pylist():
            r["_split"] = sp
            rows.append(r)
    return rows


def read_one(trajectory_id: str, root: Optional[str] = None,
             columns: Optional[List[str]] = None) -> Dict[str, Any]:
    rows = read_rows(root, columns, trajectory_id)
    if len(rows) != 1:
        raise ValueError(f"expected one trajectory, found {len(rows)}")
    return rows[0]


_TASK = re.compile(r"(?:^|\n)(?:Your )?task is(?: to)?:\s*(.*?)(?=\nYour (?:current )?observation is:|\nYour admissible|\Z)", re.I | re.S)
_OBS = re.compile(r"(?:current )?observation is:\s*(.*?)(?:\nYour admissible|\nPlease |\Z)", re.S)
_ADM = re.compile(r"admissible actions.*?are:\s*(.*?)(?:\n\n|\nPlease |\Z)", re.S)


def unpack(row: Dict[str, Any]) -> Tuple[str, str, List[str], List[str], List[List[str]]]:
    """Returns (trajectory id, task, env texts, agent texts, admissible lists).

    A trajectory is a flat message list alternating environment and agent. Where
    the last agent turn is missing the pair is dropped, because a step without an
    agent turn is not a step the agent took."""
    msgs = json.loads(row["full_trajectory"])["messages"]
    tid = row["trajectory_id"]
    task_m = _TASK.search(msgs[0]["content"]) if msgs else None
    task = task_m.group(1).strip() if task_m else ""
    if not task:
        raise ValueError("task envelope missing: refusing silent empty task extraction")

    env, agent, adm = [], [], []
    for k in range(0, len(msgs) - 1, 2):
        u, a = msgs[k], msgs[k + 1]
        if u["role"] != "user" or a["role"] != "assistant":
            raise ValueError("unexpected message order: refusing partial trajectory extraction")
        o = _OBS.search(u["content"])
        if o is None:
            raise ValueError(f"observation envelope missing at step {k // 2 + 1}")
        env.append(o.group(1).strip() if o else "")
        agent.append(a["content"])
        m = _ADM.search(u["content"])
        adm.append([x.strip() for x in re.findall(r"'([^']+)'", m.group(1))] if m else [])
    return tid, task, env, agent, adm


def _listed(value) -> List[Any]:
    # Older parquet rows store lists as their Python repr.
    if isinstance(value, str):
        try:
            value = ast.literal_eval(value)
        except (ValueError, SyntaxError):
            return [value]
    return list(value or [])


def as_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def reference(row: Dict[str, Any]) -> Dict[str, Any]:
    """The annotation, kept apart from everything a method may read."""
    return {"step": as_int(row["critical_failure_step"]),
            "module": row["critical_failure_module"],
            "types": _listed(row["failure_types"])}
