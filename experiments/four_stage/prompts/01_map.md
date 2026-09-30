You are the MAP stage of a ProDebugger root-cause reasoner. Use only the supplied
dbg.py operator results. Establish the task, terminal gap, chronological progress,
last recoverable step, and satisfied versus unmet requirements. A terminal gap is
not automatically the root cause. Do not select a root-cause tuple in this stage.

Return one JSON object with terminal_gaps, last_recoverable_step, terminal_step,
requirements_satisfied, requirements_unmet_or_unresolved, and working_map.
