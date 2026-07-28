/* Load check: 150 concurrent players through a real two-question game.
   Measures how long the whole floor takes to receive a question and how long
   the server takes to process a burst of simultaneous answers.
   Run with: node test/load.js [playerCount] */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const COUNT = Number(process.argv[2] || 150);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fq-load-"));

process.env.NODE_ENV = "test";
process.env.PORT = "0";
process.env.HOST = "127.0.0.1";
process.env.HOST_PASSWORD = "load-test";
process.env.SESSION_SECRET = "0".repeat(64);
process.env.DB_PATH = path.join(tmp, "load.db");
process.env.PUBLIC_URL = "http://127.0.0.1";
process.env.MAX_PLAYERS = String(COUNT + 10);

const { server } = await import("../server/index.js");
const { io: ioc } = await import("socket.io-client");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const mb = b => (b / 1024 / 1024).toFixed(1);

await new Promise(r => (server.listening ? r() : server.once("listening", r)));
const base = "http://127.0.0.1:" + server.address().port;

const login = await fetch(base + "/api/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: "load-test" })
});
const cookie = login.headers.get("set-cookie").split(";")[0];

const host = ioc(base, { extraHeaders: { Cookie: cookie }, transports: ["websocket"] });
await new Promise(r => host.on("connect", r));

const quiz = {
  title: "Load Test",
  questions: [
    { q: "Question one", t: 30, opts: ["A", "B", "C", "D"], correct: 0 },
    { q: "Question two", t: 30, opts: ["A", "B", "C", "D"], correct: 2 }
  ]
};
const { pin } = await new Promise(r => host.emit("host:create", { quiz }, r));
console.log(`PIN ${pin}, ramping ${COUNT} players…\n`);

const baseMem = process.memoryUsage().rss;
const clients = [];
const joinTimes = [];
const t0 = Date.now();

/* Join in waves, the way a real room fills up rather than all at once. */
for (let i = 0; i < COUNT; i += 25) {
  const wave = [];
  for (let k = i; k < Math.min(i + 25, COUNT); k++) {
    wave.push((async () => {
      const s = ioc(base, { transports: ["websocket"] });
      await new Promise(r => s.on("connect", r));
      const start = Date.now();
      const res = await new Promise(r => s.emit("player:join", { pin, name: "Agent " + (k + 1) }, r));
      joinTimes.push(Date.now() - start);
      if (res.error) throw new Error(res.error);
      clients.push({ s, gotQuestion: 0, resultAt: 0 });
    })());
  }
  await Promise.all(wave);
}
const rampMs = Date.now() - t0;
console.log(`joined     ${clients.length}/${COUNT} in ${rampMs} ms`);
console.log(`join ack   p50 ${pct(joinTimes, .5)} ms   p95 ${pct(joinTimes, .95)} ms   max ${Math.max(...joinTimes)} ms`);

/* ---- question one: measure fan-out, then a simultaneous answer burst ---- */
clients.forEach(c => {
  c.s.on("state", st => { if (st.phase === "question" && !c.gotQuestion) c.gotQuestion = Date.now(); });
  c.s.on("result", () => { c.resultAt = Date.now(); });
});

const sentAt = Date.now();
host.emit("host:start");
await sleep(2500);

const fanout = clients.filter(c => c.gotQuestion).map(c => c.gotQuestion - sentAt);
console.log(`\nquestion fan-out to ${fanout.length} devices`);
console.log(`           p50 ${pct(fanout, .5)} ms   p95 ${pct(fanout, .95)} ms   max ${Math.max(...fanout)} ms`);

const burstStart = Date.now();
const acks = await Promise.all(
  clients.map(c => new Promise(r => c.s.emit("player:answer", { choice: Math.floor(Math.random() * 4) }, r)))
);
const burstMs = Date.now() - burstStart;
const accepted = acks.filter(a => a && a.ok).length;
console.log(`\nanswer burst ${clients.length} simultaneous submissions`);
console.log(`           accepted ${accepted}/${clients.length} in ${burstMs} ms`);

/* All connected players answered, so the server should close on its own. */
const revealAt = await new Promise(r => host.once("reveal", () => r(Date.now())));
console.log(`           auto-closed ${revealAt - burstStart} ms after the burst started`);

await sleep(600);
const results = clients.filter(c => c.resultAt).length;
console.log(`           ${results}/${clients.length} devices received their personal result`);

/* ---- finish and check the write path ---- */
host.emit("host:next");
await sleep(400);
host.emit("host:next");
await sleep(600);
await Promise.all(clients.map(c => new Promise(r => c.s.emit("player:answer", { choice: 2 }, r))));
await sleep(1200);
host.emit("host:next");
const final = await new Promise(r => host.once("final", r));
console.log(`\nfinal board ${final.board.length} players, winner ${final.board[0].name} on ${final.board[0].score}`);

const csv = await fetch(base + "/api/sessions/" + final.sessionId + "/csv", { headers: { Cookie: cookie } });
const rows = (await csv.text()).trim().split("\r\n").length - 1;
console.log(`csv export  ${rows} result rows written to sqlite and read back`);

const peakMem = process.memoryUsage().rss;
console.log(`\nmemory      ${mb(baseMem)} MB before players, ${mb(peakMem)} MB at peak`);
console.log(`            ~${((peakMem - baseMem) / COUNT / 1024).toFixed(1)} KB per connected player`);
console.log(`\nnote: server and all ${COUNT} clients are sharing one CPU in this test,`);
console.log(`      so real figures with players on their own phones will be better.`);

clients.forEach(c => c.s.disconnect());
host.disconnect();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
