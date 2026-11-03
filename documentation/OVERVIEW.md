# ProDebugger overview

ProDebugger analyzes a **recorded** agent trajectory after the fact. It does not run the agent or the environment, and it does not repair the trajectory.

## Input

A finished trajectory: the task statement plus, for each step, what the agent observed, what it thought, and the action it took.

## Stages

| Stage | Reads | Produces |
| --- | --- | --- |
| **MAP** | The task statement and the structured record of the trajectory | The task goals that were left unmet |
| **ROUTE** | Unmet goals and warnings raised over the record | A short list of suspicious steps |
| **TRACE** | The suspicious steps | Evidence for or against each suspect, quoted from the trajectory |
| **SUBMIT** | All suspects and their evidence | One failure hypothesis, or an explicit "uncertain" |

## Output

A report that names the step and the part of the agent (for example its plan or its action) where the failure most likely began, quotes the supporting evidence, and lists rival explanations it could not rule out. See [`samples/sample_report.json`](samples/sample_report.json).

## What a report is not

A report is a hypothesis backed by the recorded evidence, not proof of causation. Missing evidence stays unknown, and the selected step is not claimed to be the unique cause.
