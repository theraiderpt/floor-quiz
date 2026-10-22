#!/usr/bin/env bash
# Usage: scripts/set-env.sh SMTP_PASS
# Prompts for the value without echoing it and writes KEY=value into .env,
# replacing an existing line, so a secret never lands in shell history or a chat.
set -euo pipefail
key="${1:?usage: set-env.sh KEY}"
[[ "$key" =~ ^[A-Z0-9_]+$ ]] || { echo "bad key name" >&2; exit 1; }
env_file="$(dirname "$0")/../.env"
read -r -s -p "$key: " value; echo
[ -n "$value" ] || { echo "empty value, nothing changed" >&2; exit 1; }
KEY="$key" VALUE="$value" ENV_FILE="$env_file" python3 - <<'PY'
import os
k, v, p = os.environ["KEY"], os.environ["VALUE"], os.environ["ENV_FILE"]
lines = open(p).read().split("\n")
# dotenv treats an unquoted " #" as a comment, so quote values that need it
if any(c in v for c in "# \t") and '"' not in v:
    v = f'"{v}"'
new = f"{k}={v}"
hits = [i for i, l in enumerate(lines) if l.startswith(k + "=")]
if hits:
    lines[hits[0]] = new
else:
    lines += [new]
open(p, "w").write("\n".join(lines))
PY
echo "$key saved to .env (restart the app to apply)"
