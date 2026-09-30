#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PRODEBUGGER_PYTHON:-$ROOT_DIR/.venv/bin/python}"

if [[ ! -x "$PYTHON" ]]; then
  echo "Python runtime not found. Run ./setup.sh first." >&2
  exit 1
fi

cd "$ROOT_DIR/core"
exec "$PYTHON" dbg.py "$@"
