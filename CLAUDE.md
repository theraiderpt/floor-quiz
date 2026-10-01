# CX Quiz

Live team quiz. Host screen on a projector, players answer on phones over WebSockets.
Production domain: **cxquiz.tech**. Runs on a Hostinger KVM 2 VPS, Ubuntu 24.04.

## Ground rules

- **`.env` edits are allowed** (user authorized this on 2026-09-18, overriding the earlier
  "never touch it" rule). Adding or updating a variable (e.g. `GIPHY_API_KEY`) directly is fine.
  Still avoid printing the full file's contents into chat/logs unprompted: it holds
  `SESSION_SECRET` and `HOST_PASSWORD`/API keys, and a transcript is a wider blast radius than a
  single scoped edit. Changing or removing an *existing* secret (not just adding a new one) can
  break auth/sessions app-wide, so treat that as the kind of high-risk change worth flagging
  before doing it, same as a schema change.
- **Never run `certbot` or overwrite `/etc/nginx/sites-available/floor-quiz`.** Certbot owns
  that file after the first issuance. Copying `deploy/nginx.conf` over it drops the site off
  HTTPS. Check for `ssl_certificate` in the live file before touching it.
- **Check before restarting the service, don't ask by default.** `curl -s localhost:3000/api/health`
  reports `games`. If it is `0`, restart freely as part of a deploy. If it is non-zero, a session
  is live and a restart disconnects a whole room: wait for it to end (poll `/api/health`, or check
  `pm2 logs` for the room closing) rather than interrupting it, and only ask if it's been live for
  an unusually long time and you suspect it's stuck.
- For agreed-upon work (a fix or feature already discussed and approved in chat), you have
  autonomy to implement, run `npm run smoke`, and deploy without stopping to ask first. Still
  explain a diagnosis and wait for agreement before starting on something not yet discussed, and
  still flag anything genuinely high-risk (schema changes, replacing an existing `.env` secret,
  anything touching nginx, anything that can't be cleanly rolled back) before doing it even if
  it's in scope.

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
npm run smoke            # full game + admin/host/invite/quota checks, 145 assertions. Run before every restart.
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
- Any user-facing feature, fix, or enhancement gets an entry in `public/js/changelog.js`'s
  `CHANGELOG` array (newest first, add an item to today's entry if one already exists for the
  date). That feeds the "What's new" panel on the host sign-in screen. Keep entries short,
  host-facing, and free of file names or implementation detail.
- **Every user-facing string is translated.** Seven languages (en, fr, de, es, el, pt, ro) live in
  `public/js/locales.js`; never hard-code English text in a page or script. Static HTML uses
  `data-i18n` / `data-i18n-ph` / `data-i18n-title` / `data-i18n-aria`, JS uses `t("key", vars)`
  (a numeric `n` picks `.one` / `.few` / `.other`). Do not put `data-i18n` on an element JS also
  writes to, or a language switch will reset it. Add the key to all seven languages, not just
  English. Server errors return `{ error, code }`; add `err.<code>` to the dictionary for any new
  code. Quiz content (questions, options) is never translated.
- Never stop a process by `pkill -f <command string>` on this box: dev/test instances and the
  real PM2-managed production process often run the literal same command, just with different env
  vars, so a substring match can hit production. Kill by the specific PID instead.
