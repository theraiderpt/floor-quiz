# Floor Quiz

A self-hosted live team quiz. One screen at the front, everyone else answers on their phone, fastest correct answer scores highest. Built to replace a third-party quiz tool for internal engagement sessions, with all data staying on your own server.

Live at **cxquiz.tech**. Deployment: run `bash deploy/setup.sh` on the VPS, or follow [`deploy/DEPLOY.md`](deploy/DEPLOY.md) by hand.

## What it does

- Host console with a saved quiz library, question editor, and CSV or JSON import
- Four-choice and true/false questions, per-question time limits from 5 to 120 seconds
- Room PIN plus a QR code on the lobby screen so a large room joins in seconds
- Live answered counter while a question is open, answer distribution on reveal
- Standings between questions, podium at the end, CSV export
- Past game history kept on the server
- Players who refresh, lock their phone, or drop off wifi rejoin with their score intact

## Architecture

```
  phones ─┐
          ├─ WebSocket ─→ nginx ─→ Node (Express + Socket.IO) ─→ SQLite
  host ───┘                          │
  screen                             └─ game state in memory
```

Live game state is deliberately in memory. A quiz session lasts fifteen minutes and nobody needs a game to survive a server restart, so a database write per answer would be cost without benefit. Only the final standings are persisted, once, when a game ends.

```
server/
  config.js   env loading, scoring constants, refuses to boot on weak secrets
  db.js       SQLite schema and prepared statements
  game.js     Game state machine and the room registry
  index.js    HTTP routes, auth, and the socket event handlers
public/
  index.html  player app: join, answer, result
  host.html   host console: library, editor, lobby, game screens
deploy/       nginx config, PM2 config, deployment runbook
test/
  smoke.js    end-to-end game, 36 assertions
  load.js     concurrent player load test
```

## Scoring

A correct answer scores between 600 and 1000 points, decaying linearly across the question's time limit, plus 60 points per consecutive correct answer capped at five. Wrong answers score zero. Slow but right always beats fast but wrong, which keeps people reading the question rather than mashing a colour.

Tune it in `SCORING` in `server/config.js`.

Scoring happens on the server and nowhere else. The correct answer is not sent to any player device until the question closes, so opening dev tools on a phone reveals nothing useful.

## Running locally

```bash
npm install
cp .env.example .env      # set HOST_PASSWORD, leave NODE_ENV unset
npm run dev
```

Host console at `http://localhost:3000/host`, player app at `http://localhost:3000`. To test properly, open the player app on your phone using your laptop's LAN address with both on the same wifi.

## Tests

```bash
npm run smoke          # full game with three players, 36 assertions
node test/load.js 150  # 150 concurrent players
node test/load.js 400  # headroom check
```

Measured on a single shared CPU, with the server and every simulated client on the same machine:

| Players | Question reaches all devices | Simultaneous answers accepted | Memory |
|---|---|---|---|
| 150 | 4 ms | 150/150 in 29 ms | +31 MB |
| 400 | 11 ms | 400/400 in 79 ms | +41 MB |

Real sessions will do better, since the players are on their own phones rather than competing with the server for CPU.

## Importing questions

CSV columns, header row optional:

```
question, option A, option B, option C, option D, correct letter, seconds
```

```csv
Question,A,B,C,D,Correct,Seconds
"What does AHT stand for?",Average Handle Time,Agent Hold Time,Auto Hangup Threshold,All Hands Total,A,20
Is 80/20 a service level target?,True,False,,,A,10
```

Leave C and D blank for a two-option question. JSON export from the host console can be re-imported unchanged, which is the easiest way to move a quiz between servers.

## Limits worth knowing

- Single process. Game state is in memory, so this does not cluster without a Redis adapter.
- A server restart ends any game in progress.
- Anyone with the host password can run games. It is one shared password, not per-user accounts. If you need an audit trail of who ran what, that is the first thing to add.
- Names are free text and are stored in the results table. Tell people to use a first name and team.
