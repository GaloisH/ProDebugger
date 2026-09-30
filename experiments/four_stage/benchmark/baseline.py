"""The shipped tool-use reasoner comparison arm."""
from __future__ import annotations

import json

from .case import Case
from .common import CORE, TOOL, compact, save_json
from .model import Model


def baseline(model: Model, case: Case) -> None:
    task = (CORE / "TASK.md").read_text(encoding="utf-8")
    reasoner = (CORE / "REASONER.md").read_text(encoding="utf-8")
    system = ("You are the shipped ProDebugger tool-use reasoner. TASK.md and "
              "REASONER.md are fully supplied below; their read instruction is "
              "already satisfied. run_operator maps exactly to ./run.sh <TID> "
              "<operator> <args>. In run_operator, op is just the operator name "
              "and args contains ONLY the operands after that name; never put "
              "the trajectory ID or operator name in args. For example, use "
              "op='profile', args=[] and op='view', "
              "args=['local_audits | steps:1:3 | detail:summary']. Use narrow "
              "step ranges when a view is large. You have no file tool. The harness writes the "
              "specified JSONL from an accepted submit, so do not write files. "
              "Complete the entire protocol and submit a diagnosis.\n\n"
              f"TASK.md:\n{task}\n\nREASONER.md:\n{reasoner}")
    messages: list[dict] = (json.loads(case.messages_path.read_text(encoding="utf-8"))
                            if case.messages_path.exists() else
                            [{"role": "system", "content": system},
                             {"role": "user", "content":
                              f"Diagnose trajectory {case.tid}. Use run_operator and submit."}])
    if case.log["commands"] and not case.messages_path.exists():
        raise RuntimeError("cannot resume baseline without its saved model messages")
    reminders = 0
    first_turn = sum(item["role"] == "assistant" for item in messages)
    for turn in range(first_turn, 100):
        message = model.ask(case.arm, case.tid, f"agent_{turn}", messages,
                            max_tokens=7000, tools=TOOL)
        calls = message.tool_calls or []
        assistant = {"role": "assistant", "content": message.content}
        if calls:
            assistant["tool_calls"] = [call.model_dump(exclude_none=True) for call in calls]
        if getattr(message, "reasoning_content", None):
            assistant["reasoning_content"] = message.reasoning_content
        messages.append(assistant)
        if not calls:
            if (case.log.get("result") or {}).get("accepted"):
                return
            if reminders == 2:
                raise RuntimeError("baseline ended without an accepted submit")
            reminders += 1
            messages.append({"role": "user", "content":
                             "Continue the ProDebugger protocol and call submit. "
                             "Read any refusal and satisfy its missing requirements."})
            save_json(case.messages_path, messages)
            continue
        for call in calls:
            if call.function.name != "run_operator":
                output = {"error": "unknown tool"}
            else:
                try:
                    value = json.loads(call.function.arguments)
                    op = value["op"]
                    args = value.get("args", [])
                    if not isinstance(args, list) or not all(isinstance(x, str) for x in args):
                        raise ValueError("args must be a list of strings")
                    # Models sometimes transcribe the shell form verbatim.
                    # Normalize only redundant, unambiguous leading fields.
                    if args and args[0] == case.tid:
                        args = args[1:]
                    if args and args[0] == op:
                        args = args[1:]
                    output = case.cli(op, *args, strict=False)
                except (ValueError, KeyError, TypeError) as exc:
                    output = {"error": str(exc)}
            rendered = compact(output)
            if len(rendered) > 70000:
                result = output.get("output", {}) if isinstance(output, dict) else {}
                output = {"truncated": True, "exit_code": output.get("exit_code"),
                          "query_answer": result.get("query_answer"),
                          "preview": rendered[:45000],
                          "instruction": "This result is too large for one tool message. "
                                         "Use a view with a small steps:a:b range "
                                         "or narrower section/detail to inspect the rest."}
            messages.append({"role": "tool", "tool_call_id": call.id,
                             "content": compact(output)})
        tool_messages = [item for item in messages if item["role"] == "tool"]
        for old in tool_messages[:-4]:
            if len(old["content"]) > 600:
                old["content"] = "Earlier operator result omitted from context; " \
                                 "repeat a narrow query if its evidence is needed."
        save_json(case.messages_path, messages)
        if (case.log.get("result") or {}).get("accepted"):
            return
    raise RuntimeError("baseline exceeded 100 model turns")
