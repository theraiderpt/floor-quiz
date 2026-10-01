import { randomUUID } from "node:crypto";
import { SCORING, FLOW, config } from "./config.js";
import { store } from "./db.js";

export const PHASES = ["lobby", "question", "reveal", "scores", "final"];
export const QUESTION_TYPES = ["single", "multi", "text", "numeric"];

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const isValidEmail = s => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/* Pictures aren't embedded on the question any more (server/media.js saves
   uploads to disk and Giphy picks stay on Giphy's CDN), so `img` is always
   a short URL now: either our own `/uploads/...` path or an `https://` URL
   on Giphy's media CDN. A generous length cap just guards against garbage,
   not against a real picture's worth of bytes. */
const MAX_IMG_URL_CHARS = 600;
const isOwnUpload = s => s.startsWith("/uploads/");
const isGiphyUrl = s => /^https:\/\/[a-z0-9-]+\.giphy\.com\//.test(s);

/* Scoring lives server side and nowhere else. The client is never told the
   correct answer until the question is closed, and never computes its own
   score, so a player with the dev tools open gains nothing. */
export function scoreAnswer(usedMs, limitMs, streak) {
  const speed = clamp(1 - usedMs / limitMs, 0, 1);
  const bonus = Math.min(streak, SCORING.STREAK_CAP) * SCORING.STREAK_STEP;
  return Math.round(SCORING.BASE + SCORING.SPEED * speed) + bonus;
}

export function cleanName(raw) {
  return String(raw || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
}

function sanitiseQuestion(q) {
  const type = QUESTION_TYPES.includes(q?.type) ? q.type : "single";
  const text = String(q?.q || "").trim().slice(0, 200);
  if (!text) return null;
  const seconds = clamp(Number(q?.t) || 20, 5, 120);
  const img = typeof q?.img === "string" && q.img.length <= MAX_IMG_URL_CHARS && (isOwnUpload(q.img) || isGiphyUrl(q.img))
    ? q.img : null;

  if (type === "text") return { type, q: text, t: seconds, img };

  if (type === "numeric") {
    const target = Number(q?.target);
    if (!Number.isFinite(target)) return null;
    const tolerance = clamp(Number(q?.tolerance) || 0, 0, 1_000_000_000);
    return { type, q: text, t: seconds, img, target, tolerance };
  }

  /* "single" and "multi" are both option-based, so they share the opts
     sanitising and the per-player shuffle flag. */
  const opts = (Array.isArray(q?.opts) ? q.opts : [])
    .map(o => String(o || "").trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 4);
  if (opts.length < 2) return null;
  const shuffle = Boolean(q?.shuffle);

  if (type === "multi") {
    const correct = [...new Set((Array.isArray(q?.correct) ? q.correct : []).map(Number))]
      .filter(i => Number.isInteger(i) && i >= 0 && i < opts.length)
      .sort((a, b) => a - b);
    if (!correct.length) return null;
    return { type, q: text, t: seconds, img, opts, correct, shuffle };
  }

  const correct = clamp(Number(q?.correct) || 0, 0, opts.length - 1);
  return { type: "single", q: text, t: seconds, img, opts, correct, shuffle };
}

/* Questions arriving from the host console are never trusted as-is. */
export function sanitiseQuiz(input) {
  const title = String(input?.title || "Quiz").trim().slice(0, 80) || "Quiz";
  const raw = Array.isArray(input?.questions) ? input.questions : [];
  const questions = raw.map(sanitiseQuestion).filter(Boolean).slice(0, 100);
  const joinMode = input?.joinMode === "name_email" ? "name_email" : "name";
  const gapSeconds = clamp(Number(input?.gapSeconds) || FLOW.scoresMs / 1000, 2, 30);
  const deliveryMode = input?.deliveryMode === "selfpaced" ? "selfpaced" : "live";
  return { title, questions, joinMode, gapSeconds, deliveryMode };
}

/* Checks a raw player answer against one question and reports whether it's
   usable and whether it's correct. `correct` is `null` for question types
   that don't have a right answer (currently just "text"), which callers use
   to skip streak/correctCount bookkeeping without treating the answer as
   wrong. Shared between the live Game below and the self-paced attempt
   engine in server/selfpaced.js so both score the exact same way. */
export function evaluateAnswer(question, payload) {
  if (question.type === "multi") {
    const picked = Array.isArray(payload) ? [...new Set(payload.map(Number))] : null;
    if (!picked || !picked.length || picked.some(i => !Number.isInteger(i) || i < 0 || i >= question.opts.length)) {
      return { valid: false };
    }
    const correctSet = new Set(question.correct);
    const pickedSet = new Set(picked);
    const correct = correctSet.size === pickedSet.size && [...correctSet].every(i => pickedSet.has(i));
    return { valid: true, correct, answer: picked };
  }

  if (question.type === "text") {
    const text = String(payload ?? "").trim().slice(0, 300);
    if (!text) return { valid: false };
    return { valid: true, correct: null, answer: text };
  }

  if (question.type === "numeric") {
    const value = Number(payload);
    if (!Number.isFinite(value)) return { valid: false };
    const distance = Math.abs(value - question.target);
    return { valid: true, correct: distance <= question.tolerance, answer: value, distance };
  }

  const idx = Number(payload);
  if (!Number.isInteger(idx) || idx < 0 || idx >= question.opts.length) return { valid: false };
  return { valid: true, correct: idx === question.correct, answer: idx };
}

export function optionText(question, idx) {
  return question.opts?.[idx];
}

/* One line per question, in submission order, for the CSV export. Unscored
   text questions log the literal response (the whole point of asking) since
   there's no right/wrong to report instead. Shared with the self-paced
   attempt engine so both produce identical CSV columns. */
export function logEntry(question, answer) {
  if (!answer) return "No answer";
  if (question.type === "text") return answer.answer || "No answer";
  return answer.correct ? "Right" : "Wrong";
}

/* The wire-safe shape of a question: never the answer key, and personalised
   to one player's shuffled option order when the question calls for it.
   Shared by the live Game below and the self-paced attempt engine. */
export function publicQuestion(question, optOrder) {
  const order = question.shuffle && optOrder ? optOrder : null;
  return {
    type: question.type,
    q: question.q,
    t: question.t,
    img: question.img || null,
    shuffle: Boolean(question.shuffle),
    opts: question.opts ? (order ? order.map(i => question.opts[i]) : question.opts) : undefined
  };
}

/* Shaped per question type so the player app can render the right feedback.
   Single-choice keeps both the index (`choice`/`correctIndex`, for the
   existing positional highlight when the question wasn't shuffled) and the
   option text (works regardless of shuffle). */
function resultFor(question, answer, player, rank, of) {
  const base = { answered: Boolean(answer), score: player.score, streak: player.streak, rank, of, type: question.type };

  if (question.type === "text") {
    return { ...base, yourText: answer ? answer.answer : null, correct: null, points: 0 };
  }

  if (question.type === "numeric") {
    return {
      ...base,
      value: answer ? answer.answer : null,
      target: question.target,
      distance: answer ? answer.distance : null,
      correct: answer ? answer.correct : false,
      points: answer ? answer.points : 0
    };
  }

  if (question.type === "multi") {
    const picked = answer ? answer.answer : [];
    return {
      ...base,
      yourTexts: picked.map(i => optionText(question, i)),
      correctTexts: question.correct.map(i => optionText(question, i)),
      correct: answer ? answer.correct : false,
      points: answer ? answer.points : 0
    };
  }

  const idx = answer ? answer.answer : null;
  return {
    ...base,
    choice: idx,
    correctIndex: question.correct,
    yourText: idx != null ? optionText(question, idx) : null,
    correctText: optionText(question, question.correct),
    correct: answer ? answer.correct : false,
    points: answer ? answer.points : 0
  };
}

export function shuffledOrder(n) {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export class Game {
  constructor({ pin, quiz, quizId, io, hostId, maxPlayers }) {
    this.pin = pin;
    this.io = io;
    this.quiz = quiz;
    this.quizId = quizId || null;
    this.hostId = hostId;
    /* 'name_email' means the host wants a real identity on file, not just a
       display name - checked at join time in addPlayer(). */
    this.joinMode = quiz.joinMode === "name_email" ? "name_email" : "name";
    /* The host's own quota, but never above the process-wide safety ceiling. */
    this.maxPlayers = Math.min(maxPlayers || config.maxPlayers, config.maxPlayers);
    this.phase = "lobby";
    this.qIndex = -1;
    this.players = new Map();      // playerId -> player
    this.answers = new Map();      // playerId -> evaluated answer + usedMs/points
    this.timer = null;
    this.questionEndsAt = 0;
    this.createdAt = Date.now();
    this.touchedAt = Date.now();
    this.sessionId = store.sessions.open(pin, this.quizId, quiz.title, hostId);
    this.finished = false;
    /* The last host-facing payload of each kind, replayed to a host socket
       that reconnects (or a host page that reloads) mid-game, so the
       projector lands back on the exact screen the room is looking at. */
    this.lastReveal = null;
    this.lastScores = null;
    this.lastFinal = null;
    /* Set by Rooms: called once when the game ends, to drop it from memory. */
    this.onFinish = null;
  }

  get room() { return `g:${this.pin}`; }
  get hostRoom() { return `h:${this.pin}`; }
  get total() { return this.quiz.questions.length; }
  get current() { return this.qIndex >= 0 ? this.quiz.questions[this.qIndex] : null; }

  touch() { this.touchedAt = Date.now(); }

  /* ------------------------------------------------ players ------------- */

  addPlayer(socket, rawName, existingId, rawEmail) {
    this.touch();
    if (existingId && this.players.has(existingId)) {
      const p = this.players.get(existingId);
      p.connected = true;
      p.socketId = socket.id;
      return { player: p, rejoined: true };
    }
    if (this.phase !== "lobby") return { error: "That game has already started.", code: "game_started" };
    if (this.players.size >= this.maxPlayers) return { error: "This game is full.", code: "game_full" };

    let name = cleanName(rawName);
    if (!name) return { error: "Add a name so the host can see you.", code: "name_required" };

    const email = String(rawEmail || "").trim().toLowerCase();
    if (this.joinMode === "name_email" && !isValidEmail(email)) {
      return { error: "This quiz needs your email to join.", code: "email_required" };
    }

    const taken = new Set([...this.players.values()].map(p => p.name.toLowerCase()));
    if (taken.has(name.toLowerCase())) {
      let n = 2;
      while (taken.has(`${name} ${n}`.toLowerCase())) n++;
      name = `${name} ${n}`.slice(0, 20);
    }

    const player = {
      id: randomUUID(),
      name,
      email: isValidEmail(email) ? email : null,
      socketId: socket.id,
      connected: true,
      score: 0,
      streak: 0,
      correctCount: 0,
      answered: 0,
      optOrder: null,  // this question's per-player shuffled option order, or null
      log: []          // one entry per question, in order: "Right" | "Wrong" | "No answer" | literal text
    };
    this.players.set(player.id, player);
    return { player, rejoined: false };
  }

  markDisconnected(socketId) {
    for (const p of this.players.values()) {
      if (p.socketId === socketId) {
        p.connected = false;
        p.socketId = null;
        return p;
      }
    }
    return null;
  }

  /* A player who never answered a single question and drops out during the
     lobby is dropped entirely. One who has played stays in the standings. */
  pruneLobby() {
    if (this.phase !== "lobby") return;
    for (const [id, p] of this.players) {
      if (!p.connected && p.answered === 0) this.players.delete(id);
    }
  }

  connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  standings() {
    return [...this.players.values()]
      .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount || a.name.localeCompare(b.name))
      .map(p => ({
        id: p.id,
        name: p.name,
        email: p.email || null,
        score: p.score,
        correctCount: p.correctCount,
        answered: p.answered
      }));
  }

  rankOf(playerId) {
    return this.standings().findIndex(p => p.id === playerId) + 1 || null;
  }

  /* ------------------------------------------------ broadcasting -------- */

  /* `forPlayer` personalises the visible option order for a shuffled
     question. The host/projector view always calls this with no player, so
     the shared screen stays in one canonical order even when phones don't. */
  publicState(forPlayer) {
    const q = this.current;
    const showQuestion = this.phase === "question" || this.phase === "reveal";
    const question = showQuestion && q ? publicQuestion(q, forPlayer?.optOrder) : null;
    return {
      pin: this.pin,
      title: this.quiz.title,
      phase: this.phase,
      qIndex: this.qIndex,
      total: this.total,
      players: this.players.size,
      connected: this.connectedCount(),
      msLeft: this.phase === "question" ? Math.max(0, this.questionEndsAt - Date.now()) : 0,
      question,
      /* Lets a player who rejoins mid-question go straight to "locked in"
         instead of seeing a fresh pad the server will refuse. */
      youAnswered: forPlayer ? this.answers.has(forPlayer.id) : undefined
    };
  }

  broadcastState() {
    this.io.to(this.hostRoom).emit("state", this.publicState());
    for (const p of this.players.values()) {
      if (p.socketId) this.io.to(p.socketId).emit("state", this.publicState(p));
    }
  }

  broadcastLobby() {
    this.io.to(this.hostRoom).emit("lobby", {
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, email: p.email || null, connected: p.connected })),
      count: this.players.size
    });
  }

  /* ------------------------------------------------ flow ---------------- */

  start() {
    if (this.phase !== "lobby" || !this.total) return false;
    this.pruneLobby();
    this.ask(0);
    return true;
  }

  ask(index) {
    this.touch();
    this.clearTimer();
    this.qIndex = index;
    this.phase = "question";
    this.answers = new Map();
    const q = this.current;
    this.questionEndsAt = Date.now() + q.t * 1000;

    /* A fresh per-player shuffle every time this question is asked, so the
       translation in submitAnswer() below always matches what's currently
       on screen. Only choice-based questions have anything to shuffle. */
    const optionCount = q.opts?.length || 0;
    for (const p of this.players.values()) {
      p.optOrder = q.shuffle && optionCount ? shuffledOrder(optionCount) : null;
    }

    this.broadcastState();
    this.io.to(this.hostRoom).emit("answered", { answered: 0, connected: this.connectedCount() });
    this.timer = setTimeout(() => this.closeQuestion(), q.t * 1000 + 250);
  }

  /* A shuffled player's phone shows options in `optOrder` order, so a tapped
     position has to be mapped back to the question's own canonical index
     before it means anything to evaluateAnswer(). Unshuffled questions pass
     the raw payload through untouched. */
  translateAnswer(player, question, rawAnswer) {
    if (!question.shuffle || !player.optOrder) return rawAnswer;
    const toCanonical = shown => {
      const i = Number(shown);
      return Number.isInteger(i) && i >= 0 && i < player.optOrder.length ? player.optOrder[i] : shown;
    };
    if (question.type === "multi") return Array.isArray(rawAnswer) ? rawAnswer.map(toCanonical) : rawAnswer;
    return toCanonical(rawAnswer);
  }

  submitAnswer(playerId, rawAnswer) {
    if (this.phase !== "question") return { error: "Too late.", code: "too_late" };
    const p = this.players.get(playerId);
    if (!p) return { error: "You are not in this game.", code: "not_in_game" };
    if (this.answers.has(playerId)) return { error: "Already answered.", code: "already_answered" };

    const q = this.current;
    const translated = this.translateAnswer(p, q, rawAnswer);
    const evaluated = evaluateAnswer(q, translated);
    if (!evaluated.valid) return { error: "Invalid answer.", code: "invalid_answer" };

    const limitMs = q.t * 1000;
    const usedMs = clamp(limitMs - (this.questionEndsAt - Date.now()), 0, limitMs);
    const points = evaluated.correct === true ? scoreAnswer(usedMs, limitMs, p.streak) : 0;

    this.answers.set(playerId, { ...evaluated, usedMs, points });
    this.touch();

    this.io.to(this.hostRoom).emit("answered", {
      answered: this.answers.size,
      connected: this.connectedCount()
    });

    /* Everyone in the room has answered, so stop the clock rather than
       making the floor stare at a countdown with nothing happening. */
    if (this.answers.size >= this.connectedCount()) {
      this.clearTimer();
      this.timer = setTimeout(() => this.closeQuestion(), 600);
    }
    return { ok: true };
  }

  closeQuestion() {
    if (this.phase !== "question") return;
    this.clearTimer();
    this.phase = "reveal";
    const q = this.current;
    const isChoice = q.type === "single" || q.type === "multi";

    const counts = isChoice ? new Array(q.opts.length).fill(0) : null;
    const responses = q.type === "text" ? [] : null;
    const guesses = q.type === "numeric" ? [] : null;

    for (const [playerId, a] of this.answers) {
      const p = this.players.get(playerId);
      if (!p) continue;
      if (isChoice) {
        (q.type === "multi" ? a.answer : [a.answer]).forEach(i => { if (counts[i] != null) counts[i]++; });
      } else if (q.type === "text") {
        responses.push({ name: p.name, text: a.answer });
      } else if (q.type === "numeric") {
        guesses.push({ name: p.name, value: a.answer, distance: a.distance });
      }
    }
    if (guesses) guesses.sort((x, y) => x.distance - y.distance);

    /* Called out on the host screen, Kahoot-style: a nudge that speed pays
       (it does, see scoreAnswer's SPEED slice) and a small moment of fame
       for whoever earns it. Stays null for an unscored text question, since
       correct is never true there. */
    let fastestCorrect = null;
    for (const [playerId, a] of this.answers) {
      const p = this.players.get(playerId);
      if (!p) continue;
      p.answered++;
      /* `correct === null` (unscored text) touches neither the streak nor
         correctCount - it's a discussion prompt, not a right/wrong one. */
      if (a.correct === true) {
        p.score += a.points;
        p.streak++;
        p.correctCount++;
        if (!fastestCorrect || a.usedMs < fastestCorrect.usedMs) fastestCorrect = { name: p.name, usedMs: a.usedMs };
      } else if (a.correct === false) {
        p.streak = 0;
      }
    }

    /* Recorded for every player, not just this.answers, so a player who let
       the clock run out still gets a slot and the per-player logs stay
       aligned with question order for the CSV export. */
    for (const p of this.players.values()) {
      p.log.push(logEntry(q, this.answers.get(p.id)));
    }

    this.broadcastState();

    const board = this.standings();
    const rankById = new Map(board.map((p, i) => [p.id, i + 1]));

    const reveal = { type: q.type, answered: this.answers.size, connected: this.connectedCount(), fastestCorrect };
    if (isChoice) {
      reveal.correct = q.correct;
      reveal.counts = counts;
      reveal.gotItRight = [...this.answers.values()].filter(a => a.correct === true).length;
    } else if (q.type === "text") {
      reveal.responses = responses;
    } else if (q.type === "numeric") {
      reveal.target = q.target;
      reveal.tolerance = q.tolerance;
      reveal.guesses = guesses;
      reveal.gotItRight = [...this.answers.values()].filter(a => a.correct === true).length;
    }
    this.lastReveal = reveal;
    this.io.to(this.hostRoom).emit("reveal", reveal);

    /* Each player gets their own result, addressed to their socket only. */
    for (const p of this.players.values()) {
      if (!p.socketId) continue;
      const a = this.answers.get(p.id);
      this.io.to(p.socketId).emit("result", resultFor(q, a, p, rankById.get(p.id) || null, board.length));
    }

    /* Auto-advance by default so the host never has to touch the console
       mid-game; a manual "next" click (below) just gets there sooner. */
    this.timer = setTimeout(() => this.next(), FLOW.revealMs);
  }

  next() {
    this.touch();
    this.clearTimer();
    if (this.phase === "reveal") {
      if (this.qIndex + 1 < this.total) {
        this.phase = "scores";
        this.broadcastState();
        this.lastScores = { board: this.standings().slice(0, 10) };
        this.io.to(this.hostRoom).emit("scores", this.lastScores);
        this.timer = setTimeout(() => this.next(), this.quiz.gapSeconds * 1000);
      } else {
        this.end();
      }
      return true;
    }
    if (this.phase === "scores") {
      this.ask(this.qIndex + 1);
      return true;
    }
    return false;
  }

  end() {
    if (this.finished) return;
    this.clearTimer();
    this.finished = true;

    /* Ended before the first question: a cancelled lobby, not a game.
       Nothing was played, so nothing goes into history or the stats. */
    if (this.qIndex < 0) {
      this.phase = "final";
      store.sessions.discard(this.sessionId);
      this.io.to(this.room).emit("cancelled");
      this.onFinish?.(true);
      return;
    }

    this.phase = "final";
    const board = this.standings();
    try {
      const withLogs = board.map(p => ({ ...p, log: this.players.get(p.id)?.log || [] }));
      store.sessions.close(this.sessionId, withLogs, this.quiz.questions.map(q => q.q));
    } catch (err) {
      console.error("Could not save results for session", this.sessionId, err.message);
    }
    this.broadcastState();
    this.lastFinal = { board, sessionId: this.sessionId };
    this.io.to(this.hostRoom).emit("final", this.lastFinal);
    const rankById = new Map(board.map((p, i) => [p.id, i + 1]));
    for (const p of this.players.values()) {
      if (!p.socketId) continue;
      this.io.to(p.socketId).emit("gameover", {
        rank: rankById.get(p.id) || null,
        of: board.length,
        score: p.score,
        correctCount: p.correctCount,
        total: this.total
      });
    }
    this.onFinish?.(false);
  }

  clearTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  destroy() {
    this.clearTimer();
    this.players.clear();
    this.answers.clear();
  }
}

/* --------------------------------------------------- registry ----------- */

export class Rooms {
  constructor(io) {
    this.io = io;
    this.games = new Map();       // pin -> Game
    this.playerIndex = new Map(); // socketId -> { pin, playerId }
    /* Games abandoned mid-flight would otherwise sit in memory forever. */
    this.sweeper = setInterval(() => this.sweep(), 10 * 60 * 1000);
    this.sweeper.unref?.();
  }

  newPin() {
    for (let i = 0; i < 200; i++) {
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      if (!this.games.has(pin)) return pin;
    }
    throw Object.assign(new Error("No free PINs. Too many games are running at once."), { code: "no_pins" });
  }

  create(quiz, quizId, hostId, maxPlayers) {
    const pin = this.newPin();
    const game = new Game({ pin, quiz, quizId, io: this.io, hostId, maxPlayers });
    this.games.set(pin, game);
    /* A finished game used to sit in memory until the 4-hour sweep, so
       /api/health over-reported live games (which the deploy rule reads to
       decide whether a restart is safe). A cancelled lobby goes at once; a
       played game stays briefly so a host who reloads on the podium, or a
       player whose phone reconnects, still finds it. */
    game.onFinish = cancelled => {
      if (cancelled) return this.remove(pin, game);
      setTimeout(() => this.remove(pin, game), FLOW.finishedGraceMs).unref?.();
    };
    return game;
  }

  /* Only removes `game` itself: by the time a grace timer fires, the PIN
     may already belong to a newer game. */
  remove(pin, game) {
    if (this.games.get(pin) !== game) return;
    game.destroy();
    this.games.delete(pin);
    for (const [socketId, ref] of this.playerIndex) {
      if (ref.pin === pin) this.playerIndex.delete(socketId);
    }
  }

  get(pin) { return this.games.get(String(pin)); }

  close(pin) {
    const g = this.games.get(String(pin));
    if (!g) return;
    if (!g.finished) g.end();
    g.destroy();
    this.games.delete(String(pin));
  }

  sweep() {
    const cutoff = Date.now() - 4 * 60 * 60 * 1000;
    for (const [pin, g] of this.games) {
      if (g.touchedAt < cutoff) {
        g.destroy();
        this.games.delete(pin);
      }
    }
  }

  stats() {
    return { games: this.games.size, players: [...this.games.values()].reduce((n, g) => n + g.players.size, 0) };
  }
}
