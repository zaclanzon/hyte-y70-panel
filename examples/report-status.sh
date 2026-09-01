#!/usr/bin/env bash
# Report any agent or long task to the panel.
#
#   examples/report-status.sh <id> <status> [detail]
#   status: working | waiting | attention | idle | ended
#
# Example inside a script:
#   report-status.sh nightly-build working "Compiling"
#   report-status.sh nightly-build ended   "Build passed"
set -euo pipefail
ID="${1:?id}"; STATUS="${2:?status}"; DETAIL="${3:-}"
PANEL="${HYTE_PANEL_URL:-http://127.0.0.1:8787}"
python3 - "$ID" "$STATUS" "$DETAIL" "$PWD" <<'PY' | curl -sS -m 2 -X POST "$PANEL/api/agents/status" -H 'Content-Type: application/json' -d @- >/dev/null
import json, sys
print(json.dumps({"id": sys.argv[1], "name": sys.argv[1], "status": sys.argv[2], "detail": sys.argv[3], "cwd": sys.argv[4]}))
PY
