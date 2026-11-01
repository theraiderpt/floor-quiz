# Handover: CX Quiz

Living note shared by Claude Code on the VPS and Claude Desktop. Read it at the start of a session, update it at the end (protocol at the end of `CLAUDE.md`). It holds state and decisions, not code. No secrets in here. Ground rules, operational facts and conventions are in `CLAUDE.md` and are authoritative.

## 1. State (written 2026-11-01, VPS session; facts checked that day)
- **`master` = `origin/master` = `d39ccca`, deployed 2026-11-01** (PM2 `floor-quiz` restarted with 0 games running, health ok, site 200, `npm run smoke` all checks passed on the production tree). Production runs from this directory (`/var/www/floor-quiz`, PM2 as `deploy`). Rollback copy: `/var/backups/floor-quiz-20261101-002219`.
- **Shipped 2026-11-01:** `lastRank` is now kept for every player, so someone who rejoins sees movement against the right rank; `host:resume` sends the quiz `theme` so a projector reload keeps a dark quiz dark; `npm audit fix` (body-parser, compression, proxy-addr, qs, express 4.22.3). Changelog entry added.
- **Last big release before that:** "Sunny Sticker" refresh (2026-10-26), pictures and GIFs, Giphy, "What's new", 7 languages.
- **Tests:** `npm run smoke` (throwaway database, safe against production).
- **Audit:** the one remaining finding, `nodemailer`, is fixed on branch `cli/hardening-nodemailer` (10.3.1, `npm audit --omit=dev` 0 vulnerabilities, smoke green including the SMTP sink). Merged and deployed 2026-11-01 (rollback copy `/var/backups/floor-quiz-20261101-002856`).
- **GitHub:** private `git@github.com:theraiderpt/floor-quiz.git`, branch `master`. Push after every deploy.

## 2. In progress (claims)
Nothing claimed. Before starting anything bigger than a small fix, add a line here on your branch: `date | tool | branch | area`.

## 3. Owner decisions still open
None recorded. Anything that changes game flow, scoring or the visual direction goes through the owner first.

## 4. Next steps
1. **Done 2026-11-01, kept for the record: `cli/hardening-nodemailer` merged and deployed** (nodemailer 10.3.1). Checked against its changelog: needs Node 20+ (production runs 24), the TLS and `NoAuth` changes do not touch `server/mail.js`. Only the smoke SMTP sink exercised it, so send one real invite after deploy. Deploy like 2026-11-01: backup, sync a tested `node_modules`, never `npm ci` (see pitfalls).
2. **Branch `origin/claude/vibrant-hawking-rmml7k` deleted 2026-11-01.** Correction of the 2026-10-31 review: nothing is missing from it. `master` already contains that commit (PR #1, `628a71c`): rate limit per socket, daily upload budget, disabled hosts cut off, narrower CSP, 256KB socket buffer, credential-tagged cookies, account lockout. The earlier "still missing" list came from a keyword search and was wrong. The branch is only behind `master`.
3. Optional, a design call: movement line on text questions (the server already sends `prevRank` and `gapToNext`; the rank never changes on a text question).
4. Approve the `better-sqlite3` install script for npm 12 (`allowScripts`) so `deploy/update.sh` works again.

## 5. Pitfalls and environment
- **npm 12 blocks dependency install scripts.** `npm ci` then leaves `better-sqlite3` without its compiled binary and the app cannot start. On 2026-11-01 the deploy avoided `npm ci`: it synced a tested `node_modules` from a worktree (binary copied from production) with rsync, `chown -R deploy:deploy`, and checked `require("better-sqlite3")` as `deploy` before restarting. `deploy/update.sh` still runs `npm ci --omit=dev`: do not use it until the install script is approved.
- **Editing here is editing production code.** The working tree is what PM2 runs. Check `curl -s localhost:3000/api/health` (`games` must be 0) before a restart, and read the ground rules in `CLAUDE.md` first.
- **Unmerged branch `origin/claude/vibrant-hawking-rmml7k`** (a web session, 2026-10-04): one commit, "Harden auth, sockets and self-paced flow after security review" (7 files, +340 -51: `server/index.js`, `server/selfpaced.js`, `test/smoke.js`, locales, changelog). It is 22 commits behind `master`, so expect conflicts. It may hold security fixes that `master` still lacks: review it before deleting it, do not merge it blindly.
- **`/root/fq-review` is a stale copy without git.** Its `CLAUDE.md` is older than this one. Edit only here.
- Conventions that bite: no inline `style=""` (the CSP drops them), every user-facing string goes through `locales.js`, user-facing changes need a `changelog.js` entry, no em-dashes in any file you write, a change to game flow or scoring needs a `test/smoke.js` assertion.
- Never stop a process with `pkill -f <command string>` on this box: kill by PID.
- Claude Desktop sessions cannot reach the VPS or its `~/.claude` notes: put what matters here.

## 6. Session log (newest first)
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
