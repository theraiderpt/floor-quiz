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
Known follow-ups from the Sunny Sticker work, none fixed:
1. Reloading the projector mid-game drops a dark quiz back to light (`S.quiz` has no `theme` on `host:resume`).
2. `lastRank` is not updated for players who were disconnected at the reveal.
3. No rank-movement line on text questions; the "answered" count is hidden on the reveal screen.
4. Review the stale branch below before deciding what to do with it.

## 5. Pitfalls and environment
- **Editing here is editing production code.** The working tree is what PM2 runs. Check `curl -s localhost:3000/api/health` (`games` must be 0) before a restart, and read the ground rules in `CLAUDE.md` first.
- **Unmerged branch `origin/claude/vibrant-hawking-rmml7k`** (a web session, 2026-10-04): one commit, "Harden auth, sockets and self-paced flow after security review" (7 files, +340 -51: `server/index.js`, `server/selfpaced.js`, `test/smoke.js`, locales, changelog). It is 22 commits behind `master`, so expect conflicts. It may hold security fixes that `master` still lacks: review it before deleting it, do not merge it blindly.
- **`/root/fq-review` is a stale copy without git.** Its `CLAUDE.md` is older than this one. Edit only here.
- Conventions that bite: no inline `style=""` (the CSP drops them), every user-facing string goes through `locales.js`, user-facing changes need a `changelog.js` entry, no em-dashes in any file you write, a change to game flow or scoring needs a `test/smoke.js` assertion.
- Never stop a process with `pkill -f <command string>` on this box: kill by PID.
- Claude Desktop sessions cannot reach the VPS or its `~/.claude` notes: put what matters here.

## 6. Session log (newest first)
### 2026-10-31 | Claude Code on the VPS | no branch, no code change
Created this handover and the protocol in `CLAUDE.md`; checked the repo, the health endpoint and the stale branch. Nothing deployed, nothing committed (files left for the owner to commit).

### 2026-10-26 | Claude Code on the VPS | `master`
Sunny Sticker refresh shipped and deployed, pushed.

### Before that
2026-09-18 to 2026-10-01: images and GIFs for players, Giphy, "What's new", 7 languages, review fixes. See `git log`.
