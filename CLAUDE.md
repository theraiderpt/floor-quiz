# Floor Quiz

Live team quiz. Host screen on a projector, players answer on phones over WebSockets.
Production domain: **cxquiz.tech**. Runs on a Hostinger KVM 2 VPS, Ubuntu 24.04.

## Ground rules

- **Never read, print, or edit `.env`.** It holds `HOST_PASSWORD` and `SESSION_SECRET`.
  If a change needs a new variable, tell me the line to add and I will add it myself.
- **Never run `certbot` or overwrite `/etc/nginx/sites-available/floor-quiz`.** Certbot owns
  that file after the first issuance. Copying `deploy/nginx.conf` over it drops the site off
  HTTPS. Check for `ssl_certificate` in the live file before touching it.
- **Ask before restarting the service.** `curl -s localhost:3000/api/health` reports
  `games`. If it is non-zero, a session is live and a restart disconnects a whole room.
- Explain a diagnosis and wait for me to agree before changing files.

## Operational facts that are easy to get wrong

- **PM2 runs as the `deploy` user, not root.** `pm2 status` as root shows an empty table and a
  separate daemon. Always `sudo -u deploy -i pm2 ...`, and never run `pm2 startup` as root.
- **Single process on purpose.** Game state is in memory. Clustering would split a room across
  workers and half the players would hit a process that has never heard of their PIN.
  `instances: 1` in `deploy/ecosystem.config.cjs` is deliberate, do not "fix" it.
- **A restart ends any game in progress.** Only final standings are persisted, on game end.
- **The database is outside the app directory**, at `/var/lib/floor-quiz/floor-quiz.db`, so
  deploys never touch the quiz library or past results. Keep it that way.
- Helmet sends HSTS with a one year max-age. Once a browser has loaded the site over HTTPS it
  will refuse plain HTTP to that domain. **Diagnose with `curl`, not a browser.**

## Known pitfalls in this codebase

- **Optional-call short-circuiting.** `ack?.(doSomething())` never evaluates `doSomething()`
  when `ack` is undefined, which silently drops the action. This bug shipped once in the socket
  handlers and cost real debugging time. Always compute first, then `ack?.(result)`.
  `test/smoke.js` deliberately emits without callbacks to guard this.
- **Scoring belongs on the server only.** The correct answer is never sent to a player device
  until the question closes. Do not move scoring or answer keys client side.
- Socket event handlers must tolerate a missing payload and a missing ack.

## Commands

```bash
npm run smoke            # full game, 3 players, 36 assertions. Run before every restart.
node test/load.js 150    # concurrent player load test
sudo -u deploy -i pm2 logs floor-quiz --lines 50 --nostream
sudo -u deploy -i pm2 restart floor-quiz
sudo tail -30 /var/log/nginx/floor-quiz.error.log
```

`npm run smoke` uses a throwaway database and is safe to run against production at any time.

## Conventions

- Plain vanilla JS on the client, no framework, no build step. Keep it that way.
- No em-dashes inside sentences in any file you write, including docs and comments.
  Use commas, colons, or periods.
- Comments explain *why*, not *what*. Do not narrate the obvious.
- Any change to game flow or scoring needs a matching assertion in `test/smoke.js`.

## Current task

See `HANDOFF.md` in this directory for where the deployment got to and what to check next.
Delete that file once the deployment is working.
