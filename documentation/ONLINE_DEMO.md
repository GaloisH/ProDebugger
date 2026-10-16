# Online end-to-end demo

This guide runs the complete **MAP → ROUTE → TRACE → SUBMIT** workflow on one released ALFWorld trajectory. Unlike [`inspect_examples.py`](../inspect_examples.py), this run calls an LLM and may incur provider charges. A Chat Completions-compatible endpoint with tool-call support and its API key are required.

## 1. Install and configure a provider

Follow the [repository quick start](../README.md#quick-start), then create a local environment file:

```bash
cp .env.example .env
```

Put your key in the variable you intend to use, for example `OPENAI_API_KEY=...`. Keep `.env` private; it is git-ignored. Set `MODEL_ID` and `BASE_URL` to a model and endpoint that support tool calls:

```bash
MODEL_ID="your-tool-capable-model"
BASE_URL="https://your-provider.example/v1"
```

Do not include `/chat/completions` in `BASE_URL`; the OpenAI SDK appends the endpoint path.

## 2. Run one recorded trajectory

```bash
python -B -m prodebugger.run_experiment GPT-4o_027_alfworld_task_027 \
  --model "$MODEL_ID" \
  --base-url "$BASE_URL" \
  --env-file .env \
  --api-key-env OPENAI_API_KEY \
  --run-id online-demo-alfworld \
  --max-turns 24 \
  --max-tool-calls 48 \
  --max-input-tokens 200000 \
  --max-output-tokens 20000 \
  --max-tokens 4096 \
  --max-parse-calls 10 \
  --max-parse-input-tokens 50000 \
  --max-parse-output-tokens 4000
```

If your key uses another environment-variable name, change `--api-key-env` to match it. The command reads the recorded trajectory from the included Parquet file and starts a new run; it does not launch or modify the original ALFWorld environment.

These are run-level request/token ceilings for a bounded first try, not a guaranteed monetary cap; provider pricing and token accounting vary. If the run stops at a configured limit, inspect the stop reason and increase limits deliberately.

## 3. Inspect the run

The output is saved under `artifacts/dsl_debugger/online-demo-alfworld/`:

- `report.md` and `results.json`: run summary and per-trajectory result;
- `manifest.json`: model/endpoint settings, run mode, input source, Python version and source fingerprint (never the API key);
- `GPT-4o_027_alfworld_task_027/result.json`: selected hypothesis, evidence references, uncertainty and stop reason;
- `tool_calls.jsonl`, `trace_queries.jsonl` and phase logs: investigation record.

Start the browser workbench with `python web/server.py`, then open <http://127.0.0.1:8770/#/?group=online-demo-alfworld>.

`status=diagnosed` means the answer passed the output protocol; it does not mean the selected cause is correct. Check the quoted source and uncertainty in `result.json`. For detailed budgets, replay and resume behavior, see [Running the debugger](RUNNING.md).
