"""Record operators behind the ROUTE tools.

Steering moves the focus and reports what it passed through, so the direction
is the caller's and the path is the record's. Evidence gathers at a focus.
Nothing here decides where to go next; that is the caller's job.
"""
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

from record import Record, Fact, Entity
from criterion import kappa, Verdict
import primitives as P
import views as V


@dataclass
class Move:
    """The result of a steering operator."""
    focus: List[int]          # the new focus, as fact ids
    passed: List[int]         # what the move went through
    note: str = ""


# ---------------- steering ---------------------------------------------
def back(R: Record, fid: int) -> Move:
    f = R.fact(fid)
    return Move(list(f.basis), [fid], "one step along the dependence axis")


def up(R: Record, fid: int) -> Move:
    f = R.fact(fid)
    if f.purpose is None:
        return Move([], [fid], "this fact states no purpose")
    parent = R.purpose_parent(f.purpose)
    target = parent if parent is not None else f.purpose
    return Move([g.fid for g in R.by_entity(target)], [fid], f"up to {target}")


def versions(R: Record, rel: str, args: Tuple[Entity, ...]) -> Move:
    c = R.chain(rel, args)
    return Move([f.fid for f in c], [], f"{len(c)} assignments of {rel}")


def neighbours(R: Record, fid: int, span: int = 1) -> Move:
    f = R.fact(fid)
    out: List[int] = []
    for t in range(f.t - span, f.t + span + 1):
        out.extend(g.fid for g in R.by_step(t))
    return Move(out, [fid], f"steps {f.t - span} to {f.t + span}")


# ---------------- evidence ---------------------------------------------
def check(R: Record, fid: int) -> Verdict:
    """The criterion is evidence the caller may request, not a control flow the
    code runs. A caller is free never to invoke it."""
    return kappa(R, R.fact(fid))


def state(R: Record, t: int) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for (rel, args) in list(R._chain.keys()):
        f = R.in_force(rel, args, t)
        if f is not None:
            out[f"{rel}({','.join(str(a) for a in args)})"] = f.value
    return out


def span(R: Record, fid: int) -> str:
    return R.fact(fid).span


def _live_at(R: Record, t: int):
    """The unmet requirements that were still reachable at this step: either an
    opportunity at or after it was left undecided, or none had come yet."""
    live = []
    for u in failed(R):
        q = Entity(*u["requirement"].split(":", 1))
        opps = could_have(R, q)
        if not opps or any(o["step"] >= t and not o["met"] for o in opps):
            live.append(str(q))
    return live


def _put_right_after(R: Record, f: Fact):
    """Whether anything the run was shown after this step re-established what it
    concerns. A later observation on the same key is the record putting the
    matter right, and condition 3 then rules the step out."""
    rel = R.relations.declared().get(f.rel)
    if rel is None or f.side == "env":
        return []
    key = tuple(str(f.args[i]) for i in rel.key)
    return [g.fid for g in R.F
            if g.rel == f.rel and g.side != "mind" and g.t > f.t
            and tuple(str(g.args[i]) for i in rel.key) == key][:6]


def contrast(R: Record, *fids: int) -> Dict[str, Any]:
    """Put candidates side by side against the three conditions.

    Ranking is not on offer. What is on offer is the one thing a reader cannot
    get by looking at candidates one at a time: which column actually separates
    them. A column on which every candidate agrees has told you nothing, whatever
    it says."""
    if len(fids) < 2:
        raise ValueError("contrast needs at least two facts")

    rows = []
    facts = [R.fact(x) for x in fids]
    reach = {f.fid: {g.fid for g in P.why()(R, [f])} for f in facts}
    for f in facts:
        v = kappa(R, f)
        put_right = _put_right_after(R, f)
        rows.append({
            "fid": f.fid, "step": f.t, "slot": f.slot,
            "states": repr(f)[:90],
            # condition 1: did its own content follow from what it had
            "verdict": v.value, "because": v.reason[:110],
            # condition 2: does the failure reach it, and is it downstream of a rival
            "requirements_live_here": _live_at(R, f.t),
            "reaches": sorted(reach[f.fid] & {g.fid for g in facts if g.fid != f.fid}),
            # condition 3: did anything afterwards put the matter right
            "put_right_after": put_right,
            "after_commit": any(g.t <= f.t and g.slot == "act" and R.commits(g)
                                and g.t < f.t for g in R.F),
        })
    cols = ("verdict", "requirements_live_here", "reaches",
            "put_right_after", "after_commit")
    same = [c for c in cols if len({repr(r[c]) for r in rows}) == 1]
    return {"rows": rows,
            "discriminates": [c for c in cols if c not in same],
            "tells_you_nothing": same}


# ---------------- retrieval by composition ------------------------------
def view(R: Record, spec: str) -> Dict[str, Any]:
    """Execute a declarative entity-evidence view program."""
    return V.program_view(R, spec)


# ---------------- requirements used by contrast --------------------------
def failed(R: Record) -> List[Dict[str, Any]]:
    """The goals the run left unsatisfied."""
    out = []
    for g in R.goals:
        if g.status_mode != "tracked":
            continue
        q = g.entity()
        met = [f for f in R.F if f.rel == g.rel and f.slot == "chk"
               and f.value is True and f.purpose is not None and str(f.purpose) == str(q)]
        if len(met) < g.count:
            out.append({"requirement": str(q), "needs": g.count, "met": len(met),
                        "expression": f"exists^{g.count} x: {g.of_kind} and "
                                      f"{g.rel}(x, {g.target}) {list(g.attrs)}"})
    return out


def could_have(R: Record, q: Entity) -> List[Dict[str, Any]]:
    if str(q) not in R.E:
        known = sorted(str(e) for e in R.E.values() if e.kind == "req")
        raise KeyError(f"{q} is not a requirement of this record; known: {known}")
    """The moments at which this requirement was decidable and was not decided.
    An omission has no fact of its own, so it is stated as an absence against an
    opportunity."""
    opps = [f for f in R.F if f.slot == "chk" and f.purpose is not None
            and str(f.purpose) == str(q)]
    decided = {f.t: f for f in opps if f.value is not None}
    offered = {f.t for f in R.F if f.slot == "obs" and f.purpose is not None
               and str(f.purpose) == str(q)}
    out = []
    for t in sorted(offered | set(decided)):
        g = decided.get(t)
        # `met` separates an opportunity the run took correctly from one it took
        # with a value the task did not name. An opportunity decided and not met
        # is sterile: arriving at it could never have discharged the requirement.
        out.append({"step": t, "decided": t in decided,
                    "met": (None if g is None else bool(g.value)),
                    "took": (None if g is None else str(g.args[-1]).split(":", 1)[-1])})
    return out


ACTION_SPACE = {"back": back, "up": up, "versions": versions, "neighbours": neighbours,
                "check": check, "state": state, "span": span, "contrast": contrast, "view": view}
