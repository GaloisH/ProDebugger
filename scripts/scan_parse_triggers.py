"""Survey every task/observation without loading benchmark answer columns."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pyarrow.parquet as pq
from prodebugger.parse_audit import TRIGGER_CATEGORIES, audit
from prodebugger.record_bridge import PROFILES, plain, write_json
from data_io import _TASK, _OBS


def scan(data_dir):
    rows = []
    for path in sorted(Path(data_dir).glob("*.parquet")):
        rows.extend(pq.read_table(path, columns=["trajectory_id", "task_type", "full_trajectory"]).to_pylist())
    units, template_counts, reasons = [], Counter(), Counter()
    for row in rows:
        messages = json.loads(row["full_trajectory"])["messages"]
        task = _TASK.search(messages[0]["content"]) if messages else None
        if row["task_type"] == "gaia" and messages:
            task = re.search(r"\nTask:\s*(.*?)(?=\n\n)", messages[0]["content"], re.S)
        if task:
            units.append({"trajectory_id": row["trajectory_id"], "task_type": row["task_type"],
                          "kind": "task", "step": 0, "text": task.group(1).strip()})
        for n, message in enumerate(m for m in messages if m["role"] == "user"):
            match = _OBS.search(message["content"])
            # GAIA has no supported observation adapter. Keep its messages in
            # a separate bucket; they contain repeated history and instructions.
            units.append({"trajectory_id": row["trajectory_id"], "task_type": row["task_type"],
                          "kind": "observation" if match else "raw_user", "step": n + 1,
                          "text": match.group(1).strip() if match else message["content"]})
    tasks = {u["trajectory_id"]: u["text"] for u in units if u["kind"] == "task"}
    for u in units:
        if u["task_type"] not in PROFILES or u["kind"] == "raw_user":
            continue
        profile = PROFILES[u["task_type"]]
        proposed = plain(profile.parse_goal(u["text"]) if u["kind"] == "task" else profile.parse_observation(u["text"], []))
        review = audit(u["kind"], u["text"], proposed, profile, task=tasks.get(u["trajectory_id"], ""))
        template_counts[f"{u['task_type']}/{u['kind']}/" + ("backoff_required" if review["reasons"] else "template_candidate")] += 1
        reasons.update(reason.split(":", 1)[0] for reason in review["reasons"])
    categories = {}
    for category, terms in TRIGGER_CATEGORIES.items():
        entries = []
        for term in terms.split("|"):
            pattern = re.compile(r"\b" + re.escape(term).replace(r"\ ", r"\s+") + r"\b", re.I)
            groups, examples, occurrences = Counter(), defaultdict(list), 0
            for u in units:
                matches = list(pattern.finditer(u["text"]))
                if not matches:
                    continue
                group = f"{u['task_type']}/{u['kind']}"
                groups[group] += 1
                occurrences += len(matches)
                if len(examples[group]) < 3:
                    m = matches[0]
                    examples[group].append({k: v for k, v in u.items() if k != "text"} | {
                        "excerpt": u["text"][max(0, m.start() - 90):m.end() + 130]})
            entries.append({"phrase": term, "units": sum(groups.values()), "occurrences": occurrences,
                            "by_type": dict(groups), "examples": dict(examples)})
        categories[category] = entries
    return {"rows": len(rows), "task_types": dict(Counter(r["task_type"] for r in rows)),
            "units": len(units), "unit_counts": dict(Counter(f"{u['task_type']}/{u['kind']}" for u in units)),
            "labels_read": False, "audit_admission": dict(template_counts), "audit_reasons": dict(reasons),
            "limitations": "GAIA raw_user includes repeated history/instructions; its counts are separate. "
                           "Template counts are admission candidates, still requiring output validation. "
                           "Corpus frequency does not establish semantic parsing correctness.",
            "categories": categories}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("core/data"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/analysis/trigger_scan.json"))
    args = parser.parse_args()
    result = scan(args.data_dir)
    write_json(args.output, result)
    print(json.dumps({k: v for k, v in result.items() if k != "categories"}, ensure_ascii=False, indent=2))
