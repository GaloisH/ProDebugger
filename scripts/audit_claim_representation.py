"""Offline inventory of agent-claim representation in archived records.

Counts describe structural coverage, not semantic correctness. Gold locations are
used only to inspect evaluation cases, never as input to a production parser.
No compilation, model calls, or changes to the archived runs are performed.
"""
import argparse
from collections import Counter
import json
from pathlib import Path


WRAPPERS = {"recalled_summary", "recalled_nothing", "memory_unparsed", "assessed", "planned"}
SLOTS = {"memory": "mem", "reflection": "refl", "plan": "plan", "action": "act"}


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def records(root):
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        path = folder / "canonical_record.json"
        if not path.exists():
            path = folder / "record.json"
        if path.exists():
            yield path, read(path)


def summarize(root):
    counts, relations, audits, intentions = Counter(), Counter(), Counter(), Counter()
    for path, record in records(root):
        counts["trajectories"] += 1
        for fact in record["facts"]:
            if fact["side"] != "mind":
                continue
            relations[fact["rel"]] += 1
            if fact["slot"] in {"mem", "refl", "plan"}:
                counts[fact["slot"] + "_facts"] += 1
                counts[fact["slot"] + "_nonwrapper_facts"] += fact["rel"] not in WRAPPERS
            if fact["rel"] == "recalled_nothing" and fact["span"].strip():
                counts["nonempty_memories_with_recalled_nothing"] += 1
            if fact["slot"] == "mem" and fact["rel"] == "satisfied" and fact["value"] is True:
                counts["current_completion_rule_trigger_facts"] += 1
        units = record.get("parse_audits")
        if units is None:
            units = list(read(path.parent / "audited_parse.json")["units"].values())
        audits.update(u["kind"] for u in units)
        intentions.update(i.get("extraction", "missing") for i in record.get("intentions", {}).values())
        counts["intentions_with_bound_verb"] += sum(i.get("verb") is not None for i in record.get("intentions", {}).values())
    for key in ("current_completion_rule_trigger_facts", "mem_nonwrapper_facts", "refl_nonwrapper_facts", "plan_nonwrapper_facts"):
        counts.setdefault(key, 0)
    counts["memory_modules"] = relations["recalled_summary"]
    counts["reflection_modules"] = relations["assessed"]
    counts["plan_modules"] = relations["planned"]
    return {"root": str(root), "counts": dict(counts), "mental_relations": dict(relations),
            "audited_unit_kinds": dict(audits), "intention_extractions": dict(intentions)}


def main(run, corpus, output):
    evaluation = read(run / "evaluation.json")
    cases = []
    for gold in evaluation["trajectories"]:
        folder = run / gold["trajectory_id"]
        record, source = read(folder / "canonical_record.json"), read(folder / "input.json")
        step, module = gold["gold_step"], gold["gold_module"]
        facts = [f for f in record["facts"] if f["t"] == step and f["slot"] == SLOTS[module]]
        cases.append({"trajectory_id": gold["trajectory_id"], "step": step, "module": module,
                      "original": source["steps"][step - 1]["parts"][module], "facts": facts,
                      "claim_scopes": {str(f["fid"]): record["claim_scopes"].get(str(f["fid"])) for f in facts},
                      "intention": record["intentions"].get(f"int:i{step}") if module == "plan" else None})
    result = {"method": __doc__, "latest_run": summarize(run), "gold_location_inventory": cases,
              "limitations": ["Raw text is retained; nonwrapper counts do not measure semantic completeness.",
                              "Plans have separate intention metadata: a planned wrapper does not mean no plan parsing.",
                              "Historical corpus snapshots are not a recompilation using today's parser.",
                              "No counterfactual model evaluation was run; causal effects on selection are unproven."],
              "model_calls": 0}
    if corpus:
        result["historical_corpus"] = summarize(corpus)
    output.mkdir(parents=True, exist_ok=True)
    (output / "inventory.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["解析表达覆盖审计（离线；非错误判定）", "", __doc__.strip(), ""]
    for key in ("latest_run", "historical_corpus"):
        if key in result:
            lines += [key, json.dumps(result[key], ensure_ascii=False, indent=2), ""]
    lines += ["标注位置当前事实/意图："]
    for case in cases:
        description = ", ".join(f"{f['fid']}:{f['rel']}" for f in case["facts"])
        lines += [f"{case['trajectory_id']} step={case['step']} module={case['module']}: {description}"]
        if case["intention"]:
            lines += ["  intention: " + json.dumps(case["intention"], ensure_ascii=False)]
    lines += ["", "Limits:", *result["limitations"]]
    (output / "inventory.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("latest_run", "historical_corpus") if k in result}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--corpus", type=Path)
    parser.add_argument("--output", type=Path, default=Path("artifacts/analysis/claim-representation-20261013"))
    args = parser.parse_args()
    main(args.run, args.corpus, args.output)
