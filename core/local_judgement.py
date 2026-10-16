"""Module and fault-class vocabulary shared by TRACE and SUBMIT."""

MODULES = ("memory", "reflection", "plan", "action")
SLOTS = {"memory": "mem", "reflection": "refl", "plan": "plan", "action": "act"}
FAULT = {
    "memory": ["hallucination", "over_simplification", "memory_retrieval_failure"],
    "reflection": ["progress_misjudge", "causal_misattribution",
                   "outcome_misinterpretation"],
    "plan": ["inefficient_plan", "constraint_ignorance", "impossible_action"],
    "action": ["invalid_action", "parameter_error", "misalignment", "format_error"],
    "system": ["environment_error", "step_limit", "llm_limit",
               "tool_execution_error"],
}
