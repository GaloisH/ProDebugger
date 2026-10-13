# ProDebugger

Standalone migration of the DSL debugger experiment (`experiments/dsl` in the original
OmniDebugger intern repository). Core logic, interfaces, prompts and outputs are unchanged;
only import and resource paths were adjusted so the project runs on its own.

```text
ProDebugger/
  core/                 canonical record compiler, profiles, session/operators (copied unchanged)
    profiles/           alfworld, webshop, base
    data/train.parquet  benchmark trajectories (private; git-ignored)
  prodebugger/          the DSL debugger (formerly experiments/dsl)
    run_experiment.py   MAP -> ROUTE -> TRACE -> SUBMIT entry point
    run_compile.py      compile one trajectory / the fixed 20-ID sample
    prompts/            map.md, route.md, trace.md, submit.md
    sessions/abstract_rules_n20/   20 compiled trajectories used as saved inputs
  web/                  workbench: stdlib server + static frontend (no build), chat launcher
  artifacts/dsl_debugger/          run outputs (created on first run; git-ignored)
```

All commands below are run from the `ProDebugger` directory.

## Setup

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
copy .env.example .env   # then put your key in .env
```

Python 3.12+ (tested with 3.13). `pyarrow` is needed for Parquet input and `run_compile`;
`openai` and `python-dotenv` only for online runs.

## LLM debugger entry point

`run_experiment.py` runs **MAP → ROUTE → TRACE → SUBMIT** with four isolated phase
conversations, four prompts, and independently configurable phase models.
MAP reads unmet/unresolved requirements. ROUTE follows native evidence and entity
history to several issue anchors. TRACE directly evaluates original window text
with only the assess submission tool, without views or pagination. For anchor `t`, a window of size `W` covers
`[max(1,t-W+1),t]`. W defaults to 5 and includes the anchor. Each window
receives original prior context, four module texts, admissible commands and recorded
next environment feedback in an independent conversation; overlapping steps remain
in each window. Up to two window requests run concurrently; commits remain serial.
TRACE calls its sole tool `assess` once per window with all plausible error/uncertain
candidates and exact raw quotes, without selecting a winner. The runner validates
the entire candidate list and maps it to existing Fact IDs; it creates no new Facts.
The current TRACE mode is `independent-window-candidates/v2`.
SUBMIT compares every TRACE candidate, recovery and terminal goal impact in ONE
plain-JSON response without tools. It selects an existing candidate or returns
uncertain. The runner validates candidate references and saves `direct_submit.jsonl`.
The current result policy is `window-candidates-submit/v3`; structural acceptance
does not prove causal correctness.
The user-specified benchmark scope contains all core fault classes except
`format_error` (16 allowed labels); formatting, spelling and quotation marks
cannot be benchmark root causes in this experiment. Both TRACE and SUBMIT use
that premise. Raw source text is preserved; excluded causes cannot be relabelled.
No surviving suspect yields `uncertain` rather than a fabricated alternative.
Invalid SUBMIT JSON/selection stops uncertain after that response, without retries
for semantic correction. Provider transport retries retain their normal accounting.
Current checkpoints require v4 and current source fingerprints. Earlier
runs are not resumed under the changed protocol.

Validate saved steps without any model or Parquet dependency:

```powershell
python -B -m prodebugger.run_experiment GPT-4o_018_alfworld_task_018 --compiled-dir prodebugger/sessions/abstract_rules_n20 --dry-run
python -B -m prodebugger.run_experiment --sample-file prodebugger/sessions/abstract_rules_n20/sample.json --compiled-dir prodebugger/sessions/abstract_rules_n20 --dry-run
```

Direct script execution also works: `python prodebugger/run_experiment.py ...`.
The sample may be any nonempty unique JSON ID list or object with `trajectory_ids`.
Without `--compiled-dir`, inputs come from `core/data/{train,validation,test}.parquet`
(or `--data-dir`), which requires PyArrow. Only trajectory_id, task_type and
full_trajectory are read; benchmark labels and reference answers are excluded.

For online execution, use a configured model supporting Chat Completions tool calls.
Configure credentials locally in `OPENAI_API_KEY`, or select another variable with
`--api-key-env`; `--env-file` can load a local dotenv file. Credentials are never
included in manifests or model/tool logs. For an OpenAI-compatible provider:

```powershell
python -B -m prodebugger.run_experiment TRAJECTORY_ID --model MODEL_NAME --base-url ENDPOINT --window-size 5 --max-turns 80 --max-tool-calls 240
```

The endpoint is optional when using the SDK's default endpoint. No model is
hardcoded. `--max-input-tokens`, `--max-output-tokens`, and per-request
`--max-tokens` bound usage. Input admission uses a conservative UTF-8 byte estimate;
actual tokens and reserved amounts are recorded separately. Retries are finite
and metered, including failed requests with unknown usage. Providers omitting usage
stop the run rather than silently reporting zero usage.

For the DeepSeek provider (key in `.env` as `DEEPSEEK_API_KEY`), this is the
configuration used by the original online runs:

```powershell
python -B -m prodebugger.run_experiment GPT-4o_018_alfworld_task_018 --compiled-dir prodebugger/sessions/abstract_rules_n20 --env-file .env --api-key-env DEEPSEEK_API_KEY --model deepseek-flash --base-url https://api.deepseek.com --reasoning-effort high --max-input-tokens 8000000 --max-output-tokens 0 --max-tokens 0
```

`--reasoning-effort none` selects non-thinking mode. Use a provider-supported mode
when changing `--reasoning-effort`; response `reasoning_content` is retained for
subsequent tool rounds. Actual token usage, cache hit/miss counts when returned,
and response model are logged by phase and globally.

`--model` supplies the default for all four phase slots. Override them separately
with `--map-model`, `--route-model`, `--trace-model`, and `--submit-model`; online
execution needs either a default model or all four overrides. The endpoint and
credential configuration are shared. Each phase uses `prompts/<phase>.md`.
MAP requests the initial requirements view through its model. Phase switches
pass explicit shared-state handoffs. TRACE receives only original text and goal IDs,
not prior hypotheses, compiled state claims or audit packets. SUBMIT receives TRACE
suspects, shared original context at candidate steps (including admissible), and bounded directed source excerpts. Complete `execution_history` is omitted. The `direct-submit-input/v2` packet preserves every candidate ID; window reviews reference IDs instead of duplicating candidate prose. A deterministic selector includes at most 12 related events per candidate, with 280-character related module excerpts and 600-character related observation excerpts. Selection scope/omissions are explicit: retrieval hints do not prove causal dependence, recovery or absence. Other phases' message/reasoning histories are
excluded. Re-entry preserves only that phase's history and supplies current versions.

Offline replay accepts JSON/JSONL containing recorded assistant messages, including
the generated `messages.jsonl`, or a directory of `TRAJECTORY_ID.json` scripts:

```powershell
python -B -m prodebugger.run_experiment TRAJECTORY_ID --compiled-dir prodebugger/sessions/abstract_rules_n20 --replay PATH_TO_MESSAGES
python -B -m prodebugger.run_experiment --resume PATH_TO_RUN
python -B -m prodebugger.run_experiment --resume PATH_TO_RUN --max-tool-calls 400
```

Resume uses the recorded source snapshot and model configuration. Budget ceilings
may be increased; cumulative usage is retained. Completed tool calls are reconstructed
from committed events and are not appended a second time. An interrupted model
request without a durable response cannot be safely replayed and requires a new run.
Input, compiler, rules, prompt and actual Fact/Goal fingerprints must match. The CLI
defaults to PYTHONHASHSEED=42 for stable IDs, honors an explicit numeric seed and
uses the original seed when resuming. Current checkpoints use `debugger-checkpoint/v4`.
Runs created by the original repository cannot be resumed here: the source
fingerprint includes the source file set and paths, which changed with the migration.

This mode builds one canonical core Record and a strict same-ID DSL projection,
then runs the unchanged seven abstract rules. Compilation mode is
`canonical-core-dsl-projection/v1`.

Available tools include scoped `view`, `view_evidence`, `trace_evidence`,
`trace_fact`, `trace_window`, window-candidate `assess`,
`check/span/state/back/up/versions/neighbours`, `hold/drop/contrast`, `reroute`
and `finish`. Read/routing tools remain available to MAP/ROUTE; TRACE exposes
only `assess`, while SUBMIT has no tool schemas. Rule candidates, provenance
links and LLM assessments are separate claims.

TRACE tool calls are recorded in messages/requests/usage and tool_calls; validated
window conclusions are saved in `window_trace.jsonl`. Each window gets at most
three validation attempts. Invalid candidate lists cannot partially update coverage.
Every declared window must have a committed conclusion before SUBMIT. Exact quotes,
existing Fact mappings and allowed benchmark fault classes are checked. SUBMIT
compares all candidates once; invalid JSON/selection stops uncertain. Core's
full-trajectory gate remains unchanged. Finite coverage does not establish the
globally earliest or unique cause.

Each run has a unique directory; existing runs are never overwritten:

```text
artifacts/dsl_debugger/<run_id>/
  manifest.json, results.json, report.md
  <trajectory_id>/
    input.json, canonical_record.json, rules.json, evidences.json, evaluations.json
    goal_map.json, route_candidates.json, trace_windows.json, trace_graph.json
    window_trace.jsonl, direct_submit.jsonl
    messages.jsonl, phase_events.jsonl, tool_calls.jsonl, usage.jsonl, usage.json
    requests/00001.json, ..., checkpoint.json, result.json
```

Dry-run produces no model transcript/checkpoint or diagnosis. `result.status` is
diagnosed, uncertain, no_failure, budget_exhausted, error, or dry_run. Only an
accepted submit produces diagnosed. Resume writes separate resume_manifest/results/report
and preserves rejected restores in resume_error.json.

## Workbench

Runs and compiled sessions are browsed in the web workbench. It is isolated from the
debugger: `web/server.py` uses only the Python standard library, imports nothing from
`prodebugger/` or `core/`, and serves the files above read-only; the frontend is plain
HTML/CSS/ES modules with no build step. Its only writes are runs started from the Chat
page, which `web/launcher.py` runs as subprocesses.

```powershell
python web/server.py            # http://127.0.0.1:8770
```

Options: `--port`, `--host` (default 127.0.0.1), `--runs-dir`, `--sessions-dir`,
`--data-dir` (benchmark parquet, default `core/data`), `--python` (interpreter for
launched runs, default `.venv` when present).
The home page (`#/`) is a light product overview: the problem, capabilities, the four
stages (the full diagram is `web/static/img/methodology.png`), use cases, and the real
case views for `GPT-4o_018` from
`artifacts/dsl_debugger/dsl-route-causal-timeline-high-unlimited-alf18-20261007-live`
embedded read-only (a placeholder appears when that run is absent).
The Runs page (`#/runs`) lists every run under `artifacts/dsl_debugger/` and every compiled session
under `prodebugger/sessions/`. A run that is still being written is marked LIVE and
followed as it grows (JSON files refetched on change, JSONL logs read from their last
byte offset), so it can be opened while `run_experiment` is working.

Each case has three tabs:

- **Trajectory**: two linked horizontal lanes, debugger events (handoffs, model turns,
  tool calls, window assessments, the submit decision) above the original agent steps.
  Cards expand in place. Hovering or selecting an event draws curves to the steps it
  cites; selecting a step lights every event that looked at it. Step fields are laid out
  by role (State / Reasoning / Action / Outcome) inferred from field names, so other
  benchmarks need no configuration; each step also lists its Facts and rule evaluations.
- **DSL Graph**: fact dependencies (by step and side, `basis` edges, step-range brush,
  lineage highlight, debugger attention and ROUTE path overlays), entities and relations
  (state as of a chosen step), schema (kinds and relation signatures), goals and
  requirements, and rules → evaluations → facts.
- **Result**: a diagnosed run shows the root cause with its step chain and evidence;
  any other status shows the status, reasoning, uncertainty and window coverage.

**Chat** (`#/chat`) reads every run as a conversation: the request, then one message per
phase (MAP requirements, ROUTE anchors, one per TRACE window, the SUBMIT verdict) with an
expandable activity log, and, once a run has a result, a Reference card comparing step,
module and error type with the benchmark label. The composer searches the parquet catalog
(read by `web/catalog.py` in a subprocess; gaia rows are listed but unsupported) and
starts either a **Live run** (`run_experiment` with the newest online run's config, model /
reasoning / window overridable) or a **Replay** of a finished run of the same trajectory.
One run at a time; Run becomes Stop while it is active. Launched runs carry `chat.json`
(mode, config, exit state, log tail). Custom tasks are accepted by the form but not
implemented by the launcher yet. Reference labels are served only to the page and are
never passed to the debugger.

URLs are shareable (`#/runs?group=<group>`, `#/case/<runs|sessions>/<group>/<trajectory>/<tab>/...`,
`#/chat/<group>/<trajectory>`).
`python web/simulate_live.py <run>/<trajectory>` replays a finished run into a new run
directory at a slow pace, to try the live view without model calls.

## Compilation entry point

Compile an exact trajectory ID (needs `pyarrow`):

```powershell
python -B -m prodebugger.run_compile GPT-4o_003_chat_b000_t00_e02-1e119842
```

Omit the ID to enter it interactively. Script execution also works:
`python prodebugger/run_compile.py TRAJECTORY_ID`.
The runner searches `core/data/{train,validation,test}.parquet` by ID.
Use `--data-dir PATH` to select another dataset directory.
Outputs are written to `prodebugger/sessions/TRAJECTORY_ID/`:

- `record.json`: task, kinds, relations, entities, goals, constraints, facts, and evidence groups.
- Each top-level record field is also saved directly to its own file:
  `trajectory_id.json`, `task_type.json`, `task.json`, `kinds.json`,
  `relations.json`, `entities.json`, `goals.json`, `facts.json`, and `evidences.json`.
- `steps.json`: segmented environment/agent text, module text, and admissible actions.
- `rules.json` and `evaluations.json`: the seven abstract rules and their four-state evaluations.

The parser reuses the WebShop and ALFWorld profiles. Other task types
produce an explicit error. Actions use facts with `slot="act"`; module text is
retained, but intentions, diagnoses, and goal-completion evaluation are omitted.
Repeated runs replace the generated JSON files for that ID.

Compile the fixed twenty IDs (WebShop 10, ALFWorld 10):

```powershell
$env:PYTHONHASHSEED = '42'
python -B -m prodebugger.run_compile --sample-file prodebugger/sessions/abstract_rules_n20/sample.json --output-dir artifacts/compile_n20
```

Batch outputs: sample.json (IDs and source/data hashes), rules.json, results.json,
report.md and one compilation directory per ID. PYTHONHASHSEED=42 fixes profile set
iteration. `prodebugger/sessions/abstract_rules_n20/` is the original committed
output of this command; its `sample.json` keeps the original source hashes and
absolute source paths as historical provenance only (they are never read as paths).

## Derived evidence

`Evidence` stores `eid`, `kind`, `t`, a tuple of Fact indices (`refs`), `status`,
`rule`, and `details`. `Record.evidences` groups items by kind in `Evidences`.
Each exported group also includes the sorted union of its items' Fact refs.
All refs must exist and must not point to a step later than the evidence.

All active DSL detection uses `abstract_rules.py`. Each evaluation records
`satisfied`, `violated`, `unknown`, or `not_applicable`; only `violated` adds
candidate Evidence of kind `abstract.rule`. Candidates are not confirmed diagnoses.
`parse_benchmark_instance(..., with_evidence=False)` compiles Facts without detection.

## Seven abstract rules

R1–R5, R7 and R8 are defined in `abstract_rules.py` (R6 is removed). They read existing
Facts and add no semantic or intention parsing.

| Rule | Existing-Fact check | Unknown boundary |
|---|---|---|
| R1 assertion.consistency | Functional key and positive versions/payload | Mutable assertion time, unbound/page placeholder |
| R2 assertion.grounding | Matching observation history or immutable counterrecord | Missing record does not establish hallucination |
| R3 information.update | Previously supported value and later invalidation | Current versus historical assertion is not recorded |
| R4 decision.applicability | Existing admissibility check linked to the action | Missing check/no_tag; no extra task-constraint inference |
| R5 execution.result | First associated feedback, explicit effect=none | Missing feedback or expected effect model |
| R7 completion.consistency | Explicit structured mind satisfied Fact and contemporaneous goal status | No completion commitment inferred from domain actions |
| R8 progress.efficiency | Consecutive equivalent actions, context and nonempty result fingerprint | Retry exceptions, incomplete/changed context; no optimality claim |

## External requirements

- Python packages: `requirements.txt` (pyarrow, openai, python-dotenv).
- Online runs: an OpenAI-compatible Chat Completions endpoint with tool calls, and its API key
  in an environment variable or `.env` (see `.env.example`). Dry-run, replay and compilation
  need no network or credentials.
