# ProDebugger

Standalone migration of the DSL debugger experiment (`experiments/dsl` in the original
OmniDebugger intern repository). The backend audits task/observation parsing and uses evidence-driven SQL retrieval in TRACE. SUBMIT retains its input schema and must select one supplied candidate.

See [README_EVOLUTION.md](README_EVOLUTION.md) for the changes from the initial
repository to the current backend. Experiment results and trajectory archives are kept
outside this repository.

```text
ProDebugger/
  core/                 canonical compiler, domain profiles, semantic scope and operators
    profiles/           alfworld, webshop, base
    data/train.parquet  benchmark trajectories (private; git-ignored)
  prodebugger/          the DSL debugger (formerly experiments/dsl)
    run_experiment.py   MAP -> ROUTE -> TRACE -> SUBMIT entry point
    run_compile.py      compile one trajectory / the fixed 20-ID sample
    prompts/            map.md, route.md, manager.md, trace.md, submit.md
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
conversations and independently configurable phase models. TRACE begins with a
separate manager conversation before its investigator conversations.
MAP reads unmet/unresolved requirements. ROUTE follows native evidence and entity
history to several issue anchors. Task and observation parsing first passes a strict
whole-template audit. Complete domain grammars parse fixed task clauses, scoped
empty/no-effect feedback, local unambiguous pronouns, object lists and listing
product/title/price tuples. Every token/clause must be consumed and typed values
validated. Unknown clauses, ambiguous references, invalid values or incomplete
extraction require LLM backoff; keyword occurrence alone is not sufficient.
Backoff uses the current text and only prior observations/actions; exact source spans,
entity bindings and residual coverage are validated. Unresolved text is recorded as
an evidence gap, and dependent rule violations are conservatively demoted. Offline
compilation records backoff-required gaps instead of accepting partial extraction.

The TRACE manager sees the complete original action/observation timeline, all ROUTE
anchor modules, cited Facts and parse warnings, plus the same SQL documentation,
original step bounds and relation names as TRACE. Other steps' memory/reflection/plan
texts require investigator retrieval. It allocates 1..`trace_top_p` investigators,
merging related ROUTE cases or assigning complementary questions to the same case.
The manager defaults to one investigator, adds a second for an independent question
that could change the diagnosis, and must justify additional investigators. Origin,
verification and recovery can share one query; agent limits are ceilings, not targets.
Each allocation specifies a question, search targets, exact source excerpts and
supported/refuted/unknown criteria. Cross-agent conditional rules explain how findings
would affect causal comparison, including missing links and counterevidence. The plan
is validated and saved in `manager_plan.json` before queries, and cannot be rewritten
after seeing results. Source excerpts must occur in manager-visible original text.
The manager prompt explicitly allocates backward claim-origin searches across
`[1,anchor]`, separate from historical-event verification and later recovery. Two
source-grounded allocation examples illustrate supported origins and parser false
positives. These are planning instructions; runtime validation checks structure,
coverage and exact quotes, not the semantic quality of causal allocation.
Assignments are starting points, not search whitelists. The manager asks workers to
compare a source-grounded competing mechanism, not only earlier copies of an anchor
phrase. Workers may expand to related modules and report a different supported cause.
Within the one SQL query, targeted claim discovery can be joined by step to separately
retrieved peer-module excerpts, actions and feedback. Table-function arguments remain
literals; this does not permit full-step retrieval or another query. The historical
drawer SQL example demonstrates this pattern using actual archived sources.

Each TRACE investigator receives its anchor source, assigned question and evidence, makes
**one SQL query**, then returns **one original step** in the existing candidate-list
schema, adding `is_root_cause` (true/false/null) to distinguish causal role from
fault confidence. A confident fault can return its step with `status=error` and
`is_root_cause=false`. Same-step module alternatives remain possible. No fixed window or automatic
prior-history dump is supplied. CTEs, joins, conditions, set operations and record-specific
functions (`TRACE_ENTITY`, `TRACE_STATE`, `TRACE_ACTION`, `TRACE_FACT`, `STATE_AT`,
`SOURCE`, `SEARCH_TEXT`, `GOAL_STATUS`, `COVERAGE`)
are documented in [Record SQL](prodebugger/prompts/query_dsl.md). Queries are read-only,
audited; invalid SQL also consumes the one opportunity. Quotes must exist
in returned raw source, allocated exact excerpts or the initial anchor. The mode is `evidence-query-step/v2-elements`.
The canonical names are `TRACE_ENTITY`, `TRACE_STATE`, and `TRACE_ACTION`.
Archived `TRACK_*` calls remain compatible aliases; execution and query conversion
normalize their function names without changing quoted evidence or historical logs.
Record SQL retains support for token-bounded letter/digit codes such as `4T` and normalizes
double-quoted literals only in known string argument slots. Invalid known-function
arguments may suppress dependent top-level `UNION ALL` arms while preserving
independent arms. `partial`, `function_errors`, `skipped_branches` and `repairs`
reach both TRACE and SUBMIT: suppressed evidence is unavailable, never zero matches.
Full-log access and other prohibited SQL still fail; recovery makes no extra model
call and does not widen search scope.
Record SQL v6 batches repeated terms/modules and supports `UNION ALL BY NAME`.
Branches select only relevant fields; source and Fact rows need no NULL padding.
Compact queries return sparse rows that omit NULL keys while preserving 0/false/empty
strings. Source alignment reads available fields and requires unambiguous provenance;
missing attributes remain unknown. Existing scalar SQL and TRACE candidate schemas
remain compatible.

TRACE is instructed to include concise English `--` comments in its SQL explaining
the query's purpose, retrieval branches and meaningful filters/bounds. Annotated SQL
is preserved in `trace_queries.jsonl` (`query`) and `tool_calls.jsonl` (`arguments.sql`)
for display and debugging, within the same single query call.
TRACE's `query_context` supplies the original step range and relation/action names.
The SQL engine searches the full trajectory, including steps before a ROUTE anchor;
optional function bounds narrow an element search, never create a fixed window.
Prompts guide source-claim verification across memory/reflection/actions/observations
and include four executable examples from other archived trajectories, without
benchmark answers.
ROUTE preserves every result in the latest tool batch in full, retains marked source
previews for older large results, and references duplicate results. Three consecutive
rounds without new successful evidence restrict the next turn to routing or finishing
uncertain; another retrieval request stops uncertain. Durable tool logs remain complete.
The executor rejects direct `steps`, `modules`, `facts` and `RAW_STEP` access, including
through CTEs and joins. Queries must use element functions. Original excerpts require
a specific search term and one source field, with 360-character phrase-centered
excerpts. All matching sources are materialized; there is no shared character,
source-count, graph-node-count, function-count or result-row/byte budget. Explicit
SQL LIMIT, filters and graph depth still apply, and SQL execution deadlines remain.
Raw module wrapper facts expose
identity only. SQL LIMIT and function omissions remain explicit. Every result carries
extraction gaps and distinguishes observations, agent claims and derived checks.
Unknown state is not a negative state, and selective module extraction is not evidence
that the agent omitted a constraint. TRACE must test these false-positive explanations.
Legacy `window_id`, `window`, and result envelope fields remain for SUBMIT compatibility;
`lo=hi=issue_step` records an anchor, never a retrieval boundary. `--window-size` and
`--trace-top-k` remain legacy metadata and do not control TRACE retrieval or step count.

SUBMIT compares every TRACE candidate, recovery and terminal goal impact in ONE
plain-JSON response without tools. It must select one existing candidate and return
`diagnosed`, including when all TRACE candidates are `uncertain`. Evidence limits
remain explicit in the `uncertainty` text; forced selection does not establish truth.
The runner validates candidate references and saves `direct_submit.jsonl`.
`manager_guidance` passes the manager's plan directly to SUBMIT, together with allocated
source excerpts and the actual bounded SQL results/errors/truncation for every agent,
including agents returning no candidate. SUBMIT checks each condition against evidence
and explains relevant rule IDs in existing reasoning/comparisons fields. Conditions in
one rule are ANDed; missing evidence remains unknown. Manager rules are hypotheses,
not observations, votes or hard candidate exclusions. This is an additive input field;
investigator candidate outputs and final answer fields retain their existing layout.
The additional root-role field is passed to SUBMIT only when at least two different
steps from independent TRACE cases have definite `error` judgements and known
boolean root roles. A single case, same-step alternatives, or an uncertain case
paired with a non-root case hides the field. The full annotations remain in TRACE
logs. Role annotations inform comparison and never remove selectable candidates.
The current result policy is `window-candidates-submit/v5-manager-forced-choice`; structural acceptance
does not prove causal correctness.
The user-specified benchmark scope contains all core fault classes except
`format_error` (16 allowed labels); formatting, spelling and quotation marks
cannot be benchmark root causes in this experiment. Both TRACE and SUBMIT use
that premise. Raw source text is preserved; excluded causes cannot be relabelled.
When every TRACE result is empty, the runner records `no_candidate` and skips SUBMIT.
Invalid SUBMIT JSON/selection (including status `uncertain`) records `error` after that response, without retries
for semantic correction. Provider transport retries retain their normal accounting.
Current checkpoints require v6 and current source fingerprints. Earlier
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
python -B -m prodebugger.run_experiment TRAJECTORY_ID --model MODEL_NAME --base-url ENDPOINT --max-turns 80 --max-tool-calls 240
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
credential configuration are shared. `--manager-model` overrides the manager's model,
which otherwise inherits `--trace-model` (or `--model`). MANAGER requests and usage are
logged separately while its orchestration remains inside TRACE. Each role uses its
corresponding prompt under `prompts/`.
MAP requests the initial requirements view through its model. Phase switches
pass explicit shared-state handoffs. TRACE receives the ROUTE hypothesis and cited
Facts, original anchor source, query metadata and parsing warnings. SUBMIT receives TRACE
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
uses the original seed when resuming. Current checkpoints use `debugger-checkpoint/v6`.
Runs created by the original repository cannot be resumed here: the source
fingerprint includes the source file set and paths, which changed with the migration.

This mode builds one canonical core Record and a strict same-ID DSL projection,
then runs the unchanged seven abstract rules. Compilation mode is
`canonical-core-dsl-projection/v1`.

Available tools include scoped `view`, `view_evidence`, `trace_evidence`,
`trace_fact`, `route_cases`, `query_logs`, compatible candidate-list `assess`,
`check/span/state/back/up/versions/neighbours`, `hold/drop/contrast`, `reroute`
and `finish`. Read/routing tools remain available to MAP/ROUTE; TRACE exposes
`query_logs` followed by `assess`, while SUBMIT has no tool schemas. Rule candidates, provenance
links and LLM assessments are separate claims.

TRACE tool calls are recorded in messages/requests/usage and tool_calls; validated
TRACE conclusions retain the `window_trace.jsonl` output contract. Each case gets at most
three validation attempts. Invalid candidate lists cannot partially update coverage.
Every declared case must have a committed conclusion before SUBMIT. Exact quotes,
existing Fact mappings and allowed benchmark fault classes are checked. SUBMIT
compares all candidates once; invalid JSON/selection stops with a protocol error. Core's
full-trajectory gate remains unchanged. Finite coverage does not establish the
globally earliest or unique cause.

Each run has a unique directory; existing runs are never overwritten:

```text
artifacts/dsl_debugger/<run_id>/
  manifest.json, results.json, report.md
  <trajectory_id>/
    input.json, canonical_record.json, rules.json, evidences.json, evaluations.json
    goal_map.json, route_candidates.json, trace_windows.json, trace_graph.json
    window_trace.jsonl, trace_queries.jsonl, direct_submit.jsonl
    audited_parse.json, parse_audit.jsonl, parsing_usage.json, parsing/
    messages.jsonl, phase_events.jsonl, tool_calls.jsonl, usage.jsonl, usage.json
    requests/00001.json, ..., checkpoint.json, result.json
```

Dry-run produces no model transcript/checkpoint or diagnosis. `result.status` is
diagnosed, uncertain, no_candidate, no_failure, budget_exhausted, error, or dry_run. Only an
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
Its hero rotates screenshots in `web/static/img/shots/`; refresh them after UI changes with
`python web/capture_shots.py` (headless Chrome or Edge plus Pillow, server running).
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

## Audited parsing and concurrent runs

```bash
.venv/bin/python -B -m unittest discover -s checks -v
.venv/bin/python -B -m prodebugger.run_experiment --sample-file artifacts/analysis/sample10.json --workers 10 --model openai/gpt-6-luna-pro --base-url https://openrouter.ai/api/v1 --api-key-env OPENROUTER_API_KEY --env-file .env
```

`--workers` runs independent trajectories concurrently. Parsing has its own model
(`--parse-model`, defaulting to `--model`) and recorded budgets (`--max-parse-calls`,
`--max-parse-input-tokens`, `--max-parse-output-tokens`, `--parse-max-tokens`).
`parsing_usage.json` is separate from the four diagnostic phases' `usage.json`.
Completed parse units and TRACE conversations are durable; resume reuses them.
Source/model changes require a new run. Frontend adaptation is outside this change.

Agent statement parsing is separate from observed world facts. Compilation retains
exact clause offsets, lexical topics, conservative complete-template statements and
explicit unresolved text. A memory with no typed claim is `memory_unparsed`, never
an assertion that the agent recalled nothing. ROUTE gets topic discovery metadata;
manager and TRACE cards respect their existing source visibility.

`FIND_CLAIMS(topic,module[,from,to])` discovers targeted mental clauses, including
earlier clauses absent from entity/state parsing. Existing SQL results also receive
statement cards when their final returned columns preserve source text/provenance.
Filtered-out rows cannot contribute cards. Partial clauses remain unresolved and
are not expanded into full modules. Topic matching is lexical, not exhaustive.

After each successful TRACE query, all unique visible complex clauses (query,
anchor and assigned excerpts) are sent in **one compact batch parser request**.
Integer source indexes and positional statement fields avoid repeatedly generating
long field names and source quotes. The validated statement-card format is unchanged.
There is no per-sentence call, semantic repair loop or automatic transport retry. The batch
extracts propositions, modality/negation and explicit stated relationships together;
it also resolves pronouns against earlier already-visible clauses of the same module
when an exact antecedent can be cited. Reference-sensitive caches include that visible
context, so narrower retrieval cannot inherit a hidden antecedent. It does not
diagnose faults or infer world truth. Exact quotations are validated;
invalid units leave unresolved evidence. If JSON is cut off or the provider reports
`finish_reason=length`, complete units are retained and **only missing units** are
requested in smaller groups. Recovery splits each missing group in two, at most
twice (at most seven requests including the initial request). An oversized single
unit is not blindly repeated. Exhausted recovery leaves an explicit missing-unit
count and unresolved sources; it is never reported as a complete parse. A complete
JSON response that omits units without a length signal is flagged as incomplete,
without semantic repair calls. Provider errors stop recovery.
Recovery preserves the original visible reference context and never reruns SQL.
Per-clause and whole-batch caches plus the durable response ledger preserve reuse
and deterministic restart, including failed batches. Offline/replay runs make no
new semantic model calls. The usage ledger records finish/native finish reasons,
response IDs and reasoning-token usage when the provider supplies them.
The parser uses the existing parse model/settings; its separate request/usage/cache
files live in `claim_parsing/`, with usage also exposed in `result.usage.claim_parsing`.
This is one logical parse batch per investigator, normally one model call;
truncation recovery calls are counted separately in the batch metadata. The TRACE assess
schema, one-query/one-step constraint and SUBMIT handoff fields are unchanged.
