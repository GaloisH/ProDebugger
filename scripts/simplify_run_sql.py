"""Convert every saved query in a run and prove ordered-row/source equivalence.

Reads published archives without modifying historical requests, results or metrics.
No model/API calls. The output is a derived SQL view, not a new diagnosis run.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import sqlglot
from sqlglot import exp
from prodebugger.debug_tools import DebugTools
from prodebugger.query_dsl import execute, RecordSQLite
from prodebugger.query_simplify import simplify_sql
from prodebugger.record_bridge import build_bundle, read_json, write_json, valid_id
from scripts.audit_trace_queries import restore_archived_facts

DEFAULT_RUN = "evidence-query-claims-n30-20261013"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sparse(rows):
    return [{k: v for k, v in row.items() if v is not None} for row in rows]


def syntax_counts(sql):
    tree = sqlglot.parse_one(sql, read=RecordSQLite)
    def null_placeholder(node):
        while isinstance(node, (exp.Alias, exp.Cast, exp.Paren)):
            node = node.this
        return isinstance(node, exp.Null)
    return {"chars": len(sql), "selects": len(list(tree.find_all(exp.Select))),
            "projection_fields": sum(len(s.expressions) for s in tree.find_all(exp.Select)),
            "null_placeholders": sum(null_placeholder(n) for n in tree.find_all(exp.Alias)),
            "element_calls": sum(isinstance(t.this, exp.Anonymous) for t in tree.find_all(exp.Table))}


def convert(tools, saved, folder):
    sql = simplify_sql(saved["query"])
    before, after = execute(tools, saved["query"]), execute(tools, sql)
    for result in (before, after):
        if result.get("error") or result.get("partial") or result.get("truncated"):
            raise ValueError(f"Cannot certify incomplete query: {result.get('error') or result.get('function_errors')}")
    checks = {
        "old_engine_reproduces_saved_rows": before["rows"] == saved["rows"],
        "ordered_rows_equal_ignoring_null_keys": sparse(after["rows"]) == sparse(saved["rows"]),
        "columns_equal": after["columns"] == saved["columns"],
        "source_fragments_equal": after["claim_fragments"] == saved["claim_fragments"],
        "returned_steps_equal": after["returned_steps"] == saved["returned_steps"],
        "returned_fids_equal": after["returned_fids"] == saved["returned_fids"],
        "no_null_values_in_sparse_rows": all(v is not None for row in after["rows"] for v in row.values()),
    }
    if not all(checks.values()):
        raise ValueError(f"Conversion changed evidence: {checks}")
    aid = valid_id(saved["candidate_id"])
    after["candidate_id"] = aid
    # Visibility and order are proved identical above. Reuse the archived parser
    # sidecar, including anchor/assigned clauses, without pretending to call an LLM.
    if "agent_statements" in saved:
        after["agent_statements"] = saved["agent_statements"]
    after["conversion"] = {
        "kind": "offline_sql_translation", "historical_model_response": False,
        "original_query_sha256": sha(saved["query"].encode()),
        "compact_query_sha256": sha(sql.encode()), "checks": checks,
        "agent_statements_origin": "unchanged archived sidecar after exact fragment-visibility verification",
        "model_api_calls": 0,
    }
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{aid}.sql").write_text(sql, encoding="utf-8")
    write_json(folder / f"{aid}.result.json", after)
    before_metrics, after_metrics = syntax_counts(saved["query"]), syntax_counts(sql)
    return after, {"candidate_id": aid, "before": before_metrics, "after": after_metrics,
        "rows": len(after["rows"]), "null_values_omitted": sum(v is None for row in saved["rows"] for v in row.values()),
        "checks": checks, "query_sha256": after["conversion"]["compact_query_sha256"]}


def read_archive(path, run, tid, index):
    recorded = next(item for item in index["archives"] if item["archive"] == path.name)
    if sha(path.read_bytes()) != recorded["sha256"]:
        raise ValueError(f"Archive checksum mismatch: {tid}")
    required = ("input.json", "audited_parse.json", "canonical_record.json", "result.json")
    optional = ("trace_queries.jsonl", "window_trace.jsonl")
    result = {}
    members = {m["path"]: m for m in recorded["members"]}
    with tarfile.open(path) as handle:
        for name in (*required, *optional):
            target = f"{run}/{tid}/{name}"
            if target not in members and name in optional:
                result[name] = []
                continue
            stream = handle.extractfile(target)
            if stream is None:
                raise ValueError(f"Missing archive member {target}")
            raw = stream.read()
            if sha(raw) != members[target]["sha256"]:
                raise ValueError(f"Archive member checksum mismatch: {target}")
            result[name] = ([json.loads(line) for line in raw.splitlines() if line.strip()]
                            if name.endswith(".jsonl") else json.loads(raw))
    return result, recorded["sha256"]


def totals(rows):
    queries = [q for row in rows for q in row["queries"]]
    result = {"tasks": len(rows), "tasks_with_queries": sum(bool(row["queries"]) for row in rows),
        "queries": len(queries), "verified_queries": sum(all(q["checks"].values()) for q in queries),
        "rows": sum(q["rows"] for q in queries),
        "null_values_omitted": sum(q["null_values_omitted"] for q in queries), "model_api_calls": 0}
    for side in ("before", "after"):
        result[side] = {key: sum(q[side][key] for q in queries) for key in
                        ("chars", "selects", "projection_fields", "null_placeholders", "element_calls")}
    result["query_chars_reduction_percent"] = round(100 * (1 - result["after"]["chars"] / result["before"]["chars"]), 2)
    return result


def migrate(run, output):
    summary = ROOT / "results" / "summary" / run
    traces = ROOT / "results" / "traces" / run
    manifest = read_json(summary / "manifest.json")
    archive_index = read_json(summary / "trace_archives.json")
    originals = list(summary.glob("*.json")) + list(traces.glob("*.tar.gz"))
    hashes = {str(p): sha(p.read_bytes()) for p in originals}
    tasks, examples = [], []
    for tid in manifest["trajectory_ids"]:
        archived, archive_sha = read_archive(traces / f"{tid}.tar.gz", run, tid, archive_index)
        bundle = build_bundle(archived["input.json"], audited=archived["audited_parse.json"])
        restore_archived_facts(bundle, archived["canonical_record.json"])
        tools = DebugTools(bundle)
        windows = archived["window_trace.jsonl"]
        if windows:
            tools.windows.configure([{k: item["window"][k] for k in
                ("candidate_id", "issue_step", "issue_fids", "goal_links", "hypothesis")} for item in windows])
        task_dir = output / tid
        task_dir.mkdir(parents=True)
        converted, reports = [], []
        for saved in archived["trace_queries.jsonl"]:
            result, report = convert(tools, saved, task_dir)
            converted.append(result)
            reports.append(report)
        (task_dir / "trace_queries.jsonl").write_text("".join(json.dumps(q, ensure_ascii=False) + "\n" for q in converted), encoding="utf-8")
        lines = [f"# {tid}：简化 SQL", "",
            "从原运行转换并离线验证的查询视图，不是新的模型运行。JSON 行仅省略 NULL 键；原始模型响应及诊断结论保留在上层归档。", ""]
        for q in reports:
            aid = q['candidate_id']
            lines += [f"- [{aid}.sql]({aid}.sql)：{q['before']['chars']} → {q['after']['chars']} 字符，{q['rows']} 行；[完整返回]({aid}.result.json)。"]
        if not reports:
            lines += [f"原任务状态为 `{archived['result.json']['status']}`，没有进入 TRACE 查询；因此无 SQL 可转换，没有补造查询。"]
        (task_dir / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        tasks.append({"trajectory_id": tid, "source_archive_sha256": archive_sha,
            "historical_status": archived["result.json"]["status"], "queries": reports})

        # The six manually authored examples retain their explicit provenance.
        example_dir = traces / "constructed" / tid
        if (example_dir / "query_result.json").exists():
            saved = read_json(example_dir / "query_result.json")
            result, report = convert(tools, saved, output / "constructed" / tid)
            provenance = read_json(example_dir / "provenance.json")
            write_json(output / "constructed" / tid / "provenance.json", provenance)
            examples.append({"trajectory_id": tid, "synthetic": True, "include_in_benchmark": False,
                "source_query_result_sha256": sha((example_dir / "query_result.json").read_bytes()), "queries": [report]})
    if hashes != {str(p): sha(p.read_bytes()) for p in originals}:
        raise ValueError("An original run artifact changed during migration")
    report = {"schema": "compact-sql-migration/v1", "run": run,
        "method": "AST translation plus offline execution; exact ordered-row equality after dropping null-valued keys; exact source-fragment equality; no model calls",
        "original_artifacts_unchanged": True, "summary": totals(tasks),
        "constructed_summary": totals(examples) if examples else {}, "tasks": tasks, "constructed_examples": examples}
    write_json(output / "report.json", report)
    lines = ["# 30 任务 SQL 简化与核对", "",
        "批量关键词/模块检索减少重复 SELECT；UNION ALL BY NAME 按字段名合并分支，省略 NULL 占位；返回 JSON 只包含非空字段。旧标量语法仍兼容。", "",
        "这是原 SQL 的派生视图：不改写实际模型请求、诊断结论或评测成绩。所有查询在原输入与存档解析上离线重放；没有重新调用 LLM。", "",
        f"{len(tasks)} 个任务全部覆盖，{report['summary']['queries']} 条实际 SQL 全部核对通过；另转换 {len(examples)} 条人工示范 SQL。没有查询的任务明确保留无查询状态。", "",
        "| 任务 | SQL 数 | 字符数（原 → 简化） |", "|---|---:|---:|"]
    for row in tasks:
        qs = row['queries']
        lines.append(f"| [{row['trajectory_id']}]({row['trajectory_id']}/README.md) | {len(qs)} | {sum(q['before']['chars'] for q in qs)} → {sum(q['after']['chars'] for q in qs)} |")
    lines += ["", "核对项目：原查询复现存档返回；省略 NULL 后返回行逐条、顺序一致；列名顺序、Fact ID、step 和原文片段完全一致。已有语义解析侧信息在引用可见性一致后原样保留，不冒充新增解析调用。", "",
        "字段缺失表示 unknown，不代表 false。0、false 和空字符串保留。SQL 内部仍按 NULL 语义执行 WHERE/IS NULL、排序与聚合；仅序列化时省略空键。", "",
        "## 六条人工示范", ""]
    for row in examples:
        tid, q = row['trajectory_id'], row['queries'][0]
        lines.append(f"- [{tid}](constructed/{tid}/{q['candidate_id']}.sql)：{q['before']['chars']} → {q['after']['chars']} 字符。")
    lines += ["", "[机器可读核对报告](report.json)。每个 .result.json 记录新的执行结果和原查询摘要；原始归档位于上一层。", ""]
    (output / "README.md").write_text("\n".join(lines), encoding="utf-8")
    write_json(output / "manifest.json", {"run": run, "derived": True, "files": [
        {"path": str(p.relative_to(output)), "bytes": p.stat().st_size, "sha256": sha(p.read_bytes())}
        for p in sorted(output.rglob("*")) if p.is_file()]})
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", default=DEFAULT_RUN)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    valid_id(args.run)
    output = args.output or ROOT / "results" / "traces" / args.run / "compact_sql"
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")
    with tempfile.TemporaryDirectory(prefix="prodebugger-sql-") as temporary:
        staging = Path(temporary) / "compact_sql"
        staging.mkdir()
        report = migrate(args.run, staging)
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(staging, output)
    print(json.dumps({"output": str(output), "summary": report["summary"],
                      "constructed_summary": report["constructed_summary"]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
