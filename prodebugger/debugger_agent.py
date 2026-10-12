"""Four isolated phase conversations sharing the original debugger state machine."""
from __future__ import annotations

import json
import asyncio
from pathlib import Path

from .debug_tools import DebugTools, PHASE_TOOLS, SCHEMAS
from .evidence_tools import BudgetExceeded, ToolError
from .llm_client import PHASES, json_lines
from .record_bridge import append_json, digest, plain, read_json, write_json
from .window_trace import MODE, SCHEMA as WINDOW_SCHEMA, packet as window_packet, coverage as window_coverage
from .direct_submit import POLICY, commit as commit_direct, packet as submit_packet, parse as parse_submit
from local_judgement import SLOTS

PROMPTS = {p: Path(__file__).parent / "prompts" / f"{p.lower()}.md" for p in PHASES}


class DebuggerAgent:
    def __init__(self, bundle, client, output, config, *, resume=False):
        self.bundle, self.client, self.output, self.config = bundle, client, Path(output), config
        self.tools = DebugTools(bundle, self.output, config["max_tool_calls"], config["window_size"],
                                trace_top_p=config.get("trace_top_p", 5), trace_top_k=config.get("trace_top_k", 2))
        self.phase_messages = {p: [] for p in PHASES}
        self.active_phase = None
        self.turns, self.text_only_turns = 0, 0
        self.trace_failures = {}
        self.consumed_model_state = client.snapshot()
        checkpoint = self.output / "checkpoint.json"
        if resume:
            state = read_json(checkpoint)
            if state.get("schema") != "debugger-checkpoint/v4":
                raise ToolError("source_mismatch", "direct SUBMIT checkpoints require v4; start a new run")
            if state["canonical_fingerprint"] != bundle.fingerprint:
                raise ToolError("source_mismatch", "input/compiler/rules/prompt changed; use a new run")
            self.tools.restore(json_lines(self.output / "tool_calls.jsonl"),
                               json_lines(self.output / "direct_submit.jsonl"))
            self.phase_messages, self.turns = state["phase_messages"], state["turns"]
            self.active_phase = state["active_phase"]
            self.text_only_turns = state.get("text_only_turns", 0)
            self.trace_failures = state.get("trace_failures", {})
            self.consumed_model_state = state["model_state"]
            client.restore(state["model_state"])
            if client.recovered_message and client.recovered_phase != "TRACE":
                if client.recovered_phase != self.active_phase:
                    raise ToolError("source_mismatch", "durable model response phase differs from checkpoint")
                self._assistant(client.recovered_message)
        else:
            self._activate("MAP")
            self.checkpoint()

    @property
    def messages(self):
        return self.phase_messages[self.active_phase]

    def _handoff(self, phase):
        if phase == "SUBMIT":
            return {"schema": "debugger-handoff/v1", "from": self.active_phase, "to": phase,
                    "policy": POLICY, "instruction": "Compare supplied TRACE suspects directly; no tools. "
                                                         "The runner supplies original context and benchmark scope."}
        if phase == "TRACE":
            return {"schema": "debugger-handoff/v1", "from": self.active_phase, "to": phase,
                    "versions": {"window_version": self.tools.windows.version}, "evaluation_mode": MODE,
                    "candidate_limits": {"top_p": self.tools.trace_top_p, "top_k": self.tools.trace_top_k,
                                         "top_k_unit": "distinct_root_steps_per_window"},
                    "instruction": "Original window text is supplied directly. Rank evidence-supported root steps and retain "
                                   "at most top_k distinct steps per independent window using assess only. "
                                   "Keep materially competing module/class attributions within retained steps."}
        state = {"schema": "debugger-handoff/v1", "from": self.active_phase, "to": phase,
                 "versions": {"window_version": self.tools.windows.version}, "goal_map": self.tools.goal_map,
                 "coverage": window_coverage(self.tools),
                 "candidate_limits": {"top_p": self.tools.trace_top_p, "top_k": self.tools.trace_top_k,
                                      "top_k_unit": "distinct_root_steps_per_window"},
                 "route_history": self.tools.route_history,
                 "instruction": "Current shared state supersedes old versions. Hypotheses and prior judgements are leads, not local evidence. Re-read scoped raw material when needed."}
        # Carry transition tool outputs without forwarding the previous model's messages or reasoning.
        outputs = []
        if self.active_phase:
            for m in reversed(self.messages):
                if m["role"] == "assistant":
                    break
                if m["role"] == "tool":
                    event = self.tools.completed.get(m["tool_call_id"], {})
                    if event.get("name") in {"trace_window", "reroute", "assess"}:
                        outputs.append({"tool": event["name"], "result": json.loads(m["content"])})
        state["transition_results"] = list(reversed(outputs))
        return plain(state)

    def _log_message(self, message):
        append_json(self.output / "messages.jsonl", {"phase": self.active_phase,
                    "message": plain(message), "turn": self.turns})

    def _route_timeline(self):
        """Full original action/feedback timeline with explicit existing Fact locations."""
        source = self.bundle.source["steps"]
        facts = list(self.tools.index.facts.values())
        seen, rows = {}, []
        for item in source:
            t, action = item["t"], item["parts"].get("action")
            feedback = source[t]["env_text"] if t < len(source) else None
            rows.append({"step": t, "env_text": item["env_text"], "action": action,
                "next_env_text": feedback,
                "module_fids": {m: [f.fid for f in facts if f.t == t and f.side == "mind" and f.slot == slot]
                                for m, slot in SLOTS.items()},
                "recorded_goal_observations": [{"fid": f.fid, "relation": f.rel,
                    "arguments": plain(f.args), "value": plain(f.value), "quote": f.span}
                    for f in facts if f.t == t and f.side == "env"
                    and any(str(a) in self.tools.index.requirements for a in f.args)],
                "signals": {"previous_exact_action_steps": list(seen.get(action, [])),
                    "explicit_no_effect_feedback": feedback.strip().lower() == "nothing happens."
                                                   if feedback is not None else None}})
            if action:
                seen.setdefault(action, []).append(t)
        return {"schema": "route-timeline/v1", "task": self.bundle.source["task"],
            "requirement_ids": sorted(self.tools.index.requirements), "steps": rows,
            "complete": True, "step_count": len(rows),
            "instruction": "step equals original trajectory step and Fact.t. module_fids belong to that row's step. "
                "scope.step only controls visibility, not a returned Fact's location. "
                "Feedback is original post-action text; repeat/no-effect signals are leads, not faults. "
                "Empty recorded_goal_observations means no such compiled observation, not proof of no progress. "
                "Use tools to read full modules at candidate steps before declaring causal anchors."}

    def _activate(self, phase):
        if phase == self.active_phase:
            return
        previous = self.active_phase
        handoff = self._handoff(phase)
        self.active_phase = phase
        if not self.messages:
            self.messages.extend([
                {"role": "system", "content": PROMPTS[phase].read_text(encoding="utf-8")},
                {"role": "user", "content": json.dumps({"trajectory_id": self.bundle.record.tid,
                 "task": self.bundle.record.task, "steps": len(self.bundle.source["steps"]),
                 "W": self.config["window_size"], "submission_policy": POLICY,
                 "candidate_limits": {"top_p": self.tools.trace_top_p, "top_k": self.tools.trace_top_k,
                                      "top_k_unit": "distinct_root_steps_per_window"}}, ensure_ascii=False)}])
            for m in self.messages:
                self._log_message(m)
        message = {"role": "user", "content": json.dumps(handoff, ensure_ascii=False)}
        self.messages.append(message)
        self._log_message(message)
        if phase == "ROUTE":
            message = {"role": "user", "content": json.dumps(self._route_timeline(), ensure_ascii=False)}
            self.messages.append(message)
            self._log_message(message)
        append_json(self.output / "phase_events.jsonl", {"from": previous, "to": phase,
                    "turn": self.turns, "handoff": handoff})
        self.text_only_turns = 0

    def checkpoint(self):
        write_json(self.output / "checkpoint.json", {"schema": "debugger-checkpoint/v4",
                   "canonical_fingerprint": self.bundle.fingerprint, "phase": self.tools.phase,
                   "active_phase": self.active_phase,
                   "turns": self.turns, "text_only_turns": self.text_only_turns,
                   "trace_failures": self.trace_failures,
                   "tool_calls": self.tools.call_count, "model_state": self.consumed_model_state,
                   "phase_messages": self.phase_messages})

    def _assistant(self, message):
        if message.get("role") != "assistant":
            raise ToolError("model_error", "model returned a non-assistant message")
        self.messages.append(plain(message))
        self.consumed_model_state = self.client.snapshot()
        self.turns += 1
        self.text_only_turns = 0 if message.get("tool_calls") else self.text_only_turns + 1
        self._log_message(message)
        self.checkpoint()  # Preserve outstanding calls before executing any mutation.

    def _pending_calls(self):
        assistant_pos = next((i for i in range(len(self.messages) - 1, -1, -1)
                              if self.messages[i]["role"] == "assistant"), None)
        if assistant_pos is None:
            return []
        calls = self.messages[assistant_pos].get("tool_calls", []) or []
        completed = {m.get("tool_call_id") for m in self.messages[assistant_pos + 1:] if m["role"] == "tool"}
        return [c for c in calls if c.get("id") not in completed]

    def _dispatch(self, call):
        call_id = call.get("id")
        if not isinstance(call_id, str) or not call_id:
            raise ToolError("model_error", "tool call is missing its ID")
        function = call.get("function", {})
        try:
            arguments = json.loads(function.get("arguments", "{}"))
        except (json.JSONDecodeError, TypeError):
            arguments = {"invalid_json": True}
        result = self.tools.execute(function.get("name", ""), arguments, call_id)
        self.messages.append({"role": "tool", "tool_call_id": call_id,
                              "content": json.dumps(result, ensure_ascii=False)})
        self._log_message(self.messages[-1])
        self.checkpoint()

    def _context(self):
        """Bound old tool packets structurally, retaining the full transcript on disk."""
        messages = plain(self.messages)
        # Latest packets stay complete. Earlier views can be requested again by ID.
        for i, message in enumerate(messages[:-4]):
            if message["role"] == "tool" and len(message["content"].encode("utf-8")) > 12000:
                result = json.loads(message["content"])
                message["content"] = json.dumps({"schema": "debugger-context-summary/v1",
                    "tool_call_id": message["tool_call_id"], "scope": result.get("scope"),
                    "original_digest": digest(result), "truncated": True,
                    "instruction": "Full output is in the event log; request a scoped view again if needed."})
            elif message["role"] == "user":
                value = json.loads(message["content"])
                if value.get("schema") == "debugger-handoff/v1" and value.get("transition_results"):
                    value["transition_results"] = [{"tool": row["tool"],
                        "original_digest": digest(row["result"]), "truncated": True,
                        "instruction": "Re-read scoped views or a previous trace_window page for raw material."}
                        for row in value["transition_results"]]
                    message["content"] = json.dumps(value, ensure_ascii=False)
        return messages

    def _trace(self):
        """Concurrent isolated window requests; validation and commits stay serial."""
        asyncio.run(self._window_trace())

    async def _window_trace(self):
        base = plain(self.messages[:3])
        # Recover every durable concurrent response, not only the last ledger row.
        recovered = {}
        for row in json_lines(self.output / "usage.jsonl"):
            if row.get("phase") != "TRACE" or row.get("event") != "completed":
                continue
            request = read_json(self.output / row["request_file"])
            inputs = json.loads(request["messages"][3]["content"])
            recovered[inputs["window"]["candidate_id"]] = row["message"]
        semaphore = asyncio.Semaphore(self.tools.trace_top_p)

        async def evaluate(window):
            wid = window["candidate_id"]
            if wid in self.tools.window_conclusions:
                return
            inputs = window_packet(self.tools, window)
            history = base + [{"role": "user", "content": json.dumps(inputs, ensure_ascii=False)}]
            self._log_message(history[-1])
            key = digest(inputs)
            async with semaphore:
                while self.trace_failures.get(key, 0) < 3:
                    if wid in recovered:
                        message = recovered.pop(wid)
                    else:
                        message = await self.client.complete_async(history, [WINDOW_SCHEMA], phase="TRACE")
                    self._assistant(message)
                    history.append(plain(message))
                    calls = message.get("tool_calls") or []
                    result = None
                    if len(calls) == 1 and calls[0].get("function", {}).get("name") == "assess":
                        self.tools.current_trace_window = wid
                        try:
                            self._dispatch(calls[0])
                            result = json.loads(self.messages[-1]["content"])
                            history.append(plain(self.messages[-1]))
                        finally:
                            del self.tools.current_trace_window
                    else:
                        for call in calls:
                            history.append({"role": "tool", "tool_call_id": call["id"],
                                "content": json.dumps({"error": "Use exactly one assess call"})})
                    if result is not None and "error" not in result:
                        return
                    self.trace_failures[key] = self.trace_failures.get(key, 0) + 1
                    quote_source = None
                    if len(calls) == 1:
                        try:
                            rejected = json.loads(calls[0]["function"]["arguments"])
                            quote_source = []
                            for index, candidate in enumerate(rejected.get("candidates", []), 1):
                                t, module = candidate.get("step"), candidate.get("module")
                                if type(t) is int and t in inputs["evaluation_steps"] and module in {"memory", "reflection", "plan", "action"}:
                                    quote_source.append({"candidate_index": index, "step": t, "module": module,
                                        "original_module_text": self.bundle.source["steps"][t - 1]["parts"].get(module)})
                        except (ValueError, TypeError, KeyError):
                            pass
                    correction = {"role": "user", "content": json.dumps({
                        "error": result.get("error") if result else "Use exactly one assess call",
                        "quote_source": quote_source,
                        "instruction": "Correct this same window. Submit its ranked list with at most top_k distinct root steps in one assess call. "
                                       "Keep materially competing module/class attributions at retained steps; do not force candidates. "
                                       "output_quote must be copied from the selected module's original_module_text; "
                                       "a plan quote cannot be an action quote. Verify the claim itself too."})}
                    history.append(correction)
                    self._log_message(correction)
                    self.checkpoint()

        outcomes = await asyncio.gather(*(evaluate(w) for w in self.tools.windows.windows), return_exceptions=True)
        # All requests are joined before reporting any failure/budget termination.
        for outcome in outcomes:
            if isinstance(outcome, BaseException):
                raise outcome
        if window_coverage(self.tools)["trace_complete"]:
            self.tools.phase = "SUBMIT"
        else:
            self.tools.result = self.tools.stop_result("uncertain", "window TRACE validation failed three times")
            self.tools.result["coverage"] = window_coverage(self.tools)
        self.checkpoint()

    def _direct_submit(self):
        if self.messages[-1]["role"] == "assistant":
            message = self.messages[-1]
            try:
                if message.get("tool_calls"):
                    raise ToolError("invalid_direct_submit", "SUBMIT has no tools; return plain JSON")
                commit_direct(self.tools, parse_submit(message.get("content")), self.turns)
            except (ValueError, TypeError, KeyError) as exc:
                self.tools.result = self.tools.stop_result("uncertain", f"direct SUBMIT response rejected: {exc}")
                self.tools.result.update(policy=POLICY, uncertainty=str(exc))
            self.checkpoint()
            return
        if self.turns >= self.config["max_turns"]:
            raise BudgetExceeded("assistant turn limit reached")
        self.messages.append({"role": "user", "content": json.dumps(submit_packet(self.tools), ensure_ascii=False)})
        self._log_message(self.messages[-1])
        self.checkpoint()
        self._assistant(self.client.complete(plain(self.messages), [], phase="SUBMIT"))

    def run(self):
        try:
            while self.tools.result is None:
                if self.tools.phase == "TRACE":
                    self._activate("TRACE")
                    self._trace()
                    continue
                if self.tools.phase == "SUBMIT":
                    self._activate("SUBMIT")
                    self._direct_submit()
                    continue
                pending = self._pending_calls()
                if pending:
                    for call in pending:
                        if self.tools.result is not None:
                            break
                        self._dispatch(call)
                    continue
                self._activate(self.tools.phase)
                if self.turns >= self.config["max_turns"]:
                    raise BudgetExceeded("assistant turn limit reached")
                self.messages.append({"role": "user", "content": json.dumps({
                    "phase": self.tools.phase, "coverage": window_coverage(self.tools),
                    "remaining_tool_calls": self.tools.max_tool_calls - self.tools.call_count,
                    "instruction": "Continue through tools. Re-route or finish uncertain if evidence cannot support submission."})})
                self._log_message(self.messages[-1])
                self.checkpoint()
                schemas = [s for s in SCHEMAS if s["function"]["name"] in PHASE_TOOLS[self.tools.phase]]
                message = self.client.complete(self._context(), schemas, phase=self.active_phase)
                self._assistant(message)
                if not message.get("tool_calls"):
                    if self.text_only_turns >= 3:
                        self.tools.result = self.tools.stop_result("uncertain", "model repeatedly returned text without a tool decision")
        except BudgetExceeded as exc:
            self.tools.result = self.tools.stop_result("budget_exhausted", str(exc))
        except ToolError as exc:
            self.tools.result = self.tools.stop_result("error", f"{exc.code}: {exc}")
        except KeyboardInterrupt:
            self.tools.result = self.tools.stop_result("uncertain", "interrupted; resume from checkpoint")
        result = self.tools.result
        result.update(run_id=self.output.parent.name, trajectory_id=self.bundle.record.tid,
                      canonical_fingerprint=self.bundle.fingerprint, phase=self.tools.phase,
                      route_history=self.tools.route_history, usage={**self.client.snapshot(),
                      "tool_calls": self.tools.call_count, "assistant_turns": self.turns})
        result["evaluation_mode"] = MODE
        result["policy"] = POLICY
        self.tools.save()
        self.checkpoint()
        write_json(self.output / "result.json", result)
        write_json(self.output / "usage.json", result["usage"])
        return result
