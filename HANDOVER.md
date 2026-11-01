# Handover: CX Quiz

Living note shared by Claude Code on the VPS and Claude Desktop. Read it at the start of a session, update it at the end (protocol at the end of `CLAUDE.md`). It holds state and decisions, not code. No secrets in here. Ground rules, operational facts and conventions are in `CLAUDE.md` and are authoritative.

## 1. State (written 2026-10-31, VPS session; facts below were checked that day)
- **`master` = `origin/master` = `f49cb76` (2026-10-26)**, clean working tree. Production runs from this very directory (`/var/www/floor-quiz`, PM2 process `floor-quiz` as the `deploy` user), so the files on disk are what a restart runs. Health check on 2026-10-31: `{"ok":true,"games":0}`, process online with 0 restarts.
- **Last shipped:** the "Sunny Sticker" visual refresh (light sky-blue ground, navy outlines, Fredoka and Nunito, Noto Sans for Greek), light is the default theme and each quiz has a `theme` column. Before that: pictures and GIFs on player devices, Giphy search, a "What's new" panel, a UI in 7 languages (en, fr, de, es, el, pt-PT, ro), and the fixes from the 2026-10-01 review. History: `git log` and `public/js/changelog.js`.
- **Tests:** `npm run smoke` (145 assertions, throwaway database, safe against production). It was not re-run on 2026-10-31.
- **Giphy:** `GIPHY_API_KEY` is now set in `.env` (older notes said it was pending).
- **GitHub:** private `git@github.com:theraiderpt/floor-quiz.git`, branch `master`. Push after every deploy (rule in `CLAUDE.md`).

## 2. In progress (claims)
Nothing claimed. Before starting anything bigger than a small fix, add a line here on your branch: `date | tool | branch | area`.

## 3. Owner decisions still open
None recorded. Anything that changes game flow, scoring or the visual direction goes through the owner first.

## 4. Next steps
Review of 2026-10-31, from reading the code and running `npm audit`. Nothing was changed and nothing was reproduced in a browser.

**Known follow-ups**
1. **Reloading the projector drops a dark quiz to light: real, but only in a fallback.** The theme comes from `S.quiz.theme`, which `rememberLive()` keeps in `sessionStorage` and a reload restores. When that storage fails or is cleared, `resumeLive` builds `S.quiz = { title, questions: [] }` with no theme and `FQTheme.set(undefined)` means light. The server does know the theme (`host:create` runs the saved quiz from the database, so `game.quiz.theme` is right) but `host:resume` does not send it. Fix, small: add `theme: game.quiz.theme` to the resume answer in `server/index.js` and use `res.theme` in `public/js/host.js` when `S.quiz` has none.
2. **`lastRank` is stale for players who were disconnected at a reveal: confirmed.** In the reveal loop of `server/game.js`, `if (!p.socketId) continue;` comes before `p.lastRank = rank`, so a player who rejoins sees "moved up or down" measured against a rank from several questions ago. Fix, two lines: set `lastRank` for every player and send `result` only to connected ones. Add an assertion to `test/smoke.js`.
3. **No movement line on text questions:** the player client returns early for text before `renderMovement`, although the server already sends `prevRank` and `gapToNext`. A text question scores nothing, so the rank never changes and the line would only say "same place, N points behind". Optional, a design call.
4. **The "answered" counter is hidden on the reveal screen: by design.** `host.js` collapses the timer block so the reveal tiles take the space, and the footer already shows "got it X of Y". No change recommended. The faint dark outline is also by design.

**Security, from `npm audit --omit=dev` (5 findings in production dependencies)**
- `proxy-addr` (critical, IP spoofing through a trusted subnet): probably not exploitable here, because the app sets `trust proxy` to the hop count 1 and not to a subnet. Based on the advisory text, the library was not read.
- `body-parser` (high, denial of service with trailing bytes after a compressed body) and `compression` (high, memory leak on premature close): reachable by anyone who can send requests, so worth fixing.
- `nodemailer` (high): needs a major jump from 6 to 10. The app only sends fixed texts to validated addresses (`server/mail.js`), so exposure is low, but the jump needs a test of the invite and results emails.
- `qs` (moderate, `stringify` with comma format): the app does not use that call.
- `npm audit fix` without `--force` handles all but `nodemailer`. Do it in a git worktree and run `npm run smoke`, never in `/var/www/floor-quiz` directly.

**Stale branch `origin/claude/vibrant-hawking-rmml7k` (2026-10-04, security hardening)**: do not merge it, it conflicts in `server/index.js`, `server/selfpaced.js`, `test/smoke.js` and the changelog, and its lockfile predates today's advisories. A keyword search shows `master` already has an Origin check, the socket buffer limit, the login limiter that ignores successes, an account failure lockout and credential-tagged cookies (equivalence not verified), and `/api/health` no longer lists players. Still missing on `master`: a per-socket event rate limit, a daily upload byte budget per host, disconnecting sockets of disabled hosts, a narrower CSP `connect-src`. The self-paced changes in that commit were not compared. Port the missing pieces on a fresh branch, then delete the old one.

## 5. Pitfalls and environment
- **Editing here is editing production code.** The working tree is what PM2 runs. Check `curl -s localhost:3000/api/health` (`games` must be 0) before a restart, and read the ground rules in `CLAUDE.md` first.
- **Unmerged branch `origin/claude/vibrant-hawking-rmml7k`** (a web session, 2026-10-04): one commit, "Harden auth, sockets and self-paced flow after security review" (7 files, +340 -51: `server/index.js`, `server/selfpaced.js`, `test/smoke.js`, locales, changelog). It is 22 commits behind `master`, so expect conflicts. It may hold security fixes that `master` still lacks: review it before deleting it, do not merge it blindly.
- **`/root/fq-review` is a stale copy without git.** Its `CLAUDE.md` is older than this one. Edit only here.
- Conventions that bite: no inline `style=""` (the CSP drops them), every user-facing string goes through `locales.js`, user-facing changes need a `changelog.js` entry, no em-dashes in any file you write, a change to game flow or scoring needs a `test/smoke.js` assertion.
- Never stop a process with `pkill -f <command string>` on this box: kill by PID.
- Claude Desktop sessions cannot reach the VPS or its `~/.claude` notes: put what matters here.

## 6. Session log (newest first)
### 2026-10-31 (late) | Claude Code on the VPS | no branch, no code change
Reviewed the known follow-ups and the stale security branch (section 4) and ran `npm audit`: 5 findings in production dependencies, one marked critical. Nothing changed.

### 2026-10-31 | Claude Code on the VPS | no branch, no code change
Created this handover and the protocol in `CLAUDE.md`; checked the repo, the health endpoint and the stale branch. Nothing deployed, nothing committed (files left for the owner to commit).

### 2026-10-26 | Claude Code on the VPS | `master`
Sunny Sticker refresh shipped and deployed, pushed.

### Before that
2026-09-18 to 2026-10-01: images and GIFs for players, Giphy, "What's new", 7 languages, review fixes. See `git log`.
