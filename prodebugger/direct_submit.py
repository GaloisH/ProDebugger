"""One plain-JSON comparison of TRACE suspects, without debugger tool calls."""
import json

from .benchmark_scope import ALLOWED, scope, validate_cause
from .evidence_tools import ToolError
from .record_bridge import append_json, digest, plain
from local_judgement import SLOTS
from .submit_evidence import directed_context

POLICY = "window-candidates-submit/v5-manager-forced-choice"
from .window_trace import coverage as window_coverage


def disclose_root_roles(candidates):
    """Only show roles for distinct, definite TRACE step judgements.

    A single judgement, same-step alternatives, or one uncertain judgement plus
    one definite judgement does not establish the requested comparison context.
    These annotations are evidence for SUBMIT, never a candidate eligibility gate.
    """
    definite = [c for c in candidates if c["assessment"]["status"] == "error"
                and type(c["assessment"].get("is_root_cause")) is bool]
    return len({c["step"] for c in definite}) >= 2 and len({c["window"]["candidate_id"] for c in definite}) >= 2


def parse(content):
    if not isinstance(content, str):
        raise ToolError("invalid_direct_submit", "SUBMIT must return a JSON object")
    value = content.strip()
    if value.startswith("```") and value.endswith("```"):
        lines = value.split("\n", 1)
        value = lines[1].rsplit("```", 1)[0].strip() if len(lines) == 2 else ""
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise ToolError("invalid_direct_submit", f"Invalid JSON at character {exc.pos}: {exc.msg}; "
                        f"near {value[max(0, exc.pos-50):exc.pos+50]!r}. Return one JSON object.") from exc


def packet(tools):
    from .trace_manager import submit_guidance
    candidates = []
    for window in tools.windows.windows:
        event = tools.window_conclusions.get(window["candidate_id"])
        if event is None:
            continue
        for index, judgement in enumerate(event["candidates"], 1):
            t = judgement["step"]
            candidates.append({"candidate_id": f"trace-window:{window['candidate_id']}:{index}",
                "window": {k: window[k] for k in ("candidate_id", "lo", "hi")},
                "step": t, "module": judgement["module"], "assessment": plain(judgement)})
    show_roles = disclose_root_roles(candidates)
    for candidate in candidates:
        judgement = candidate["assessment"]
        if not show_roles or judgement["status"] != "error" or type(judgement.get("is_root_cause")) is not bool:
            candidate["assessment"].pop("is_root_cause", None)
    coverage = window_coverage(tools)
    return {"schema": "direct-submit-input/v2", "policy": POLICY,
            "task": tools.bundle.source["task"], "benchmark_scope": scope(),
            "coverage": {"windows": [{k: w[k] for k in ("candidate_id", "lo", "hi")}
                                      for w in tools.windows.windows],
                         **{k: coverage[k] for k in ("selected_steps", "assessed_steps", "unassessed_steps", "trace_complete")}},
            "candidates": candidates,
            "window_reviews": [{"window_id": w["candidate_id"],
                "candidate_ids": [c["candidate_id"] for c in candidates if c["window"]["candidate_id"] == w["candidate_id"]],
                "uncertainty": tools.window_conclusions[w["candidate_id"]]["conclusion"]["uncertainty"]}
                for w in tools.windows.windows if w["candidate_id"] in tools.window_conclusions],
            **directed_context(tools.bundle.source, candidates), **submit_guidance(tools),
            "instruction": "Select one existing candidate and return the required diagnosed JSON without tools. "
                           "Compare actual source support, causal dependence and recovery; qualify remaining evidence gaps. "
                           "Local context and related excerpts are incomplete evidence, not a complete execution history."
                           + (" Known root-role opinions are disclosed for distinct definite worker findings; "
                              "they are not eligibility rules or votes." if show_roles else "")}


def _text(value, field, required=True):
    if not isinstance(value, str) or (required and not value.strip()):
        raise ToolError("invalid_direct_submit", f"{field} must be a nonempty string")
    return value.strip()


def normalize(tools, answer):
    keys = {"status", "selected_candidate_id", "fault_class", "output_quote", "reasoning", "comparisons", "repair", "uncertainty"}
    if not isinstance(answer, dict) or set(answer) != keys:
        raise ToolError("invalid_direct_submit", f"return exactly {sorted(keys)}")
    inputs = packet(tools)
    if not inputs["coverage"]["trace_complete"]:
        raise ToolError("invalid_direct_submit", "TRACE coverage is incomplete")
    candidates = {c["candidate_id"]: c for c in inputs["candidates"]}
    if not candidates:
        raise ToolError("invalid_direct_submit", "no TRACE candidates; skip SUBMIT and record no_candidate")
    if answer["status"] != "diagnosed":
        raise ToolError("invalid_direct_submit", "SUBMIT status must be diagnosed; select one existing candidate, including a TRACE uncertain candidate")
    comparisons = answer["comparisons"]
    if not isinstance(comparisons, list):
        raise ToolError("invalid_direct_submit", "comparisons must be a list")
    seen = set()
    for row in comparisons:
        if not isinstance(row, dict) or set(row) != {"candidate_id", "reasoning"}:
            raise ToolError("invalid_direct_submit", "comparison needs candidate_id and reasoning")
        cid = row["candidate_id"]
        if not isinstance(cid, str) or cid not in candidates or cid in seen:
            raise ToolError("invalid_direct_submit", "unknown or duplicate comparison candidate")
        seen.add(cid)
        _text(row["reasoning"], "comparison.reasoning")
    if seen != set(candidates):
        raise ToolError("invalid_direct_submit", "compare every TRACE suspect exactly once")
    reason = _text(answer["reasoning"], "reasoning")
    _text(answer["uncertainty"], "uncertainty", False)
    root, selected = None, answer["selected_candidate_id"]
    if answer["status"] == "diagnosed":
        if not isinstance(selected, str) or selected not in candidates:
            raise ToolError("invalid_direct_submit", "select an existing TRACE candidate")
        candidate = candidates[selected]
        t, module = candidate["step"], candidate["module"]
        judgement = candidate["assessment"]
        fault_class = answer["fault_class"]
        if fault_class not in ALLOWED[module]:
            raise ToolError("invalid_direct_submit", "use a permitted class for the selected module")
        validate_cause(module, {"status": "error", "proposition": reason})
        quote = _text(answer["output_quote"], "output_quote")
        source = tools.bundle.source["steps"][t - 1]["parts"].get(module) or ""
        if quote not in source:
            raise ToolError("invalid_direct_submit", "output_quote must exactly match the selected module's original text")
        owned = [f for f in tools.index.facts.values() if f.t == t and f.side == "mind" and f.slot == SLOTS[module]]
        if not owned:
            raise ToolError("invalid_direct_submit", "selected module has no existing Fact; cannot invent one")
        matching = [f for f in owned if f.span and (f.span in quote or quote in f.span)]
        fid = judgement["primary_fid"] if judgement["status"] == "error" else (max(matching, key=lambda f: len(f.span)) if matching else owned[0]).fid
        _text(answer["repair"], "repair")
        root = {"root_id": selected, "step": t, "module": module,
                "fid": fid, "fault_class": fault_class, "source_trace_status": judgement["status"],
                "output_quote": quote,
                "status": "error", "proposition": judgement["proposition"],
                "reasoning": reason, "goal_links": judgement["requirement_links"],
                "supporting_fids": list(dict.fromkeys([fid, *judgement["evidence_for"]])), "counterevidence": judgement["evidence_against"]}
    return {"schema": "debugger-result/v1", "status": answer["status"], "accepted": root is not None,
            "policy": POLICY, "root": root, "reasoning": reason,
            "supporting_evidence": root["supporting_fids"] if root else [],
            "counterevidence": root["counterevidence"] if root else [], "causal_chain": [],
            "repair": answer["repair"], "uncertainty": answer["uncertainty"],
            "alternatives": [c for c in inputs["candidates"] if c["candidate_id"] != selected],
            "candidate_comparisons": comparisons, "coverage": window_coverage(tools),
            "benchmark_scope": scope(), "stop_reason": "direct TRACE-candidate comparison completed",
            "semantic_verdict": "Model judgement under the user's benchmark premise; structural validation only"}


def commit(tools, answer, response_turn, *, record=True, expected=None):
    key = str(response_turn)
    if key in tools.direct_completed:
        event = tools.direct_completed[key]
        if digest(event["raw_answer"]) != digest(answer):
            raise ToolError("source_mismatch", "direct response turn reused with a different answer")
        return event
    result = normalize(tools, answer)
    event = {"schema": "direct-submit-answer/v1", "event": "committed", "phase": "SUBMIT",
             "response_turn": response_turn, "after_tool_calls": tools.call_count,
             "packet_digest": digest(packet(tools)), "raw_answer": plain(answer), "result": result}
    if expected and (event["packet_digest"] != expected["packet_digest"]
                     or digest(result) != digest(expected["result"])):
        raise ToolError("source_mismatch", "direct answer replay changed")
    if record and tools.output:
        append_json(tools.output / "direct_submit.jsonl", event)
    tools.direct_completed[key] = event
    tools.result = result
    return event
