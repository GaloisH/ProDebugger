"""Benchmark vocabulary under the user's explicit no-format/spelling premise."""
import re
from .record_bridge import CORE  # Initialize the established core import path.
from .evidence_tools import ToolError
from local_judgement import FAULT

EXCLUDED = {"format_error", "spelling_error", "syntax_error", "typo"}
ALLOWED = {module: [name for name in names if name not in EXCLUDED]
           for module, names in FAULT.items()}


def validate_cause(module, item):
    """Reject overt action-format relabelling, not a general semantic classifier."""
    if item.get("status") != "error" or module != "action":
        return
    reason = " ".join(str(item.get(k, "")) for k in ("proposition", "reasoning", "immediate_effect"))
    if re.search(r"\b(?:format(?:ting)?|spell(?:ing)?|typo|syntax|serializ\w*)\b|"
                 r"(?:literal|surrounding) (?:single |double )?quot|quoted (?:string|form|command|action)|"
                 r"(?:rather than|instead of) (?:the )?bare|unquoted", reason, re.I):
        raise ToolError("excluded_benchmark_cause", "Action formatting/spelling/quoted-vs-bare causes are excluded, "
                        "even under invalid_action/parameter_error/misalignment. Evaluate supported semantic choices within the current phase's output contract.")


def scope():
    return {"schema": "benchmark-error-scope/v1", "allowed_by_module": ALLOWED,
            "source": "core/local_judgement.py:FAULT with user-requested exclusions",
            "excluded_causes": ["formatting", "spelling", "literal quotation marks", "serialization"],
            "premise": "All genuine benchmark errors are within allowed_by_module. "
                       "Formatting and spelling cannot cause the benchmark failure. "
                       "Do not relabel these causes as another allowed error."}
