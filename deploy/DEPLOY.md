# Deploying Floor Quiz on a Hostinger VPS

Written to be followed top to bottom. Every command runs on the VPS over SSH unless it says otherwise. Budget an hour the first time.

## 0. What to buy

Buy **VPS hosting**, not Premium or Business web hosting. Hostinger's shared plans run PHP behind Apache or LiteSpeed and cannot keep a Node process alive or hold WebSocket connections open, which is the whole basis of this app.

| | |
|---|---|
| Plan | KVM 1 is genuinely enough. This app used about 140 MB of RAM with 400 players connected, and a KVM 1 has 4 GB. Take KVM 2 only if you want room for other projects on the same box. |
| OS template | Ubuntu 24.04 LTS, plain. Do not pick a template with a control panel preinstalled, it will fight you for ports 80 and 443. |
| Domain | Buy it in the same Hostinger account so DNS is one screen instead of two. |
| Backups | Weekly backups are included. Daily is a paid add-on, around 6 USD a month. For a quiz tool, weekly is fine. |

A subdomain like `cxquiz.tech` is tidier than a bare domain and leaves the apex free.

## 1. Point the domain at the server

In hPanel, open the VPS and copy its IPv4 address. Then under the domain's DNS zone, add:

```
Type  Name   Points to        TTL
A     quiz   <your.vps.ip>    300
```

Check it took, from your laptop:

```bash
dig +short cxquiz.tech
```

Wait until that prints your VPS IP before going near certbot. TLS issuance fails if DNS has not propagated, and Let's Encrypt rate-limits repeated failures.

## 2. First login and basic hardening

```bash
ssh root@<your.vps.ip>

adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable

apt update && apt upgrade -y
```

Log back in as `deploy` from here on. Consider disabling root SSH login in `/etc/ssh/sshd_config` (`PermitRootLogin no`) once you have confirmed the `deploy` login works.

## 3. Install the runtime

```bash
# Node 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# build toolchain: better-sqlite3 falls back to compiling from source
# if no prebuilt binary matches your architecture
sudo apt install -y build-essential python3 git nginx

node --version    # expect v24.x
```

## 4. Put the app on the server

```bash
sudo mkdir -p /var/www/floor-quiz /var/lib/floor-quiz /var/log/floor-quiz
sudo chown -R deploy:deploy /var/www/floor-quiz /var/lib/floor-quiz /var/log/floor-quiz
```

Upload the project, either by pushing it to a private Git repo and cloning, or straight from your laptop:

```bash
# from your laptop, in the folder containing floor-quiz/
rsync -avz --exclude node_modules --exclude .env \
  floor-quiz/ deploy@<your.vps.ip>:/var/www/floor-quiz/
```

Then back on the VPS:

```bash
cd /var/www/floor-quiz
npm ci --omit=dev
```

## 5. Configure

```bash
cp .env.example .env
openssl rand -base64 24     # paste as HOST_PASSWORD
openssl rand -hex 32        # paste as SESSION_SECRET
nano .env
```

Set at minimum:

```
NODE_ENV=production
PUBLIC_URL=https://cxquiz.tech
DB_PATH=/var/lib/floor-quiz/floor-quiz.db
HOST_PASSWORD=<the generated one>
SESSION_SECRET=<the generated one>
```

```bash
chmod 600 .env
```

The server refuses to start in production with placeholder secrets, so a copy-paste mistake fails loudly at boot instead of quietly leaving the host console open to the internet.

Confirm it runs before adding anything in front of it:

```bash
node server/index.js
# expect: Floor Quiz listening on http://127.0.0.1:3000 (production)
# Ctrl-C to stop
```

## 6. Keep it running

```bash
sudo npm install -g pm2
cd /var/www/floor-quiz
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup          # run the sudo command it prints back to you
pm2 status
```

## 7. Nginx and TLS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/floor-quiz
sudo nano /etc/nginx/sites-available/floor-quiz     # replace cxquiz.tech
sudo ln -s /etc/nginx/sites-available/floor-quiz /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Visit `http://cxquiz.tech`. The join screen should load. Then:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d cxquiz.tech
```

Choose the redirect option when asked. Certbot installs its own renewal timer; check it with `systemctl list-timers | grep certbot`.

## 8. Verify the real thing

```bash
curl -s https://cxquiz.tech/api/health
```

Then, and this is the step people skip: open the host console at `/host` on a laptop, open a lobby, and join from a phone **on mobile data, not office wifi**. That proves WebSockets are surviving the proxy from outside your network. If the phone shows "Connection lost" on a loop, the `Upgrade` and `Connection` headers in the nginx config are the first place to look.

## 9. Running a session

1. `/host` on the room laptop, sign in, pick a quiz, **Open lobby**.
2. Project the screen. Players scan the QR or type the PIN.
3. **Start quiz** when the room settles.
4. **Close early** skips the rest of a timer once everyone has answered.
5. Results save automatically. Download the CSV from the final screen or from **Past games**.

## Operating notes

**Updating.** `git pull` (or rsync again), then `npm ci --omit=dev && pm2 restart floor-quiz`. The database lives in `/var/lib/floor-quiz`, outside the app folder, so redeploys never touch your quiz library or past results.

**Backups.** The whole history is one file. A nightly copy is enough:

```bash
sudo crontab -e
0 3 * * * sqlite3 /var/lib/floor-quiz/floor-quiz.db ".backup '/var/backups/floor-quiz-$(date +\%F).db'"
```

**Restarting mid-game.** Live game state is in memory, so a restart ends any game in progress and players see a reconnect banner. Restart between sessions, not during one.

**One process only.** The PM2 config runs a single instance deliberately. Clustering would split games across workers and half the room would hit a process that has never heard of their PIN. If you ever need more than one process, the socket.io Redis adapter plus moving game state out of memory is the path.

**Data protection.** Everything stays on your VPS: names, scores, history. Names are free text, so tell people to use a first name and team rather than anything sensitive, and set a retention rule you are comfortable with. Deleting old rows is one SQL statement against `sessions`, and the `results` rows cascade with it.
