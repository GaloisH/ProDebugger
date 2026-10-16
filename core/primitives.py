"""Fact retrieval primitives.

A primitive retrieves and arranges. It decides nothing, and it holds no
threshold.
"""
from typing import Callable, Iterable, List, Set

from record import Record, Fact, Entity

Lens = Callable[[Record, List[Fact]], List[Fact]]


def _uniq(fs: Iterable[Fact]) -> List[Fact]:
    seen: Set[int] = set()
    out: List[Fact] = []
    for f in fs:
        if f.fid in seen:
            continue
        seen.add(f.fid)
        out.append(f)
    return sorted(out, key=lambda f: (f.t, f.fid))


def why(depth: int = 1 << 30) -> Lens:
    """Walk the dependence axis backwards from each fact, transitively."""
    def go(R: Record, fs: List[Fact]) -> List[Fact]:
        seen: Set[int] = set()
        order: List[Fact] = []
        stack = [f.fid for f in fs]
        while stack and len(order) < depth:
            i = stack.pop()
            if i in seen:
                continue
            seen.add(i)
            f = R.fact(i)
            order.append(f)
            stack.extend(reversed(f.basis))
        return _uniq(order)
    return go


def entity_facts(R: Record, e: Entity) -> List[Fact]:
    """Facts that mention the entity, including as a purpose. A requirement is
    rarely an argument of anything; it is what facts point at."""
    out = list(R.by_entity(e))
    out += [f for f in R.F if f.purpose is not None and str(f.purpose) == str(e)]
    return _uniq(out)
