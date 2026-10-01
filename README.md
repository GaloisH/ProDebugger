# ProDebugger

ProDebugger compiles agent trajectories into a typed evidence record, exposes
that record through a query language, and checks a reasoner's review and
verification protocol. The repository contains the deterministic core, a
local read-only trajectory workbench, and code for a four-stage evaluation.

**No trajectory data, experiment results, test suite, or examples are
distributed in this repository.** Supply your own authorized Parquet corpus
to use the CLI, workbench, or evaluation code.

## Requirements and installation

- Python 3.9–3.12
- Bash or Zsh for the convenience scripts
- Internet access for the initial `pyarrow` installation

From the repository root, run `./setup.sh`. It creates `.venv` and installs
the pinned dependency in `requirements.txt`. On Windows, create a virtual
environment and install that file with your Python package manager instead.

Place your own corpus files at `core/data/train.parquet`,
`core/data/validation.parquet`, or `core/data/test.parquet`. These paths are
ignored by Git. The loader in `core/data_io.py` reads the files that exist;
the input schema is defined by that module and the record compiler. No data is
downloaded by the setup script.

## Run the debugger

After adding a corpus, get a trajectory ID from your data and run:

```bash
./run.sh "$TRACE_ID" profile
./run.sh "$TRACE_ID" view "process_notes | detail:summary"
./run.sh "$TRACE_ID" view "requirements | state:unmet | section:definition,status,gaps"
```

The query grammar and response schema are documented in
[`core/VIEW_INTERFACE.md`](core/VIEW_INTERFACE.md). The reasoner protocol is
documented in [`core/REASONER.md`](core/REASONER.md). Model invocation is kept
outside the deterministic core; [`core/TASK.md`](core/TASK.md) is the task
prompt for a tool-using reasoner.

## Local trajectory workbench

With the corpus in place, start the read-only HTTP service:

```bash
.venv/bin/python core/workbench.py
```

Open `http://127.0.0.1:8765/`. The service uses `workbench/` for its static
HTML, CSS, and JavaScript. The **Evidence / Experiment Debug** navigation switches
between the evidence workbench and saved experiment pages at `/experiments/`.
Evidence APIs do not read gold labels. The experiment view shows saved evaluations
and annotations separately; browsing either view does not create protocol sessions
or run a model.

Generate experiment pages with the command below, then refresh the Experiment Debug
view. With no generated pages, that view displays build instructions. To serve a
custom build output, start with `--experiments-dir PATH` (matching the builder's
`--output PATH`). Links between views preserve the trajectory and experiment run;
if multiple runs match a trajectory, the most recent run is selected.

On Windows, build saved experiment pages and start a hidden background service with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File workbench/start.ps1 -BuildExperiments
```

The launcher checks both views before printing their URLs and reuses an already
healthy workbench. It continues serving after the launch command exits. Use
`-Port 8766` for an alternative port. Logs are kept in `artifacts/workbench/`.

## Four-stage evaluation and offline case browser

`experiments/four_stage/` contains the model runner, prompts, scoring, and
saved-log analysis code. It needs a user-supplied corpus and model credentials
to execute. Install its additional dependencies with
`pip install -r experiments/four_stage/requirements.txt` when needed. Local
run outputs are excluded from Git.

The offline browser builder, dashboard generator, and browser assets
live in `frontend/case_browser/`. Once local run logs and the corpus exist,
generate pages with:

```bash
.venv/bin/python frontend/case_browser/build.py
```

Use `--source`, `--output`, and `--corpus` to override its defaults. Generated
pages contain trajectory and evaluation data, so the default output directory
is excluded from Git. Pages can still be opened offline: shared styles and
navigation assets are copied alongside the viewer. Cross-view evidence navigation
is available when entering through the local workbench service.

## Source layout

| Path | Purpose |
| --- | --- |
| `core/` | Corpus loader, typed record compiler, query engine, CLI, and protocol state |
| `workbench/` | Local read-only workbench page |
| `frontend/case_browser/` | Offline case browser builder and static assets |
| `experiments/four_stage/` | Evaluation runner and saved-log analysis code |
| `docs/DATA_STRUCTURES.md` | Core types, query schemas, and experiment data structures (Chinese) |

## Repository contents

Git tracks source code, prompts, static browser assets, launch scripts, and public
documentation. Local credentials (`.env`), virtual environments, caches, trajectory
corpora and exports, protocol sessions, experiment logs and results, generated
browser pages, temporary scripts, and internal research notes are excluded by
`.gitignore`. Keep generated data in the ignored output directories when using
custom paths.

The core exposes evidence; it does not choose a semantic root cause for the
reasoner. The reasoner must review the trajectory before a submission can be
accepted by the protocol.
