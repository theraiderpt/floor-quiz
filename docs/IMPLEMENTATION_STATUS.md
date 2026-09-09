# Implementation status

Tracks what has shipped against the product direction agreed with the owner:
a single-organisation, Foundever-focused proof of concept, live-session-only
(no self-paced mode), SQLite kept as-is, no AI authoring. See
`docs/PRODUCT_AND_TECHNICAL_AUDIT.md` for the full audit this direction was
scoped against.

## Phase: admin / host accounts, categories, quotas, question bank

Status: shipped and deployed.

- Admin and host accounts stored in SQLite (`admins`, `hosts` tables), scrypt
  password hashing, HMAC-signed `fq_auth` cookie carrying `{role, id, exp}`.
- Invite-link onboarding: admin creates a host, gets a one-time link, host
  sets their own password to activate the account.
- Per-host player caps enforced at join time, admin-editable.
- Categories and a pre-written question bank (Contact Center industry,
  Customer Experience, Foundever) that hosts pull from when building a quiz.
- Admin overview: hosts, categories, bank, and all games across hosts.
- `npm run smoke` covers admin/host auth, the invite lifecycle, cross-host
  quiz isolation, and quota enforcement.

## Phase: auto-advance, question pictures, rebrand

Status: shipped and deployed.

- Game flow (question -> reveal -> standings -> next question) now advances
  on its own via server-side timers (`FLOW.revealMs` / `FLOW.scoresMs` in
  `server/config.js`, overridable with `REVEAL_MS` / `SCORES_MS`). A host
  click still short-circuits the wait, it just isn't required.
- Questions can carry a picture (data-URI, resized and compressed client
  side, capped at 350KB server side). Pictures are sent to the host screen
  only, over a dedicated `question:image` socket event, so player phones
  never download image bytes they don't need.
- Tool renamed from "Floor Quiz" to "CX Quiz" throughout the UI.

## Phase: per-quiz join mode + nicknames

Status: shipped, smoke-tested, not yet deployed to production.

Adds a `joinMode` setting per quiz, chosen by the host when building it:

- `name` (default): join with a name only. A dice button on the join screen
  can generate a quirky nickname (adjective + noun, client side, no
  external calls) for players who would rather not use their real name.
- `name_email`: join requires a name and a work email. The email is
  validated, lower-cased, and stored as the player's identity key alongside
  the display name; it is not shown to other players, only to the host (in
  the lobby roster tooltip) and in the exported results.

### Files changed

- `server/db.js`: `quizzes.join_mode` column (default `'name'`), `results.email`
  column. `store.quizzes.create/update` and `store.sessions.close` take the
  new fields.
- `server/game.js`: `sanitiseQuiz` reads `joinMode`; `Game.addPlayer` rejects
  a join with a missing/invalid email when the quiz requires one; player
  records and standings carry `email`.
- `server/index.js`: `/api/quizzes` (POST/PUT) accept `joinMode`; the
  `player:join` socket handler passes `email` through; CSV export gains an
  Email column.
- `public/host.html` / `public/js/host.js`: join-mode selector in the quiz
  setup screen; lobby roster shows a player's email on hover when present.
- `public/index.html` / `public/js/play.js`: optional email field on the
  join screen, and a nickname-generator button next to the name field.

### Database migration

Additive only, via the existing `ensureColumn()` helper. No manual migration
step: the live database at `/var/lib/floor-quiz/floor-quiz.db` picks up the
two new columns on next process start. Existing quizzes default to
`join_mode = 'name'`, i.e. current behaviour is unchanged until a host
opts a quiz into `name_email`.

### Commands run

```bash
node --check server/db.js server/game.js server/index.js   # syntax check, all three
npm run smoke                                                # 63 assertions, all green
```

### Manual verification still to do

Not yet done in a browser:

1. Build a quiz in `/host`, set "Joining this quiz" to the formal option,
   save, open the lobby, and join from `/` on another device: confirm the
   email field is required and a bad email is rejected client side too
   (server already rejects it either way).
2. Same quiz left on the fun/default option: confirm the dice button fills
   in a nickname and the game plays the same as before.
3. Finish a formal-mode game and check the downloaded CSV has the right
   email in the right row.

### Known limitations

- Email is free text validated by a simple regex, there's no verification
  step (no confirmation link). Good enough for a live in-room quiz where
  the host can see who's in the lobby; not suitable if this ever needs to
  gate access to something more sensitive.
- No admin-side reporting yet on emails collected across games. They only
  surface in per-session CSV exports for now.

### Deployment

Not deployed. Per the standing ground rules: check
`curl -s localhost:3000/api/health` for `games: 0` before restarting, and
get explicit go-ahead before running `sudo -u deploy -i pm2 restart floor-quiz`.

## Phase: host results dashboard

Status: shipped, smoke-tested, not yet deployed to production.

Adds a "Dashboard" screen for hosts, separate from the flat "Past games"
list that already existed: an overview of everything a host has run, then
per-quiz aggregates, then drill-down into any one game's full leaderboard.

- Overview tiles: games played, total players, average players per game,
  quizzes in the library, last played date. All scoped to the signed-in
  host, same ownership model as quizzes/sessions.
- Per-quiz cards: games played, total players, average score, accuracy,
  last played. Grouped by `quiz_id`; a session whose quiz was later deleted
  (or never saved) still rolls up under its own bucket, keyed by `null`,
  using the session's own frozen title.
- Per-quiz question breakdown: which questions are actually getting missed,
  computed by lining up each session's frozen `questions_json` against
  every player's per-question `answers_json` log and tallying right/wrong/
  skipped by question text (not index, since a quiz can be edited between
  games). Sorted hardest-first.
- Click through from a quiz to its list of games, and from any game (in the
  dashboard or the existing history list) to a full per-player results
  table: rank, name, correct/answered, score. CSV export reused from the
  existing per-session endpoint.

### Files changed

- `server/db.js`: `stmt.hostOverview`, `stmt.countQuizzesByHost`,
  `stmt.statsByQuiz`, `stmt.sessionsForQuiz`, and a new `store.stats`
  module (`overview`, `byQuiz`, `sessionsForQuiz`, `questionBreakdown`).
  No schema change, everything reads existing columns.
- `server/index.js`: `GET /api/stats/overview`, `GET /api/stats/quizzes`,
  `GET /api/stats/quizzes/:quizId/sessions`,
  `GET /api/stats/quizzes/:quizId/questions`. All behind `requireHost` and
  scoped to `req.hostAccount.id`; `:quizId` accepts the literal `null` for
  the no-quiz bucket.
- `public/host.html` / `public/js/host.js`: "Dashboard" nav entry next to
  "Past games"; three new screens (`s-dashboard`, `s-quiz-sessions`,
  `s-session-detail`); existing history rows now open the same session
  detail view instead of only offering a CSV link.
- `public/css/app.css`: `.stats`/`.stat` tiles, `.qitem.click` hover state,
  `.lrow.detail`/`.lrow.head` for the results table, `.qbars`/`.qbar` for
  the per-question accuracy bars.

### Commands run

```bash
node --check server/db.js server/index.js public/js/host.js test/smoke.js
npm run smoke   # 78 assertions, all green (12 new, covering host scoping,
                 # the null-quiz bucket, and the accuracy math)
```

### Manual verification still to do

Not yet done in a browser:

1. Sign in as a host with at least one finished game, open "Dashboard",
   confirm the overview tiles and per-quiz cards match what's in "Past
   games".
2. Drill into a quiz, confirm the question-accuracy bars look right against
   a game you remember playing, then drill into one of its games and check
   the leaderboard table and CSV download both work.
3. Confirm a host with zero finished games gets empty-state copy rather
   than a broken screen.

### Deployment

Not deployed. Per the standing ground rules: check
`curl -s localhost:3000/api/health` for `games: 0` before restarting, and
get explicit go-ahead before running `sudo -u deploy -i pm2 restart floor-quiz`.

## Deferred, not started

Everything below was scoped out or explicitly deprioritised by the owner in
favour of the join-mode feature above, and should not be picked up without
a fresh ask:

- Multi-tenant organisations/teams beyond the single Foundever org.
- Competency frameworks and cross-session reporting.
- Self-paced (non-live) quiz mode.
- AI-assisted question authoring.
- Migrating off SQLite.
