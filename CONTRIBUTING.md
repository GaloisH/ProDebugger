# Contributing

Thanks for your interest in improving ProDebugger. Contributions should preserve the project's evidence boundaries: missing or unparsed evidence stays unknown, and a rule flag or selected hypothesis must not be presented as a confirmed cause.

## Set up a development environment

Use Python 3.12 or later and run commands from the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt pytest
```

## Before opening a pull request

Run the regression checks and the credential-free examples:

```bash
python -m pytest checks -q
python -B inspect_examples.py
```

The offline examples should not require a model API key or make network requests. If a change affects their output, update the relevant documentation and checked-in example report where appropriate. Do not commit `.env` files, API keys, generated run artifacts, or benchmark data beyond the files already tracked by the project.

## Describe changes clearly

In a pull request, summarize the behavior changed, the evidence or checks used to validate it, and any known limitations. For diagnostic behavior, distinguish structural/protocol validity from causal correctness and report uncertainty explicitly.
