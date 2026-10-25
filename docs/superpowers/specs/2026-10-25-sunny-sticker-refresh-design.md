# CX Quiz "Sunny Sticker" visual refresh

Date: 2026-10-25. Status: awaiting owner approval.

## Intent and why

The owner's userbase (contact-centre staff) knows Kahoot. CX Quiz works but looks like a
control-room dashboard: a dark navy wallboard, a mono-font uppercase status strip on every
screen, and quiet result screens. The owner wants it to feel friendly, bright and fun, with
playful visuals and animation, so that using it feels like a game and not a tool.

Success: a first-time player on a phone understands what to do without reading, the answer and
result moments feel rewarding, and the projector view feels like a show. Owner approved the
look from a mockup (see "Look" below).

## Look (decided by the owner)

Direction "B. Sunny Sticker", from the mockup at https://claude.ai/artifact/Tt1jUuDgKTh49CSoqQFz7u
(source: the scratchpad file `cxquiz-palettes.html`; tokens listed here so the document stands alone).

- Light sky-blue ground `#dff1ff`, navy ink `#10223f`, white cards.
- Thick (3px) navy outlines and a solid navy bottom edge on tiles and buttons, flat colour fills.
- Tile colours: coral `#ff6b6b`, blue `#4dabff`, sun `#ffd23f`, mint `#3ddc97`. Dark text on all of them.
- Type: Fredoka (display, buttons, numbers) and Nunito (body), from Google Fonts. The app already
  loads Google Fonts, so no new host. Keep real fallback stacks.
- The four answer shapes (triangle, diamond, circle, square) stay, tied to the four colours.
- Dark theme stays as a toggle: the same sticker style on a navy ground, tiles unchanged.
  Light becomes the default. (Owner confirmed light default only implicitly; flagged as my call.)
- The Foundever brand palette stops being the base. Owner agreed to a more playful palette.

## Scope

Phones (`index.html` + `play.js`):
- Join screen gets a "CX Quiz" logo moment instead of an empty navy page with mono labels.
- Answer screen: big sticker tiles; the language and theme buttons must no longer cover the
  bottom tiles.
- Result screen: full-screen colour flood (mint for correct, coral for wrong), a pop-in tick or
  cross, the points, total, and streak badge.

Host and projector (`host.html` + `host.js`):
- Lobby: player names bounce in as they join.
- Question screen: uses the full height; today everything sits in the top half.
- Standings and final screens in the same style.

Other pages (`admin.html`, `invite.html`, `take.html` self-paced): new colours and fonts only,
no new motion.

## Four gameplay-display additions (owner chose all four)

1. **Podium on every phone at the end.** Top 3 plus a highlighted "you" row; confetti and a
   trophy moment when the player is in the top 3. Today phones show only "You finished #N".
2. **Rank movement.** After each question show "up N places" or "down N places" and
   "N points behind the next place". Needs the server to send the previous rank and the points gap.
3. **Streak badge on the phone** (flame icon with the count). The streak bonus exists in scoring
   but players cannot see it.
4. **Winner reveal on the projector.** Podium builds third, then second, then first, instead
   of appearing all at once.

Item 4 is display only. Items 1, 2 and 3 add fields to what the server already sends to players
(see "Calls made by the author"); scoring is unchanged.

## Goals, non-goals, anti-goals

Goals: the look above, the four additions, same behaviour everywhere else.

Non-goals: team mode, any change to the scoring formula or game flow, new sounds, new question
types, a build step or framework.

Anti-goals (a failure even if it technically works): a regression in game flow; an answer key
reaching a player device before the question closes; text that is hard to read on a projector;
motion that makes a room of 150 phones noisy or janky; the refresh needing a restart that ends a
live game.

## Constraints (from the project's CLAUDE.md)

- Repo is `/var/www/floor-quiz` (the copy at `/root/fq-review` is stale; do not use it).
- Plain vanilla JS and CSS, no framework, no build step.
- No inline `style=""`; use CSS classes. Translate every user-visible string through the i18n
  dictionary (en, fr, de, es, el, pt, ro); new strings need all seven languages.
- No em-dashes inside sentences in any file written, including docs and comments.
- Comments explain why, not what.
- Any change to game flow or scoring needs a matching assertion in `test/smoke.js`. Items 2 and 3
  change the data players receive, so they get assertions. `npm run smoke` must pass before any restart.
- A "What's new" entry in `public/js/changelog.js` (host-facing, short, no file names).
- Scoring and answer keys stay server-side. Socket handlers must tolerate a missing payload and ack.
- Check `curl -s localhost:3000/api/health`: only restart when `games` is 0.
- Deploy only after the owner says to; push to GitHub after every deploy. Do not touch nginx or `.env`.
- Honour `prefers-reduced-motion`: no bounce, flood animation or confetti motion for those users.
- Accessibility: keep visible focus states and sufficient contrast on every tile (dark text on the
  four tile colours; verify the navy-ground dark theme too).
- Test visually with the throwaway-instance approach: `PORT=3055 DB_PATH=<scratch>/dev.db node
  server/index.js`, seed a host through `server/db.js` and `hashPassword`, drive it with
  `playwright-core` and the cached headless Chromium. Kill the dev instance by PID, never `pkill -f`.

## Calls made by the author (owner to check)

Facts found in the code:
- The CSP already allows `fonts.googleapis.com` and `fonts.gstatic.com`. There is no service
  worker. Static files are cached for 1 hour in production, with no versioning.
- At game end the server sends each phone only `rank`, `of`, `score`, `correctCount`, `total`
  (`gameover` event). The full board goes to the host only. So item 1 is not display only.
- `take.html` (self-paced) has its own screens and no rank or streak. Rank movement, streak badge
  and the phone podium are live-game only.

Calls:
- **Podium data (item 1):** extend `gameover` with the top 3 (name, score) and nothing more of the
  board. The player's own row is already known. Fewer than 3 players: show only those who exist.
  Display names are already put on the projector for everyone, so showing three of them on
  phones is no new exposure.
- **Rank movement (item 2):** add `prevRank` (rank after the previous question) and `gapToNext`
  (points behind the player directly above) to the per-player result the server already builds at
  question close. First question: no movement shown. Leader: "in the lead" instead of a gap.
  Ranks stay positional as in the existing code, so a player level on points with the one above
  gets `gapToNext` 0 and the phone shows "tied". Players who did not answer still get movement.
- **Timing / answer key:** rank, gap and streak ride on the result sent when the question closes,
  as `rank` and `streak` already do. Nothing new is sent while a question is open.
- **Streak (item 3):** correction after reading the code: phones already show a "{n} in a row"
  badge on the result screen when the streak is above 1. The work is to restyle it and also show
  the current streak in the answer screen's top bar. Uses the existing `streak` field; display only.
- **Mixed versions during a deploy:** only add fields, never rename or remove. New client code
  treats every new field as optional, so a phone with a cached old page and a phone with the new
  page both work against the new server.
- **Theme:** keep the `fq-theme` key. Anyone with a stored choice keeps it; everyone else gets
  the new light default.
- **Per-quiz projector theme (owner request, 2026-10-25):** the host and projector screen start
  light, and the host can choose light or dark in the quiz setup screen next to the other
  per-quiz options (joining mode, time between questions, delivery). Stored as a new `theme`
  column on `quizzes`, added the same additive way as `gap_seconds` and `delivery_mode`
  (`ensureColumn`, `TEXT NOT NULL DEFAULT 'light'`), carried through create, update, import and
  export of a quiz. Existing quizzes become light. **This is a schema change, so it needs the
  owner's go-ahead before it ships** (project ground rule); it is additive and a rollback leaves a
  harmless unused column. My call: the choice sets the starting theme of the host and projector
  screen only. Phones keep following each player's own stored choice, or light. A host's own
  toggle on the screen still overrides it for that browser. Needs a smoke assertion that the
  setting round-trips and defaults to light.

## Left to the builder

- Exact animation timings, easing and the confetti implementation (CSS or a small canvas).
- How the lobby name bounce, flood and podium build are sequenced.
- Layout details of the logo, and whether the dark theme needs minor token tweaks.
- Whether to split the work into a CSS-first pass and a gameplay-display pass.
- Where to put the new translated strings and the exact wording (en first, then the six others).

## Open items

- Greek and Romanian copy has had no native review (existing note); new strings in those two
  languages are best effort.
