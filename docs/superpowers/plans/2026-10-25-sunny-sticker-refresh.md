# Sunny Sticker Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every CX Quiz screen in the owner-approved "Sunny Sticker" look, add motion, and add four player-facing gameplay displays plus a per-quiz projector theme.

**Architecture:** Mostly CSS and DOM changes in `public/`; the server only gains additive fields (`theme` on quizzes, `prevRank` and `gapToNext` on the per-player `result` event, `top3` on `gameover`). Scoring and flow are untouched.

**Tech Stack:** Node 20+ ESM, Express, socket.io, better-sqlite3, vanilla JS and one CSS file (`public/css/app.css`), no build step. Tests: `npm run smoke`.

**Spec:** `docs/superpowers/specs/2026-10-25-sunny-sticker-refresh-design.md` (read it first; it holds the palette tokens and the "Calls made by the author" section).

**Repo and working rules:** work in `/var/www/floor-quiz`, never `/root/fq-review` (stale copy). Do not restart, deploy, push, or touch nginx or `.env`; the owner says when. Never `pkill -f`; kill dev instances by PID.

## Global Constraints

- Palette: ground `#dff1ff`, ink `#10223f`, tiles coral `#ff6b6b`, blue `#4dabff`, sun `#ffd23f`, mint `#3ddc97`; 3px navy outlines, solid navy bottom edge; dark text on all four tiles.
- Fonts: Fredoka (display) and Nunito (body) via the existing Google Fonts import; keep fallback stacks. CSP already allows these hosts.
- Light is the default theme everywhere; dark is the same sticker style on a navy ground. Storage key stays `fq-theme`.
- Additive server changes only: never rename or remove an existing event field. New client code treats every new field as optional (old cached pages must keep working for the first hour after a deploy).
- No inline `style=""` (use classes); every user-visible string goes through `public/js/locales.js` in all seven languages (en, fr, de, es, el, pt, ro).
- No em-dashes inside sentences in any file written. Comments explain why, not what.
- `prefers-reduced-motion`: no bounce, flood, podium build or confetti motion.
- Scoring and answer keys stay server-side; nothing new is sent while a question is open.
- Game flow or data changes need `test/smoke.js` assertions; `npm run smoke` must pass at the end of every task that touches the server.
- Add a "What's new" entry to `public/js/changelog.js` (today's date, newest first, host-facing, no file names).

## Review Focus

- Podium with fewer than 3 players (1 or 2): phones and projector show only who exists, no "undefined" or empty medals.
- Leader, tied and first-question cases: leader has `gapToNext` null; a player level on points with the one above has `gapToNext` 0; question 1 has `prevRank` null; the UI never shows "up 0 places" or negative numbers.
- Players who did not answer and unscored text questions still get rank movement without errors.
- A player who rejoins mid-game, or a socket with no `lastRank` yet, gets a valid `result` (null movement, not a crash).
- Quiz import or an old JSON export with no `theme`, and an invalid `theme` value, both load as light.
- Very long player names and answer texts do not overflow the sticker tiles, podium or phone result.
- Lobby bounce with 150 players: only the newly joined chip animates, and the host stays responsive.
- An old phone page (no new fields handled) still works against the new server, and a new page works against a payload with the new fields missing.

---

## File Structure

- `server/db.js`: `theme` column, store signatures.
- `server/game.js`: `sanitiseQuiz` theme, movement fields, `top3`.
- `server/index.js`: quiz routes pass `theme`.
- `public/css/app.css`: tokens, components, motion (the single stylesheet; it is the file that changes most).
- `public/js/theme.js`: default light, `window.FQTheme.set`.
- `public/js/play.js`, `public/index.html`: phone screens.
- `public/js/host.js`, `public/host.html`: projector and setup.
- `public/js/locales.js`, `public/js/changelog.js`: copy.
- `test/smoke.js`: assertions.

---

### Task 1: Per-quiz `theme` setting (server and setup UI)

**Files:**
- Modify: `server/db.js` (ensureColumn near line 109; statements near lines 121-138; `parseQuiz` ~line 303; `create`/`update` ~lines 340-360)
- Modify: `server/game.js` (`sanitiseQuiz`, ~line 76-84)
- Modify: `server/index.js` (quiz routes ~lines 485-497)
- Modify: `public/host.html` (setup form, next to `quizDelivery`), `public/js/host.js` (`openSetup`, `persistQuiz`, `libNew`, import ~lines 160-230, 320-330, 1160-1175)
- Test: `test/smoke.js`

**Interfaces:**
- Produces: quiz objects carry `theme: "light" | "dark"`; `sanitiseQuiz(input)` returns `{ ..., theme }`; `store.quizzes.create(title, questions, hostId, categoryId, joinMode, gapSeconds, deliveryMode, theme)` and `store.quizzes.update(id, title, questions, categoryId, hostId, joinMode, gapSeconds, deliveryMode, theme)` (theme is the new last parameter); `S.quiz.theme` on the host client; the JSON export and import carry `theme`.

- [ ] **Step 1: Write failing smoke assertions.** Create a quiz through the API without `theme` and assert `theme === "light"`; create with `theme: "dark"` and assert it round-trips through GET and PUT; send `theme: "purple"` and assert it stores as `"light"`.
- [ ] **Step 2: Run `npm run smoke`.** Expected: the three new checks FAIL, the existing ones pass.
- [ ] **Step 3: Add the column** with `ensureColumn("quizzes", "theme", "TEXT NOT NULL DEFAULT 'light'")` and add `theme` to the select, insert and update statements, `parseQuiz` (`theme: row.theme === "dark" ? "dark" : "light"`), and the new trailing parameter of `create` and `update`.
- [ ] **Step 4: `sanitiseQuiz` returns `theme`** (`"dark"` only when exactly `"dark"`, else `"light"`); the POST and PUT routes pass it through.
- [ ] **Step 5: Host setup UI.** Add a select `#quizTheme` (options Light, Dark) labelled through i18n key `host.projectorTheme`; set it in `openSetup`, handle `change` to `S.quiz.theme`, send it in `persistQuiz`, default `"light"` in `libNew`, read `parsed.theme || "light"` on import and include it in the settings object and the JSON export.
- [ ] **Step 6: Run `npm run smoke`.** Expected: all pass, new checks included.
- [ ] **Step 7: Commit** ("Add per-quiz projector theme setting"). No `Co-Authored-By` or model name unless the owner has said otherwise for this repo; check `git log` for the existing style.

### Task 2: Rank movement and podium data on the server

**Files:**
- Modify: `server/game.js` (`resultFor` ~line 155; result loop ~line 524; `end()` gameover ~line 584; player creation ~line 280)
- Test: `test/smoke.js` (near the existing `result` and `gameover` handling, ~lines 357-460)

**Interfaces:**
- Produces: `result` event gains `prevRank: number | null` and `gapToNext: number | null`; `gameover` gains `top3: Array<{ name: string, score: number }>` (length 0 to 3). Players gain an internal `lastRank` (number | null). `resultFor(question, answer, player, rank, of, movement)` where `movement = { prevRank, gapToNext }` and both are spread into the returned base.

- [ ] **Step 1: Write failing smoke assertions** for a 3-player game: after question 1 every `result` has `prevRank === null`; after question 2 `prevRank` equals that player's rank in question 1; the leader has `gapToNext === null`; every other player's `gapToNext` equals the score of the board entry directly above minus their own score, and is `>= 0`; `gameover.top3` has the 3 highest names and scores in order. Add a one-player game asserting `top3.length === 1`.
- [ ] **Step 2: Run `npm run smoke`.** Expected: new checks FAIL.
- [ ] **Step 3: In the result loop** compute `gapToNext` from the board entry at index `rank - 2` (null for the leader), pass `{ prevRank: p.lastRank ?? null, gapToNext }` to `resultFor`, then set `p.lastRank = rank`. Ranks stay positional exactly as today; "tied" is `gapToNext === 0`.
- [ ] **Step 4: In `end()`** add `top3: board.slice(0, 3).map(p => ({ name: p.name, score: p.score }))` to the per-player `gameover` payload.
- [ ] **Step 5: Run `npm run smoke`.** Expected: all pass.
- [ ] **Step 6: Commit** ("Send rank movement and top three to players").

### Task 3: Theme foundation and design tokens

**Files:**
- Modify: `public/js/theme.js`, `public/css/app.css` (the `:root` and `[data-theme]` blocks at the top, base elements, `.strip`, buttons, inputs, `.chip`, `.lrow`, `.pod`), the `<meta name="theme-color">` in every HTML page.

**Interfaces:**
- Produces: `window.FQTheme.set(theme, { persist })` where `theme` is `"light" | "dark"` and `persist` defaults to false; `apply` keeps updating the `theme-color` meta. CSS tokens `--bg`, `--ink`, `--card`, `--line`, `--t1`..`--t4` (tile colours), `--tfg`, `--shadow-edge`, `--disp`, `--body`; the old `--a1`..`--a4`, `--ink-2`, `--chalk` names may stay as aliases so untouched rules keep working.

- [ ] **Step 1: `theme.js`:** default becomes light (stored `"dark"` returns dark, anything else light); the toggle persists as before; expose `window.FQTheme.set`.
- [ ] **Step 2: Tokens and base styles** in `app.css`: replace the Foundever palette with the Sunny Sticker values for light and the navy-ground variant for dark; swap the font import to Fredoka and Nunito; restyle strip, buttons, inputs, chips, list rows and podium cards as stickers (3px ink outline, solid bottom edge). Keep the mono face only for the PIN and numeric readouts where it helps.
- [ ] **Step 3: Update `theme-color` meta** values (light `#dff1ff`, dark navy) in `index.html`, `host.html`, `admin.html`, `invite.html`, `take.html` and in `theme.js`'s table.
- [ ] **Step 4: Visual check.** Run a throwaway instance (`PORT=3055 DB_PATH=<scratchpad>/dev.db node server/index.js`, host seeded through `server/db.js` plus `hashPassword`, driven with `playwright-core` and the cached headless Chromium). Screenshot sign-in, library, setup and lobby in light and dark; confirm text contrast and no overflow. Kill the instance by PID.
- [ ] **Step 5: Run `npm run smoke`** (static files only, should be unchanged) and commit ("Sunny Sticker tokens, fonts and base components").

### Task 4: Phone screens

**Files:**
- Modify: `public/index.html`, `public/js/play.js` (`result` handler ~line 81, `gameover` handler ~line 123, `streakBadge`, `confetti`), `public/css/app.css` (`.pad`, `.ans`, result and final screens, the fixed language and theme buttons), `public/js/locales.js`.

**Interfaces:**
- Consumes: `result.prevRank`, `result.gapToNext`, `result.streak`, `gameover.top3` (all optional) from Task 2.
- Produces: i18n keys `play.rankUp` ("up {n} places" with plural forms), `play.rankDown`, `play.rankSame`, `play.inTheLead`, `play.pointsBehind` ("{n} points behind the player above"), `play.tied`, `play.podiumYou`.

- [ ] **Step 1: Join screen:** a "CX Quiz" logo block replaces the empty top area; PIN, name and email fields in sticker style; the dice button kept.
- [ ] **Step 2: Answer screen:** sticker tiles with the four colours and shapes; move the language and theme buttons so they never overlap the bottom tiles (for example collapse them into the top bar on small screens); show the player's current streak badge in the top bar when `streak > 1`.
- [ ] **Step 3: Result screen:** full-screen flood (mint when correct, coral when wrong, blue-grey when unanswered), a pop-in tick or cross, points, total, the existing streak badge restyled, and one rank-movement line built from `prevRank`, `rank` and `gapToNext` (ignore the line when `prevRank` is null or a field is missing; leader shows `play.inTheLead`; `gapToNext === 0` shows `play.tied`).
- [ ] **Step 4: Final screen:** render `top3` as a small podium with the player's own row highlighted below if they are not in it; keep the confetti for a top-3 finish; render nothing extra when `top3` is missing.
- [ ] **Step 5: Add English strings and all six translations**; keep Greek and Romanian best effort.
- [ ] **Step 6: Visual check** with four simulated players over two questions (one wrong, one unanswered) in light and dark at 390px wide; also run once with `emulateMedia({ reducedMotion: "reduce" })` and confirm nothing animates.
- [ ] **Step 7: Run `npm run smoke` and commit** ("Phone screens: sticker look, rank movement, streak, podium").

### Task 5: Host and projector screens

**Files:**
- Modify: `public/host.html`, `public/js/host.js` (lobby roster ~lines 620-710, question and reveal screens, `scores` and `final` handlers ~lines 840-880), `public/css/app.css`, `public/js/locales.js`.

**Interfaces:**
- Consumes: `S.quiz.theme` (Task 1) and `window.FQTheme.set` (Task 3).

- [ ] **Step 1: Apply the quiz theme** when a game's lobby opens: call `FQTheme.set(S.quiz.theme)` without persisting; the on-screen toggle persists as before. Leave library, setup and sign-in on the stored or default theme.
- [ ] **Step 2: Lobby:** large PIN card and QR in sticker style; only a newly joined player's chip gets the bounce class, never the whole roster.
- [ ] **Step 3: Question and reveal screens** use the full height: bigger question text, a timer ring or bar, tiles that fill the remaining space, the answer-count bars and "fastest correct" callout restyled.
- [ ] **Step 4: Standings:** sticker rows with rank, name, points. **Final:** podium reveal sequence third, then second, then first with delays (CSS animation delays on classes, no inline styles), the winner headline last, confetti after the first place lands; with reduced motion show the finished podium immediately; handle 1 or 2 players.
- [ ] **Step 5: Visual check** at 1600x900 and 1280x720 for lobby (150 simulated names), question, reveal, standings and the final podium in light and dark; run `node test/load.js 150` against the throwaway instance and note that the lobby stays responsive.
- [ ] **Step 6: Run `npm run smoke` and commit** ("Host screens: sticker look, lobby bounce, podium reveal").

### Task 6: Remaining pages, copy, changelog and final verification

**Files:**
- Modify: `public/admin.html`, `public/invite.html`, `public/take.html`, `public/js/take.js` if needed, `public/css/app.css`, `public/js/changelog.js`, `public/js/locales.js`, `CLAUDE.md` only if a convention changed.

- [ ] **Step 1: Check admin, invite and self-paced pages** in light and dark; fix any rule that still depends on the old palette (tables, selects, banners, the history and dashboard screens). No new motion on these pages.
- [ ] **Step 2: Changelog entry:** one short host-facing item covering the new look, the rank and streak displays, the podium, and the projector theme choice.
- [ ] **Step 3: Checks:** grep the changed files for em-dashes in prose and for inline `style=` additions; confirm every new i18n key exists in all seven languages; run `npm run smoke` and `node test/load.js 150`; run an axe-style contrast spot check on tiles and the dark theme.
- [ ] **Step 4: Compat check:** with the new server, load a page version from before this change (git stash or the production copy) and play one question; confirm nothing breaks.
- [ ] **Step 5: Commit** ("Finish Sunny Sticker refresh"). Stop here: do not restart, deploy or push. Report to the owner, who decides when to deploy (check `curl -s localhost:3000/api/health` shows `games: 0` first).
