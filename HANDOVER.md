# Handover: CX Quiz

Living note shared by Claude Code on the VPS and Claude Desktop. Read it at the start of a session, update it at the end (protocol at the end of `CLAUDE.md`). It holds state and decisions, not code. No secrets in here. Ground rules, operational facts and conventions are in `CLAUDE.md` and are authoritative.

## 1. State (written 2026-11-06, VPS session; facts checked that day)
- **`master` = `origin/master`, app code at `d371566`, deployed 2026-11-06** (PM2 `floor-quiz` restarted with 0 games running, health ok, site 200, `npm run smoke` 228 passed on the production tree). Production runs from this directory (`/var/www/floor-quiz`, PM2 as `deploy`). Rollback copy: `/var/backups/floor-quiz-20261106-111736` (pre-merge code at `50fee0e`).
- **Shipped 2026-11-06:** player avatars (builder on the phone join screen, shown in lobby, leaderboard and podium) and host background music (lobby and question loops, Pixabay licence, muted by the speaker toggle). No schema change.
- **Earlier releases:** 2026-11-01 `lastRank` for all players, theme on `host:resume`, text-question movement line, nodemailer 10.3.1, `allowScripts` for `better-sqlite3`. 2026-10-26 "Sunny Sticker" refresh; before that pictures and GIFs, Giphy, "What's new", 7 languages.
- **Tests:** `npm run smoke` (throwaway database, safe against production).
- **Audit:** `npm audit --omit=dev` was at 0 vulnerabilities on 2026-11-01; not re-run on 2026-11-06 (no dependency changed).
- **GitHub:** private `git@github.com:theraiderpt/floor-quiz.git`, branch `master`. Push after every deploy.

## 2. In progress (claims)
Nothing claimed. Before starting anything bigger than a small fix, add a line here on your branch: `date | tool | branch | area`.

## 3. Owner decisions still open
None recorded. Anything that changes game flow, scoring or the visual direction goes through the owner first.

## 4. Next steps
Nothing queued for CX Quiz. Worth doing the next time someone runs a real game: hear the music through the room speakers and try the builder on a real phone (only headless Chromium has run them so far).
Small items seen in the 2026-11-06 review, not fixed, not agreed:
- On a 380x700 phone the open builder pushes Join below the fold (bottom at y=800). The page scrolls and the tap works. Starting the card closed for returning players would fix it.
- `host.js` guards `Avatar` against a stale cache but calls `Sound.music` unguarded in `show()`, and `play.js` needs `Avatar` at load. Static files cache for 1h, so a browser mixing old and new files could throw in the first hour after this deploy. Unlikely, since a page normally loads its files together. `Sound.music?.()` is the fix if it is ever seen.
- The "What's new" entry mentions music during questions but not the lobby loop.
Ideas only, not agreed: send one real invite email to confirm SMTP after the nodemailer 10 upgrade (only the smoke SMTP sink tested it).

## 5. Pitfalls and environment
- **npm 12 and `better-sqlite3`:** npm 12 blocks dependency install scripts. `package.json` now has `allowScripts` for `better-sqlite3@11.10.0` (tested: `npm ci --omit=dev` in a scratch dir builds the binary), so `deploy/update.sh` works again, untested on the live box. The approval is pinned to the version: after bumping `better-sqlite3`, run `npm approve-scripts better-sqlite3` again. The safe fallback used on 2026-11-01 was to rsync a tested `node_modules` and check `require("better-sqlite3")` as `deploy`.
- **Merging in this checkout is a deploy for `public/`.** Static files are served from disk, so test a branch in a worktree (symlink `node_modules`) and take the backup before merging here, or the backup already holds the new code.
- **The site is behind Caddy** (`/etc/caddy/Caddyfile`, `cxquiz.tech` to `127.0.0.1:3000`). `/etc/nginx/sites-available/floor-quiz` does not exist any more, so the nginx notes in `CLAUDE.md` look out of date. Owner to confirm before they are changed.
- **Editing here is editing production code.** The working tree is what PM2 runs. Check `curl -s localhost:3000/api/health` (`games` must be 0) before a restart, and read the ground rules in `CLAUDE.md` first.
- Conventions that bite: no inline `style=""` (the CSP drops them), every user-facing string goes through `locales.js`, user-facing changes need a `changelog.js` entry, no em-dashes in any file you write, a change to game flow or scoring needs a `test/smoke.js` assertion.
- Never stop a process with `pkill -f <command string>` on this box: kill by PID.
- Claude Desktop sessions cannot reach the VPS or its `~/.claude` notes: put what matters here.

## 6. Session log (newest first)
### 2026-11-06 (later) | Claude Code on the VPS | `desktop/avatars-music`, fast-forwarded to `master` (`d371566`), deployed, pushed
Reviewed the diff and deployed on the owner's instruction. No app code changed in this session. Verified: smoke 228 passed on the branch and again on `master`; a scripted headless Chromium game against a throwaway instance (music starts after a tap, mute and unmute, question loop, music off on leaderboard and podium, avatars on all screens, no page, CSP or request errors); after the restart health ok with 0 games, `/`, `/host`, `/js/avatar.js` and both MP3s 200 through `https://cxquiz.tech`, range requests 206. Not done: a real phone, a projector, audible music, or a game on the live server. Rollback: `/var/backups/floor-quiz-20261106-111736`. Branch `origin/desktop/avatars-music` left in place. Also removed stale pitfalls from this file (the deleted branch and `/root/fq-review`).
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
