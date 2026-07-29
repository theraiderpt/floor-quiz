# Product & Technical Audit — CX Quiz (cxquiz.tech)

Written before any architectural work, per the standing instruction to audit first.
This describes what actually exists today, not what the CX-readiness-platform brief
envisions. The gap between the two is large and is called out explicitly at the end.

## 1. Stack, versions, entry points, structure

- **Runtime**: Node.js 24.18.0 (`engines` declares `>=20`), ES modules (`"type": "module"`).
- **Package manager**: npm (11.16.0), plain `package.json` + `package-lock.json`. No monorepo tooling.
- **Server**: Express 4.21 + Socket.IO 4.8 on one HTTP server (`server/index.js`). No separate API/web split.
- **Database**: SQLite via `better-sqlite3` (synchronous, single file at `/var/lib/floor-quiz/floor-quiz.db`, WAL mode). No ORM.
- **Frontend**: plain HTML/CSS/JS, no framework, no bundler, no build step, no TypeScript. Four static pages (`public/*.html`) each with one matching script (`public/js/*.js`).
- **Process manager**: PM2, single fork instance (`instances: 1`, deliberate — game state is in-memory).
- **Reverse proxy / TLS**: Nginx + Certbot (Let's Encrypt), on a single Hostinger KVM 2 VPS, Ubuntu 24.04.
- **Entry points**: `server/index.js` (`npm start` / PM2), `npm run dev` (`node --watch`), `npm run smoke`, `node test/load.js [n]`.

```
server/
  config.js               env loading, scoring + flow-timing constants, boot guard
  auth.js                 password hashing (scrypt) and invite tokens
  db.js                   SQLite schema (CREATE TABLE IF NOT EXISTS) + prepared statements
  question-bank-seed.js   starter question bank content, seeded once
  game.js                 in-memory game/session state machine
  index.js                all HTTP routes, auth, and Socket.IO handlers (one file)
public/
  index.html / js/play.js     participant app
  host.html / js/host.js      host console (build quizzes, run live games)
  admin.html / js/admin.js    admin panel (hosts, categories, question bank, overview)
  invite.html / js/invite.js  invite-completion page
  css/app.css                 one shared stylesheet, one dark theme
scripts/create-admin.mjs   CLI to bootstrap/reset the admin account (run over SSH)
deploy/                    setup.sh, update.sh, ecosystem.config.cjs, nginx.conf (reference copy), DEPLOY.md
test/                      smoke.js (58 assertions, boots the real server against a throwaway DB),
                           load.js (concurrent-player load check)
docs/                      (this audit; nothing else exists yet)
```

No CI config, no test framework (no Jest/Vitest/Mocha) — `smoke.js`/`load.js` are hand-written
Node scripts that assert via console output and a process exit code, not a runner with
reporting. No linter config. No git history prior to this session (`f5d343c before Claude
Code session` is the only prior commit; all work since has been uncommitted).

## 2. Routes, entities, auth model

### Roles (today)

Two roles, no organisations, no teams. One deployment = one company:

- **admin** — one or more rows in `admins`, manages hosts, categories, the question bank, and
  sees a cross-host overview. Bootstrapped only via `scripts/create-admin.mjs` (SSH-only, no UI signup).
- **host** — a row in `hosts`, created by an admin, activated via a one-time invite link
  (48h token, admin generates and sends it manually — no email-sending integration exists).
  A host builds and runs their own quizzes; ownership is enforced server-side (`host_id` on
  every quiz/session, checked on every read/write, not just hidden in the UI).

There is no third role. Nothing maps to "manager who can draft but not publish" — every
authenticated host has full CRUD over their own quizzes today.

### Auth mechanics

- Custom HMAC-SHA256-signed cookie (`fq_auth`), home-rolled (not JWT, not a session-store
  library): payload `{ role, id, exp }`, `HttpOnly`, `SameSite=Lax`, `Secure` when the request
  is actually HTTPS. 12-hour expiry. Verified with `crypto.timingSafeEqual`.
- Passwords hashed with `crypto.scryptSync` (salt + hash stored as `salt:hash` hex), no bcrypt
  dependency needed.
- No self-serve "forgot password" — only an admin can reset a host's password (by minting a
  new invite link, which resets `password_hash`).
- No email verification step beyond "you have the invite link."
- Rate limiting exists on `/api/login`, `/api/admin/login`, and the invite endpoints (12–20
  requests / 15 min). **No rate limiting on any other endpoint** (quiz/category/bank CRUD).

### Data model (SQLite, `server/db.js`)

```
quizzes(id, title, questions JSON, host_id, category_id, created_at, updated_at)
sessions(id, pin, quiz_id, title, host_id, player_count, started_at, ended_at)
results(id, session_id, rank, name, score, correct_count, answered)
admins(id, email, password_hash, created_at)
hosts(id, email, password_hash, max_players, status[invited|active|disabled], created_at)
invites(id, host_id, token, expires_at, used_at)
categories(id, name, created_at)
bank_questions(id, category_id, q, t, opts JSON, correct, created_at)
```

Integer autoincrement primary keys throughout, not UUIDs. No `deleted_at` / soft-delete
anywhere (deletes are hard deletes; `ON DELETE SET NULL`/`CASCADE` foreign keys preserve
history where it matters — deleting a host orphans their quizzes/sessions rather than
destroying them). No `updated_by`/`created_by` audit columns. No migrations framework — schema
evolves via idempotent `CREATE TABLE IF NOT EXISTS` plus a hand-rolled `ensureColumn()` helper
that checks `PRAGMA table_info` before `ALTER TABLE ADD COLUMN`. This has no rollback story.

A `questions` row is `{ q, t (seconds), opts[2-4], correct (index), img? (base64 data URI,
≤350KB) }` — flat multiple-choice or true/false. No scenario metadata (channel, sentiment,
policy reference, rationale, competency tag, difficulty) exists on a question anywhere.

### API surface

All JSON over Express, one file (`server/index.js`, ~360 lines):

- `POST /api/login`, `/api/logout`, `GET /api/me` — host auth
- `POST /api/admin/login`, `/api/admin/logout`, `GET /api/admin/me` — admin auth
- `GET/POST/PATCH/DELETE /api/admin/hosts[/:id]`, `POST /api/admin/hosts/:id/reinvite`
- `GET/POST/DELETE /api/admin/categories[/:id]`
- `GET/POST/DELETE /api/admin/bank[/:id]`
- `GET /api/admin/games`, `GET /api/admin/overview`
- `GET /api/invite/:token`, `POST /api/invite/:token/complete` (public)
- `GET /api/categories`, `GET /api/bank` (host-facing reads)
- `GET/POST/PUT/DELETE /api/quizzes[/:id]`, host-scoped
- `GET /api/sessions[/:id]`, `GET /api/sessions/:id/csv`, host-scoped
- `GET /api/health` (public, used by deploy scripts and PM2 checks)

Realtime (Socket.IO): `host:create/start/next/skip/end/kick`, `player:join/answer`, plus
server→client `state/reveal/scores/final/answered/question:image/lobby/result/gameover/kicked`.
Game state (`server/game.js`) lives entirely **in memory**, one `Game` per 4-digit PIN, inside
one process — this is the deliberate `instances: 1` constraint. A restart ends every live
game; only final standings get written to SQLite, once, on completion.

### User flows that exist today

1. Admin logs in → creates a host (email + player quota) → gets an invite link → sends it manually.
2. Host opens the link → sets a password → logs in at `/host`.
3. Host builds a quiz (title, category, questions with optional picture) from scratch, a CSV/JSON
   import, or by pulling pre-written questions from the admin-managed bank.
4. Host opens a lobby (4-digit PIN + QR code) → players join at `/` by PIN + name.
5. Host starts the quiz → questions auto-advance through reveal → standings → next (manual
   "skip ahead" buttons still work) → final board → CSV export of that one session's results.
6. Admin sees an overview (host/category/bank/live counts) and a flat list of all completed
   games across all hosts.

**Nothing else exists.** No self-paced/assignment delivery, no deadlines, no retakes, no
cross-session reporting/aggregation, no competency scoring, no teams, no AI, no marketing site
(`/` is the participant join screen, not a homepage).

## 3. UX/security/performance notes

**Strengths**
- The live flow (join → answer → reveal → standings → final) works end-to-end, is now
  auto-advancing, and has held up in local load tests (150–400 simulated concurrent players in
  `test/load.js`, though those figures predate today's changes and should be re-measured).
- Server-authoritative scoring — the correct answer is never sent to a client until the
  question closes; a player with dev tools open gains nothing.
- Ownership checks are real, not cosmetic: quiz/session endpoints are scoped by `host_id`
  server-side and covered by a smoke-test assertion that one host cannot read/edit another's data.
- SQL injection surface is effectively nil — every query is a parameterised prepared statement;
  the only string-interpolated SQL (`ensureColumn`) uses hardcoded internal literals, never
  request data.
- Mass assignment is avoided — every write path (`sanitiseQuiz`, admin CRUD handlers)
  whitelists and clamps fields rather than spreading the request body into a DB write.
- CSP is real (not just present): `script-src 'self'`, no inline scripts anywhere, matching the
  no-build-step/no-framework approach.

**Gaps and risks, roughly by severity**
- **No audit log of any kind.** Host creation/deletion, category/bank changes, logins — none of
  it is recorded anywhere beyond ephemeral PM2 process logs. The brief asks for audit logs on
  auth/invitations/role changes/publishing/exports; today there is no `audit_logs` table at all.
- **No migrations framework or rollback story.** Fine for the additive changes made so far;
  a real blocker for any non-additive schema change (renaming/splitting tables for a
  multi-tenant model, for instance).
- **No rate limiting outside auth/invite endpoints.** An authenticated host or admin session
  could hammer quiz/bank/category CRUD with no throttle.
- **No self-serve password reset.** Only an admin can unlock a locked-out host.
- **Home-rolled session token**, not a reviewed library. Implemented correctly as far as I can
  tell (HMAC + timing-safe compare + expiry), but it's bespoke, which is itself a maintenance
  and review cost.
- **Image question data is unvalidated beyond a string prefix + size cap.** `data:image/` +
  ≤350KB is the entire check; nothing verifies it decodes as a real image. Low risk today
  (never executed, only ever rendered in an `<img src>`), but worth tightening before opening
  this to less-trusted authors.
- **No GDPR tooling whatsoever** — no data export, no deletion/anonymisation workflow, no
  retention settings. Player names and scores persist indefinitely in `results`.
- **No dedicated test framework** — `smoke.js` covers a real and growing set of behaviors (58
  assertions: auth, invite lifecycle, cross-host isolation, quota enforcement, category/bank
  CRUD, full game flow, sanitiser edge cases) but it's a bespoke script, not `jest`/`vitest`
  with per-case isolation, mocking, or CI integration.
- **No dark/light toggle** — one fixed dark theme, by design so far.
- **No accessibility audit performed.** Focus-visible states and form labels exist; there are
  no ARIA live regions for real-time reveal/score updates, no skip links, no formal contrast check.
- **Single process, in-memory game state, is a hard architectural ceiling**, not an oversight —
  documented and intentional (`CLAUDE.md`: "Single process on purpose... do not 'fix' it").
  Any move toward horizontal scaling or multi-instance deployment requires revisiting this
  deliberately, not incidentally.

I did not find console errors, dead code paths, or broken flows in the current feature set —
the app is small enough, and was built incrementally with a smoke test run before every change,
that there isn't accumulated cruft yet. The main "debt" is *absence* of things a larger platform
needs (audit trail, migrations, tests-as-a-framework, RBAC granularity), not broken things
that need fixing.

## 4. Prioritised backlog

**P0 — worth doing regardless of product direction**
- Add an `audit_logs` table + writes on auth events, host/category/bank CRUD, exports.
- Introduce a real migrations mechanism (even a lightweight versioned-file approach) with a
  documented rollback step, before any further schema changes.
- Self-serve password reset for hosts.
- Rate limiting on the remaining write endpoints (quiz/category/bank CRUD).
- Re-run and publish current load-test numbers (the README's 150/400-player figures predate
  today's auto-advance and image features).

**P1 — genuine new architecture; each is a real design decision, not a bug fix**
- Multi-tenant **organisations** model. Does not exist today. Introducing it means an `org_id`
  on every table, a rewrite of every auth check, and a decision about what "admin"/"host" mean
  once there can be many companies instead of one.
- **Self-paced / assignment / campaign** delivery mode. Everything today is a live, host-driven
  session; there is no async assignment, deadline, or retake concept anywhere.
- **Competency framework + scenario-rich question types** (channel, customer sentiment, policy
  reference, rationale, difficulty, competency tags). Today's question is flat MCQ/True-False
  plus an optional picture.
- **AI authoring.** Zero existing integration, no provider account, no secret configured.
- **GDPR export/delete workflow** and retention settings.
- **Cross-session reporting/analytics** (competency rollups, team trends, readiness heatmaps).
  Today's only report is a per-session CSV.
- **Marketing/homepage.** There is no marketing site; `/` is the participant join screen.

**P2 — polish, once P1 direction is decided**
- Design-system tokens, dark-mode toggle, gamification opt-in settings (badges, team
  challenges, anonymised leaderboards), broader accessibility pass, chart+table parity for reports.

## 5. Exact commands

**Local**
```bash
npm install
cp .env.example .env                              # fill in, no real secrets committed
npm run dev                                        # http://localhost:3000
node scripts/create-admin.mjs you@example.com      # bootstrap an admin login
npm run smoke                                      # 58 assertions, throwaway DB, safe anytime
node test/load.js 150                              # concurrent-player load check
```

**On the VPS (already deployed)**
```bash
sudo -u deploy -i pm2 status
sudo -u deploy -i pm2 logs floor-quiz --lines 50 --nostream
curl -s localhost:3000/api/health                  # check "games" before any restart
sudo -u deploy -i pm2 restart floor-quiz           # only after confirming no live game
bash deploy/update.sh                              # pulls a new build, backs up, restarts
```

## 6. Deployment architecture — recommendation

For the product as it exists today (single company, live-hosted quiz sessions, moderate
concurrency), the current architecture is appropriate and shouldn't be changed reflexively:
one Node process behind Nginx/PM2, SQLite for persistence, in-memory game state. It's simple,
it's already load-tested into the hundreds of concurrent players, and CLAUDE.md is explicit
that this is deliberate, not a gap.

**If** the direction is a genuine multi-tenant SaaS serving many companies, several of today's
choices become real constraints rather than style preferences, and would need a deliberate
decision (not a silent migration):
- SQLite works for one deployment; a multi-tenant relational model with concurrent writes
  from many organisations is much more comfortable on Postgres.
- In-memory, single-process game state means live sessions can't be load-balanced across
  multiple app instances without introducing shared state (Redis, or a Socket.IO adapter) —
  a bigger change than "add organisations to the schema."
- A home-rolled auth cookie is fine at this scale; a multi-tenant SaaS with many admins per
  org would benefit from a reviewed session/auth library.

I'm not recommending any of this be done now — it's listed so the tradeoff is visible before
committing to the "B2B SaaS" framing in the brief.

## 7. Assumptions that need your confirmation before any P1 work starts

1. **Is this becoming a true multi-tenant SaaS** (many companies, self-serve signup), or does
   "organisation" just mean *this one company* — i.e., is today's admin/host model already the
   right shape, just needing new capabilities (teams, competencies, reporting) layered on top
   without a tenant-isolation rewrite?
2. **Is GDPR compliance a real, current legal requirement** (EU employees/customers whose data
   is regulated right now), or a forward-looking goal? This changes how urgently P1's export/
   delete workflow needs to land.
3. **Is self-paced/assignment delivery actually needed**, or is live-hosted play (the entire
   product today) the intended mode and "campaigns" just means "a saved quiz assigned to a team
   for a live session"?
4. **Is a new AI provider account/budget approved?** No AI integration exists; adding one is a
   new external dependency, cost, and data-handling surface, not a config flag away.
5. **Is a database engine change (SQLite → Postgres) on the table?** It's the single biggest
   lever for the multi-tenant/reporting ambitions, but is explicitly against this project's
   current "keep it simple" ground rules unless you decide otherwise.
6. **Should the existing production data survive?** There are already real host accounts, quizzes,
   and completed-game history in the live database. Any schema direction needs a migration
   path for that data, not a fresh start.

I've stopped here, as instructed, rather than starting on P1 architecture. Tell me which of the
above you want to lock in and I'll turn this into a phased implementation plan for the first
vertical slice.
