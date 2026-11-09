# Handover: CX Quiz

Living note shared by Claude Code on the VPS and Claude Desktop. Read it at the start of a session, update it at the end (protocol at the end of `CLAUDE.md`). It holds state and decisions, not code. No secrets in here. Ground rules, operational facts and conventions are in `CLAUDE.md` and are authoritative.

## 1. State (written 2026-11-09, VPS session; facts checked that day)
- **`master` = `origin/master`, deployed 2026-11-09** (fast-forward of `desktop/review-privacy`: privacy hardening with self-hosted fonts, Giphy copies, retention and admin audit log; fixes; podium sounds; `/demo` on PIN 1234). PM2 `floor-quiz` restarted with 0 games, health ok, site, `/host`, `/demo`, `/fonts/fonts.css`, `/audio/cheer.mp3` all 200. Smoke 262 passed in a worktree before merging. Rollback copy (code and database): `/var/backups/floor-quiz-20261109-162613` (pre-merge code at `b266646`). `audit_log` table added at boot (additive).
- **Retention:** `RETENTION_DAYS` is not set in `.env`, so the default of 365 days applies.
- **Earlier releases:** 2026-11-06 avatars and host music; 2026-11-01 `lastRank`, nodemailer 10.3.1, `allowScripts`; 2026-10-26 "Sunny Sticker"; before that pictures and GIFs, Giphy, "What's new", 7 languages.
- **Tests:** `npm run smoke` (throwaway database, safe against production).
- **Audit:** `npm audit --omit=dev` last run 2026-11-01 (0 vulnerabilities).
- **GitHub:** private `git@github.com:theraiderpt/floor-quiz.git`, branch `master`. Push after every deploy.

## 2. In progress (claims)
Nothing claimed. Before starting anything bigger than a small fix, add a line here on your branch: `date | tool | branch | area`.

## 3. Owner decisions still open
None recorded. Anything that changes game flow, scoring or the visual direction goes through the owner first.

## 4. Next steps
- Not verified after the 2026-11-09 deploy: the uploads folder was created (Giphy copy ran, no `giphy copy failed` seen) but not every quiz was inspected; the retention job logged nothing; `/demo` and the podium sounds were not tried on a real phone, projector or speakers.
- Small items from the 2026-11-06 review, not fixed, not agreed: open builder pushes Join below the fold on a 380x700 phone; `Sound.music` is called unguarded in `host.js` `show()` (use `Sound.music?.()` if a stale cache is ever seen); the "What's new" entry does not mention the lobby music loop.
- Idea only: send one real invite email to confirm SMTP after the nodemailer 10 upgrade.

## 5. Pitfalls and environment
- **npm 12 and `better-sqlite3`:** npm 12 blocks dependency install scripts. `package.json` now has `allowScripts` for `better-sqlite3@11.10.0` (tested: `npm ci --omit=dev` in a scratch dir builds the binary), so `deploy/update.sh` works again, untested on the live box. The approval is pinned to the version: after bumping `better-sqlite3`, run `npm approve-scripts better-sqlite3` again. The safe fallback used on 2026-11-01 was to rsync a tested `node_modules` and check `require("better-sqlite3")` as `deploy`.
- **Merging in this checkout is a deploy for `public/`.** Static files are served from disk, so test a branch in a worktree (symlink `node_modules`) and take the backup before merging here, or the backup already holds the new code.
- **The site is behind Caddy** (`/etc/caddy/Caddyfile`, `cxquiz.tech` to `127.0.0.1:3000`). nginx is inactive and its site file is gone; the owner had the nginx notes removed from `CLAUDE.md` on 2026-11-06. `README.md`, `.env.example` and `deploy/` (`setup.sh`, `update.sh`, `DEPLOY.md`, `nginx.conf`) still mention nginx: do not trust them on this point.
- **Editing here is editing production code.** The working tree is what PM2 runs. Check `curl -s localhost:3000/api/health` (`games` must be 0) before a restart, and read the ground rules in `CLAUDE.md` first.
- Conventions that bite: no inline `style=""` (the CSP drops them), every user-facing string goes through `locales.js`, user-facing changes need a `changelog.js` entry, no em-dashes in any file you write, a change to game flow or scoring needs a `test/smoke.js` assertion.
- Never stop a process with `pkill -f <command string>` on this box: kill by PID.
- Claude Desktop sessions cannot reach the VPS or its `~/.claude` notes: put what matters here.

## 6. Session log (newest first)
### 2026-11-09 (deploy) | Claude Code on the VPS | `master` fast-forwarded to `desktop/review-privacy`, deployed, pushed
Deployed on the owner's instruction. Backup first (code and database), smoke 262 green in a worktree, 0 games, restart, endpoints 200, startup jobs ran without errors in the logs. Branch `origin/desktop/review-privacy` is now merged and can be deleted.
### 2026-11-09 (later) | Claude Code on the web | `desktop/review-privacy`, pushed, not merged or deployed
`/demo`, agreed with the owner: the projector page in demo mode runs `server/demo.js` (6 questions, one of each type) on PIN 1234 (`DEMO_PIN`, never handed to a normal game). `POST /api/demo/start` (10 per 15 minutes per IP) creates it with `persist: false` (no `sessions` row, nothing in results, history or stats), 20 players max, auto-end after 30 minutes, one demo at a time (`409 demo_busy`), and sets a signed `fq_demo` cookie. A socket that connects with `auth: { demo: true }` and that cookie may only send `host:resume/start/next/skip/end/kick` for that one game, and the pass dies when the game ends or a new demo starts. A signed-in host opening `/demo` still drives the demo (the demo flag takes priority over the host cookie). Also added the owner's crowd cheer as `public/audio/cheer.mp3` (Pixabay licence), played as first place lands. Verified: smoke 262 all passed (14 demo checks: busy, reload, pass required, no game creation, nothing saved, stale pass refused); headless run of lobby with 3 phones, busy screen in a second browser, projector reload mid-question, play-through to the podium (CSV export hidden, "Start a new demo" opens a fresh lobby).

### 2026-11-09 | Claude Code on the web | `desktop/review-privacy`, pushed, not merged or deployed
Podium celebration sounds: `Sound.play("podium")` is now a synth sequence timed to the podium CSS (drumroll 0 to 2.6s, hits at 0.7s and 1.7s as third and second land, crash and fanfare at 2.7s for first), then plays `public/audio/cheer.mp3` if it exists (not in the repo yet: the owner is picking a royalty-free crowd cheer; the slot stays silent until then). Verified: rendered offline in headless Chromium (peak 0.45, no clipping, timing checked on a spectrogram); not heard on real speakers. The owner's earlier `/demo` idea (no-login demo game on PIN 1234) was proposed but never agreed or built.

### 2026-11-07 (later) | Claude Code on the web | `desktop/review-privacy`, pushed, not merged or deployed
Fixed the four code review findings, agreed with the owner: (1) `Game.closeIfAllAnswered()` closes a question early only when every connected player has answered, and is also re-checked when a player drops; (2) open-text answers no longer count as skipped in `questionBreakdown` (the question gets no accuracy) or against quiz accuracy in `statsByQuiz` (`json_each` over `answers_json`); (3) a lobby is cancelled once its host screen has been gone for `HOST_GONE_MS` (default 10 minutes; `host:resume` cancels the countdown); (4) `player:join` passes `addPlayer`'s error `code`. Verified: smoke 248 all passed; with the old logic put back, the 5 related checks fail.

### 2026-11-07 | Claude Code on the web | `desktop/review-privacy`, pushed, not merged or deployed
Code review of server and client (findings in section 4) and three items from the security assessment. #5: fonts self-hosted in `public/fonts` (Fontsource 5.3.0, Latin, Latin Extended and Greek subsets, 432 KB), Google removed from the CSP; a picked GIF is downloaded by `POST /api/giphy/save` into the uploads folder (Giphy hosts only, no redirects, type and size checks, counts against the daily upload quota); `migrateGiphyImages()` runs before the daily orphan sweep. The host's own GIF search thumbnails still load from Giphy. #2: `RETENTION_DAYS` (default 365) purge at boot and daily, admin "delete game" (`DELETE /api/admin/games/:id`), privacy line on the join and self-paced start screens (`GET /api/privacy`). #7: `audit_log` table, admin Activity tab (`GET /api/admin/audit`), logging admin sign-in, host create, re-invite, quota, enable, disable and delete, categories, bank questions, game deletes, host quiz deletes and retention purges. Also fixed two stale nginx comments in `server/index.js`. Verified: smoke 241 all passed, a real Giphy download and the migration run in a scratch database (dedupes, a dead link keeps its URL), headless screenshots of the join screen and the admin Overview and Activity tabs, zero third-party requests from the join page.

### 2026-11-06 (end) | Claude Code on the VPS | `master`, docs only, no restart
Removed the nginx and certbot notes from `CLAUDE.md` (the site is on Caddy) and deleted the merged branch `origin/desktop/avatars-music`. The other nginx mentions in the repo were left alone (section 5).

### 2026-11-06 (later) | Claude Code on the VPS | `desktop/avatars-music`, fast-forwarded to `master` (`d371566`), deployed, pushed
Reviewed the diff and deployed on the owner's instruction. No app code changed in this session. Verified: smoke 228 passed on the branch and again on `master`; a scripted headless Chromium game against a throwaway instance (music starts after a tap, mute and unmute, question loop, music off on leaderboard and podium, avatars on all screens, no page, CSP or request errors); after the restart health ok with 0 games, `/`, `/host`, `/js/avatar.js` and both MP3s 200 through `https://cxquiz.tech`, range requests 206. Not done: a real phone, a projector, audible music, or a game on the live server. Rollback: `/var/backups/floor-quiz-20261106-111736`. Branch `origin/desktop/avatars-music` deleted afterwards at the owner's request. Also removed stale pitfalls from this file (the deleted branch and `/root/fq-review`).
### 2026-11-06 | Claude Code on the web | `desktop/avatars-music`, pushed, not merged or deployed
Player avatars: `public/js/avatar.js` renders SVG characters (5 slots, headset is the default headwear), builder on the phone join screen (remembered in localStorage `cxq.avatar`), server `cleanAvatar()` clamps input, avatars in lobby, standings, final board and `gameover.top3`, shown on the host lobby, leaderboard and podium and on the phone podium. Avatars are stripped before results are saved: no schema change. Host background music: `Sound.music()` in `sound.js`, `think.mp3` (Pixabay licence) loops during questions, `lobby.mp3` (Pixabay licence, re-encoded to 128 kbps) loops in the lobby, the existing speaker toggle mutes both. Verified: smoke 228 all passed, headless screenshots of join, lobby and podium in light and dark. Not seen on a real phone or projector, music not heard in a real browser.

### 2026-11-01 (end) | Claude Code on the VPS | `cli/text-movement-allowscripts`, merged to `master` (`acae266`), deployed
Players now see rank and the movement line after text questions; `allowScripts` added so `npm ci` builds `better-sqlite3` on npm 12. No restart needed (client file and package.json only). Verified: smoke green, live `play.js` has the change, health ok, site 200. Rollback copy `/var/backups/floor-quiz-20261101-004626`. Not seen in a real browser.

### 2026-11-01 (later) | Claude Code on the VPS | `cli/hardening-nodemailer`, merged to `master` and deployed
Bumped nodemailer 6 to 10.3.1 (audit clean, smoke green). Re-checked the "missing hardening" claim and found it false: `master` already has every piece (diff in section 4). Gemini was asked to review the nodemailer upgrade but returned nothing usable, so the changelog was read by hand.

### 2026-11-01 | Claude Code on the VPS | `cli/fixes-2026-11-01`, merged to `master` and deployed
Fixed `lastRank` for offline players and the theme on `host:resume` (both red-green in `test/smoke.js`), ran `npm audit fix`, deployed after a backup with 0 games running. Left: `nodemailer`, the stale-branch hardening, text-question movement line, npm 12 install script (section 4). Verified: smoke green before and after the deploy, health, site 200.

### 2026-10-31 (late) | Claude Code on the VPS | no branch, no code change
Reviewed the known follow-ups and the stale security branch (section 4) and ran `npm audit`: 5 findings in production dependencies, one marked critical. Nothing changed.

### 2026-10-31 | Claude Code on the VPS | no branch, no code change
Created this handover and the protocol in `CLAUDE.md`; checked the repo, the health endpoint and the stale branch. Nothing deployed, nothing committed (files left for the owner to commit).

### 2026-10-26 | Claude Code on the VPS | `master`
Sunny Sticker refresh shipped and deployed, pushed.

### Before that
2026-09-18 to 2026-10-01: images and GIFs for players, Giphy, "What's new", 7 languages, review fixes. See `git log`.
