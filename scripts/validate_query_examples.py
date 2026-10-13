"""Execute the exact SQL examples in the prompt against saved source-only inputs.

No model requests or benchmark label/reference reads. Audit snapshots are reused
offline; the report records actual rows, coverage limits and original-source checks.
"""
import argparse
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prodebugger.debug_tools import DebugTools
from prodebugger.query_dsl import documentation, execute
from prodebugger.query_trace import packet
from prodebugger.record_bridge import build_bundle, digest, read_json, write_json


def validate(corpus):
    examples = re.findall(r"<!-- real-example: (\S+) anchor=(\d+) -->\s*```sql\n(.*?)\n```",
                          documentation(), flags=re.S)
    if len(examples) != 4:
        raise ValueError("Expected all four documented source examples")
    reports = []
    for tid, anchor, sql in examples:
        source = read_json(corpus / tid / "input.json")
        audited = read_json(corpus / tid / "audited_parse.json")
        tools = DebugTools(build_bundle(source, audited=audited))
        anchor = int(anchor)
        fid = next(f.fid for f in tools.bundle.record.F if f.t == anchor and f.slot == "plan")
        case = {"candidate_id": "example", "issue_step": anchor, "issue_fids": [fid],
                "goal_links": [], "hypothesis": "Verify a disputed claim against original elements."}
        tools.windows.configure([case])
        result = execute(tools, sql)
        if result.get("error") or result["truncated"] or not result["rows"]:
            raise ValueError(f"{tid}: failed, empty or truncated example: {result}")
        earlier = sorted({r["step"] for r in result["rows"] if r["step"] < anchor})
        if not earlier:
            raise ValueError(f"{tid}: no evidence preceding the anchor")
        verified = 0
        for row in result["rows"]:
            step = source["steps"][row["step"] - 1]
            original = step["env_text"] if row["module"] == "observation" else step["parts"].get(row["module"])
            if original is not None:
                if row["text"] not in original:
                    raise ValueError(f"{tid}: result is not an exact original source substring: {row}")
                verified += 1
        reports.append({"trajectory_id": tid, "anchor": anchor, "source_digest": digest(source),
                        "query_context": packet(tools, tools.windows.windows[0])["query_context"],
                        "earlier_returned_steps": earlier, "source_substrings_verified": verified,
                        "result": result})
    return {"method": "Execute exact prompt SQL on archived input.json/audited_parse.json; no model or label reads.",
            "example_count": len(reports), "examples": reports}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("artifacts/analysis/query-guidance-examples-20261013/validation.json"))
    args = parser.parse_args()
    report = validate(args.corpus)
    write_json(args.output, report)
    for item in report["examples"]:
        print(f"{item['trajectory_id']}: anchor={item['anchor']}, rows={item['result']['returned_rows']}, "
              f"earlier_steps={item['earlier_returned_steps']}, truncated=False")
    print(f"Saved {args.output}")


if __name__ == "__main__":
    main()
