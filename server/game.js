import { randomUUID } from "node:crypto";
import { SCORING, config } from "./config.js";
import { store } from "./db.js";

export const PHASES = ["lobby", "question", "reveal", "scores", "final"];

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

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

/* Questions arriving from the host console are never trusted as-is. */
export function sanitiseQuiz(input) {
  const title = String(input?.title || "Quiz").trim().slice(0, 80) || "Quiz";
  const raw = Array.isArray(input?.questions) ? input.questions : [];
  const questions = raw
    .map(q => {
      const opts = (Array.isArray(q?.opts) ? q.opts : [])
        .map(o => String(o || "").trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 4);
      const text = String(q?.q || "").trim().slice(0, 200);
      const seconds = clamp(Number(q?.t) || 20, 5, 120);
      const correct = clamp(Number(q?.correct) || 0, 0, Math.max(0, opts.length - 1));
      return opts.length >= 2 && text ? { q: text, t: seconds, opts, correct } : null;
    })
    .filter(Boolean)
    .slice(0, 100);
  return { title, questions };
}

export class Game {
  constructor({ pin, quiz, quizId, io }) {
    this.pin = pin;
    this.io = io;
    this.quiz = quiz;
    this.quizId = quizId || null;
    this.phase = "lobby";
    this.qIndex = -1;
    this.players = new Map();      // playerId -> player
    this.answers = new Map();      // playerId -> { choice, usedMs, points, correct }
    this.timer = null;
    this.questionEndsAt = 0;
    this.createdAt = Date.now();
    this.touchedAt = Date.now();
    this.sessionId = store.sessions.open(pin, this.quizId, quiz.title);
    this.finished = false;
  }

  get room() { return `g:${this.pin}`; }
  get hostRoom() { return `h:${this.pin}`; }
  get total() { return this.quiz.questions.length; }
  get current() { return this.qIndex >= 0 ? this.quiz.questions[this.qIndex] : null; }

  touch() { this.touchedAt = Date.now(); }

  /* ------------------------------------------------ players ------------- */

  addPlayer(socket, rawName, existingId) {
    this.touch();
    if (existingId && this.players.has(existingId)) {
      const p = this.players.get(existingId);
      p.connected = true;
      p.socketId = socket.id;
      return { player: p, rejoined: true };
    }
    if (this.phase !== "lobby") return { error: "That game has already started." };
    if (this.players.size >= config.maxPlayers) return { error: "This game is full." };

    let name = cleanName(rawName);
    if (!name) return { error: "Add a name so the host can see you." };

    const taken = new Set([...this.players.values()].map(p => p.name.toLowerCase()));
    if (taken.has(name.toLowerCase())) {
      let n = 2;
      while (taken.has(`${name} ${n}`.toLowerCase())) n++;
      name = `${name} ${n}`.slice(0, 20);
    }

    const player = {
      id: randomUUID(),
      name,
      socketId: socket.id,
      connected: true,
      score: 0,
      streak: 0,
      correctCount: 0,
      answered: 0
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
        score: p.score,
        correctCount: p.correctCount,
        answered: p.answered
      }));
  }

  rankOf(playerId) {
    return this.standings().findIndex(p => p.id === playerId) + 1 || null;
  }

  /* ------------------------------------------------ broadcasting -------- */

  publicState() {
    const q = this.current;
    const showQuestion = this.phase === "question" || this.phase === "reveal";
    return {
      pin: this.pin,
      title: this.quiz.title,
      phase: this.phase,
      qIndex: this.qIndex,
      total: this.total,
      players: this.players.size,
      connected: this.connectedCount(),
      msLeft: this.phase === "question" ? Math.max(0, this.questionEndsAt - Date.now()) : 0,
      question: showQuestion && q ? { q: q.q, opts: q.opts, t: q.t } : null
    };
  }

  broadcastState() {
    this.io.to(this.room).emit("state", this.publicState());
  }

  broadcastLobby() {
    this.io.to(this.hostRoom).emit("lobby", {
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, connected: p.connected })),
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
    this.broadcastState();
    this.io.to(this.hostRoom).emit("answered", { answered: 0, connected: this.connectedCount() });
    this.timer = setTimeout(() => this.closeQuestion(), q.t * 1000 + 250);
  }

  submitAnswer(playerId, choice) {
    if (this.phase !== "question") return { error: "Too late." };
    const p = this.players.get(playerId);
    if (!p) return { error: "You are not in this game." };
    if (this.answers.has(playerId)) return { error: "Already answered." };

    const q = this.current;
    const idx = Number(choice);
    if (!Number.isInteger(idx) || idx < 0 || idx >= q.opts.length) return { error: "Invalid answer." };

    const limitMs = q.t * 1000;
    const usedMs = clamp(limitMs - (this.questionEndsAt - Date.now()), 0, limitMs);
    const correct = idx === q.correct;
    const points = correct ? scoreAnswer(usedMs, limitMs, p.streak) : 0;

    this.answers.set(playerId, { choice: idx, usedMs, points, correct });
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
    return { ok: true, choice: idx };
  }

  closeQuestion() {
    if (this.phase !== "question") return;
    this.clearTimer();
    this.phase = "reveal";
    const q = this.current;

    const counts = new Array(q.opts.length).fill(0);
    for (const [playerId, a] of this.answers) {
      counts[a.choice]++;
      const p = this.players.get(playerId);
      if (!p) continue;
      p.answered++;
      if (a.correct) {
        p.score += a.points;
        p.streak++;
        p.correctCount++;
      } else {
        p.streak = 0;
      }
    }

    this.broadcastState();

    const board = this.standings();
    const rankById = new Map(board.map((p, i) => [p.id, i + 1]));

    this.io.to(this.hostRoom).emit("reveal", {
      correct: q.correct,
      counts,
      answered: this.answers.size,
      connected: this.connectedCount(),
      gotItRight: counts[q.correct] || 0
    });

    /* Each player gets their own result, addressed to their socket only. */
    for (const p of this.players.values()) {
      if (!p.socketId) continue;
      const a = this.answers.get(p.id);
      this.io.to(p.socketId).emit("result", {
        answered: Boolean(a),
        choice: a ? a.choice : null,
        correctIndex: q.correct,
        correct: Boolean(a && a.correct),
        points: a ? a.points : 0,
        score: p.score,
        streak: p.streak,
        rank: rankById.get(p.id) || null,
        of: board.length
      });
    }
  }

  next() {
    this.touch();
    if (this.phase === "reveal") {
      if (this.qIndex + 1 < this.total) {
        this.phase = "scores";
        this.broadcastState();
        this.io.to(this.hostRoom).emit("scores", { board: this.standings().slice(0, 10) });
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
    this.phase = "final";
    const board = this.standings();
    try {
      store.sessions.close(this.sessionId, board);
    } catch (err) {
      console.error("Could not save results for session", this.sessionId, err.message);
    }
    this.broadcastState();
    this.io.to(this.hostRoom).emit("final", { board, sessionId: this.sessionId });
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
    throw new Error("No free PINs. Too many games are running at once.");
  }

  create(quiz, quizId) {
    const pin = this.newPin();
    const game = new Game({ pin, quiz, quizId, io: this.io });
    this.games.set(pin, game);
    return game;
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
