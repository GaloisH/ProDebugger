"""Score whatever is in submissions/ against the annotation."""
import glob, json, os, sys, collections, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from data_io import load, gold

G = {r["trajectory_id"]: gold(r) for r in load("webshop")}
sub = {}
for p in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "submissions", "*.jsonl"))):
    for line in open(p):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        sub[d["trajectory_id"]] = d

n = len(G)
S = SM = ALL = T1 = 0
offs, calls, mcalls, forced, acc = [], [], [], 0, 0
for tid, g in G.items():
    d = sub.get(tid)
    if not d or d.get("step") is None:
        continue
    ok = d["step"] == g["step"]
    S += ok
    T1 += abs(d["step"] - g["step"]) <= 1
    SM += ok and d.get("module") == g["module"]
    ALL += ok and d.get("module") == g["module"] and d.get("fault_class") in g["types"]
    offs.append(d["step"] - g["step"])
    if d.get("operator_calls") is not None: calls.append(d["operator_calls"])
    if d.get("model_calls") is not None: mcalls.append(d["model_calls"])
    forced += bool(d.get("forced"))
    acc += bool(d.get("accepted"))

print(f"submissions {len(sub)}/{n}   accepted {acc}   forced {forced}\n")
print(f"{'metric':<26}{'hits':>6}{'rate':>9}")
for lbl, v in (("S   step exact", S), ("    step +-1", T1),
               ("S+M step + module", SM), ("ALL step+module+class", ALL)):
    print(f"{lbl:<26}{v:>6}{100*v/n:>8.1f}%")
if offs:
    o = sorted(offs)
    print(f"\noffset median {o[len(o)//2]}  early {sum(1 for x in offs if x<0)}"
          f"  at {sum(1 for x in offs if x==0)}  late {sum(1 for x in offs if x>0)}")
if calls:
    print(f"operator calls per trajectory: median {statistics.median(calls):.0f}, "
          f"max {max(calls)}")
if mcalls:
    print(f"model calls per trajectory:    median {statistics.median(mcalls):.0f}, "
          f"max {max(mcalls)}")
print("\nmodule confusion")
for (a, b), c in collections.Counter(
        (G[t]["module"], sub[t].get("module")) for t in sub if t in G).most_common(8):
    print(f"  gold {a:<11} -> {str(b):<11} {c}")
