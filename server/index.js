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
import { Attempts } from "./selfpaced.js";
import { hashPassword, verifyPassword, randomToken } from "./auth.js";
import { saveImageUpload, searchGiphy } from "./media.js";

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  pingInterval: 20000,
  pingTimeout: 25000,
  /* Raised from the 100KB default. Questions carry only a short image URL
     now (server/media.js), not the picture itself, but a large question
     bank in one host:create payload still benefits from the headroom. */
  maxHttpBufferSize: 8e6
});
const rooms = new Rooms(io);
const attempts = new Attempts();

/* Nginx sits in front, so trust exactly one proxy hop for client IPs. */
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(compression());
/* Raised to match maxHttpBufferSize above, so saving a quiz with pictures
   over plain HTTP (PUT/POST /api/quizzes) isn't rejected either. */
app.use(express.json({ limit: "8mb" }));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        /* data: for the tiny inline QR code and file-picker preview; Giphy's
           CDN for GIFs picked from the search panel (server/media.js proxies
           the search itself, but the picked GIF's own pixels load straight
           from Giphy, not through us). */
        imgSrc: ["'self'", "data:", "https://*.giphy.com"],
        connectSrc: ["'self'", "ws:", "wss:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/* ---------------------------------------------------------------- auth --- */
/* Two roles, one signed cookie. Admin accounts manage hosts/categories/the
   question bank; host accounts build and run quizzes. Password hashing lives
   in ./auth.js (node:crypto scrypt, no native dependency to compile). */

const COOKIE = "fq_auth";
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

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

function currentAuth(req) {
  return verify(readCookie(req.headers.cookie, COOKIE));
}

/* Keyed off the real request scheme, not NODE_ENV. Hard-coding Secure in
   production would make login fail silently in the window between the site
   coming up on port 80 and certbot issuing the certificate, because the
   browser accepts the response and then discards the cookie. `trust proxy`
   means req.secure already reflects X-Forwarded-Proto. */
function setAuthCookie(req, res, payload) {
  const token = sign({ ...payload, exp: Date.now() + 12 * 60 * 60 * 1000 });
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${12 * 60 * 60}; SameSite=Lax${secure}`
  );
}

function clearAuthCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function requireHost(req, res, next) {
  const payload = currentAuth(req);
  const host = payload?.role === "host" ? store.hosts.get(payload.id) : null;
  if (!host || host.status !== "active") return res.status(401).json({ error: "Sign in first." });
  req.hostAccount = { id: host.id, email: host.email, maxPlayers: host.max_players };
  next();
}

function requireAdmin(req, res, next) {
  const payload = currentAuth(req);
  const admin = payload?.role === "admin" ? store.admins.get(payload.id) : null;
  if (!admin) return res.status(401).json({ error: "Sign in first." });
  req.admin = { id: admin.id, email: admin.email };
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait fifteen minutes." }
});
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait fifteen minutes." }
});
const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait fifteen minutes." }
});

app.post("/api/login", loginLimiter, (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const given = String(req.body?.password || "");
  const host = store.hosts.getByEmail(email);
  if (!host || host.status !== "active" || !host.password_hash || !verifyPassword(given, host.password_hash)) {
    return res.status(401).json({ error: "That email or password is not right." });
  }
  setAuthCookie(req, res, { role: "host", id: host.id });
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => { clearAuthCookie(res); res.json({ ok: true }); });

app.get("/api/me", (req, res) => {
  const payload = currentAuth(req);
  const host = payload?.role === "host" ? store.hosts.get(payload.id) : null;
  res.json(host && host.status === "active" ? { host: true, email: host.email } : { host: false });
});

app.post("/api/admin/login", adminLoginLimiter, (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const given = String(req.body?.password || "");
  const admin = store.admins.getByEmail(email);
  if (!admin || !verifyPassword(given, admin.password_hash)) {
    return res.status(401).json({ error: "That email or password is not right." });
  }
  setAuthCookie(req, res, { role: "admin", id: admin.id });
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => { clearAuthCookie(res); res.json({ ok: true }); });

app.get("/api/admin/me", (req, res) => {
  const payload = currentAuth(req);
  const admin = payload?.role === "admin" ? store.admins.get(payload.id) : null;
  res.json(admin ? { admin: true, email: admin.email } : { admin: false });
});

/* ------------------------------------------------------------- invites --- */
/* Public, unauthenticated: a host completes their own invite with just the
   token from the link the admin sent them. */

function inviteStatus(token) {
  const inv = store.invites.getByToken(token);
  const valid = Boolean(inv && !inv.used_at && new Date(inv.expires_at) > new Date());
  return { inv, valid };
}

app.get("/api/invite/:token", inviteLimiter, (req, res) => {
  const { inv, valid } = inviteStatus(req.params.token);
  res.json({ valid, email: valid ? inv.host_email : null });
});

app.post("/api/invite/:token/complete", inviteLimiter, (req, res) => {
  const { inv, valid } = inviteStatus(req.params.token);
  if (!valid) return res.status(400).json({ error: "That invite link is invalid or has expired." });
  const password = String(req.body?.password || "");
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  store.hosts.setPassword(inv.host_id, hashPassword(password));
  store.invites.markUsed(inv.id);
  res.json({ ok: true });
});

/* --------------------------------------------------------- admin: hosts --- */

app.get("/api/admin/hosts", requireAdmin, (req, res) => res.json(store.hosts.list()));

app.post("/api/admin/hosts", requireAdmin, (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (store.hosts.getByEmail(email)) return res.status(409).json({ error: "A host with that email already exists." });
  const maxPlayers = clamp(Number(req.body?.maxPlayers) || 400, 1, 2000);
  const host = store.hosts.create(email, maxPlayers);
  const token = randomToken();
  store.invites.create(host.id, token, new Date(Date.now() + INVITE_TTL_MS).toISOString());
  res.status(201).json({ host, inviteLink: `${config.publicUrl || ""}/invite/${token}` });
});

app.post("/api/admin/hosts/:id/reinvite", requireAdmin, (req, res) => {
  const host = store.hosts.get(Number(req.params.id));
  if (!host) return res.status(404).json({ error: "No such host." });
  const token = randomToken();
  store.invites.create(host.id, token, new Date(Date.now() + INVITE_TTL_MS).toISOString());
  res.json({ inviteLink: `${config.publicUrl || ""}/invite/${token}` });
});

app.patch("/api/admin/hosts/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!store.hosts.get(id)) return res.status(404).json({ error: "No such host." });
  if (req.body?.maxPlayers != null) store.hosts.updateQuota(id, clamp(Number(req.body.maxPlayers) || 400, 1, 2000));
  if (["active", "disabled"].includes(req.body?.status)) store.hosts.setStatus(id, req.body.status);
  res.json(store.hosts.get(id));
});

app.delete("/api/admin/hosts/:id", requireAdmin, (req, res) => {
  res.json({ ok: store.hosts.remove(Number(req.params.id)) });
});

/* ---------------------------------------------------- admin: categories --- */

app.get("/api/admin/categories", requireAdmin, (req, res) => res.json(store.categories.list()));

app.post("/api/admin/categories", requireAdmin, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "Name a category." });
  try {
    res.status(201).json(store.categories.create(name));
  } catch {
    res.status(409).json({ error: "That category already exists." });
  }
});

app.delete("/api/admin/categories/:id", requireAdmin, (req, res) => {
  res.json({ ok: store.categories.remove(Number(req.params.id)) });
});

/* ---------------------------------------------------- admin: bank & overview --- */

app.get("/api/admin/bank", requireAdmin, (req, res) =>
  res.json(store.bank.list(req.query.category ? Number(req.query.category) : null, req.query.q || null))
);

app.post("/api/admin/bank", requireAdmin, (req, res) => {
  const categoryId = Number(req.body?.categoryId);
  if (!store.categories.get(categoryId)) return res.status(400).json({ error: "Pick a valid category." });
  const q = String(req.body?.q || "").trim().slice(0, 200);
  const opts = (Array.isArray(req.body?.opts) ? req.body.opts : [])
    .map(o => String(o || "").trim().slice(0, 120)).filter(Boolean).slice(0, 4);
  if (!q || opts.length < 2) return res.status(400).json({ error: "Add question text and at least two options." });
  const t = clamp(Number(req.body?.t) || 20, 5, 120);
  const correct = clamp(Number(req.body?.correct) || 0, 0, opts.length - 1);
  res.status(201).json(store.bank.create(categoryId, q, t, opts, correct));
});

app.delete("/api/admin/bank/:id", requireAdmin, (req, res) => {
  res.json({ ok: store.bank.remove(Number(req.params.id)) });
});

app.get("/api/admin/games", requireAdmin, (req, res) => res.json(store.sessions.listAll(100)));

app.get("/api/admin/overview", requireAdmin, (req, res) => {
  const hosts = store.hosts.list();
  res.json({
    hosts: hosts.length,
    activeHosts: hosts.filter(h => h.status === "active").length,
    invitedHosts: hosts.filter(h => h.status === "invited").length,
    categories: store.categories.list().length,
    bankQuestions: store.bank.list(null, null).length,
    completedGames: store.sessions.count(),
    live: rooms.stats()
  });
});

/* ---------------------------------------------------- host-facing reads --- */

app.get("/api/categories", requireHost, (req, res) => res.json(store.categories.list()));
app.get("/api/bank", requireHost, (req, res) =>
  res.json(store.bank.list(req.query.category ? Number(req.query.category) : null, req.query.q || null))
);

/* -------------------------------------------------------------- media --- */
/* Both are host-only and rate-limited: the upload writes to disk, the
   Giphy search spends a call against our API key's quota per request. */
const mediaLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Wait a moment." }
});

app.post("/api/uploads/image", requireHost, mediaLimiter, async (req, res) => {
  try {
    const url = await saveImageUpload(req.body?.dataUrl);
    res.status(201).json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/giphy/search", requireHost, mediaLimiter, async (req, res) => {
  try {
    const results = await searchGiphy(String(req.query.q || "").trim().slice(0, 100), req.query.limit);
    res.json({ data: results });
  } catch (err) {
    res.status(err.code === "no_key" ? 501 : 502).json({ error: err.message });
  }
});

/* ------------------------------------------------------------ quizzes --- */

app.get("/api/quizzes", requireHost, (req, res) => res.json(store.quizzes.list(req.hostAccount.id)));

app.post("/api/quizzes", requireHost, (req, res) => {
  const { title, questions, joinMode, gapSeconds, deliveryMode } = sanitiseQuiz(req.body);
  if (!questions.length) return res.status(400).json({ error: "Add at least one usable question." });
  const categoryId = req.body?.categoryId ? Number(req.body.categoryId) : null;
  res.status(201).json(store.quizzes.create(title, questions, req.hostAccount.id, categoryId, joinMode, gapSeconds, deliveryMode));
});

app.put("/api/quizzes/:id", requireHost, (req, res) => {
  const id = Number(req.params.id);
  if (!store.quizzes.get(id, req.hostAccount.id)) return res.status(404).json({ error: "No such quiz." });
  const { title, questions, joinMode, gapSeconds, deliveryMode } = sanitiseQuiz(req.body);
  if (!questions.length) return res.status(400).json({ error: "Add at least one usable question." });
  const categoryId = req.body?.categoryId ? Number(req.body.categoryId) : null;
  res.json(store.quizzes.update(id, title, questions, categoryId, req.hostAccount.id, joinMode, gapSeconds, deliveryMode));
});

app.delete("/api/quizzes/:id", requireHost, (req, res) => {
  res.json({ ok: store.quizzes.remove(Number(req.params.id), req.hostAccount.id) });
});

/* ----------------------------------------------------------- sessions --- */

app.get("/api/sessions", requireHost, (req, res) => res.json(store.sessions.list(req.hostAccount.id, 40)));

app.get("/api/sessions/:id", requireHost, (req, res) => {
  const s = store.sessions.get(Number(req.params.id), req.hostAccount.id);
  if (!s) return res.status(404).json({ error: "No such session." });
  res.json(s);
});

app.get("/api/sessions/:id/csv", requireHost, (req, res) => {
  const s = store.sessions.get(Number(req.params.id), req.hostAccount.id);
  if (!s) return res.status(404).send("No such session.");
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  let questions = [];
  try { questions = JSON.parse(s.questions_json || "[]"); } catch { questions = []; }
  const qHeaders = questions.map((q, i) => `Q${i + 1}: ${q}`);
  const lines = [["Rank", "Name", "Email", "Score", "Correct", "Answered", ...qHeaders].map(cell).join(",")];
  s.results.forEach(r => {
    let log = [];
    try { log = JSON.parse(r.answers_json || "[]"); } catch { log = []; }
    const perQuestion = questions.map((_, i) => log[i] || "");
    lines.push([r.rank, r.name, r.email, r.score, r.correct_count, r.answered, ...perQuestion].map(cell).join(","));
  });
  const slug = s.title.replace(/[^\w]+/g, "_").slice(0, 40);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}_${s.id}.csv"`);
  res.send("\uFEFF" + lines.join("\r\n"));
});

/* --------------------------------------------------------------- stats --- */

app.get("/api/stats/overview", requireHost, (req, res) => res.json(store.stats.overview(req.hostAccount.id)));

app.get("/api/stats/quizzes", requireHost, (req, res) => res.json(store.stats.byQuiz(req.hostAccount.id)));

/* A quiz group is addressed by the `groupKey` a /api/stats/quizzes row
   carries: a saved quiz's own id as a string, or `t:<title>` for an
   ad-hoc/deleted-quiz bucket (see store.stats.byQuiz). */
function parseGroupKey(raw, res) {
  if (typeof raw === "string" && raw.startsWith("t:")) return { quizId: null, title: raw.slice(2) };
  const quizId = Number(raw);
  if (!Number.isInteger(quizId)) { res.status(400).json({ error: "Bad quiz id." }); return null; }
  return { quizId, title: null };
}

app.get("/api/stats/quizzes/:groupKey", requireHost, (req, res) => {
  if (!parseGroupKey(req.params.groupKey, res)) return;
  res.json(store.stats.forQuiz(req.hostAccount.id, req.params.groupKey));
});

app.get("/api/stats/quizzes/:groupKey/sessions", requireHost, (req, res) => {
  const parsed = parseGroupKey(req.params.groupKey, res);
  if (!parsed) return;
  res.json(store.stats.sessionsForQuiz(req.hostAccount.id, parsed.quizId, parsed.title));
});

app.get("/api/stats/quizzes/:groupKey/questions", requireHost, (req, res) => {
  const parsed = parseGroupKey(req.params.groupKey, res);
  if (!parsed) return;
  res.json(store.stats.questionBreakdown(req.hostAccount.id, parsed.quizId, parsed.title));
});

app.get("/api/health", (req, res) => res.json({ ok: true, ...rooms.stats(), uptime: Math.round(process.uptime()) }));

/* -------------------------------------------------------- self-paced --- */
/* Public, unauthenticated: the share token itself is the access control,
   same pattern as the invite-link flow above. No socket, no lobby - see
   server/selfpaced.js for why this is a separate engine from Rooms/Game. */

const selfpacedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait a bit and try again." }
});

app.get("/api/selfpaced/:token", selfpacedLimiter, (req, res) => {
  const quiz = store.quizzes.getByShareToken(req.params.token);
  if (!quiz) return res.status(404).json({ error: "That link isn't valid." });
  res.json({ title: quiz.title, total: quiz.questions.length, joinMode: quiz.joinMode });
});

app.post("/api/selfpaced/:token/start", selfpacedLimiter, (req, res) => {
  const quiz = store.quizzes.getByShareToken(req.params.token);
  if (!quiz) return res.status(404).json({ error: "That link isn't valid." });
  const result = attempts.start(quiz, req.body?.name, req.body?.email);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.post("/api/selfpaced/attempts/:attemptId/answer", selfpacedLimiter, (req, res) => {
  const attempt = attempts.get(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: "That attempt has expired. Start again." });
  const result = attempt.answer(req.body?.answer, req.body?.qIndex);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/* ------------------------------------------------------------- static --- */

/* Filenames are random UUIDs (server/media.js) and a question's picture
   never changes once saved, so these are safe to cache hard. */
app.use("/uploads", express.static(config.uploadsDir, { maxAge: "30d", fallthrough: true }));
app.use(express.static(PUBLIC_DIR, { maxAge: config.isProd ? "1h" : 0, extensions: ["html"] }));
app.get("/host", (req, res) => res.sendFile("host.html", { root: PUBLIC_DIR }));
app.get("/admin", (req, res) => res.sendFile("admin.html", { root: PUBLIC_DIR }));
app.get("/invite/:token", (req, res) => res.sendFile("invite.html", { root: PUBLIC_DIR }));
app.get("/play", (req, res) => res.sendFile("index.html", { root: PUBLIC_DIR }));
app.get("/take/:token", (req, res) => res.sendFile("take.html", { root: PUBLIC_DIR }));
app.use((req, res) => res.status(404).sendFile("index.html", { root: PUBLIC_DIR }));

/* ----------------------------------------------------------- realtime --- */

io.use((socket, next) => {
  const payload = verify(readCookie(socket.handshake.headers.cookie, COOKIE));
  const host = payload?.role === "host" ? store.hosts.get(payload.id) : null;
  if (host && host.status === "active") {
    socket.data.isHost = true;
    socket.data.hostId = host.id;
    socket.data.hostMaxPlayers = host.max_players;
  }
  next();
});

io.on("connection", socket => {
  /* ---- host side ---- */

  socket.on("host:create", async (payload, ack) => {
    if (!socket.data.isHost) return ack?.({ error: "Sign in first." });
    const quiz = sanitiseQuiz(payload?.quiz);
    if (!quiz.questions.length) return ack?.({ error: "That quiz has no usable questions." });
    /* Only stamp the session with a quizId this host actually owns. */
    const ownedQuiz = payload?.quizId ? store.quizzes.get(payload.quizId, socket.data.hostId) : null;
    if (ownedQuiz?.deliveryMode === "selfpaced") {
      return ack?.({ error: "This quiz is set to self-paced. Share its link instead of opening a live lobby." });
    }
    const ownedQuizId = ownedQuiz ? payload.quizId : null;
    let game;
    try {
      game = rooms.create(quiz, ownedQuizId, socket.data.hostId, socket.data.hostMaxPlayers);
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
        qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 340, color: { dark: "#09092d", light: "#f3f3f7" } });
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

  socket.on("player:join", ({ pin, name, playerId, email } = {}, ack) => {
    const game = rooms.get(String(pin || "").trim());
    if (!game) return ack?.({ error: `No game running on PIN ${pin}.` });

    const res = game.addPlayer(socket, cleanName(name), playerId, email);
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

  socket.on("player:answer", ({ answer } = {}, ack) => {
    const game = rooms.get(socket.data.pin);
    if (!game || !socket.data.playerId) return ack?.({ error: "Not in a game." });
    const outcome = game.submitAnswer(socket.data.playerId, answer);
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
  console.log(`CX Quiz listening on http://${config.host}:${config.port} (${config.env})`);
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

export { app, server, io, rooms, attempts };
