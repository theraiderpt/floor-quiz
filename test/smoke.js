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
/* Set (empty) before the server loads so dotenv, which never overrides an
   existing variable, can't pull the real key in from .env: the Giphy check
   below is about the "not configured" path, not a live API call. */
process.env.GIPHY_API_KEY = "";
/* Short, so the finished-game cleanup can be observed without a 2 minute wait. */
process.env.FINISHED_GRACE_MS = "1500";

const { server, attempts, rooms, io: serverIo } = await import("../server/index.js");
const { store } = await import("../server/db.js");
const { hashPassword } = await import("../server/auth.js");
const { FLOW } = await import("../server/config.js");
const { io: ioc } = await import("socket.io-client");

/* Smallest possible valid PNG and GIF (1x1 transparent), used to check the
   /api/uploads/image round-trip without needing a real image file on disk. */
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const TINY_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

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
await new Promise(r => formalSocket.emit("player:answer", { answer: 0 }, r));
const formalResult = await formalFinal;

const formalCsv = await fetch(base + "/api/sessions/" + formalResult.sessionId + "/csv", { headers: { Cookie: cookieB } });
const formalCsvText = await formalCsv.text();
check("email is lower-cased and persisted into the CSV export",
  formalCsvText.includes("player@smoke.test"), JSON.stringify(formalCsvText));

noEmailSocket.disconnect();
formalSocket.disconnect();
hostBSocket2.disconnect();

/* ---- configurable time between questions ---- */
const hostCSocket = ioc(base, { extraHeaders: { Cookie: cookieB }, transports: ["websocket"] });
await new Promise(r => hostCSocket.on("connect", r));
const gapGame = await new Promise(r => hostCSocket.emit("host:create", {
  quiz: {
    title: "Gap Test",
    gapSeconds: 2,
    questions: [
      { q: "one", t: 6, opts: ["a", "b"], correct: 0 },
      { q: "two", t: 6, opts: ["a", "b"], correct: 0 }
    ]
  }
}, r));
check("gap game opens", /^\d{4}$/.test(gapGame.pin || ""), JSON.stringify(gapGame));

const gapPlayer = ioc(base, { transports: ["websocket"] });
await new Promise(r => gapPlayer.on("connect", r));
await new Promise(r => gapPlayer.emit("player:join", { pin: gapGame.pin, name: "Gapper" }, r));

const gapQ1 = waitFor(gapPlayer, "state", s => s.phase === "question" && s.qIndex === 0);
hostCSocket.emit("host:start");
await gapQ1;
await sleep(100);

const gapScores = waitFor(hostCSocket, "scores", () => true);
await new Promise(r => gapPlayer.emit("player:answer", { answer: 0 }, r));
await gapScores;
const gapT0 = Date.now();

const gapQ2 = waitFor(gapPlayer, "state", s => s.phase === "question" && s.qIndex === 1);
await gapQ2;
const gapElapsed = Date.now() - gapT0;
check("custom gapSeconds shortens the pause between questions",
  gapElapsed >= 1500 && gapElapsed < 4000, "elapsed=" + gapElapsed + "ms");

hostCSocket.emit("host:end");
gapPlayer.disconnect();
hostCSocket.disconnect();

/* ---- image uploads and Giphy search ---- */
const pngUpload = await (await fetch(base + "/api/uploads/image", {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ dataUrl: TINY_PNG })
})).json();
check("PNG upload returns an /uploads/ URL", /^\/uploads\/[\w-]+\.png$/.test(pngUpload.url || ""), JSON.stringify(pngUpload));

const gifUpload = await (await fetch(base + "/api/uploads/image", {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ dataUrl: TINY_GIF })
})).json();
check("GIF upload returns an /uploads/ URL", /^\/uploads\/[\w-]+\.gif$/.test(gifUpload.url || ""), JSON.stringify(gifUpload));

const servedGif = await fetch(base + gifUpload.url);
check("uploaded GIF is served back with the right content type",
  servedGif.status === 200 && servedGif.headers.get("content-type") === "image/gif",
  servedGif.status + " " + servedGif.headers.get("content-type"));

const badUpload = await fetch(base + "/api/uploads/image", {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ dataUrl: "not-a-data-uri" })
});
check("garbage upload is rejected", badUpload.status === 400, "got " + badUpload.status);

const uploadNoAuth = await fetch(base + "/api/uploads/image", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ dataUrl: TINY_PNG })
});
check("upload needs auth", uploadNoAuth.status === 401, "got " + uploadNoAuth.status);

/* No GIPHY_API_KEY in the test env, so this exercises the "not configured"
   path rather than a real Giphy call. */
const giphyNoKey = await fetch(base + "/api/giphy/search?q=cat", { headers: { Cookie: cookie } });
check("Giphy search without an API key fails clearly", giphyNoKey.status === 501, "got " + giphyNoKey.status);
check("Giphy not-configured error carries a translatable code", (await giphyNoKey.json()).code === "giphy_no_key");

/* ---- host socket, host A ---- */
const hostSocket = ioc(base, { extraHeaders: { Cookie: cookie }, transports: ["websocket"] });
await new Promise(r => hostSocket.on("connect", r));

const quiz = {
  title: "Smoke Test",
  questions: [
    { q: "Fast one", t: 6, opts: ["Right", "Wrong", "Also wrong", "Nope"], correct: 0, img: pngUpload.url },
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
check("a refused join carries a translatable code and the PIN", ghostRes.code === "no_pin" && ghostRes.pin === "0000", JSON.stringify(ghostRes));

/* Malformed emits from any client used to throw out of socket.io and kill
   the process (and every game on it): a null payload skips a destructuring
   default, and a non-function in the ack slot throws on ack?.(). The game
   above must still be alive and answering afterwards. */
ghost.emit("player:join", null);
ghost.emit("player:answer", null);
ghost.emit("host:kick", null);
ghost.emit("player:join", { pin: "0000" }, "not-a-callback");
ghost.emit("host:start", null, 42);
await sleep(150);
const aliveRes = await new Promise(r => ghost.emit("player:join", { pin: "0000", name: "X" }, r));
check("server survives null payloads and non-function acks", aliveRes?.code === "no_pin", JSON.stringify(aliveRes));
const health = await (await fetch(base + "/api/health")).json();
check("the live game is still registered after malformed emits", health.games >= 1, JSON.stringify(health));
ghost.disconnect();

/* ---- question one ---- */
const reveals = [];
hostSocket.on("reveal", d => reveals.push(d));
const scoreEvents = [];
hostSocket.on("scores", d => scoreEvents.push(d));
const finals = [];
hostSocket.on("final", d => finals.push(d));

const hostQ1 = waitFor(hostSocket, "state", s => s.phase === "question");
const q1 = waitFor(players[0].socket, "state", s => s.phase === "question");
hostSocket.emit("host:start");   // deliberately no ack: guards the short-circuit bug
const [hostQ1State, playerQ1State] = await Promise.all([hostQ1, q1]);
await sleep(120);

check("a question's picture reaches the host through the normal state broadcast",
  hostQ1State.question?.img === pngUpload.url, JSON.stringify(hostQ1State.question));
check("a question's picture now reaches player devices too (used to be host-only)",
  playerQ1State.question?.img === pngUpload.url, JSON.stringify(playerQ1State.question));

/* Ana answers correctly and fast, Kostas correctly but slow, Marta wrong. */
await new Promise(r => players[0].socket.emit("player:answer", { answer: 0 }, r));
await sleep(1500);
await new Promise(r => players[1].socket.emit("player:answer", { answer: 0 }, r));
const twice = await new Promise(r => players[0].socket.emit("player:answer", { answer: 1 }, r));
check("double answering is blocked", Boolean(twice.error), JSON.stringify(twice));
await new Promise(r => players[2].socket.emit("player:answer", { answer: 2 }, r));

await sleep(1200);
check("question one revealed", reveals.length === 1, "reveals=" + reveals.length);
check("reveal reports the right answer index", reveals[0]?.correct === 0);
check("answer distribution counted", JSON.stringify(reveals[0]?.counts) === "[2,0,1,0]", JSON.stringify(reveals[0]?.counts));
check("two of three got it right", reveals[0]?.gotItRight === 2);
check("fastest correct answer is called out", reveals[0]?.fastestCorrect?.name === "Ana", JSON.stringify(reveals[0]?.fastestCorrect));

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
await Promise.all(players.map(p => new Promise(r => p.socket.emit("player:answer", { answer: 1 }, r))));
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

const csvRows = text.trim().split("\r\n");
check("CSV header lists each question", csvRows[0].includes('"Q1: Fast one"') && csvRows[0].includes('"Q2: Second one"'), csvRows[0]);
const rowFor = name => csvRows.slice(1).find(r => r.split(",")[1] === `"${name}"`);
const perQ = row => row.split(",").slice(6).join(",");
check("CSV marks Ana right on both questions", perQ(rowFor("Ana")) === '"Right","Right"', rowFor("Ana"));
check("CSV marks Kostas right on both questions", perQ(rowFor("Kostas")) === '"Right","Right"', rowFor("Kostas"));
check("CSV marks Marta wrong then right", perQ(rowFor("Marta")) === '"Wrong","Right"', rowFor("Marta"));

const csvFr = await (await fetch(base + "/api/sessions/" + sessionId + "/csv?lang=fr", { headers: { Cookie: cookie } })).text();
/* The export opens with a UTF-8 BOM (so Excel reads accents right); strip it before matching. */
const csvFrRows = csvFr.replace(/^\uFEFF/, "").trim().split("\r\n");
check("CSV headers follow ?lang", csvFrRows[0].startsWith('"Rang","Nom"') && csvFrRows[0].includes('"Q1: Fast one"'), csvFrRows[0]);
check("CSV outcome cells follow ?lang", csvFrRows.slice(1).some(r => r.endsWith('"Faux","Juste"')), csvFr);
const csvBogus = await (await fetch(base + "/api/sessions/" + sessionId + "/csv?lang=xx", { headers: { Cookie: cookie } })).text();
check("an unknown CSV language falls back to English", csvBogus.replace(/^\uFEFF/, "").startsWith('"Rank"'), csvBogus.slice(0, 40));

const history = await (await fetch(base + "/api/sessions", { headers: { Cookie: cookie } })).json();
check("session appears in history", history.some(s => s.id === sessionId));

/* ---- dashboard stats ---- */
const statsOverview = await (await fetch(base + "/api/stats/overview", { headers: { Cookie: cookie } })).json();
check("stats overview counts this host's one completed game", statsOverview.games === 1, JSON.stringify(statsOverview));
check("stats overview sums players across the game", statsOverview.totalPlayers === 3, JSON.stringify(statsOverview));
check("stats overview counts this host's one saved quiz", statsOverview.quizzes === 1, JSON.stringify(statsOverview));

const statsByQuiz = await (await fetch(base + "/api/stats/quizzes", { headers: { Cookie: cookie } })).json();
const adhoc = statsByQuiz.find(q => q.quizId === null);
check("an ad-hoc (unsaved) quiz still gets its own bucket in the per-quiz stats", Boolean(adhoc), JSON.stringify(statsByQuiz));
check("per-quiz stats title falls back to the session title", adhoc?.title === "Smoke Test", JSON.stringify(adhoc));
check("per-quiz stats count the one game played", adhoc?.games === 1, JSON.stringify(adhoc));
check("per-quiz totalPlayers isn't inflated by the results-join fan-out (3, not 3x results rows)", adhoc?.totalPlayers === 3, JSON.stringify(adhoc));
check("per-quiz accuracy blends both questions (5 of 6 correct)", adhoc?.accuracy === 83, JSON.stringify(adhoc));
check("groupKey for an ad-hoc quiz is derived from its title", adhoc?.groupKey === "t:Smoke Test", JSON.stringify(adhoc));

const groupKey = encodeURIComponent(adhoc.groupKey);

const oneQuiz = await (await fetch(base + "/api/stats/quizzes/" + groupKey, { headers: { Cookie: cookie } })).json();
check("single-quiz stats endpoint matches the list entry", oneQuiz?.games === adhoc.games && oneQuiz?.totalPlayers === adhoc.totalPlayers, JSON.stringify({ oneQuiz, adhoc }));

const missingQuiz = await fetch(base + "/api/stats/quizzes/" + encodeURIComponent("t:Nonexistent"), { headers: { Cookie: cookie } });
const missingQuizBody = await missingQuiz.json();
check("single-quiz stats endpoint returns null for an unknown bucket", missingQuiz.status === 200 && missingQuizBody === null, JSON.stringify(missingQuizBody));

const badKey = await fetch(base + "/api/stats/quizzes/not-a-number/sessions", { headers: { Cookie: cookie } });
check("a malformed group key is rejected", badKey.status === 400, "got " + badKey.status);

const quizSessions = await (await fetch(base + "/api/stats/quizzes/" + groupKey + "/sessions", { headers: { Cookie: cookie } })).json();
check("drilling into the quiz lists its one session", quizSessions.length === 1 && quizSessions[0].id === sessionId, JSON.stringify(quizSessions));

const quizQuestions = await (await fetch(base + "/api/stats/quizzes/" + groupKey + "/questions", { headers: { Cookie: cookie } })).json();
const q1Stats = quizQuestions.find(q => q.q === "Fast one");
const q2Stats = quizQuestions.find(q => q.q === "Second one");
check("question breakdown finds both questions", Boolean(q1Stats) && Boolean(q2Stats), JSON.stringify(quizQuestions));
check("hardest question reflects Marta's miss", q1Stats?.right === 2 && q1Stats?.wrong === 1 && q1Stats?.accuracy === 67, JSON.stringify(q1Stats));
check("easy question shows everyone right", q2Stats?.right === 3 && q2Stats?.accuracy === 100, JSON.stringify(q2Stats));

const otherHostSessions = await (await fetch(base + "/api/stats/quizzes/" + groupKey + "/sessions", { headers: { Cookie: cookieB } })).json();
check("dashboard stats are scoped per host, not shared", otherHostSessions.every(s => s.id !== sessionId), JSON.stringify(otherHostSessions));

const statsNoAuth = await fetch(base + "/api/stats/overview");
check("dashboard stats require a signed-in host", statsNoAuth.status === 401, "got " + statsNoAuth.status);

/* ---- dashboard stats: a second, differently-titled ad-hoc quiz must not
   get merged into the first one just because both have quiz_id NULL ---- */
const hostSocket2 = ioc(base, { extraHeaders: { Cookie: cookie }, transports: ["websocket"] });
await new Promise(r => hostSocket2.on("connect", r));
const secondAdhocQuiz = { title: "Second Ad-hoc", questions: [{ q: "Only one", t: 6, opts: ["Right", "Wrong"], correct: 0 }] };
const secondGame = await new Promise(r => hostSocket2.emit("host:create", { quiz: secondAdhocQuiz }, r));
const soloPlayer = ioc(base, { transports: ["websocket"] });
await new Promise(r => soloPlayer.on("connect", r));
await new Promise(r => soloPlayer.emit("player:join", { pin: secondGame.pin, name: "Solo" }, r));
const secondFinal = waitFor(hostSocket2, "final", () => true);
const secondQ = waitFor(soloPlayer, "state", s => s.phase === "question");
hostSocket2.emit("host:start");
await secondQ;
await sleep(120);
await new Promise(r => soloPlayer.emit("player:answer", { answer: 0 }, r));
await sleep(600);
await secondFinal;
await sleep(FLOW.revealMs + 500);
soloPlayer.disconnect();
hostSocket2.disconnect();

const statsByQuizAfter = await (await fetch(base + "/api/stats/quizzes", { headers: { Cookie: cookie } })).json();
const nullBuckets = statsByQuizAfter.filter(q => q.quizId === null);
check("two differently-titled ad-hoc quizzes get separate dashboard buckets", nullBuckets.length === 2, JSON.stringify(nullBuckets));
const secondBucket = nullBuckets.find(q => q.title === "Second Ad-hoc");
check("the new ad-hoc quiz's own bucket has its own game count", secondBucket?.games === 1, JSON.stringify(secondBucket));
const firstBucketAfter = nullBuckets.find(q => q.title === "Smoke Test");
check("the original ad-hoc quiz's game count is unaffected by the second one",
  firstBucketAfter?.games === 1 && firstBucketAfter?.totalPlayers === 3, JSON.stringify(firstBucketAfter));

/* ---- dashboard stats: an abandoned (never-ended) session must not leak
   its title or timestamp into a bucket it doesn't actually count toward ---- */
store.sessions.open("9999", null, "Smoke Test", hostA.id);
const statsAfterAbandoned = await (await fetch(base + "/api/stats/quizzes", { headers: { Cookie: cookie } })).json();
const bucketAfterAbandoned = statsAfterAbandoned.find(q => q.quizId === null && q.title === "Smoke Test");
check("an abandoned, never-finished session doesn't count toward games played", bucketAfterAbandoned?.games === 1, JSON.stringify(bucketAfterAbandoned));
check("an abandoned session's timestamp doesn't leak in as the bucket's last-played date",
  bucketAfterAbandoned?.lastPlayed === firstBucketAfter?.lastPlayed, JSON.stringify({ bucketAfterAbandoned, firstBucketAfter }));

/* ---- new question types: multi-select, unscored text, numeric guess,
   and per-player shuffled answer order ---- */
const hostSocket3 = ioc(base, { extraHeaders: { Cookie: cookie }, transports: ["websocket"] });
await new Promise(r => hostSocket3.on("connect", r));

const typesReveals = [];
hostSocket3.on("reveal", d => typesReveals.push(d));
const hostQ0States = [];
hostSocket3.on("state", s => { if (s.phase === "question" && s.qIndex === 0) hostQ0States.push(s); });

const typesGame = await new Promise(r => hostSocket3.emit("host:create", {
  quiz: {
    title: "Types Test",
    questions: [
      { type: "single", q: "Single", t: 8, opts: ["A", "B", "C", "D"], correct: 1, shuffle: true },
      { type: "multi", q: "Multi", t: 8, opts: ["A", "B", "C", "D"], correct: [0, 2] },
      { type: "text", q: "Text", t: 8 },
      { type: "numeric", q: "Numeric", t: 8, target: 50, tolerance: 5 }
    ]
  }
}, r));
check("types game opens", /^\d{4}$/.test(typesGame.pin || ""), JSON.stringify(typesGame));

const typer = ioc(base, { transports: ["websocket"] });
await new Promise(r => typer.on("connect", r));
const typerResults = [];
typer.on("result", d => typerResults.push(d));

const offer = ioc(base, { transports: ["websocket"] });
await new Promise(r => offer.on("connect", r));
const offerResults = [];
offer.on("result", d => offerResults.push(d));

await new Promise(r => typer.emit("player:join", { pin: typesGame.pin, name: "Typer" }, r));
await new Promise(r => offer.emit("player:join", { pin: typesGame.pin, name: "Off" }, r));

/* Q0: single, shuffled. Each player's own view is shuffled independently,
   so both look up where the correct option ("B", canonical index 1) landed
   for them rather than assuming a fixed position. */
const typerQ0 = waitFor(typer, "state", s => s.phase === "question" && s.qIndex === 0);
const offerQ0 = waitFor(offer, "state", s => s.phase === "question" && s.qIndex === 0);
hostSocket3.emit("host:start");
const [typerState0, offerState0] = await Promise.all([typerQ0, offerQ0]);
check("shuffled question tells the player it's shuffled", typerState0.question.shuffle === true, JSON.stringify(typerState0.question));
await sleep(150);
check("host's own view stays in canonical (unshuffled) order",
  JSON.stringify(hostQ0States[0]?.question.opts) === JSON.stringify(["A", "B", "C", "D"]),
  JSON.stringify(hostQ0States[0]?.question));

const typerPos0 = typerState0.question.opts.indexOf("B");
const offerPos0 = offerState0.question.opts.indexOf("C"); // deliberately wrong
await new Promise(r => typer.emit("player:answer", { answer: typerPos0 }, r));
await new Promise(r => offer.emit("player:answer", { answer: offerPos0 }, r));
await sleep(900);
check("shuffled single-choice still scores against the canonical correct answer",
  typerResults[0]?.correct === true && offerResults[0]?.correct === false,
  JSON.stringify([typerResults[0], offerResults[0]]));

/* Q1: multi-select, all-or-nothing. */
hostSocket3.emit("host:next"); await sleep(150);   // reveal -> scores
const typerQ1 = waitFor(typer, "state", s => s.phase === "question" && s.qIndex === 1);
hostSocket3.emit("host:next");                      // scores -> ask(1)
await typerQ1;
await sleep(100);
await new Promise(r => typer.emit("player:answer", { answer: [0, 2] }, r));  // exact set: correct
await new Promise(r => offer.emit("player:answer", { answer: [0] }, r));     // partial: wrong
await sleep(900);
check("multi-select exact correct set scores correct", typerResults[1]?.correct === true, JSON.stringify(typerResults[1]));
check("multi-select partial pick scores wrong, not partial credit", offerResults[1]?.correct === false, JSON.stringify(offerResults[1]));
check("multi reveal reports counts per option and the correct set",
  typesReveals[1]?.type === "multi" && JSON.stringify(typesReveals[1]?.correct) === "[0,2]" && typesReveals[1]?.counts?.length === 4,
  JSON.stringify(typesReveals[1]));

/* Q2: unscored text - collected, never scored. */
hostSocket3.emit("host:next"); await sleep(150);
const typerQ2 = waitFor(typer, "state", s => s.phase === "question" && s.qIndex === 2);
hostSocket3.emit("host:next");
await typerQ2;
await sleep(100);
await new Promise(r => typer.emit("player:answer", { answer: "typer text" }, r));
await new Promise(r => offer.emit("player:answer", { answer: "off text" }, r));
await sleep(900);
check("unscored text answer reports correct: null and no points",
  typerResults[2]?.correct === null && typerResults[2]?.points === 0, JSON.stringify(typerResults[2]));
check("text reveal collects every response for the host to read",
  typesReveals[2]?.type === "text" && typesReveals[2]?.responses?.length === 2,
  JSON.stringify(typesReveals[2]));

/* Q3: numeric guess, within/outside tolerance. */
hostSocket3.emit("host:next"); await sleep(150);
const typerQ3 = waitFor(typer, "state", s => s.phase === "question" && s.qIndex === 3);
hostSocket3.emit("host:next");
await typerQ3;
await sleep(100);
await new Promise(r => typer.emit("player:answer", { answer: 52 }, r));   // within tolerance (target 50 +/-5)
await new Promise(r => offer.emit("player:answer", { answer: 100 }, r)); // outside
await sleep(900);
check("numeric guess within tolerance scores correct", typerResults[3]?.correct === true, JSON.stringify(typerResults[3]));
check("numeric guess outside tolerance scores wrong", offerResults[3]?.correct === false, JSON.stringify(offerResults[3]));
check("numeric reveal sorts guesses by closeness to the target",
  typesReveals[3]?.type === "numeric" && typesReveals[3]?.guesses?.[0]?.name === "Typer",
  JSON.stringify(typesReveals[3]));

const typesFinal = waitFor(hostSocket3, "final", () => true);
hostSocket3.emit("host:next");   // last question's reveal -> end()
const typesFinalPayload = await typesFinal;

const typesCsv = await fetch(base + "/api/sessions/" + typesFinalPayload.sessionId + "/csv", { headers: { Cookie: cookie } });
const typesCsvText = await typesCsv.text();
const typesRows = typesCsvText.trim().split("\r\n");
check("CSV header lists all four question types",
  typesRows[0].includes('"Q1: Single"') && typesRows[0].includes('"Q2: Multi"') &&
  typesRows[0].includes('"Q3: Text"') && typesRows[0].includes('"Q4: Numeric"'),
  typesRows[0]);
const typesRowFor = name => typesRows.slice(1).find(r => r.split(",")[1] === `"${name}"`);
const typesPerQ = row => row.split(",").slice(6).join(",");
check("CSV logs Typer right on every scored question plus their literal text answer",
  typesPerQ(typesRowFor("Typer")) === '"Right","Right","typer text","Right"', typesRowFor("Typer"));
check("CSV logs Off wrong on every scored question plus their literal text answer",
  typesPerQ(typesRowFor("Off")) === '"Wrong","Wrong","off text","Wrong"', typesRowFor("Off"));

/* ---- delivery mode: a quiz saved as 'selfpaced' mints a share token and
   can't be opened as a live lobby ---- */
const spQuiz = await (await fetch(base + "/api/quizzes", {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({
    title: "Self-Paced Test",
    deliveryMode: "selfpaced",
    questions: [
      { type: "single", q: "SP single", t: 20, opts: ["A", "B"], correct: 0 },
      { type: "multi", q: "SP multi", t: 20, opts: ["A", "B", "C"], correct: [0, 1] },
      { type: "text", q: "SP text", t: 20 },
      { type: "numeric", q: "SP numeric", t: 20, target: 7, tolerance: 1 }
    ]
  })
})).json();
check("a self-paced quiz gets a share token when saved", typeof spQuiz.shareToken === "string" && spQuiz.shareToken.length > 10, JSON.stringify(spQuiz));
check("delivery mode round-trips as selfpaced", spQuiz.deliveryMode === "selfpaced", JSON.stringify(spQuiz));

const liveAttempt = await new Promise(r => hostSocket3.emit("host:create", { quiz: spQuiz, quizId: spQuiz.id }, r));
check("a self-paced quiz refuses to open as a live lobby", Boolean(liveAttempt.error), JSON.stringify(liveAttempt));

const spMeta = await (await fetch(base + "/api/selfpaced/" + spQuiz.shareToken)).json();
check("self-paced metadata is public (no auth) and reports the right total", spMeta.title === "Self-Paced Test" && spMeta.total === 4, JSON.stringify(spMeta));

const badToken = await fetch(base + "/api/selfpaced/not-a-real-token");
check("an unknown self-paced token 404s", badToken.status === 404, "got " + badToken.status);

const spStart = await (await fetch(base + "/api/selfpaced/" + spQuiz.shareToken + "/start", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Self Pacer" })
})).json();
check("starting a self-paced attempt returns the first question with no answer key",
  Boolean(spStart.attemptId) && spStart.question?.q === "SP single" && spStart.question.correct === undefined,
  JSON.stringify(spStart));

const spAnswer = answer => fetch(base + "/api/selfpaced/attempts/" + spStart.attemptId + "/answer", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer })
}).then(r => r.json());

const spR1 = await spAnswer(0); // single correct
check("self-paced single answer scores flat BASE points, no speed bonus", spR1.correct === true && spR1.points === 600, JSON.stringify(spR1));
const spR2 = await spAnswer([0, 1]); // multi correct
check("self-paced multi answer scores correct", spR2.correct === true, JSON.stringify(spR2));
const spR3 = await spAnswer("hello from self-paced"); // text unscored
check("self-paced text answer is unscored", spR3.correct === null && spR3.points === 0, JSON.stringify(spR3));
const spR4 = await spAnswer(8); // numeric within tolerance (target 7 +/-1)
check("self-paced attempt finishes after the last question and reports done", spR4.done === true && spR4.next === null, JSON.stringify(spR4));
check("self-paced running score reflects three correct answers", spR4.score === 1800 && spR4.correctCount === 3, JSON.stringify(spR4));

const spSessions = await (await fetch(base + "/api/stats/quizzes/" + spQuiz.id + "/sessions", { headers: { Cookie: cookie } })).json();
check("the finished self-paced attempt lands in the quiz's own dashboard bucket", spSessions.length === 1, JSON.stringify(spSessions));

const spSessionDetail = await (await fetch(base + "/api/sessions/" + spSessions[0].id, { headers: { Cookie: cookie } })).json();
check("the persisted self-paced session is tagged with mode 'selfpaced'", spSessionDetail.mode === "selfpaced", JSON.stringify(spSessionDetail));
check("the self-paced result carries the player's name and score",
  spSessionDetail.results[0]?.name === "Self Pacer" && spSessionDetail.results[0]?.score === 1800, JSON.stringify(spSessionDetail.results));

const spAnswerAfterDone = await spAnswer(0);
check("answering after an attempt is finished is rejected", Boolean(spAnswerAfterDone.error), JSON.stringify(spAnswerAfterDone));

/* ---- self-paced stale-answer guard: a retried submission tagged with a
   qIndex the attempt has already moved past must be rejected, not
   silently scored against whatever question came next (a real bug this
   session, since self-paced advances the instant one valid answer lands,
   unlike the live game where a question stays open until the host moves
   on) ---- */
const staleStart = await (await fetch(base + "/api/selfpaced/" + spQuiz.shareToken + "/start", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Stale Tester" })
})).json();
const staleAnswer = (answer, qIndex) => fetch(base + "/api/selfpaced/attempts/" + staleStart.attemptId + "/answer", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer, qIndex })
}).then(r => r.json());

const staleFirst = await staleAnswer(0, staleStart.question.qIndex);
check("a correctly-tagged qIndex is accepted", staleFirst.correct === true, JSON.stringify(staleFirst));
const staleRetry = await staleAnswer(0, staleStart.question.qIndex);
check("a retried answer tagged with a stale qIndex is rejected, not scored against the next question",
  Boolean(staleRetry.error), JSON.stringify(staleRetry));

/* ---- self-paced sweeper: mirrors the live game's own "keeps history
   clean" rule (store.sessions.close in server/db.js) - an attempt that
   never engaged at all shouldn't land in history just because it timed
   out, but one that answered at least a single question before being
   abandoned should be persisted as-is. ---- */
const ghostStart = await (await fetch(base + "/api/selfpaced/" + spQuiz.shareToken + "/start", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Ghost" })
})).json();
const ghostAttempt = attempts.get(ghostStart.attemptId);
ghostAttempt.touchedAt = Date.now() - 4 * 60 * 60 * 1000; // past the 3h cutoff, never answered anything

const halfStart = await (await fetch(base + "/api/selfpaced/" + spQuiz.shareToken + "/start", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "HalfDone" })
})).json();
await fetch(base + "/api/selfpaced/attempts/" + halfStart.attemptId + "/answer", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ answer: 0, qIndex: halfStart.question.qIndex })
});
const halfAttempt = attempts.get(halfStart.attemptId);
halfAttempt.touchedAt = Date.now() - 4 * 60 * 60 * 1000;

attempts.sweep();

const ghostSession = store.sessions.get(ghostAttempt.sessionId, hostA.id);
check("a zero-engagement abandoned attempt is swept without being persisted (ended_at stays null)",
  ghostSession.ended_at === null, JSON.stringify(ghostSession));
const halfSession = store.sessions.get(halfAttempt.sessionId, hostA.id);
check("an abandoned attempt that answered at least one question is persisted by the sweep",
  halfSession.ended_at !== null && halfSession.results[0]?.answered === 1, JSON.stringify(halfSession));

typer.disconnect();
offer.disconnect();
hostSocket3.disconnect();

/* ---- shuffle x multi-select together: translateAnswer()'s multi branch
   (mapping a whole array of shown positions through optOrder) is only
   exercised by this combination - single+shuffle and multi+no-shuffle
   above don't reach it. ---- */
const hostSocket4 = ioc(base, { extraHeaders: { Cookie: cookie }, transports: ["websocket"] });
await new Promise(r => hostSocket4.on("connect", r));
const shuffleMultiGame = await new Promise(r => hostSocket4.emit("host:create", {
  quiz: { title: "Shuffle Multi Test", questions: [
    { type: "multi", q: "Pick even", t: 10, opts: ["1", "2", "3", "4"], correct: [1, 3], shuffle: true }
  ] }
}, r));
const smPlayer = ioc(base, { transports: ["websocket"] });
await new Promise(r => smPlayer.on("connect", r));
const smQ = waitFor(smPlayer, "state", s => s.phase === "question");
const smResultP = waitFor(smPlayer, "result", () => true);
await new Promise(r => smPlayer.emit("player:join", { pin: shuffleMultiGame.pin, name: "Shuffler" }, r));
hostSocket4.emit("host:start");
const smState = await smQ;
const shownPositions = ["2", "4"].map(v => smState.question.opts.indexOf(v));
await new Promise(r => smPlayer.emit("player:answer", { answer: shownPositions }, r));
const smResult = await smResultP;
check("shuffled multi-select still scores against the canonical correct set",
  smResult.correct === true && JSON.stringify(smResult.yourTexts.slice().sort()) === '["2","4"]',
  JSON.stringify(smResult));
smPlayer.disconnect();
hostSocket4.disconnect();

/* ---- host resume, kicks, rejoin lock-in, finished-game cleanup, CSV
   formula guard ---- */
const joinAs = async (pin, name, playerId) => {
  const sock = ioc(base, { transports: ["websocket"] });
  await new Promise(r => sock.on("connect", r));
  const res = await new Promise(r => sock.emit("player:join", { pin, name, playerId }, r));
  return { sock, res };
};
const rHost = ioc(base, { extraHeaders: { Cookie: cookie }, transports: ["websocket"] });
await new Promise(r => rHost.on("connect", r));
const rQuiz = { title: "Resume Test", questions: [
  { q: "R1", t: 30, opts: ["a", "b"], correct: 0 },
  { q: "R2", t: 30, opts: ["a", "b"], correct: 1 }
] };
const rGame = await new Promise(r => rHost.emit("host:create", { quiz: rQuiz }, r));
const formula = await joinAs(rGame.pin, "=SUM(A1:A9)");
const waiter = await joinAs(rGame.pin, "Waiter");
const doomed = await joinAs(rGame.pin, "Doomed");

await new Promise(r => rHost.emit("host:kick", { playerId: doomed.res.playerId }, r));
const roomIds = (await serverIo.in("g:" + rGame.pin).fetchSockets()).map(x => x.id);
check("a kicked player's socket leaves the game room", !roomIds.includes(doomed.sock.id) && roomIds.includes(waiter.sock.id), JSON.stringify(roomIds));
const kickedAnswer = await new Promise(r => doomed.sock.emit("player:answer", { answer: 0 }, r));
check("a kicked socket can no longer act as a player", kickedAnswer.code === "not_in_game", JSON.stringify(kickedAnswer));

const rQ1 = waitFor(formula.sock, "state", st => st.phase === "question");
rHost.emit("host:start");
await rQ1;
await new Promise(r => formula.sock.emit("player:answer", { answer: 0 }, r));
/* Same player, new socket (a reload): told it already answered, and a
   resubmission is refused with a code the phone treats as locked in. */
formula.sock.disconnect();
const rejoined = await joinAs(rGame.pin, "=SUM(A1:A9)", formula.res.playerId);
check("a player rejoining after answering is told so", rejoined.res.state.youAnswered === true, JSON.stringify(rejoined.res.state));
const reAnswer = await new Promise(r => rejoined.sock.emit("player:answer", { answer: 1 }, r));
check("a resubmission after rejoining is refused as already_answered", reAnswer.code === "already_answered", JSON.stringify(reAnswer));

/* The host's socket drops: a fresh socket resumes control of the game. */
rHost.disconnect();
const rHost2 = ioc(base, { extraHeaders: { Cookie: cookie }, transports: ["websocket"] });
await new Promise(r => rHost2.on("connect", r));
const resumed = await new Promise(r => rHost2.emit("host:resume", { pin: rGame.pin }, r));
check("host resume lands on the live question", resumed.state?.phase === "question" && resumed.state.qIndex === 0 && resumed.total === 2, JSON.stringify(resumed).slice(0, 200));
check("host resume reports answers so far", resumed.answered?.answered === 1, JSON.stringify(resumed.answered));
const otherHost = ioc(base, { extraHeaders: { Cookie: cookieB }, transports: ["websocket"] });
await new Promise(r => otherHost.on("connect", r));
const stolen = await new Promise(r => otherHost.emit("host:resume", { pin: rGame.pin }, r));
check("another host cannot resume someone else's game", stolen.code === "no_game", JSON.stringify(stolen));
otherHost.disconnect();
const anon = ioc(base, { transports: ["websocket"] });
await new Promise(r => anon.on("connect", r));
const anonResume = await new Promise(r => anon.emit("host:resume", { pin: rGame.pin }, r));
check("a signed-out socket cannot resume a game", anonResume.code === "auth", JSON.stringify(anonResume));
anon.disconnect();

const rReveal = waitFor(rHost2, "reveal", () => true);
const skipRes = await new Promise(r => rHost2.emit("host:skip", null, r));
check("a resumed host socket can drive the game", skipRes.ok === true, JSON.stringify(skipRes));
await rReveal;
const resumedReveal = await new Promise(r => rHost2.emit("host:resume", { pin: rGame.pin }, r));
check("resuming during the reveal replays the reveal", resumedReveal.state.phase === "reveal" && Array.isArray(resumedReveal.reveal?.counts), JSON.stringify(resumedReveal.reveal));

const rFinal = waitFor(rHost2, "final", () => true);
rHost2.emit("host:end");
const rFinalPayload = await rFinal;
check("a finished game stays reachable during the grace period", Boolean(rooms.get(rGame.pin)));
const resumedFinal = await new Promise(r => rHost2.emit("host:resume", { pin: rGame.pin }, r));
check("resuming after the end replays the final board", resumedFinal.final?.sessionId === rFinalPayload.sessionId, JSON.stringify(resumedFinal.final));
await sleep(Number(process.env.FINISHED_GRACE_MS) + 500);
check("a finished game is dropped from memory after the grace period", !rooms.get(rGame.pin));

const rCsv = await (await fetch(base + "/api/sessions/" + rFinalPayload.sessionId + "/csv", { headers: { Cookie: cookie } })).text();
check("CSV neutralises a formula-looking player name", rCsv.includes(`"'=SUM(A1:A9)"`) && !rCsv.includes(`"=SUM(A1:A9)"`), rCsv);
check("CSV leaves numeric cells (rank, score) alone", rCsv.includes(`"1","'=SUM(A1:A9)"`), rCsv);
[rejoined, waiter, doomed].forEach(p => p.sock.disconnect());

/* A lobby cancelled before the first question is not a game: players are
   told, nothing lands in history, and the room is freed at once. */
const cGame = await new Promise(r => rHost2.emit("host:create", { quiz: rQuiz }, r));
const cSessionId = rooms.get(cGame.pin).sessionId;
const cPlayer = await joinAs(cGame.pin, "Early");
const cancelledEvent = waitFor(cPlayer.sock, "cancelled", () => true, 3000).then(() => true, () => false);
await new Promise(r => rHost2.emit("host:end", null, r));
check("players in a cancelled lobby are told it was cancelled", await cancelledEvent);
check("a cancelled lobby is dropped from memory immediately", !rooms.get(cGame.pin));
check("a cancelled lobby leaves no session row behind", !store.sessions.get(cSessionId));
const historyAfterCancel = await (await fetch(base + "/api/sessions", { headers: { Cookie: cookie } })).json();
check("a cancelled lobby never shows up in history", !historyAfterCancel.some(x => x.id === cSessionId));
cPlayer.sock.disconnect();
rHost2.disconnect();

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
    { q: "own upload", opts: ["a", "b"], correct: 0, img: "/uploads/123e4567-e89b-42d3-a456-426614174000.png" },
    { q: "giphy pick", opts: ["a", "b"], correct: 0, img: "https://media3.giphy.com/media/xyz/giphy.gif" },
    { q: "raw data-URI no longer accepted", opts: ["a", "b"], correct: 0, img: TINY_PNG },
    { q: "arbitrary https host rejected", opts: ["a", "b"], correct: 0, img: "https://evil.example.com/tracker.gif" },
    { q: "overlong string dropped", opts: ["a", "b"], correct: 0, img: "/uploads/" + "a".repeat(700) + ".png" }
  ]
});
check("an own-server upload URL is kept", withImages.questions[0].img === "/uploads/123e4567-e89b-42d3-a456-426614174000.png");
check("a Giphy CDN URL is kept", withImages.questions[1].img === "https://media3.giphy.com/media/xyz/giphy.gif");
check("a raw base64 data-URI is dropped (pictures live on disk now, not on the question)",
  withImages.questions[2].img === null, String(withImages.questions[2].img));
check("an https URL outside Giphy's CDN is dropped", withImages.questions[3].img === null, String(withImages.questions[3].img));
check("an overlong image URL is dropped", withImages.questions[4].img === null, String(withImages.questions[4].img));

const typedQuiz = sanitiseQuiz({
  title: "Types",
  deliveryMode: "selfpaced",
  questions: [
    { type: "single", q: "unmarked type defaults to single", t: 10, opts: ["a", "b"], correct: 1 },
    { type: "multi", q: "multi with dupes and out-of-range picks", t: 10, opts: ["a", "b", "c"], correct: [0, 0, 1, 99, -1] },
    { type: "multi", q: "multi with no valid picks is dropped", t: 10, opts: ["a", "b"], correct: [] },
    { type: "text", q: "unscored", t: 10 },
    { type: "text", q: "" /* blank text question is dropped, not just a blank opts list */ },
    { type: "numeric", q: "guess it", t: 10, target: "42", tolerance: -5 },
    { type: "numeric", q: "no target given", t: 10 },
    { type: "bogus-type", q: "unknown type falls back to single", t: 10, opts: ["a", "b"], correct: 0 }
  ]
});
check("delivery mode round-trips through sanitiseQuiz", typedQuiz.deliveryMode === "selfpaced", typedQuiz.deliveryMode);
check("unusable typed questions (empty text, no valid picks, no target) are dropped",
  typedQuiz.questions.length === 5, JSON.stringify(typedQuiz.questions.map(q => q.type + ":" + q.q)));
check("multi correct set is deduped, filtered to range, and sorted",
  JSON.stringify(typedQuiz.questions[1].correct) === "[0,1]", JSON.stringify(typedQuiz.questions[1].correct));
check("numeric target coerces from a numeric string", typedQuiz.questions[3].target === 42, String(typedQuiz.questions[3].target));
check("numeric tolerance is clamped to zero or above", typedQuiz.questions[3].tolerance === 0, String(typedQuiz.questions[3].tolerance));
check("an unrecognised question type falls back to single",
  typedQuiz.questions[4]?.type === "single" && typedQuiz.questions[4].q.includes("unknown type"),
  JSON.stringify(typedQuiz.questions.map(q => q.type + ":" + q.q)));

const shuffleOff = sanitiseQuiz({ questions: [{ q: "no shuffle field", t: 10, opts: ["a", "b"], correct: 0 }] });
check("shuffle defaults to false when not given", shuffleOff.questions[0].shuffle === false);
const shuffleOn = sanitiseQuiz({ questions: [{ q: "shuffled", t: 10, opts: ["a", "b"], correct: 0, shuffle: true }] });
check("shuffle is kept when explicitly set", shuffleOn.questions[0].shuffle === true);

/* ---- review hardening: invites, uploads, rate limits ---- */
const jsonHdr = { "Content-Type": "application/json" };

const createdC = await (await fetch(base + "/api/admin/hosts", {
  method: "POST", headers: { ...jsonHdr, Cookie: adminCookie }, body: JSON.stringify({ email: "hostc@smoke.test" })
})).json();
await fetch(base + "/api/admin/hosts/" + createdC.host.id, {
  method: "PATCH", headers: { ...jsonHdr, Cookie: adminCookie }, body: JSON.stringify({ status: "disabled" })
});
await fetch(base + "/api/invite/" + createdC.inviteLink.split("/invite/")[1] + "/complete", {
  method: "POST", headers: jsonHdr, body: JSON.stringify({ password: "hostc-pass-123" })
});
check("completing an old invite does not re-enable a disabled host", store.hosts.get(createdC.host.id).status === "disabled", store.hosts.get(createdC.host.id).status);

const fakePng = await fetch(base + "/api/uploads/image", {
  method: "POST", headers: { ...jsonHdr, Cookie: cookie },
  body: JSON.stringify({ dataUrl: "data:image/png;base64," + Buffer.from("this is not a png").toString("base64") })
});
check("an upload whose bytes aren't the claimed image type is rejected", fakePng.status === 400, "got " + fakePng.status);

const { sweepOrphanUploads } = await import("../server/media.js");
const { config: cfg } = await import("../server/config.js");
const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
const orphanName = "11111111-1111-4111-8111-111111111111.png";
const keptName = "22222222-2222-4222-8222-222222222222.png";
fs.writeFileSync(path.join(cfg.uploadsDir, orphanName), "x");
fs.writeFileSync(path.join(cfg.uploadsDir, keptName), "x");
for (const n of [orphanName, keptName]) fs.utimesSync(path.join(cfg.uploadsDir, n), longAgo, longAgo);
await fetch(base + "/api/quizzes", {
  method: "POST", headers: { ...jsonHdr, Cookie: cookie },
  body: JSON.stringify({ title: "uses a picture", questions: [{ q: "pic", opts: ["a", "b"], correct: 0, img: "/uploads/" + keptName }] })
});
await sweepOrphanUploads();
check("an old unreferenced upload is swept", !fs.existsSync(path.join(cfg.uploadsDir, orphanName)));
check("an old upload still used by a quiz is kept", fs.existsSync(path.join(cfg.uploadsDir, keptName)));
check("a fresh upload is kept even if unreferenced", fs.existsSync(path.join(cfg.uploadsDir, gifUpload.url.split("/").pop())));

/* A whole classroom behind one IP must be able to start self-paced attempts. */
let startStatuses = [];
for (let i = 0; i < 80; i++) {
  const r = await fetch(base + "/api/selfpaced/" + spQuiz.shareToken + "/start", {
    method: "POST", headers: jsonHdr, body: JSON.stringify({ name: "Trainee " + i })
  });
  startStatuses.push(r.status);
}
check("80 self-paced starts from one IP are not rate limited", startStatuses.every(c => c === 201), [...new Set(startStatuses)].join(","));

/* Wrong-PIN guessing is throttled; run last since it locks this IP out for a minute. */
const guesser = ioc(base, { transports: ["websocket"] });
await new Promise(r => guesser.on("connect", r));
const guessCodes = [];
for (let i = 0; i < 12; i++) {
  guessCodes.push((await new Promise(r => guesser.emit("player:join", { pin: "00" + String(i).padStart(2, "0"), name: "x" }, r))).code);
}
check("repeated wrong PINs get throttled", guessCodes[0] === "no_pin" && guessCodes[11] === "rate_pin", guessCodes.join(","));
guesser.disconnect();

/* ---- done ---- */
players.forEach(p => p.socket.disconnect());
hostSocket.disconnect();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log("\n" + (failures ? failures + " CHECK(S) FAILED" : "all checks passed"));
process.exit(failures ? 1 : 0);
