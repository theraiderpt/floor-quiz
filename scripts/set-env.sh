#!/usr/bin/env bash
# Usage: scripts/set-env.sh SMTP_PASS
# Prompts for the value without echoing it and writes KEY=value into .env,
# replacing an existing line, so a secret never lands in shell history or a chat.
set -euo pipefail
key="${1:?usage: set-env.sh KEY}"
[[ "$key" =~ ^[A-Z0-9_]+$ ]] || { echo "bad key name" >&2; exit 1; }
env_file="$(dirname "$0")/../.env"
IFS= read -r -s -p "$key: " value; echo
[ -n "$value" ] || { echo "empty value, nothing changed" >&2; exit 1; }
KEY="$key" VALUE="$value" ENV_FILE="$env_file" python3 - <<'PY'
import os
k, v, p = os.environ["KEY"], os.environ["VALUE"], os.environ["ENV_FILE"]
lines = open(p).read().split("\n")
# Quote only when needed, with a quote char the value doesn't contain: dotenv
# has no escaping inside quotes, and single quotes avoid its \n expansion.
import re, sys
if "\n" in v or "\r" in v:
    sys.exit("value contains a newline, not supported")
if not re.fullmatch(r"[A-Za-z0-9_@%+=:,./!&$^*()\[\]{}<>?~|;-]+", v):
    q = next((c for c in "'\"`" if c not in v), None)
    if q is None:
        sys.exit("value contains all of ' \" ` and cannot be stored in .env")
    v = q + v + q
new = f"{k}={v}"
hits = [i for i, l in enumerate(lines) if l.startswith(k + "=")]
if hits:
    lines[hits[0]] = new
else:
    lines += [new]
open(p, "w").write("\n".join(lines))
PY
echo "$key saved to .env (restart the app to apply)"
