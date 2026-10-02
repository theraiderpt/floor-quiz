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
import { saveImageUpload, searchGiphy, sweepOrphanUploads } from "./media.js";
import { csvLabels, csvOutcome } from "./csv-labels.js";

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
  if (!host || host.status !== "active") return res.status(401).json({ error: "Sign in first.", code: "auth" });
  req.hostAccount = { id: host.id, email: host.email, maxPlayers: host.max_players };
  next();
}

function requireAdmin(req, res, next) {
  const payload = currentAuth(req);
  const admin = payload?.role === "admin" ? store.admins.get(payload.id) : null;
  if (!admin) return res.status(401).json({ error: "Sign in first.", code: "auth" });
  req.admin = { id: admin.id, email: admin.email };
  next();
}

/* Verified against when the account is unknown, to equalise response time. */
const DUMMY_HASH = hashPassword(randomToken());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait fifteen minutes.", code: "rate_login" }
});
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait fifteen minutes.", code: "rate_login" }
});
const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait fifteen minutes.", code: "rate_login" }
});

app.post("/api/login", loginLimiter, (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const given = String(req.body?.password || "");
  const host = store.hosts.getByEmail(email);
  const hash = host?.password_hash || DUMMY_HASH;
  const passwordOk = verifyPassword(given, hash); // always runs, so timing doesn't reveal which emails exist
  if (!host || host.status !== "active" || !host.password_hash || !passwordOk) {
    return res.status(401).json({ error: "That email or password is not right.", code: "bad_login" });
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
  const passwordOk = verifyPassword(given, admin?.password_hash || DUMMY_HASH);
  if (!admin || !passwordOk) {
    return res.status(401).json({ error: "That email or password is not right.", code: "bad_login" });
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
  if (!valid) return res.status(400).json({ error: "That invite link is invalid or has expired.", code: "invite_invalid" });
  const password = String(req.body?.password || "");
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters.", code: "pw_short" });
  store.hosts.setPassword(inv.host_id, hashPassword(password));
  store.invites.markUsed(inv.id);
  res.json({ ok: true });
});

/* --------------------------------------------------------- admin: hosts --- */

app.get("/api/admin/hosts", requireAdmin, (req, res) => res.json(store.hosts.list()));

app.post("/api/admin/hosts", requireAdmin, (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: "Enter a valid email.", code: "email_invalid" });
  if (store.hosts.getByEmail(email)) return res.status(409).json({ error: "A host with that email already exists.", code: "host_exists" });
  const maxPlayers = clamp(Number(req.body?.maxPlayers) || 400, 1, 2000);
  const host = store.hosts.create(email, maxPlayers);
  const token = randomToken();
  store.invites.create(host.id, token, new Date(Date.now() + INVITE_TTL_MS).toISOString());
  res.status(201).json({ host, inviteLink: `${config.publicUrl || ""}/invite/${token}` });
});

app.post("/api/admin/hosts/:id/reinvite", requireAdmin, (req, res) => {
  const host = store.hosts.get(Number(req.params.id));
  if (!host) return res.status(404).json({ error: "No such host.", code: "no_host" });
  const token = randomToken();
  store.invites.create(host.id, token, new Date(Date.now() + INVITE_TTL_MS).toISOString());
  res.json({ inviteLink: `${config.publicUrl || ""}/invite/${token}` });
});

app.patch("/api/admin/hosts/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!store.hosts.get(id)) return res.status(404).json({ error: "No such host.", code: "no_host" });
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
  if (!name) return res.status(400).json({ error: "Name a category.", code: "cat_name" });
  try {
    res.status(201).json(store.categories.create(name));
  } catch {
    res.status(409).json({ error: "That category already exists.", code: "cat_exists" });
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
  if (!store.categories.get(categoryId)) return res.status(400).json({ error: "Pick a valid category.", code: "cat_invalid" });
  const q = String(req.body?.q || "").trim().slice(0, 200);
  const opts = (Array.isArray(req.body?.opts) ? req.body.opts : [])
    .map(o => String(o || "").trim().slice(0, 120)).filter(Boolean).slice(0, 4);
  if (!q || opts.length < 2) return res.status(400).json({ error: "Add question text and at least two options.", code: "bank_incomplete" });
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
  message: { error: "Too many requests. Wait a moment.", code: "rate_media" }
});

app.post("/api/uploads/image", requireHost, mediaLimiter, async (req, res) => {
  try {
    const url = await saveImageUpload(req.body?.dataUrl);
    res.status(201).json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message, code: err.code, ...err.vars });
  }
});

app.get("/api/giphy/search", requireHost, mediaLimiter, async (req, res) => {
  try {
    const results = await searchGiphy(String(req.query.q || "").trim().slice(0, 100), req.query.limit);
    res.json({ data: results });
  } catch (err) {
    res.status(err.code === "giphy_no_key" ? 501 : 502).json({ error: err.message, code: err.code || "giphy_failed", ...err.vars });
  }
});

/* ------------------------------------------------------------ quizzes --- */

app.get("/api/quizzes", requireHost, (req, res) => res.json(store.quizzes.list(req.hostAccount.id)));

app.post("/api/quizzes", requireHost, (req, res) => {
  const { title, questions, joinMode, gapSeconds, deliveryMode } = sanitiseQuiz(req.body);
  if (!questions.length) return res.status(400).json({ error: "Add at least one usable question.", code: "quiz_empty" });
  const categoryId = req.body?.categoryId ? Number(req.body.categoryId) : null;
  res.status(201).json(store.quizzes.create(title, questions, req.hostAccount.id, categoryId, joinMode, gapSeconds, deliveryMode));
});

app.put("/api/quizzes/:id", requireHost, (req, res) => {
  const id = Number(req.params.id);
  if (!store.quizzes.get(id, req.hostAccount.id)) return res.status(404).json({ error: "No such quiz.", code: "no_quiz" });
  const { title, questions, joinMode, gapSeconds, deliveryMode } = sanitiseQuiz(req.body);
  if (!questions.length) return res.status(400).json({ error: "Add at least one usable question.", code: "quiz_empty" });
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
  if (!s) return res.status(404).json({ error: "No such session.", code: "no_session" });
  res.json(s);
});

app.get("/api/sessions/:id/csv", requireHost, (req, res) => {
  const s = store.sessions.get(Number(req.params.id), req.hostAccount.id);
  if (!s) return res.status(404).send("No such session.");
  /* Player names and free-text answers come from the public. A cell that
     starts with = + - @ (or a tab/CR) is run as a formula by Excel and
     Sheets, so prefix those with an apostrophe (OWASP's advice for CSV
     injection). Numbers, like scores, pass through untouched. */
  const cell = v => {
    let text = String(v ?? "");
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  let questions = [];
  try { questions = JSON.parse(s.questions_json || "[]"); } catch { questions = []; }
  const L = csvLabels(req.query.lang);
  const qHeaders = questions.map((q, i) => `${L.q}${i + 1}: ${q}`);
  const lines = [[L.rank, L.name, L.email, L.score, L.correct, L.answered, ...qHeaders].map(cell).join(",")];
  s.results.forEach(r => {
    let log = [];
    try { log = JSON.parse(r.answers_json || "[]"); } catch { log = []; }
    const perQuestion = questions.map((_, i) => csvOutcome(log[i] || "", L));
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
  if (!Number.isInteger(quizId)) { res.status(400).json({ error: "Bad quiz id.", code: "bad_id" }); return null; }
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

/* A training room usually sits behind one office NAT, so every trainee shares
   one IP. Only the cheap-to-abuse calls are limited per IP (looking up a
   link, and starting an attempt, which opens a DB row); answers are limited
   per attempt instead, since an attempt id is an unguessable UUID. */
const selfpacedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait a bit and try again.", code: "rate_selfpaced" }
});
const selfpacedAnswerLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: req => req.params.attemptId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait a bit and try again.", code: "rate_selfpaced" }
});

app.get("/api/selfpaced/:token", selfpacedLimiter, (req, res) => {
  const quiz = store.quizzes.getByShareToken(req.params.token);
  if (!quiz) return res.status(404).json({ error: "That link isn't valid.", code: "link_invalid" });
  res.json({ title: quiz.title, total: quiz.questions.length, joinMode: quiz.joinMode });
});

app.post("/api/selfpaced/:token/start", selfpacedLimiter, (req, res) => {
  const quiz = store.quizzes.getByShareToken(req.params.token);
  if (!quiz) return res.status(404).json({ error: "That link isn't valid.", code: "link_invalid" });
  const result = attempts.start(quiz, req.body?.name, req.body?.email);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.post("/api/selfpaced/attempts/:attemptId/answer", selfpacedAnswerLimiter, (req, res) => {
  const attempt = attempts.get(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: "That attempt has expired. Start again.", code: "attempt_expired" });
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

/* The join link and its QR code, for a fresh lobby and for a host resuming one. */
async function joinInfo(pin) {
  const joinUrl = `${config.publicUrl || ""}/play?pin=${pin}`;
  let qr = null;
  if (config.publicUrl) {
    try {
      qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 340, color: { dark: "#09092d", light: "#f3f3f7" } });
    } catch { /* a missing QR is cosmetic, never fatal */ }
  }
  return { joinUrl, qr };
}

/* Live-game PINs are only four digits, so an outsider could walk the whole
   space. Failed lookups are counted per client IP (the last X-Forwarded-For
   hop is the one nginx appended); successful joins are not, so a classroom
   behind one NAT can all join at once. */
const PIN_MISS_LIMIT = 10;
const PIN_MISS_WINDOW_MS = 60 * 1000;
const pinMisses = new Map(); // ip -> { count, resetAt }
setInterval(() => {
  const now = Date.now();
  for (const [ip, m] of pinMisses) if (m.resetAt <= now) pinMisses.delete(ip);
}, PIN_MISS_WINDOW_MS).unref();

function clientIp(socket) {
  const fwd = socket.handshake.headers["x-forwarded-for"];
  return (typeof fwd === "string" && fwd.split(",").pop().trim()) || socket.handshake.address;
}

function pinLockedOut(ip) {
  const m = pinMisses.get(ip);
  return Boolean(m && m.resetAt > Date.now() && m.count >= PIN_MISS_LIMIT);
}

function recordPinMiss(ip) {
  const m = pinMisses.get(ip);
  if (m && m.resetAt > Date.now()) m.count++;
  else pinMisses.set(ip, { count: 1, resetAt: Date.now() + PIN_MISS_WINDOW_MS });
}

io.on("connection", socket => {
  /* Every client event goes through here. `ack` is only ever a function or
     undefined (a client can put anything in that slot, and "x"?.() throws),
     and a handler that throws answers with an error instead of escaping
     socket.io as an uncaught exception, which would restart the process and
     end every live game on the box. */
  const on = (event, handler) => socket.on(event, async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : undefined;
    try {
      await handler(payload, reply);
    } catch (err) {
      console.error(`socket ${event} failed:`, err);
      reply?.({ error: "Something went wrong.", code: "server" });
    }
  });

  /* ---- host side ---- */

  on("host:create", async (payload, ack) => {
    if (!socket.data.isHost) return ack?.({ error: "Sign in first.", code: "auth" });
    const quiz = sanitiseQuiz(payload?.quiz);
    if (!quiz.questions.length) return ack?.({ error: "That quiz has no usable questions.", code: "quiz_empty" });
    /* Only stamp the session with a quizId this host actually owns. */
    const ownedQuiz = payload?.quizId ? store.quizzes.get(payload.quizId, socket.data.hostId) : null;
    if (ownedQuiz?.deliveryMode === "selfpaced") {
      return ack?.({ error: "This quiz is set to self-paced. Share its link instead of opening a live lobby.", code: "quiz_is_selfpaced" });
    }
    const ownedQuizId = ownedQuiz ? payload.quizId : null;
    let game;
    try {
      game = rooms.create(quiz, ownedQuizId, socket.data.hostId, socket.data.hostMaxPlayers);
    } catch (err) {
      return ack?.({ error: err.message, code: err.code });
    }
    socket.join(game.room);
    socket.join(game.hostRoom);
    socket.data.pin = game.pin;

    const { joinUrl, qr } = await joinInfo(game.pin);
    ack?.({ pin: game.pin, joinUrl, qr, state: game.publicState() });
    game.broadcastLobby();
  });

  /* A host socket that reconnects (network blip, laptop sleep, page
     reload) is a brand new socket outside the game's rooms, so the
     projector froze and every host:* event answered "no game". This puts
     it back, only for the account that created the game, and hands over
     whatever the room is currently looking at. */
  on("host:resume", async (payload, ack) => {
    if (!socket.data.isHost) return ack?.({ error: "Sign in first.", code: "auth" });
    const game = rooms.get(String(payload?.pin ?? "").trim());
    if (!game || game.hostId !== socket.data.hostId) {
      return ack?.({ error: "That game is no longer running.", code: "no_game" });
    }
    socket.join(game.room);
    socket.join(game.hostRoom);
    socket.data.pin = game.pin;
    const { joinUrl, qr } = await joinInfo(game.pin);
    ack?.({
      pin: game.pin,
      joinUrl,
      qr,
      title: game.quiz.title,
      total: game.total,
      state: game.publicState(),
      answered: { answered: game.answers.size, connected: game.connectedCount() },
      reveal: game.phase === "reveal" ? game.lastReveal : null,
      scores: game.phase === "scores" ? game.lastScores : null,
      final: game.finished ? game.lastFinal : null
    });
    if (game.phase === "lobby") game.broadcastLobby();
  });

  const hostGame = () => {
    const g = rooms.get(socket.data.pin);
    return socket.data.isHost && g ? g : null;
  };

  on("host:start", (_, ack) => {
    const g = hostGame();
    if (!g) return ack?.({ error: "No game.", code: "no_game" });
    /* Evaluate first. `ack?.(g.start())` would skip the call entirely
       whenever the client emitted without a callback. */
    const ok = g.start();
    ack?.({ ok });
  });

  on("host:next", (_, ack) => {
    const g = hostGame();
    if (!g) return ack?.({ error: "No game.", code: "no_game" });
    const ok = g.next();
    ack?.({ ok });
  });

  on("host:skip", (_, ack) => {
    const g = hostGame();
    if (!g) return ack?.({ error: "No game.", code: "no_game" });
    g.closeQuestion();
    ack?.({ ok: true });
  });

  on("host:end", (_, ack) => {
    const g = hostGame();
    if (!g) return ack?.({ error: "No game.", code: "no_game" });
    g.end();
    ack?.({ ok: true });
  });

  on("host:kick", (payload, ack) => {
    const { playerId } = payload ?? {};
    const g = hostGame();
    if (!g) return ack?.({ error: "No game.", code: "no_game" });
    const p = g.players.get(playerId);
    if (p?.socketId) {
      io.to(p.socketId).emit("kicked");
      /* Without this the kicked phone stayed in the game room, kept
         receiving room broadcasts, and kept a playerId on its socket. */
      const kicked = io.sockets.sockets.get(p.socketId);
      if (kicked) {
        kicked.leave(g.room);
        delete kicked.data.pin;
        delete kicked.data.playerId;
      }
      rooms.playerIndex.delete(p.socketId);
    }
    g.players.delete(playerId);
    g.answers.delete(playerId);
    g.broadcastLobby();
    g.broadcastState();
    ack?.({ ok: true });
  });

  /* ---- player side ---- */

  /* `payload ?? {}` rather than a destructuring default: the default only
     covers undefined, so emit("player:join", null) used to throw here and
     take the whole process (and every live game) down. */
  on("player:join", (payload, ack) => {
    const { pin, name, playerId, email } = payload ?? {};
    const pinText = String(pin ?? "").trim().slice(0, 8);
    const ip = clientIp(socket);
    if (pinLockedOut(ip)) return ack?.({ error: "Too many wrong PINs. Wait a minute.", code: "rate_pin" });
    const game = rooms.get(pinText);
    if (!game) {
      recordPinMiss(ip);
      return ack?.({ error: `No game running on PIN ${pinText}.`, code: "no_pin", pin: pinText });
    }

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
      /* Personalised: a rejoin mid-question needs this player's own shuffled
         option order (taps are mapped back through it) and whether they
         already answered. */
      state: game.publicState(res.player)
    });
    game.broadcastLobby();
    game.broadcastState();
  });

  on("player:answer", (payload, ack) => {
    const { answer } = payload ?? {};
    const game = rooms.get(socket.data.pin);
    if (!game || !socket.data.playerId) return ack?.({ error: "Not in a game.", code: "not_in_game" });
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

const uploadSweep = () => sweepOrphanUploads().catch(err => console.error("upload sweep failed:", err.message));
setTimeout(uploadSweep, 60 * 1000).unref();
setInterval(uploadSweep, 24 * 60 * 60 * 1000).unref();

function shutdown(signal) {
  console.log(`${signal} received, closing.`);
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app, server, io, rooms, attempts };
