"""The map, review, trace, and revise reasoner arm."""
from __future__ import annotations

from typing import Any

from .case import Case
from .common import PROMPTS, compact
from .model import Model


def local_rows(global_output: dict) -> list[dict]:
    return [row for row in global_output["local_error_ledger"]
            if row["status"] in ("error", "uncertain")
            and isinstance(row.get("primary_fid"), int)]


def candidate(global_output: dict, fid: int) -> dict:
    return next((row for row in local_rows(global_output)
                 if row["primary_fid"] == fid), {})


def normalize_assessments(value: dict) -> dict:
    for item in value.values():
        if not isinstance(item, dict):
            continue
        for key in ("proposition", "immediate_effect", "uncertainty", "reasoning"):
            if key in item and item[key] is not None and not isinstance(item[key], str):
                item[key] = compact(item[key])
        against = item.get("evidence_against")
        if isinstance(against, list):
            prose = [entry for entry in against if isinstance(entry, str)
                     and not entry.isdecimal()]
            if prose:
                item["uncertainty"] = " ".join(filter(None, [
                    item.get("uncertainty", ""), "Counterevidence: " + "; ".join(prose)]))
            item["evidence_against"] = [int(entry) for entry in against
                                        if isinstance(entry, int)
                                        or isinstance(entry, str) and entry.isdecimal()]
        for key in ("evidence_for", "evidence_against"):
            if key in item and not isinstance(item[key], list):
                item[key] = []
            if isinstance(item.get(key), list):
                item[key] = [int(entry) for entry in item[key]
                             if isinstance(entry, int)
                             or isinstance(entry, str) and entry.isdecimal()]
    return value


def stage_prompt(name: str) -> str:
    return (PROMPTS / name).read_text(encoding="utf-8")


def map_trajectory(model: Model, case: Case) -> tuple[dict, dict, Any]:
    """Gather the compact trajectory context and ask for the stage-one map."""
    profile = case.cli("profile")
    failed = case.cli("failed")
    notes = case.cli("view", "process_notes | detail:summary")
    packet = case.cli("view", "packet")
    mapped = case.log["model"].get("map")
    if mapped is None:
        mapped = model.ask_json(case.arm, case.tid, "map", stage_prompt("01_map.md"),
                                {"profile": profile, "failed": failed,
                                 "process_notes": notes, "packet": packet}, max_tokens=3500)
        case.model_result("map", mapped)
    return profile, mapped, notes


def review_steps(model: Model, case: Case, profile: dict,
                 mapped: dict, page_size: int) -> None:
    """Review every local audit and persist accepted step assessments."""
    for first in range(1, profile["steps"] + 1, page_size):
        last = min(profile["steps"], first + page_size - 1)
        if all(step in case.assessed_steps() for step in range(first, last + 1)):
            continue
        audits = case.cli("view", f"local_audits | steps:{first}:{last} | detail:summary")
        label = f"review_{first}_{last}"
        response = case.log["model"].get(label)
        if response is None:
            response = model.ask_json(case.arm, case.tid, label, stage_prompt("02_review.md"),
                                      {"task": profile["task"], "domain": profile["domain"],
                                       "map": mapped, "audit_query_answer": audits.get("query_answer"),
                                       "audits": audits["audits"]}, max_tokens=12000,
                                      required_steps=list(range(first, last + 1)))
            case.model_result(label, response)
        returned = {int(item["step"]): item["assessments"]
                    for item in response.get("steps", [])}
        for step in range(first, last + 1):
            if step in case.assessed_steps():
                continue
            if step not in returned:
                raise RuntimeError(f"review omitted step {step}")
            assessment = normalize_assessments(returned[step])
            for attempt in range(3):
                output = case.cli("assess", str(step), compact(assessment), strict=False)
                if output["exit_code"] == 0:
                    break
                if attempt == 2:
                    raise RuntimeError(f"step {step} assessment refused: {compact(output)[:600]}")
                repair_label = f"repair_assess_{step}_{attempt}"
                repair = case.log["model"].get(repair_label)
                if repair is None:
                    repair = model.ask_json(case.arm, case.tid, repair_label,
                                            stage_prompt("02_review.md"),
                                            {"step": step, "assessment": assessment,
                                             "validation_error": output["output"],
                                             "audit": next(x for x in audits["audits"] if x["step"] == step)},
                                            max_tokens=5000, required_steps=[step])
                    case.model_result(repair_label, repair)
                assessment = normalize_assessments(next(
                    x["assessments"] for x in repair["steps"] if int(x["step"]) == step))


def trace_and_propose(model: Model, case: Case, profile: dict,
                      mapped: dict) -> tuple[dict, dict, list[int], list[dict]]:
    """Check review coverage, compare candidate faults, and gather followups."""
    protocol = case.cli("protocol")
    if not protocol["coverage"]["local_complete"]:
        raise RuntimeError("local assessments incomplete")
    global_output = case.cli("global")
    terminal_audit = case.cli("view", f"local_audits | steps:{profile['steps']}:{profile['steps']} | detail:full")
    provisional = case.log["model"].get("trace_propose")
    if provisional is None:
        provisional = model.ask_json(case.arm, case.tid, "trace_propose",
                                     stage_prompt("03_trace_propose.md"),
                                     {"map": mapped, "task": profile["task"],
                                      "global": global_output,
                                      "terminal_audit": terminal_audit}, max_tokens=10000)
        case.model_result("trace_propose", provisional)
    selected = int(provisional["selected_fid"])
    if provisional.get("module") != "system" and candidate(global_output, selected).get("status") != "error":
        raise RuntimeError(f"provisional fid {selected} is not an assessed local error")
    known = {row["primary_fid"] for row in local_rows(global_output)}
    rivals = [int(x) for x in provisional.get("rival_fids", [])
              if int(x) in known and int(x) != selected]
    for fid in sorted(known):
        if len(known) >= 2 and len(set(rivals) & known) < (2 if selected not in known else 1):
            if fid != selected and fid not in rivals:
                rivals.append(fid)
    held = list(dict.fromkeys([selected] + rivals[:3]))
    case.cli("hold", *(str(x) for x in held))
    if len(held) >= 2:
        case.cli("contrast", *(str(x) for x in held))
    chosen_step = candidate(global_output, selected).get("step", profile["steps"])
    followups = []
    for spec in provisional.get("query_specs", [])[:3]:
        if isinstance(spec, str) and (spec.split("|", 1)[0].strip() in {
                "requirements", "scan", "local_audits", "process_notes",
                "intentions", "episodes", "changes", "assignments", "candidates",
                "candidate_families", "packet"} or spec.startswith("entity:")):
            result = case.cli("view", spec, strict=False)
            followups.append({"spec": spec, "result": result})
    required_specs = [
        f"local_audits | steps:{max(1, chosen_step - 1)}:{chosen_step} | detail:full",
        f"process_notes | steps:{max(1, chosen_step - 1)}:{chosen_step} | detail:summary",
        f"episodes | steps:{chosen_step}:{min(profile['steps'], chosen_step + 2)} | section:signals,before,at,after | detail:full",
    ]
    if chosen_step > 1:
        required_specs.append(f"process_notes | steps:1:{chosen_step - 1} | detail:summary")
    if rivals:
        rival_step = candidate(global_output, rivals[0])["step"]
        required_specs.append(f"local_audits | steps:{rival_step}:{rival_step} | detail:full")
    for spec in required_specs:
        followups.append({"spec": spec, "result": case.cli("view", spec)})
    return global_output, provisional, held, followups


def revise_and_submit(model: Model, case: Case, profile: dict, mapped: dict,
                      notes: Any, global_output: dict, provisional: dict,
                      held: list[int], followups: list[dict]) -> None:
    """Revise the fault choice, validate it, and submit the diagnosis."""
    final = case.log["model"].get("revise_submit")
    if final is None:
        final = model.ask_json(case.arm, case.tid, "revise_submit",
                               stage_prompt("04_revise_submit.md"),
                               {"map": mapped, "global_ledger": global_output["local_error_ledger"],
                                "provisional": provisional, "held": held,
                                "followups": followups, "process_notes": notes},
                               max_tokens=12000)
        case.model_result("revise_submit", final)
    final_fid = int(final["selected_fid"])
    info = candidate(global_output, final_fid)
    if final.get("module") != "system" and info.get("status") != "error":
        raise RuntimeError(f"final fid {final_fid} is not an assessed local error")
    if final_fid not in held:
        case.cli("hold", str(final_fid))
        case.cli("contrast", *(str(x) for x in dict.fromkeys([final_fid] + held)))
    final_step = info.get("step", profile["steps"])
    case.cli("view", f"local_audits | steps:{final_step}:{final_step} | detail:full")
    check = case.cli("check", str(final_fid))
    if check["verdict"] == "sat" and final.get("module") != "system":
        raise RuntimeError(f"final fid {final_fid} checks SAT")
    evidence = info.get("evidence_for", []) or final.get("evidence_for", []) or [final_fid]
    repair = str(final.get("repair") or provisional.get("repair") or "").strip()
    submitted = case.cli("submit", str(final_fid), str(final["module"]),
                         str(final["fault_class"]),
                         ",".join(str(x) for x in evidence), repair)
    if not submitted.get("accepted"):
        raise RuntimeError(f"submit refused: {compact(submitted)[:600]}")


def four_stage(model: Model, case: Case, page_size: int) -> None:
    profile, mapped, notes = map_trajectory(model, case)
    review_steps(model, case, profile, mapped, page_size)
    global_output, provisional, held, followups = trace_and_propose(
        model, case, profile, mapped)
    revise_and_submit(model, case, profile, mapped, notes, global_output,
                      provisional, held, followups)
