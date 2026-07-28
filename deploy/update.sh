#!/usr/bin/env bash
#
# Push a code update to the running server. Run from inside the fresh
# project folder on the VPS:
#
#     cd ~/floor-quiz && bash deploy/update.sh
#
# The database lives in /var/lib/floor-quiz and is never touched, so your
# quiz library and past results survive every update.

set -euo pipefail

APP_DIR="/var/www/floor-quiz"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ok()  { printf "  \033[32mok\033[0m   %s\n" "$*"; }
die() { printf "\n\033[31mstopped:\033[0m %s\n\n" "$*" >&2; exit 1; }

[ -f "$SRC_DIR/package.json" ] || die "Run this from inside the project folder."
[ "$SRC_DIR" != "$APP_DIR" ]   || die "Source and target are the same folder. Upload the new version somewhere else first."

# Refuse to update while a game is in flight, since a restart would drop
# everyone mid-question.
LIVE="$(curl -fsS --max-time 5 http://127.0.0.1:3000/api/health 2>/dev/null || echo '')"
if echo "$LIVE" | grep -q '"games":[1-9]'; then
  echo ""
  echo "  There is a game running right now: $LIVE"
  read -r -p "  Restarting will disconnect everyone. Continue? [y/N] " reply
  [ "$reply" = "y" ] || [ "$reply" = "Y" ] || die "Cancelled."
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
sudo cp -a "$APP_DIR" "/var/backups/floor-quiz-$STAMP" 2>/dev/null && ok "rolled back copy at /var/backups/floor-quiz-$STAMP" || true

tar -C "$SRC_DIR" \
    --exclude=node_modules --exclude=.git --exclude='*.db*' --exclude=.env \
    -cf - . | tar -C "$APP_DIR" -xf -
ok "source updated"

cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund >/dev/null
ok "dependencies up to date"

# Deliberately does not touch nginx. Certbot owns that file after the first
# run, and copying the plain-HTTP template over it would drop the site off TLS.
pm2 restart floor-quiz --update-env >/dev/null
ok "service restarted"

sleep 2
curl -fsS --max-time 5 http://127.0.0.1:3000/api/health >/dev/null \
  && ok "health check passed" \
  || die "App did not come back up. Check 'pm2 logs floor-quiz'."

echo ""
echo "  Done. If something is wrong, roll back with:"
echo "    sudo rm -rf $APP_DIR && sudo mv /var/backups/floor-quiz-$STAMP $APP_DIR && pm2 restart floor-quiz"
echo ""
