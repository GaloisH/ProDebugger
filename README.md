# ProDebugger

ProDebugger is a platform for inspecting LLM agent trajectories and comparing
evidence-backed failure hypotheses. It compiles recorded observations and agent
outputs into a structured record, retrieves targeted evidence through a constrained
DSL query interface, and displays the investigation in an interactive workbench.
The backend runs MAP → ROUTE → TRACE → SUBMIT. A selected diagnosis remains a
hypothesis whose evidence and uncertainty should be inspected.

For a short implementation guide, terminology and reproducible examples, start
with [REVIEWER_GUIDE.md](REVIEWER_GUIDE.md). This standalone package originated
from `experiments/dsl` in the OmniDebugger intern repository.

See [README_EVOLUTION.md](README_EVOLUTION.md) for the changes from the initial
repository to the current backend. This repository includes 105 annotated benchmark
traces: **66 ALFWorld** and **39 WebShop**. Experiment outputs are kept outside the
repository.

```text
ProDebugger/
  core/                 canonical compiler, domain profiles, semantic scope and operators
    profiles/           alfworld, webshop, base
    data/train.parquet  105 annotated traces: ALFWorld 66, WebShop 39
    data/examples/      one complete JSON trace per domain
  prodebugger/          the DSL debugger (formerly experiments/dsl)
    run_experiment.py   MAP -> ROUTE -> TRACE -> SUBMIT entry point
    run_compile.py      compile one trajectory / the fixed 20-ID sample
    prompts/            map.md, route.md, manager.md, trace.md, submit.md
    sessions/           compiled trajectories (generated locally; git-ignored)
  web/                  workbench: stdlib server + static frontend (no build), chat launcher
  artifacts/dsl_debugger/          run outputs (created on first run; git-ignored)
```

All commands below are run from the `ProDebugger` directory.

## Setup

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env   # needed only for online model configuration
```

Windows PowerShell:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env   # needed only for online model configuration
```

Python 3.12+ (tested with 3.13). `pyarrow` is needed for Parquet input and `run_compile`;
`openai` and `python-dotenv` only for online runs.

## Offline quick start

After activating the environment, compile one ALFWorld trace and one WebShop trace,
then execute a small read-only evidence query for each:

```bash
python -B inspect_examples.py
python web/server.py
```

The script makes no model calls. It saves compiled records, annotated `query.sql`,
`query_result.json` and a combined `report.json` under `artifacts/reviewer_examples/`.
Open http://127.0.0.1:8770 to use the workbench; start with the Chat catalog to
inspect the supplied trajectory IDs. Offline compilation does not create a
diagnosed run. See [the saved example report](EXAMPLE_REPORT.json) and
[the walkthrough](REVIEWER_GUIDE.md#reproduce-the-two-environment-examples).

## Benchmark traces

[Download the Parquet data](core/data/train.parquet?raw=true) or browse a complete
[ALFWorld example](core/data/examples/alfworld.json) and
[WebShop example](core/data/examples/webshop.json). Each row contains one agent
trajectory with its original failure annotations.

| Environment | Traces |
| --- | ---: |
| ALFWorld | 66 |
| WebShop | 39 |
| **Total** | **105** |

These traces are the ALFWorld/WebShop subset of the supplied 139-row `train.parquet`;
34 GAIA rows are excluded. Rows, IDs, trajectory content and annotation values are
preserved. The `train` filename follows the source file; this release does not
introduce a new train/validation/test split. See the [data documentation](core/data/README.md)
for the schema and [manifest](core/data/manifest.json) for source/output SHA-256 hashes.

Read and inspect the data after installing the requirements:

```python
import json
from collections import Counter
import pyarrow.parquet as pq

table = pq.read_table("core/data/train.parquet")
print(Counter(table["task_type"].to_pylist()))  # alfworld: 66, webshop: 39
row = table.to_pylist()[0]
messages = json.loads(row["full_trajectory"])["messages"]
print(row["trajectory_id"], messages[0]["content"])
```

Compile one included trace from each domain without an API key:

```bash
python -B -m prodebugger.run_compile GPT-4o_027_alfworld_task_027
python -B -m prodebugger.run_compile GPT-4o_003_chat_b000_t00_e02-1e119842
```

Reference labels are included for evaluation. The debugger's Parquet input path
reads only `trajectory_id`, `task_type` and `full_trajectory`.

## LLM debugger entry point

ProDebugger prepares auditable trajectory evidence, then runs
**MAP → ROUTE → TRACE → SUBMIT** to investigate a failure.

![ProDebugger workflow: evidence preparation, four diagnostic stages and evidence-linked output](assets/prodebugger-workflow.png)

**How to read the figure.** The workflow moves from the failed trajectory on the
left to a diagnosis on the right. Evidence preparation audits the input and
compiles Facts, goals and entities with source provenance and parsing gaps. Seven
abstract checks identify potential violations or unknowns; these are investigation
leads, not confirmed failures. The four diagnostic stages then use this evidence.
Within TRACE, the manager assigns investigators, who retrieve targeted evidence
through the read-only DSL / SQL interface. Source validation and protocol checks
constrain the investigation and its final output.

| Stage | Responsibility | Output |
| --- | --- | --- |
| **MAP** | Read task requirements and identify unmet or unresolved goals | Goal map |
| **ROUTE** | Inspect recorded evidence and entity history to identify issues | Source-backed investigation anchors |
| **TRACE** | A manager allocates investigations; each investigator queries evidence and assesses a step | Candidates with source quotations and uncertainty |
| **SUBMIT** | Compare supplied candidates and select one without tools | Selected hypothesis, evidence and uncertainty |

**How the stages connect.** MAP establishes the requirements used by later
stages. ROUTE proposes issue anchors; an anchor identifies a question to
investigate, not a boundary on accessible history. TRACE's manager assigns
questions and interpretation criteria before evidence queries. Investigators run
in separate conversations, sequentially in the current implementation, and assess
at most one step each. SUBMIT receives their candidates and supplied evidence to
make the final comparison. The stage outputs are recorded so users can inspect
how an explanation was reached.

Evidence queries are read-only and use targeted DSL / SQL operators. Each TRACE
investigator has one query opportunity, including SQL errors. Missing evidence
remains **unknown**. SUBMIT selects an existing candidate when available;
selection does not prove causal correctness. If TRACE returns no candidates,
SUBMIT is skipped with `no_candidate`.

### Minimal commands

After [setup](#setup), reproduce one ALFWorld and one WebShop compilation/query
example without an API key:

```bash
python -B inspect_examples.py
```

For an online diagnosis, configure your provider key in `.env` and run:

```bash
python -B -m prodebugger.run_experiment GPT-4o_027_alfworld_task_027 --model MODEL_NAME --base-url ENDPOINT --env-file .env
```

Replace `MODEL_NAME` and `ENDPOINT` with your provider configuration. The default
key variable is `OPENAI_API_KEY`; use `--api-key-env` for another variable.

### Detailed documentation

- [Implementation and terminology](REVIEWER_GUIDE.md): evidence constraints, operator names and demonstration flow.
- [Running the debugger](RUNNING.md): the complete detailed specification retained from the previous README, including parsing, manager allocation, query constraints, model settings, budgets, replay/resume and output files.
- [Query reference](prodebugger/prompts/query_dsl.md): supported operators, SQL syntax and coverage semantics.
- [Data documentation](core/data/README.md) and [offline example results](EXAMPLE_REPORT.json).

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
- **Result**: a diagnosed run shows the selected failure hypothesis with its step chain and evidence;
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
iteration. The historical `prodebugger/sessions/abstract_rules_n20/sample.json` and compiled
sessions are not included in a fresh clone. The fixed twenty-ID command requires
that local manifest. Use `python -B inspect_examples.py` for examples supplied
with this repository.

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
