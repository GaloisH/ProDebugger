# Evaluation and reproducibility

## What is currently available

The repository includes 105 annotated AgentErrorBench training trajectories: 66 ALFWorld and 39 WebShop. They are a filtered subset of the upstream 139-row `train` file, not a new held-out split. The runner records diagnoses, usage and protocol status; the separate scorer below computes exact-match agreement, but the repository does not bundle baseline runs. Do not describe the offline compiler/query example or a valid `diagnosed` response as an accuracy result.

The exact-match scorer below compares saved selected hypotheses against the supplied annotations. It reports step exact accuracy, step-and-module exact accuracy, and module exact accuracy conditional on a correct step. These are agreement metrics under one explicit policy; they do not establish causal truth. Errors and missing selected roots count as incorrect. Pass the same `--sample-file` used for the run so trajectories absent from a partial results file also count as incorrect. Module comparison ignores case and surrounding whitespace only.

## Reproduce a small online smoke run

First follow [Online end-to-end demo](ONLINE_DEMO.md) to configure a tool-call-capable provider. A two-domain sample is useful for checking setup, but is far too small for a general performance claim:

```bash
python -B -m prodebugger.run_experiment \
  --sample-file documentation/samples/two-domain-smoke.json \
  --model "$MODEL_ID" \
  --base-url "$BASE_URL" \
  --env-file .env \
  --api-key-env OPENAI_API_KEY \
  --run-id two-domain-smoke \
  --max-turns 24 \
  --max-tool-calls 48 \
  --max-input-tokens 200000 \
  --max-output-tokens 20000 \
  --max-tokens 4096 \
  --max-parse-calls 10 \
  --max-parse-input-tokens 50000 \
  --max-parse-output-tokens 4000
```

Score the returned results against the matching released annotations:

```bash
python -B -m prodebugger.evaluate_results \
  artifacts/dsl_debugger/two-domain-smoke \
  --sample-file documentation/samples/two-domain-smoke.json \
  --out artifacts/dsl_debugger/two-domain-smoke/evaluation.json
```

The scorer reads annotations only after the run has completed. `run_experiment` constructs debugger input from `trajectory_id`, `task_type` and `full_trajectory`; reference steps/modules are not part of the model input.

## Run the released 105-row subset

To evaluate every supported row, generate a unique ID list from the data file and run it as a fixed sample. This may make many provider calls and incur substantial charges; start with the two-row smoke run and set provider-side spending limits first.

```bash
mkdir -p artifacts
python - <<'PY'
import json
import pyarrow.parquet as pq

rows = pq.read_table("core/data/train.parquet", columns=["trajectory_id"]).to_pylist()
with open("artifacts/agenterrorbench-105-sample.json", "w", encoding="utf-8") as f:
    json.dump([row["trajectory_id"] for row in rows], f, indent=2)
    f.write("\n")
PY

python -B -m prodebugger.run_experiment \
  --sample-file artifacts/agenterrorbench-105-sample.json \
  --model "$MODEL_ID" \
  --base-url "$BASE_URL" \
  --env-file .env \
  --api-key-env OPENAI_API_KEY \
  --run-id agenterrorbench-105 \
  --workers 1 \
  --max-turns 24 \
  --max-tool-calls 48 \
  --max-input-tokens 200000 \
  --max-output-tokens 20000 \
  --max-tokens 4096 \
  --max-parse-calls 10 \
  --max-parse-input-tokens 50000 \
  --max-parse-output-tokens 4000

python -B -m prodebugger.evaluate_results \
  artifacts/dsl_debugger/agenterrorbench-105 \
  --sample-file artifacts/agenterrorbench-105-sample.json \
  --out artifacts/dsl_debugger/agenterrorbench-105/evaluation.json
```

## Metric definitions and reporting requirements

| Metric | Definition |
| --- | --- |
| Step exact accuracy | A protocol-accepted selected `root.step` equals `critical_failure_step`; denominator is every expected sample ID. |
| Step + module exact accuracy | Both selected root step and module match the reference; denominator is every expected sample ID. |
| Module accuracy given correct step | Module match among results with an exact step match. |

For a paper or public comparison, report the evaluated IDs/split, missing/error counts, model provider and exact model ID, endpoint family, run configuration, repository commit, and all three metrics. Use the same ID set and matching rules for every baseline. The released subset is called `train` upstream; results on it are not held-out generalization results. The repository does not currently bundle baseline runs or a pre-registered benchmark protocol.

Each run directory contains `manifest.json`, `results.json`, per-trajectory `result.json`, usage records and tool/phase logs. Preserve that directory with the evaluation JSON so a reported score can be traced back to the run configuration and evidence.
