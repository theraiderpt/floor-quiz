#!/usr/bin/env bash
#
# Floor Quiz — VPS setup for cxquiz.tech
#
# Run once, from inside the uploaded project folder, as a sudo-capable
# non-root user:
#
#     cd ~/floor-quiz && bash deploy/setup.sh
#
# Safe to re-run. Every step checks before it acts, so a failed run can be
# fixed and repeated without unpicking anything.

set -euo pipefail

DOMAIN="cxquiz.tech"
APP_DIR="/var/www/floor-quiz"
DATA_DIR="/var/lib/floor-quiz"
LOG_DIR="/var/log/floor-quiz"
NODE_MAJOR="24"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bold() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "  \033[32mok\033[0m   %s\n" "$*"; }
warn() { printf "  \033[33mnote\033[0m %s\n" "$*"; }
die()  { printf "\n\033[31mstopped:\033[0m %s\n\n" "$*" >&2; exit 1; }

# ---------------------------------------------------------------- checks ---

bold "Checking the environment"

[ "$(id -u)" -ne 0 ] || die "Run this as your deploy user, not as root. The script calls sudo where it needs to."
sudo -n true 2>/dev/null || sudo true || die "This user needs sudo."
[ -f "$SRC_DIR/package.json" ] || die "Run this from inside the project folder."
grep -q '"name": "floor-quiz"' "$SRC_DIR/package.json" || die "$SRC_DIR does not look like the Floor Quiz project."
ok "running as $(whoami), source at $SRC_DIR"

. /etc/os-release 2>/dev/null || true
[ "${ID:-}" = "ubuntu" ] || warn "Built for Ubuntu. Detected ${PRETTY_NAME:-unknown}, continuing anyway."
ok "${PRETTY_NAME:-unknown}"

# ---------------------------------------------------------------- system ---

bold "Installing system packages"

sudo apt-get update -qq

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 20 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs
fi
ok "node $(node --version)"

# better-sqlite3 ships prebuilt binaries but falls back to compiling.
sudo apt-get install -y -qq build-essential python3 git nginx curl dnsutils
ok "build tools, nginx, dnsutils"

if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2 >/dev/null 2>&1
fi
ok "pm2 $(pm2 --version 2>/dev/null || echo installed)"

# ------------------------------------------------------------- firewall ----

bold "Firewall"

if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow OpenSSH >/dev/null 2>&1 || true
  sudo ufw allow 'Nginx Full' >/dev/null 2>&1 || true
  if ! sudo ufw status | grep -q "Status: active"; then
    sudo ufw --force enable >/dev/null
  fi
  ok "ssh and http/https open, ufw active"
else
  warn "ufw not present, skipping firewall setup"
fi

# ------------------------------------------------------------ directories --

bold "Directories"

sudo mkdir -p "$APP_DIR" "$DATA_DIR" "$LOG_DIR"
sudo chown -R "$(whoami):$(whoami)" "$APP_DIR" "$DATA_DIR" "$LOG_DIR"
ok "$APP_DIR, $DATA_DIR, $LOG_DIR"

# ---------------------------------------------------------------- deploy ---

bold "Installing the app"

if [ "$SRC_DIR" != "$APP_DIR" ]; then
  # Copy source only. node_modules is rebuilt on the target, and the live
  # database in $DATA_DIR is never touched by a deploy.
  tar -C "$SRC_DIR" \
      --exclude=node_modules --exclude=.git --exclude='*.db*' --exclude=.env \
      -cf - . | tar -C "$APP_DIR" -xf -
  ok "source copied to $APP_DIR"
fi

cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund >/dev/null
ok "dependencies installed"

# ------------------------------------------------------------------ env ----

bold "Configuration"

GENERATED_PASSWORD=""
if [ -f "$APP_DIR/.env" ]; then
  ok ".env already exists, leaving it alone"
else
  GENERATED_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  SECRET="$(openssl rand -hex 32)"
  cat > "$APP_DIR/.env" <<ENVEOF
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
PUBLIC_URL=https://${DOMAIN}
DB_PATH=${DATA_DIR}/floor-quiz.db
HOST_PASSWORD=${GENERATED_PASSWORD}
SESSION_SECRET=${SECRET}
MAX_PLAYERS=400
ENVEOF
  chmod 600 "$APP_DIR/.env"
  ok ".env created with generated secrets"
fi

# ----------------------------------------------------------------- start ---

bold "Starting the service"

if pm2 describe floor-quiz >/dev/null 2>&1; then
  pm2 restart floor-quiz --update-env >/dev/null
  ok "floor-quiz restarted"
else
  pm2 start "$APP_DIR/deploy/ecosystem.config.cjs" >/dev/null
  ok "floor-quiz started"
fi

pm2 save >/dev/null 2>&1
STARTUP_CMD="$(pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>/dev/null | grep '^sudo ' || true)"
if [ -n "$STARTUP_CMD" ]; then
  eval "$STARTUP_CMD" >/dev/null 2>&1 && ok "will restart automatically after a reboot" \
    || warn "run this yourself to survive reboots: $STARTUP_CMD"
else
  ok "boot persistence already configured"
fi

sleep 2
if curl -fsS --max-time 5 http://127.0.0.1:3000/api/health >/dev/null; then
  ok "app responding on 127.0.0.1:3000"
else
  pm2 logs floor-quiz --lines 30 --nostream || true
  die "The app is not responding. The log above should say why."
fi

# ----------------------------------------------------------------- nginx ---

bold "Web server"

sudo cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/floor-quiz.new
if [ -f /etc/nginx/sites-available/floor-quiz ] && grep -q "ssl_certificate" /etc/nginx/sites-available/floor-quiz; then
  # Certbot has already rewritten this file with the TLS block. Overwriting it
  # with the plain-HTTP template would silently take the site off HTTPS.
  sudo rm -f /etc/nginx/sites-available/floor-quiz.new
  ok "existing TLS config left in place"
else
  sudo mv /etc/nginx/sites-available/floor-quiz.new /etc/nginx/sites-available/floor-quiz
  ok "nginx config installed"
fi
sudo ln -sf /etc/nginx/sites-available/floor-quiz /etc/nginx/sites-enabled/floor-quiz
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t >/dev/null 2>&1 || { sudo nginx -t; die "nginx rejected the config."; }
sudo systemctl reload nginx
ok "nginx serving $DOMAIN on port 80"

# ------------------------------------------------------------------- dns ---

bold "DNS"

SERVER_IP="$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || echo "")"
DOMAIN_IP="$(dig +short A "$DOMAIN" @1.1.1.1 2>/dev/null | tail -1 || echo "")"

DNS_READY=0
if [ -z "$SERVER_IP" ]; then
  warn "could not determine this server's public IP, skipping the DNS check"
elif [ -z "$DOMAIN_IP" ]; then
  warn "$DOMAIN does not resolve yet"
elif [ "$SERVER_IP" = "$DOMAIN_IP" ]; then
  DNS_READY=1
  ok "$DOMAIN resolves to $SERVER_IP"
else
  warn "$DOMAIN resolves to $DOMAIN_IP but this server is $SERVER_IP"
fi

# ------------------------------------------------------------------- tls ---

bold "HTTPS"

if [ "$DNS_READY" -eq 1 ]; then
  sudo apt-get install -y -qq certbot python3-certbot-nginx
  if sudo certbot certificates 2>/dev/null | grep -q "$DOMAIN"; then
    ok "certificate already issued"
  else
    # www is included so the redirect server block also has a valid cert.
    if sudo certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
         --non-interactive --agree-tos --redirect --register-unsafely-without-email >/dev/null 2>&1; then
      ok "certificate issued, http redirects to https"
    else
      warn "certbot failed. Run it yourself to see the error:"
      warn "  sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
    fi
  fi
else
  warn "skipping TLS because DNS is not pointing here yet."
  warn "Once 'dig +short $DOMAIN' returns ${SERVER_IP:-your VPS IP}, run:"
  warn "  sudo apt install -y certbot python3-certbot-nginx"
  warn "  sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

# ----------------------------------------------------------------- done ----

bold "Done"

echo "  Host console   https://${DOMAIN}/host"
echo "  Players join   https://${DOMAIN}"
echo ""
if [ -n "$GENERATED_PASSWORD" ]; then
  echo "  Host password  ${GENERATED_PASSWORD}"
  echo ""
  echo "  Save that now. It is shown once here and stored in ${APP_DIR}/.env."
  echo "  To change it: edit HOST_PASSWORD in that file, then 'pm2 restart floor-quiz'."
else
  echo "  Host password  unchanged, see ${APP_DIR}/.env"
fi
echo ""
echo "  Logs           pm2 logs floor-quiz"
echo "  Status         pm2 status"
echo "  Health         curl https://${DOMAIN}/api/health"
echo ""
echo "  Last check: open the host console on a laptop, open a lobby, then join"
echo "  from a phone on MOBILE DATA rather than office wifi. That is what proves"
echo "  WebSockets survive the proxy from outside your network."
echo ""
