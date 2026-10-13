"""Offline audit of saved TRACE queries; no API requests and no run mutation.

Labels are read only here for post-run comparison. Counterfactual retrievals
are kept separate from the actual rows provided to the model.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pyarrow.parquet as pq
import sqlglot
from prodebugger.debug_tools import DebugTools
from prodebugger.query_dsl import QueryEngine
from prodebugger.record_bridge import build_bundle, digest, read_json, write_json


def jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def row_step(row):
    return row.get("step")


def module_coverage(rows, source):
    """Require the original step ID plus the entire original module text.

    A fact mentioning a step does not establish raw module visibility. Repeated
    module texts at different steps are credited only to the row's own step.
    """
    found = set()
    for row in rows:
        step = row_step(row)
        if type(step) is not int or not 1 <= step <= len(source["steps"]):
            continue
        strings = [v for v in row.values() if isinstance(v, str)]
        for module, original in source["steps"][step - 1]["parts"].items():
            if original and any(original in value for value in strings):
                found.add((step, module))
    return sorted(found)


def describe(rows, source):
    covered = module_coverage(rows, source)
    counts = Counter(step for step, module in covered)
    return {"row_count": len(rows),
            "row_bytes": sum(len(json.dumps(r, ensure_ascii=False).encode()) for r in rows),
            "explicit_steps": sorted({row_step(r) for r in rows if type(row_step(r)) is int}),
            "row_types": dict(Counter(str(r.get("record_type", r.get("kind", "untyped"))) for r in rows)),
            "module_coverage": [list(pair) for pair in covered],
            "all_four_modules_steps": sorted(s for s, n in counts.items() if n == 4),
            "rows_per_step": dict(sorted(Counter(row_step(r) for r in rows if type(row_step(r)) is int).items()))}


def replay(tools, sql, *, unbounded=False, direct=False):
    engine = QueryEngine(tools)
    try:
        if direct:
            return {"rows": [dict(r) for r in engine.conn.execute(sql)]}
        return engine.execute(sql, **({"max_rows": 10000, "max_bytes": 20000000} if unbounded else {}))
    except Exception as exc:
        return {"error": str(exc), "rows": []}
    finally:
        engine.close()


def restore_archived_facts(bundle, saved):
    """Preserve live-run IDs despite set iteration in product mention parsing."""
    from record import Entity, Fact
    from prodebugger.dsl import Entity as DEntity, Fact as DFact
    for record, fact_type, entity_type in ((bundle.record, Fact, Entity),
                                          (bundle.projection, DFact, DEntity)):
        record.F = [fact_type(**{**f,
            "args": tuple(entity_type(**a) for a in f["args"]),
            "basis": tuple(f["basis"]),
            "purpose": entity_type(**f["purpose"]) if f["purpose"] else None}) for f in saved["facts"]]
        for name in ("_chain", "_by_entity", "_by_step", "_by_rel"):
            setattr(record, name, defaultdict(list))
        for f in record.F:
            record._chain[f.key()].append(f.fid)
            record._by_step[f.t].append(f.fid)
            record._by_rel[f.rel].append(f.fid)
            for entity in f.args:
                record._by_entity[str(entity)].append(f.fid)
    bundle.record.process_notes = {int(k): v for k, v in saved["process_notes"].items()}


def audit(run, data_dir):
    manifest = read_json(run / "manifest.json")
    labels = {}
    for path in data_dir.glob("*.parquet"):
        for row in pq.read_table(path, filters=[("trajectory_id", "in", manifest["trajectory_ids"])],
                columns=["trajectory_id", "critical_failure_step", "critical_failure_module", "failure_reasonings"]).to_pylist():
            labels[row["trajectory_id"]] = row
    trajectories = []
    for tid in manifest["trajectory_ids"]:
        folder = run / tid
        source = read_json(folder / "input.json")
        bundle = build_bundle(source, audited=read_json(folder / "audited_parse.json"))
        saved_record = read_json(folder / "canonical_record.json")
        recompiled_identical = digest(bundle.snapshot()) == digest(saved_record)
        restore_archived_facts(bundle, saved_record)
        assert digest(bundle.snapshot()) == digest(saved_record), tid
        traces = jsonl(folder / "window_trace.jsonl")
        tools = DebugTools(bundle)
        tools.windows.configure([{k: event["window"][k] for k in
            ("candidate_id", "issue_step", "issue_fids", "goal_links", "hypothesis")} for event in traces])
        label = labels[tid]
        gs, gm = label["critical_failure_step"], label["critical_failure_module"]
        queries = []
        for saved in jsonl(folder / "trace_queries.jsonl"):
            trace = next(t for t in traces if t["window_id"] == saved["candidate_id"])
            current = replay(tools, saved["query"])
            assert current["rows"] == saved["rows"], (tid, saved["candidate_id"])
            if "error" in saved:
                assert current["error"] == saved["error"]["message"]
            else:
                assert current["truncated"] == saved["truncated"]
            tree = sqlglot.parse_one(saved["query"], read="sqlite")
            sql_limit = tree.args.get("limit")
            before_engine_cap = replay(tools, saved["query"], unbounded=True)
            tree.set("limit", None)
            without_limit = replay(tools, tree.sql(dialect="sqlite"), unbounded=True)
            actual = describe(saved["rows"], source)
            before_cap = describe(before_engine_cap["rows"], source)
            before_limit = describe(without_limit["rows"], source)
            anchor = trace["window"]["issue_step"]
            query = {"candidate_id": saved["candidate_id"], "anchor": anchor,
                "sql": saved["query"], "error": saved.get("error"),
                "function_scopes": saved.get("function_scopes", []),
                "actual": actual, "reported_returned_steps": saved["returned_steps"],
                "engine_truncated": saved["truncated"],
                "sql_top_level_limit": sql_limit.expression.this if sql_limit else None,
                "counterfactual_same_sql_without_engine_cap": before_cap,
                "counterfactual_without_engine_cap_or_top_limit": before_limit,
                "rows_lost_to_engine_cap": before_cap["row_count"] - actual["row_count"],
                "rows_lost_to_sql_limit": before_limit["row_count"] - before_cap["row_count"],
                "gold_module_in_query": [gs, gm] in actual["module_coverage"],
                "gold_module_in_anchor": anchor == gs,
                "gold_module_visible": anchor == gs or [gs, gm] in actual["module_coverage"],
                "route_hypothesis": trace["window"]["hypothesis"],
                "trace_candidates": trace["candidates"], "trace_uncertainty": trace["conclusion"]["uncertainty"]}
            if saved.get("error"):
                query["original_sql_direct_sqlite_error"] = replay(tools, saved["query"], direct=True).get("error")
                fixed_tree = sqlglot.parse_one(saved["query"], read="sqlite")
                fixed_tree.set("order", sqlglot.parse_one("SELECT 1 ORDER BY 2,1,10", read="sqlite").args["order"])
                fixed = replay(tools, fixed_tree.sql(dialect="sqlite"), unbounded=True)
                query["counterfactual_positional_order_fix"] = {
                    "sql": fixed_tree.sql(dialect="sqlite"), "error": fixed.get("error"), **describe(fixed["rows"], source)}
            queries.append(query)
        result = read_json(folder / "result.json")
        trajectories.append({"trajectory_id": tid, "gold_step": gs, "gold_module": gm,
            "recompiled_snapshot_identical_before_restoring_archived_ids": recompiled_identical,
            "gold_reasoning": label["failure_reasonings"],
            "gold_original_module": source["steps"][gs - 1]["parts"][gm],
            "result": result["root"], "submit_reasoning": result.get("reasoning"),
            "gold_visible_any_case": any(q["gold_module_visible"] for q in queries),
            "gold_step_module_in_trace": any(c["step"] == gs and c["module"] == gm for q in queries for c in q["trace_candidates"]),
            "queries": queries})
    queries = [q for t in trajectories for q in t["queries"]]
    output = {"method": "Offline replay using the saved audited parse and archived canonical facts (preserving IDs despite unordered product mention extraction). Restored canonical snapshot and actual returned rows verified exactly. No API calls. Labels used only in this report. Counterfactuals were NOT visible to the model. Complete module visibility is not causal correctness.",
        "summary": {"tasks": len(trajectories), "queries": len(queries),
            "query_errors": sum(bool(q["error"]) for q in queries),
            "engine_truncations": sum(q["engine_truncated"] for q in queries),
            "sql_limits_omitting_rows": sum(q["rows_lost_to_sql_limit"] > 0 for q in queries),
            "queries_with_truncated_graph_functions": sum(any(f.get("truncated") for f in q["function_scopes"]) for q in queries),
            "nonempty_trace_cases": sum(bool(q["trace_candidates"]) for q in queries),
            "nonempty_trace_cases_selecting_route_anchor": sum(bool(q["trace_candidates"]) and q["trace_candidates"][0]["step"] == q["anchor"] for q in queries),
            "tasks_with_gold_module_visible": sum(t["gold_visible_any_case"] for t in trajectories),
            "queries_with_gold_module_visible": sum(q["gold_module_visible"] for q in queries)},
        "trajectories": trajectories}
    write_json(run / "query_audit.json", output)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--data-dir", type=Path, default=Path("core/data"))
    args = parser.parse_args()
    output = audit(args.run, args.data_dir)
    print(json.dumps(output["summary"], ensure_ascii=False, indent=2))
    for task in output["trajectories"]:
        print(task["trajectory_id"], "gold", task["gold_step"], task["gold_module"])
        for q in task["queries"]:
            print(q["candidate_id"], "anchor", q["anchor"], "rows", q["actual"]["row_count"],
                "lost_cap", q["rows_lost_to_engine_cap"], "lost_limit", q["rows_lost_to_sql_limit"],
                "full_modules_steps", q["actual"]["all_four_modules_steps"], "gold_visible", q["gold_module_visible"])
