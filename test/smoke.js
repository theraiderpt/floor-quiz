/* End-to-end check: boots the real server, signs in as admin and as host,
   walks the invite lifecycle, checks cross-host isolation and quota
   enforcement, then plays a two-question game with three players and
   verifies scoring, ordering and the CSV export. Run with `npm run smoke`.
   Uses a throwaway database. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fq-"));
process.env.NODE_ENV = "test";
process.env.PORT = "0";
process.env.HOST = "127.0.0.1";
process.env.SESSION_SECRET = "0".repeat(64);
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.PUBLIC_URL = "http://127.0.0.1";

const { server } = await import("../server/index.js");
const { store } = await import("../server/db.js");
const { hashPassword } = await import("../server/auth.js");
const { FLOW } = await import("../server/config.js");
const { io: ioc } = await import("socket.io-client");

/* Smallest possible valid PNG (1x1 transparent), used to check picture
   questions round-trip without needing a real image file on disk. */
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let failures = 0;
const check = (label, cond, extra = "") => {
  if (cond) console.log("  ok   " + label);
  else { failures++; console.log("  FAIL " + label + (extra ? "  → " + extra : "")); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cookieOf = res => res.headers.get("set-cookie").split(";")[0];

/* once() would be consumed by the first state event of any phase, and lobby
   traffic from joins and disconnects races us. Listen until the predicate
   actually matches, then detach. */
const waitFor = (socket, event, pred, ms = 10000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error("timed out waiting for " + event)); }, ms);
    function handler(payload) {
      if (!pred(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });

await new Promise(r => (server.listening ? r() : server.once("listening", r)));
const base = "http://127.0.0.1:" + server.address().port;
console.log("server up on " + base + "\n");

/* ---- seed one admin and one active host directly (test setup, not the
   behavior under test - the invite lifecycle itself gets its own coverage
   below with a second host) ---- */
store.admins.upsert("admin@smoke.test", hashPassword("admin-pass-123"));
const hostA = store.hosts.create("hosta@smoke.test", 400);
store.hosts.setPassword(hostA.id, hashPassword("hosta-pass-123"));

/* ---- admin auth ---- */
const adminBad = await fetch(base + "/api/admin/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@smoke.test", password: "wrong" })
});
check("wrong admin password rejected", adminBad.status === 401, "got " + adminBad.status);

const adminLogin = await fetch(base + "/api/admin/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@smoke.test", password: "admin-pass-123" })
});
check("admin login returns 200", adminLogin.status === 200, "got " + adminLogin.status);
const adminCookie = cookieOf(adminLogin);

const overview = await (await fetch(base + "/api/admin/overview", { headers: { Cookie: adminCookie } })).json();
check("overview reports the seeded host", overview.hosts >= 1, JSON.stringify(overview));
check("question bank was seeded on first boot", overview.bankQuestions >= 20, JSON.stringify(overview));

const seedCategories = await (await fetch(base + "/api/admin/categories", { headers: { Cookie: adminCookie } })).json();
check("three starter categories were seeded", seedCategories.length >= 3, JSON.stringify(seedCategories.map(c => c.name)));
const seedCategoryId = seedCategories[0].id;

/* ---- host A signs in ---- */
const login = await fetch(base + "/api/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "hosta@smoke.test", password: "hosta-pass-123" })
});
check("host login returns 200", login.status === 200, "got " + login.status);
const cookie = cookieOf(login);

const bad = await fetch(base + "/api/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "hosta@smoke.test", password: "wrong" })
});
check("wrong password rejected", bad.status === 401, "got " + bad.status);

const noAuth = await fetch(base + "/api/quizzes");
check("quiz list needs auth", noAuth.status === 401, "got " + noAuth.status);

/* ---- invite lifecycle: admin creates host B, host B completes it ---- */
const created = await (await fetch(base + "/api/admin/hosts", {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
  body: JSON.stringify({ email: "hostb@smoke.test", maxPlayers: 2 })
})).json();
const token = created.inviteLink.split("/invite/")[1];
check("invite link was generated", Boolean(token), JSON.stringify(created));

const inviteCheck = await (await fetch(base + "/api/invite/" + token)).json();
check("invite reports the right email", inviteCheck.valid && inviteCheck.email === "hostb@smoke.test", JSON.stringify(inviteCheck));

const completed = await fetch(base + "/api/invite/" + token + "/complete", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: "hostb-pass-123" })
});
check("invite completion succeeds", completed.status === 200, "got " + completed.status);

const loginB = await fetch(base + "/api/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "hostb@smoke.test", password: "hostb-pass-123" })
});
check("newly invited host can log in", loginB.status === 200, "got " + loginB.status);
const cookieB = cookieOf(loginB);

/* ---- cross-host isolation ---- */
const quizA = await (await fetch(base + "/api/quizzes", {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ title: "Host A's quiz", questions: [{ q: "q", t: 10, opts: ["a", "b"], correct: 0 }] })
})).json();
const crossEdit = await fetch(base + "/api/quizzes/" + quizA.id, {
  method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookieB },
  body: JSON.stringify({ title: "hijacked", questions: quizA.questions })
});
check("host B cannot edit host A's quiz", crossEdit.status === 404, "got " + crossEdit.status);

/* ---- category CRUD ---- */
const newCat = await (await fetch(base + "/api/admin/categories", {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
  body: JSON.stringify({ name: "Smoke Category" })
})).json();
const hostCats = await (await fetch(base + "/api/categories", { headers: { Cookie: cookie } })).json();
check("new category visible to hosts", hostCats.some(c => c.id === newCat.id), JSON.stringify(hostCats));
const catDel = await (await fetch(base + "/api/admin/categories/" + newCat.id, { method: "DELETE", headers: { Cookie: adminCookie } })).json();
check("category deleted", catDel.ok === true);

/* ---- bank CRUD ---- */
const bankQ = await (await fetch(base + "/api/admin/bank", {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
  body: JSON.stringify({ categoryId: seedCategoryId, q: "Smoke bank question", t: 15, opts: ["Right", "Wrong"], correct: 0 })
})).json();
const hostBank = await (await fetch(base + "/api/bank?category=" + seedCategoryId, { headers: { Cookie: cookie } })).json();
check("new bank question visible to hosts", hostBank.some(b => b.id === bankQ.id), JSON.stringify(hostBank.map(b => b.id)));
const bankDel = await (await fetch(base + "/api/admin/bank/" + bankQ.id, { method: "DELETE", headers: { Cookie: adminCookie } })).json();
check("bank question deleted", bankDel.ok === true);

/* ---- quota enforcement: host B is capped at 2 players ---- */
const hostBSocket = ioc(base, { extraHeaders: { Cookie: cookieB }, transports: ["websocket"] });
await new Promise(r => hostBSocket.on("connect", r));
const quotaGame = await new Promise(r => hostBSocket.emit("host:create", {
  quiz: { title: "Quota Test", questions: [{ q: "q", t: 10, opts: ["a", "b"], correct: 0 }] }
}, r));
check("quota game opens", /^\d{4}$/.test(quotaGame.pin || ""), JSON.stringify(quotaGame));

const quotaSockets = [];
const joinResults = [];
for (let i = 0; i < 3; i++) {
  const s = ioc(base, { transports: ["websocket"] });
  await new Promise(r => s.on("connect", r));
  quotaSockets.push(s);
  joinResults.push(await new Promise(r => s.emit("player:join", { pin: quotaGame.pin, name: "P" + i }, r)));
}
check("first two players admitted under the cap", joinResults[0].playerId && joinResults[1].playerId, JSON.stringify(joinResults));
check("third player refused once the host's cap is hit", Boolean(joinResults[2].error), JSON.stringify(joinResults[2]));
hostBSocket.emit("host:end");
quotaSockets.forEach(s => s.disconnect());
hostBSocket.disconnect();

/* ---- join modes: "name_email" rejects a join with no/bad email, and a
   valid email survives into results/CSV. The default "name" mode is
   covered below by host A's game, where players join with a name only. ---- */
const hostBSocket2 = ioc(base, { extraHeaders: { Cookie: cookieB }, transports: ["websocket"] });
await new Promise(r => hostBSocket2.on("connect", r));
const formalGame = await new Promise(r => hostBSocket2.emit("host:create", {
  quiz: { title: "Formal Test", joinMode: "name_email", questions: [{ q: "q", t: 10, opts: ["a", "b"], correct: 0 }] }
}, r));
check("formal-mode game opens", /^\d{4}$/.test(formalGame.pin || ""), JSON.stringify(formalGame));

const noEmailSocket = ioc(base, { transports: ["websocket"] });
await new Promise(r => noEmailSocket.on("connect", r));
const noEmailRes = await new Promise(r => noEmailSocket.emit("player:join", { pin: formalGame.pin, name: "NoEmail" }, r));
check("formal mode rejects a join with no email", Boolean(noEmailRes.error), JSON.stringify(noEmailRes));

const badEmailRes = await new Promise(r => noEmailSocket.emit("player:join", { pin: formalGame.pin, name: "BadEmail", email: "not-an-email" }, r));
check("formal mode rejects a join with an invalid email", Boolean(badEmailRes.error), JSON.stringify(badEmailRes));

const formalSocket = ioc(base, { transports: ["websocket"] });
await new Promise(r => formalSocket.on("connect", r));
const formalJoin = await new Promise(r => formalSocket.emit("player:join", { pin: formalGame.pin, name: "Emailed Player", email: "Player@Smoke.Test" }, r));
check("formal mode admits a join with a valid email", Boolean(formalJoin.playerId), JSON.stringify(formalJoin));

const formalFinal = waitFor(hostBSocket2, "final", () => true);
const formalQ = waitFor(formalSocket, "state", s => s.phase === "question");
hostBSocket2.emit("host:start");
await formalQ;
await sleep(120);
await new Promise(r => formalSocket.emit("player:answer", { choice: 0 }, r));
const formalResult = await formalFinal;

const formalCsv = await fetch(base + "/api/sessions/" + formalResult.sessionId + "/csv", { headers: { Cookie: cookieB } });
const formalCsvText = await formalCsv.text();
check("email is lower-cased and persisted into the CSV export",
  formalCsvText.includes("player@smoke.test"), JSON.stringify(formalCsvText));

noEmailSocket.disconnect();
formalSocket.disconnect();
hostBSocket2.disconnect();

/* ---- host socket, host A ---- */
const hostSocket = ioc(base, { extraHeaders: { Cookie: cookie }, transports: ["websocket"] });
await new Promise(r => hostSocket.on("connect", r));

const quiz = {
  title: "Smoke Test",
  questions: [
    { q: "Fast one", t: 6, opts: ["Right", "Wrong", "Also wrong", "Nope"], correct: 0, img: TINY_PNG },
    { q: "Second one", t: 6, opts: ["True", "False"], correct: 1 }
  ]
};

const gameCreated = await new Promise(r => hostSocket.emit("host:create", { quiz }, r));
check("lobby opens with a 4-digit PIN", /^\d{4}$/.test(gameCreated.pin || ""), JSON.stringify(gameCreated));
check("QR code generated", typeof gameCreated.qr === "string" && gameCreated.qr.startsWith("data:image"));
const PIN = gameCreated.pin;

/* ---- three players join ---- */
const names = ["Ana", "Kostas", "Marta"];
const players = [];
for (const name of names) {
  const s = ioc(base, { transports: ["websocket"] });
  await new Promise(r => s.on("connect", r));
  const res = await new Promise(r => s.emit("player:join", { pin: PIN, name }, r));
  players.push({ socket: s, name, id: res.playerId, results: [], over: null });
  s.on("result", d => players.find(p => p.socket === s).results.push(d));
  s.on("gameover", d => { players.find(p => p.socket === s).over = d; });
}
check("all three players joined", players.every(p => p.id), JSON.stringify(players.map(p => p.id)));

const dupe = ioc(base, { transports: ["websocket"] });
await new Promise(r => dupe.on("connect", r));
const dupeRes = await new Promise(r => dupe.emit("player:join", { pin: PIN, name: "Ana" }, r));
check("duplicate name is disambiguated", dupeRes.name === "Ana 2", "got " + dupeRes.name);
dupe.disconnect();

const ghost = ioc(base, { transports: ["websocket"] });
await new Promise(r => ghost.on("connect", r));
const ghostRes = await new Promise(r => ghost.emit("player:join", { pin: "0000", name: "X" }, r));
check("joining a dead PIN is refused", Boolean(ghostRes.error), JSON.stringify(ghostRes));
ghost.disconnect();

/* ---- question one ---- */
const reveals = [];
hostSocket.on("reveal", d => reveals.push(d));
const scoreEvents = [];
hostSocket.on("scores", d => scoreEvents.push(d));
const finals = [];
hostSocket.on("final", d => finals.push(d));
const questionImages = [];
hostSocket.on("question:image", d => questionImages.push(d));

const q1 = waitFor(players[0].socket, "state", s => s.phase === "question");
hostSocket.emit("host:start");   // deliberately no ack: guards the short-circuit bug
await q1;
await sleep(120);

check("a question's picture is sent to the host on its own channel",
  questionImages.some(d => d.qIndex === 0 && d.img === TINY_PNG), JSON.stringify(questionImages));

/* Ana answers correctly and fast, Kostas correctly but slow, Marta wrong. */
await new Promise(r => players[0].socket.emit("player:answer", { choice: 0 }, r));
await sleep(1500);
await new Promise(r => players[1].socket.emit("player:answer", { choice: 0 }, r));
const twice = await new Promise(r => players[0].socket.emit("player:answer", { choice: 1 }, r));
check("double answering is blocked", Boolean(twice.error), JSON.stringify(twice));
await new Promise(r => players[2].socket.emit("player:answer", { choice: 2 }, r));

await sleep(1200);
check("question one revealed", reveals.length === 1, "reveals=" + reveals.length);
check("reveal reports the right answer index", reveals[0]?.correct === 0);
check("answer distribution counted", JSON.stringify(reveals[0]?.counts) === "[2,0,1,0]", JSON.stringify(reveals[0]?.counts));
check("two of three got it right", reveals[0]?.gotItRight === 2);

const anaR = players[0].results[0], kosR = players[1].results[0], marR = players[2].results[0];
check("fast correct beats slow correct", anaR.points > kosR.points, anaR.points + " vs " + kosR.points);
check("wrong answer scores zero", marR.points === 0);
check("correct answer never scores below the floor", kosR.points >= 600, String(kosR.points));
check("no correct answer exceeds the ceiling", anaR.points <= 1000 + 300, String(anaR.points));
check("player is told the correct index", marR.correctIndex === 0 && marR.correct === false);
check("leader is ranked first", anaR.rank === 1, "rank " + anaR.rank);

/* ---- standings, then question two ---- */
hostSocket.emit("host:next");    // deliberately no ack
await sleep(300);
check("standings emitted", scoreEvents.length === 1);
check("standings ordered by score", scoreEvents[0]?.board[0]?.name === "Ana", JSON.stringify(scoreEvents[0]?.board.map(p => p.name)));

const q2 = waitFor(players[0].socket, "state", s => s.phase === "question" && s.qIndex === 1);
hostSocket.emit("host:next");
await q2;
await sleep(120);

/* Everyone answers, which should close the question before the timer. */
const t0 = Date.now();
await Promise.all(players.map(p => new Promise(r => p.socket.emit("player:answer", { choice: 1 }, r))));
await sleep(900);
check("all-answered closes the question early", Date.now() - t0 < 3000 && reveals.length === 2,
  "elapsed=" + (Date.now() - t0) + "ms reveals=" + reveals.length);

/* No host:next here on purpose. The reveal-to-final transition should
   happen on its own after FLOW.revealMs, with no click at all. */
await sleep(FLOW.revealMs + 500);
check("game auto-advances to final with no host click", finals.length === 1, "finals=" + finals.length);
const board = finals[0]?.board || [];
check("final board holds every player", board.length === 3, "got " + board.length);
check("board is sorted high to low", board.every((p, i) => i === 0 || board[i - 1].score >= p.score));
check("every player got a gameover event", players.every(p => p.over), JSON.stringify(players.map(p => Boolean(p.over))));
check("ranks are unique and complete",
  new Set(players.map(p => p.over.rank)).size === 3,
  JSON.stringify(players.map(p => p.over.rank)));

/* ---- results persisted ---- */
const sessionId = finals[0].sessionId;
const csv = await fetch(base + "/api/sessions/" + sessionId + "/csv", { headers: { Cookie: cookie } });
const text = await csv.text();
check("CSV export returns 200", csv.status === 200, "got " + csv.status);
check("CSV has a header and three rows", text.trim().split("\r\n").length === 4, JSON.stringify(text.slice(0, 120)));
check("CSV names the winner first", text.split("\r\n")[1].includes(board[0].name), text.split("\r\n")[1]);

const history = await (await fetch(base + "/api/sessions", { headers: { Cookie: cookie } })).json();
check("session appears in history", history.some(s => s.id === sessionId));

/* ---- sanitiser ---- */
const { sanitiseQuiz, cleanName } = await import("../server/game.js");
const dirty = sanitiseQuiz({
  title: "x".repeat(200),
  questions: [
    { q: "ok", t: 9999, opts: ["a", "b", "c", "d", "e", "f"], correct: 99 },
    { q: "", opts: ["a", "b"], correct: 0 },
    { q: "too few", opts: ["only one"], correct: 0 }
  ]
});
check("title length capped", dirty.title.length === 80, String(dirty.title.length));
check("unusable questions dropped", dirty.questions.length === 1, String(dirty.questions.length));
check("time limit clamped", dirty.questions[0].t === 120, String(dirty.questions[0].t));
check("options capped at four", dirty.questions[0].opts.length === 4);
check("correct index clamped into range", dirty.questions[0].correct === 3, String(dirty.questions[0].correct));
check("control characters stripped from names", cleanName("Ru\u0000i\nSilva") === "RuiSilva" || cleanName("Ru\u0000i\nSilva") === "Rui Silva",
  JSON.stringify(cleanName("Ru\u0000i\nSilva")));

const withImages = sanitiseQuiz({
  title: "Pictures",
  questions: [
    { q: "valid image", opts: ["a", "b"], correct: 0, img: TINY_PNG },
    { q: "bogus image", opts: ["a", "b"], correct: 0, img: "not-a-data-uri" },
    { q: "oversized image", opts: ["a", "b"], correct: 0, img: "data:image/png;base64," + "A".repeat(400_000) }
  ]
});
check("a valid data-URI image is kept", withImages.questions[0].img === TINY_PNG);
check("a non-image string is dropped", withImages.questions[1].img === null, String(withImages.questions[1].img));
check("an oversized image is dropped", withImages.questions[2].img === null, String(withImages.questions[2].img));

/* ---- done ---- */
players.forEach(p => p.socket.disconnect());
hostSocket.disconnect();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log("\n" + (failures ? failures + " CHECK(S) FAILED" : "all checks passed"));
process.exit(failures ? 1 : 0);
