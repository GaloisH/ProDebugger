#!/usr/bin/env python
"""Command line onto a session over the new core.

  dbg.py <tid> profile | failed | conflicts
  dbg.py <tid> view "requirements | state:unmet"
  dbg.py <tid> view "entity:req:size | section:definition,status,evidence"
  dbg.py <tid> view "changes | steps:1:10"
  dbg.py <tid> about <kind> <index>
  dbg.py <tid> lens "about:kind:index | why | window:1:10"
  dbg.py <tid> attempts <kind> <index>
  dbg.py <tid> could_have <req_index>
  dbg.py <tid> back|up|siblings|neighbours <fid>
  dbg.py <tid> versions <rel> <kind:index> [<kind:index>]
  dbg.py <tid> check <fid> | span <fid> | state <step>
  dbg.py <tid> contrast <fid> <fid> [<fid> ...]   (two or more)
  dbg.py <tid> count [rel=..] [slot=..] [side=..]
  dbg.py <tid> assess <step> '<local-judgement/v2 JSON>'
  dbg.py <tid> global
  dbg.py <tid> protocol
  dbg.py <tid> hold <fid>... | drop <fid>... | recall | cost
  dbg.py <tid> note "text" [fid...]
  dbg.py <tid> submit <fid> <module> <fault_class> <evidence_csv> <repair...>
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from data_io import load, unpack
import compile_run as C
import profiles.webshop as webshop
import profiles.alfworld as alfworld
from record import Entity
from session import Session
from criterion import Verdict
from local_judgement import SCHEMA as ASSESSMENT_SCHEMA

_ROWS = None
def _row(tid):
    global _ROWS
    if _ROWS is None:
        _ROWS = {r["trajectory_id"]: r for r in load()}
    return _ROWS[tid]

def _profile(row):
    return webshop if row["task_type"] == "webshop" else alfworld

def _state_path(tid): return os.path.join(HERE, "sessions", tid + ".json")

def open_session(tid, budget=None):
    row = _row(tid)
    t, task, env, ag, adm = unpack(row)
    steps = C.segment(env, ag, adm)
    R = C.build(t, task, steps, _profile(row))
    s = Session(R, budget=budget)
    p = _state_path(tid)
    if os.path.exists(p):
        st = json.load(open(p))
        s.notes = st.get("notes", [])
        s.local_audit_steps = set(st.get("local_audit_steps", []))
        assessment_current = st.get("assessment_schema") == ASSESSMENT_SCHEMA
        if assessment_current:
            s.compared = {frozenset(x) for x in st.get("compared", [])}
            s.frontier = st.get("frontier", [])
            s.assessments = {
                int(step): judgement
                for step, judgement in st.get("assessments", {}).items()
            }
        s.global_review_after_local = (
            st.get("global_review_after_local", False) if assessment_current else False
        )
        s.full_audit_steps_after_global = set(
            st.get("full_audit_steps_after_global", []) if assessment_current else []
        )
        s._replayed = st.get("n_calls", 0)
        s._replayed_model = st.get("n_model_calls", 0)
    return s

def save(s):
    json.dump({"compared": [sorted(x) for x in s.compared],
               "frontier": s.frontier, "notes": s.notes,
               "local_audit_steps": sorted(s.local_audit_steps),
               "assessments": s.assessments,
               "assessment_schema": ASSESSMENT_SCHEMA,
               "global_review_after_local": s.global_review_after_local,
               "full_audit_steps_after_global": sorted(
                   s.full_audit_steps_after_global
               ),
               "n_calls": s.operator_calls(),
               "n_model_calls": s.model_calls(),
               "submitted": s.submitted},
              open(_state_path(s.R.tid), "w"), indent=1)

def _ent(spec):
    k, i = spec.split(":", 1)
    return Entity(k, i)

def main(argv):
    if len(argv) < 3:
        print(__doc__); return 2
    tid, op, a = argv[1], argv[2], argv[3:]
    s = open_session(tid)
    try:
        if   op in ("profile", "failed", "conflicts"): out = s.call(op)
        elif op == "view":       out = s.call("view", a[0])
        elif op == "about":      out = s.call("about", a[0], a[1])
        elif op == "lens":       out = s.call("lens", a[0])
        elif op == "attempts":   out = s.call("attempts", a[0], a[1])
        elif op == "could_have": out = s.call("could_have", Entity("req", a[0]))
        elif op in ("back", "up", "siblings"): out = s.call(op, int(a[0]))
        elif op == "neighbours": out = s.call(op, int(a[0]), int(a[1]) if len(a) > 1 else 1)
        elif op == "down":       out = s.call(op, _ent(a[0]))
        elif op == "versions":   out = s.call(op, a[0], tuple(_ent(x) for x in a[1:]))
        elif op == "check":      out = s.call(op, int(a[0]))
        elif op == "span":       out = s.call(op, int(a[0]))
        elif op == "state":      out = s.call(op, int(a[0]))
        elif op == "contrast":   out = s.call(op, *[int(x) for x in a])
        elif op == "count":
            kw = dict(x.split("=", 1) for x in a if "=" in x)
            out = s.call(op, kw.get("rel"), kw.get("slot"), kw.get("side"))
        elif op == "assess":
            if len(a) != 2:
                raise ValueError("assess needs step and one quoted JSON object")
            out = s.assess_step(int(a[0]), json.loads(a[1]))
        elif op == "protocol":   out = s.protocol()
        elif op == "global":     out = s.global_review()
        elif op == "hold":       out = s.hold(*[int(x) for x in a])
        elif op == "drop":       out = s.drop(*[int(x) for x in a])
        elif op == "note":       out = s.note(a[0], [int(x) for x in a[1:]])
        elif op == "recall":     out = s.recall()
        elif op == "cost":       out = s.cost()
        elif op == "submit":
            ev = [int(x) for x in a[3].split(",") if x.strip()]
            out = s.submit(int(a[0]), a[1], a[2], ev, " ".join(a[4:]))
        else:
            print(json.dumps({"error": f"unknown op {op}"})); return 2
    except Exception as e:
        print(json.dumps({"error": f"{type(e).__name__}: {e}"})); return 1
    save(s)
    if isinstance(out, Verdict):
        out = {"verdict": out.value, "reason": out.reason,
               "cites": list(out.cites), "operands": list(out.operands)}
    print(json.dumps(out, ensure_ascii=False, default=str))
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv))
