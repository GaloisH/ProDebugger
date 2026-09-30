#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_CMD="${PYTHON_BIN:-python3}"
VENV_DIR="$ROOT_DIR/.venv"

if ! command -v "$PYTHON_CMD" >/dev/null 2>&1; then
  echo "Python executable not found: $PYTHON_CMD" >&2
  echo "Install Python 3.9-3.12 or set PYTHON_BIN=/path/to/python." >&2
  exit 1
fi

"$PYTHON_CMD" - <<'PY'
import sys
if not ((3, 9) <= sys.version_info[:2] <= (3, 12)):
    raise SystemExit(
        f"ProDebugger expects Python 3.9-3.12; found {sys.version.split()[0]}"
    )
print(f"Using Python {sys.version.split()[0]}")
PY

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "Creating virtual environment at $VENV_DIR"
  "$PYTHON_CMD" -m venv "$VENV_DIR"
fi

echo "Installing dependencies"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r "$ROOT_DIR/requirements.txt"

mkdir -p "$ROOT_DIR/core/sessions" "$ROOT_DIR/core/submissions"

echo
echo "Setup complete. Add your own Parquet trajectories under core/data/ before running the CLI or workbench."
