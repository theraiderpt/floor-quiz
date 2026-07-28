import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Server as IOServer } from "socket.io";
import QRCode from "qrcode";

import { config, PUBLIC_DIR } from "./config.js";
import { store } from "./db.js";
import { Rooms, sanitiseQuiz, cleanName } from "./game.js";

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  pingInterval: 20000,
  pingTimeout: 25000,
  maxHttpBufferSize: 1e5
});
const rooms = new Rooms(io);

/* Nginx sits in front, so trust exactly one proxy hop for client IPs. */
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(compression());
app.use(express.json({ limit: "512kb" }));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

/* ---------------------------------------------------------------- auth --- */

const COOKIE = "fq_host";

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  const a = Buffer.from(mac || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function isHost(req) {
  return Boolean(verify(readCookie(req.headers.cookie, COOKIE)));
}

function requireHost(req, res, next) {
  if (!isHost(req)) return res.status(401).json({ error: "Sign in first." });
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait fifteen minutes." }
});

app.post("/api/login", loginLimiter, (req, res) => {
  const given = String(req.body?.password || "");
  const expected = config.hostPassword;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  if (!expected || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "That password is not right." });
  }
  const token = sign({ role: "host", exp: Date.now() + 12 * 60 * 60 * 1000 });
  /* Keyed off the real request scheme, not NODE_ENV. Hard-coding Secure in
     production would make host login fail silently in the window between the
     site coming up on port 80 and certbot issuing the certificate, because
     the browser accepts the response and then discards the cookie.
     `trust proxy` means req.secure already reflects X-Forwarded-Proto. */
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${12 * 60 * 60}; SameSite=Lax${secure}`
  );
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => res.json({ host: isHost(req) }));

/* ------------------------------------------------------------ quizzes --- */

app.get("/api/quizzes", requireHost, (req, res) => res.json(store.quizzes.list()));

app.post("/api/quizzes", requireHost, (req, res) => {
  const { title, questions } = sanitiseQuiz(req.body);
  if (!questions.length) return res.status(400).json({ error: "Add at least one usable question." });
  res.status(201).json(store.quizzes.create(title, questions));
});

app.put("/api/quizzes/:id", requireHost, (req, res) => {
  const id = Number(req.params.id);
  if (!store.quizzes.get(id)) return res.status(404).json({ error: "No such quiz." });
  const { title, questions } = sanitiseQuiz(req.body);
  if (!questions.length) return res.status(400).json({ error: "Add at least one usable question." });
  res.json(store.quizzes.update(id, title, questions));
});

app.delete("/api/quizzes/:id", requireHost, (req, res) => {
  res.json({ ok: store.quizzes.remove(Number(req.params.id)) });
});

/* ----------------------------------------------------------- sessions --- */

app.get("/api/sessions", requireHost, (req, res) => res.json(store.sessions.list(40)));

app.get("/api/sessions/:id", requireHost, (req, res) => {
  const s = store.sessions.get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: "No such session." });
  res.json(s);
});

app.get("/api/sessions/:id/csv", requireHost, (req, res) => {
  const s = store.sessions.get(Number(req.params.id));
  if (!s) return res.status(404).send("No such session.");
  const cell = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["Rank", "Name", "Score", "Correct", "Answered"].map(cell).join(",")];
  s.results.forEach(r =>
    lines.push([r.rank, r.name, r.score, r.correct_count, r.answered].map(cell).join(","))
  );
  const slug = s.title.replace(/[^\w]+/g, "_").slice(0, 40);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}_${s.id}.csv"`);
  res.send("\uFEFF" + lines.join("\r\n"));
});

app.get("/api/health", (req, res) => res.json({ ok: true, ...rooms.stats(), uptime: Math.round(process.uptime()) }));

/* ------------------------------------------------------------- static --- */

app.use(express.static(PUBLIC_DIR, { maxAge: config.isProd ? "1h" : 0, extensions: ["html"] }));
app.get("/host", (req, res) => res.sendFile("host.html", { root: PUBLIC_DIR }));
app.get("/play", (req, res) => res.sendFile("index.html", { root: PUBLIC_DIR }));
app.use((req, res) => res.status(404).sendFile("index.html", { root: PUBLIC_DIR }));

/* ----------------------------------------------------------- realtime --- */

io.use((socket, next) => {
  socket.data.isHost = Boolean(verify(readCookie(socket.handshake.headers.cookie, COOKIE)));
  next();
});

io.on("connection", socket => {
  /* ---- host side ---- */

  socket.on("host:create", async (payload, ack) => {
    if (!socket.data.isHost) return ack?.({ error: "Sign in first." });
    const quiz = sanitiseQuiz(payload?.quiz);
    if (!quiz.questions.length) return ack?.({ error: "That quiz has no usable questions." });
    let game;
    try {
      game = rooms.create(quiz, payload?.quizId);
    } catch (err) {
      return ack?.({ error: err.message });
    }
    socket.join(game.room);
    socket.join(game.hostRoom);
    socket.data.pin = game.pin;

    const joinUrl = `${config.publicUrl || ""}/play?pin=${game.pin}`;
    let qr = null;
    if (config.publicUrl) {
      try {
        qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 340, color: { dark: "#101828", light: "#eef2f7" } });
      } catch { /* a missing QR is cosmetic, never fatal */ }
    }
    ack?.({ pin: game.pin, joinUrl, qr, state: game.publicState() });
    game.broadcastLobby();
  });

  const hostGame = () => {
    const g = rooms.get(socket.data.pin);
    return socket.data.isHost && g ? g : null;
  };

  socket.on("host:start", (_, ack) => {
    const g = hostGame();
    if (!g) return ack?.({ error: "No game." });
    /* Evaluate first. `ack?.(g.start())` would skip the call entirely
       whenever the client emitted without a callback. */
    const ok = g.start();
    ack?.({ ok });
  });

  socket.on("host:next", (_, ack) => {
    const g = hostGame();
    if (!g) return ack?.({ error: "No game." });
    const ok = g.next();
    ack?.({ ok });
  });

  socket.on("host:skip", (_, ack) => {
    const g = hostGame();
    if (!g) return ack?.({ error: "No game." });
    g.closeQuestion();
    ack?.({ ok: true });
  });

  socket.on("host:end", (_, ack) => {
    const g = hostGame();
    if (!g) return ack?.({ error: "No game." });
    g.end();
    ack?.({ ok: true });
  });

  socket.on("host:kick", ({ playerId } = {}, ack) => {
    const g = hostGame();
    if (!g) return ack?.({ error: "No game." });
    const p = g.players.get(playerId);
    if (p?.socketId) io.to(p.socketId).emit("kicked");
    g.players.delete(playerId);
    g.broadcastLobby();
    g.broadcastState();
    ack?.({ ok: true });
  });

  /* ---- player side ---- */

  socket.on("player:join", ({ pin, name, playerId } = {}, ack) => {
    const game = rooms.get(String(pin || "").trim());
    if (!game) return ack?.({ error: `No game running on PIN ${pin}.` });

    const res = game.addPlayer(socket, cleanName(name), playerId);
    if (res.error) return ack?.({ error: res.error });

    socket.join(game.room);
    socket.data.pin = game.pin;
    socket.data.playerId = res.player.id;
    rooms.playerIndex.set(socket.id, { pin: game.pin, playerId: res.player.id });

    ack?.({
      playerId: res.player.id,
      name: res.player.name,
      rejoined: res.rejoined,
      score: res.player.score,
      state: game.publicState()
    });
    game.broadcastLobby();
    game.broadcastState();
  });

  socket.on("player:answer", ({ choice } = {}, ack) => {
    const game = rooms.get(socket.data.pin);
    if (!game || !socket.data.playerId) return ack?.({ error: "Not in a game." });
    const outcome = game.submitAnswer(socket.data.playerId, choice);
    ack?.(outcome);
  });

  socket.on("disconnect", () => {
    const ref = rooms.playerIndex.get(socket.id);
    rooms.playerIndex.delete(socket.id);
    const game = rooms.get(socket.data.pin);
    if (!game) return;
    if (ref) {
      game.markDisconnected(socket.id);
      game.broadcastLobby();
      game.broadcastState();
    }
  });
});

/* -------------------------------------------------------------- boot ---- */

server.listen(config.port, config.host, () => {
  console.log(`Floor Quiz listening on http://${config.host}:${config.port} (${config.env})`);
  if (config.publicUrl) console.log(`Players join at ${config.publicUrl}`);
});

function shutdown(signal) {
  console.log(`${signal} received, closing.`);
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app, server, io, rooms };
