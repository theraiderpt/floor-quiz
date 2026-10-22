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
import os, re, sys
k, v, p = os.environ["KEY"], os.environ["VALUE"], os.environ["ENV_FILE"]
# Quote only when needed, with a quote char the value doesn't contain: dotenv
# has no escaping inside quotes, and single quotes avoid its \n expansion.
if "\n" in v or "\r" in v:
    sys.exit("value contains a newline, not supported")
if not re.fullmatch(r"[A-Za-z0-9_@%+=:,./!&$^*()\[\]{}<>?~|;-]+", v):
    q = next((c for c in "'\"`" if c not in v), None)
    if q is None:
        sys.exit("value contains all of ' \" ` and cannot be stored in .env")
    v = q + v + q
text = open(p).read() if os.path.exists(p) else ""
lines = text.split("\n")
if lines and lines[-1] == "":
    lines.pop()
new = f"{k}={v}"
# dotenv keeps the last duplicate, so replace every match (including "export KEY=")
pat = re.compile(r"^\s*(export\s+)?" + re.escape(k) + r"\s*=")
hits = [i for i, l in enumerate(lines) if pat.match(l)]
if hits:
    for i in hits: lines[i] = new
else:
    lines.append(new)
# temp file + rename, so a crash mid-write can't leave .env empty
tmp = p + ".tmp"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as fh:
    fh.write("\n".join(lines) + "\n")
try:
    st = os.stat(p)
    os.chown(tmp, st.st_uid, st.st_gid)
    os.chmod(tmp, st.st_mode & 0o777)
except FileNotFoundError:
    pass
os.replace(tmp, p)
PY
echo "$key saved to .env (restart the app to apply)"
