"""Pre-query allocation and conditional interpretation, never a causal verdict."""
import re

from .evidence_tools import ToolError
from .record_bridge import plain, digest
from .evidence_quality import evidence_quality
from .claim_parser import MENTAL, cards, fragment, payload as claim_payload

SCHEMA_VERSION = "trace-investigation-plan/v1"
TEXT = {"type": "string", "minLength": 1}


def obj(properties):
    return {"type": "object", "additionalProperties": False,
            "properties": properties, "required": list(properties)}


def array(items, minimum=1, maximum=20):
    return {"type": "array", "items": items, "minItems": minimum, "maxItems": maximum}


PARAMETERS = obj({
    "assignments": array(obj({
        "agent_id": TEXT, "anchor_case_id": TEXT, "route_case_ids": array(TEXT),
        "question": TEXT, "search_targets": array(TEXT, maximum=8),
        "evidence": array(obj({"source_id": TEXT, "quote": TEXT}), maximum=6),
        "criteria": obj({"supported": TEXT, "refuted": TEXT, "unknown": TEXT}),
    })),
    "decision_rules": array(obj({
        "rule_id": TEXT,
        "conditions": array(obj({"agent_id": TEXT,
            "outcome": {"enum": ["supported", "refuted", "unknown"]}, "finding": TEXT})),
        "conclusion": TEXT, "caveat": TEXT,
    }), maximum=12),
    "uncertainty": TEXT,
})
SCHEMA = {"type": "function", "function": {"name": "plan_trace",
    "description": "Allocate TRACE investigators and predeclare conditional evidence interpretation for SUBMIT. No findings have been established yet.",
    "parameters": PARAMETERS}}


def sources(tools):
    anchors = {c["issue_step"] for c in tools.route_cases}
    result = {}
    for step in tools.bundle.source["steps"]:
        fields = {"observation": step["env_text"], "action": step["parts"].get("action")}
        if step["t"] in anchors:
            fields.update(step["parts"])
        for field, text in fields.items():
            if text:
                sid = f"source:{step['t']}:{field}"
                result[sid] = {"source_id": sid, "step": step["t"], "module": field,
                    "text": text, "source_kind": "original_observation" if field == "observation" else "original_agent_module"}
    return result


def packet(tools):
    from .query_trace import packet as trace_packet, query_context
    from .query_dsl import documentation
    from .benchmark_scope import scope
    cases = []
    for case in tools.route_cases:
        item = trace_packet(tools, case)
        cases.append({k: item[k] for k in ("candidate", "facts", "rule_evidence", "parse_audits", "evidence_quality")})
    inventory = list(sources(tools).values())
    return {"schema": "trace-manager-input/v1", "task": tools.bundle.source["task"],
        "goal_map": plain(tools.goal_map), "route_cases": cases, "benchmark_scope": scope(),
        "query_context": query_context(tools), "query_language": documentation(),
        "source_inventory": inventory,
        "agent_statements": claim_payload(cards(tools.bundle.source,
            [fragment(tools.bundle.source, s["step"], s["module"]) for s in inventory if s["module"] in MENTAL])),
        "source_coverage": {"step_range": [1, tools.index.length],
            "action_observation_timeline_complete": True,
            "all_memory_reflection_plan_supplied": len({c["issue_step"] for c in tools.route_cases}) == tools.index.length,
            "other_modules": "ROUTE anchor steps only",
            "observation_timing": "observation(t) precedes action(t); observation(t+1) is its feedback; no final feedback"},
        "parse_audits": plain(getattr(tools.bundle.record, "parse_audits", [])),
        "evidence_quality": evidence_quality(tools.bundle.record, tools.index.length),
        "limits": {"max_agents": tools.trace_top_p, "queries_per_agent": 1,
            "steps_per_agent_result": 1, "max_assigned_excerpts": 6, "excerpt_chars": 360},
        "instruction": "Prioritize decision-critical evidence. Default to one investigator and merge related ROUTE cases; "
            "add a second only for an independent question requiring a separate one-step finding. More than two needs an explicit "
            "decision-changing reason for each extra investigator. Cover all ROUTE cases. Every worker also receives its anchor source. "
            "Plan feasible element retrieval using query_context and query_language. Treat ROUTE as one hypothesis; "
            "include a source-grounded rival mechanism and cross-module checks, not just earlier repetitions of anchor wording. "
            "Workers may expand these starting targets to related evidence and better-supported causes within one composed query. "
            "Allocate only exact short excerpts from source_inventory. Decide how possible findings affect causal comparison, "
            "including unknown and refuting evidence. This plan goes directly to SUBMIT, not through worker summaries."}


def _nonempty(value):
    if isinstance(value, str) and not value.strip():
        raise ToolError("invalid_manager_plan", "manager text fields must be nonempty")
    if isinstance(value, dict):
        for v in value.values():
            _nonempty(v)
    if isinstance(value, list):
        for v in value:
            _nonempty(v)


def commit(tools, **answer):
    # Import lazily: DebugTools owns generic JSON schema validation.
    from .debug_tools import validate_json
    validate_json(answer, PARAMETERS)
    _nonempty(answer)
    if tools.manager_plan is not None or tools.trace_queries or tools.window_conclusions:
        raise ToolError("invalid_manager_plan", "plan is immutable and must precede all TRACE queries")
    assignments = answer["assignments"]
    if len(assignments) > tools.trace_top_p:
        raise ToolError("invalid_manager_plan", "manager exceeds trace_top_p agent budget")
    cases = {c["candidate_id"]: c for c in tools.route_cases}
    available, agents, covered, scheduled = sources(tools), set(), set(), []
    for task in assignments:
        aid, refs = task["agent_id"], task["route_case_ids"]
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", aid) or aid in agents:
            raise ToolError("invalid_manager_plan", "agent_id must be unique and use letters, digits, underscore or hyphen")
        if len(refs) != len(set(refs)) or not set(refs) <= cases.keys() or task["anchor_case_id"] not in refs:
            raise ToolError("invalid_manager_plan", "assign existing ROUTE cases and one of them as anchor")
        agents.add(aid); covered.update(refs)
        for evidence in task["evidence"]:
            original = available.get(evidence["source_id"])
            if original is None or not 1 <= len(evidence["quote"]) <= 360 or evidence["quote"] not in original["text"]:
                raise ToolError("invalid_manager_plan", "assigned evidence must be an exact visible source excerpt of at most 360 characters")
        anchor = cases[task["anchor_case_id"]]
        scheduled.append({**{k: anchor[k] for k in ("issue_step", "issue_fids", "goal_links", "hypothesis")},
                          "candidate_id": aid})
    if covered != cases.keys():
        raise ToolError("invalid_manager_plan", "every ROUTE case must be assigned, possibly combined with another case")
    rule_ids, addressed = set(), set()
    for rule in answer["decision_rules"]:
        if rule["rule_id"] in rule_ids:
            raise ToolError("invalid_manager_plan", "rule IDs must be unique")
        rule_ids.add(rule["rule_id"])
        participants = [c["agent_id"] for c in rule["conditions"]]
        if len(participants) != len(set(participants)) or not set(participants) <= agents:
            raise ToolError("invalid_manager_plan", "each AND rule must name existing, non-repeated agents")
        addressed.update(participants)
    if addressed != agents:
        raise ToolError("invalid_manager_plan", "conditional rules must address every assigned agent")
    plan = {"schema": SCHEMA_VERSION, **plain(answer), "plan_digest": digest(answer),
            "source_coverage": packet(tools)["source_coverage"]}
    tools.windows.configure(scheduled)
    tools.manager_plan = plan
    return plain(plan)


def assignment(tools, agent_id):
    if tools.manager_plan is None:
        return {}
    task = next((a for a in tools.manager_plan["assignments"] if a["agent_id"] == agent_id), None)
    if task is None:
        return {}
    original = sources(tools)
    return {"manager_assignment": {**plain(task),
        "evidence": [{**{k: original[e["source_id"]][k] for k in ("source_id", "step", "module", "source_kind")},
                      "quote": e["quote"]} for e in task["evidence"]],
        "interpretation": "An investigation plan, not findings or a search whitelist. Expand to relevant peer modules at the same step, "
            "independent actions/feedback, earlier causes and counterevidence within your one SQL query. You may identify a different "
            "supported step/module or mechanism. Explain how it supports, refutes or leaves the original premise unknown; do not force a manager rule to fit."}}


def submit_guidance(tools):
    if tools.manager_plan is None:
        return {}
    keys = ("query", "columns", "rows", "returned_steps", "function_scopes", "truncated", "error", "evidence_quality", "limitations",
            "partial", "function_errors", "repairs", "skipped_branches", "coverage", "limits")
    return {"manager_guidance": {"plan": plain(tools.manager_plan),
        "assigned_evidence": {a["agent_id"]: assignment(tools, a["agent_id"])["manager_assignment"]["evidence"]
                              for a in tools.manager_plan["assignments"]},
        "trace_evidence": {cid: {k: plain(q[k]) for k in keys if k in q}
                           for cid, q in tools.trace_queries.items()},
        "instruction": "Evaluate each manager condition against original assigned/query evidence, including empty TRACE reviews. "
            "All conditions in a rule must be supported before using its conclusion. No result, clipping, parse gaps or agent confidence "
            "alone proves a condition. Explain supported/refuted/unknown outcomes in comparisons/reasoning; use unknown criteria for "
            "unresolved branches. partial/function_errors/skipped_branches mean unavailable evidence, never zero matches or refutation. "
            "The plan is advisory, not observed evidence or a vote. Select only an existing TRACE candidate."}}
