import { randomUUID } from "node:crypto";
import { SCORING } from "./config.js";
import { store } from "./db.js";
import {
  cleanName,
  isValidEmail,
  evaluateAnswer,
  logEntry,
  optionText,
  publicQuestion,
  shuffledOrder
} from "./game.js";

/* The self-paced player flow, deliberately kept separate from Game/Rooms in
   server/game.js: no lobby, no shared clock, no sockets, one player per
   attempt. Reuses the same question schema, evaluateAnswer(), and the same
   sessions/results persistence (and so the same host dashboard) as a live
   game, but scores flatly - correct is worth SCORING.BASE, nothing more -
   since there's no shared countdown to race against and streaks don't mean
   much when nobody's watching in real time. */

class Attempt {
  constructor({ quiz, quizId, hostId, name, email }) {
    this.id = randomUUID();
    this.quiz = quiz;
    this.quizId = quizId;
    this.hostId = hostId;
    this.name = name;
    this.email = email;
    this.qIndex = -1;
    this.optOrder = null;
    this.score = 0;
    this.correctCount = 0;
    this.answered = 0;
    this.log = [];
    this.finished = false;
    this.createdAt = Date.now();
    this.touchedAt = Date.now();
    const pin = "SP" + String(Math.floor(1000 + Math.random() * 9000));
    this.sessionId = store.sessions.open(pin, quizId, quiz.title, hostId, "selfpaced");
  }

  get total() { return this.quiz.questions.length; }
  get current() { return this.qIndex >= 0 && this.qIndex < this.total ? this.quiz.questions[this.qIndex] : null; }

  touch() { this.touchedAt = Date.now(); }

  /* Moves to the next question (or to the end) and returns the wire-safe
     question payload for whatever comes next, or null once the quiz is
     done. Called once at start (qIndex -1 -> 0) and once after every
     answer is scored. */
  advance() {
    this.qIndex++;
    const q = this.current;
    if (!q) return null;
    this.optOrder = q.shuffle && q.opts?.length ? shuffledOrder(q.opts.length) : null;
    return { ...publicQuestion(q, this.optOrder), qIndex: this.qIndex };
  }

  /* A shuffled attempt shows options in `optOrder` order, so a submitted
     position has to be translated back to the question's own canonical
     index before it means anything to evaluateAnswer() - identical to the
     live Game's translateAnswer(). */
  translate(question, rawAnswer) {
    if (!question.shuffle || !this.optOrder) return rawAnswer;
    const toCanonical = shown => {
      const i = Number(shown);
      return Number.isInteger(i) && i >= 0 && i < this.optOrder.length ? this.optOrder[i] : shown;
    };
    if (question.type === "multi") return Array.isArray(rawAnswer) ? rawAnswer.map(toCanonical) : rawAnswer;
    return toCanonical(rawAnswer);
  }

  /* Scores the current question and reports what the player should see for
     it, plus the next question (or a final summary when there isn't one).
     Returns { error } if the question was already answered, the payload
     doesn't fit the question's type, or `qIndex` doesn't match the question
     currently open. That last check matters specifically here: unlike the
     live Game (where a question stays open until the host advances, so a
     stray retry always lands on the same still-open question), a self-paced
     attempt advances the instant one valid answer is scored. On a flaky
     phone connection a lost response can make the client retry after the
     server has already moved on, and without this check that retry would
     silently score against whatever question came next instead. */
  answer(rawAnswer, qIndex) {
    const q = this.current;
    if (!q || this.finished) return { error: "This attempt is already finished." };
    if (qIndex != null && Number(qIndex) !== this.qIndex) {
      return { error: "That question has already moved on. Refresh to see where you are." };
    }

    const evaluated = evaluateAnswer(q, this.translate(q, rawAnswer));
    if (!evaluated.valid) return { error: "Invalid answer." };

    const points = evaluated.correct === true ? SCORING.BASE : 0;
    this.touch();
    this.answered++;
    if (evaluated.correct === true) { this.score += points; this.correctCount++; }
    this.log.push(logEntry(q, evaluated));

    const feedback = feedbackFor(q, evaluated, points);
    const next = this.advance();
    if (!next) this.finish();
    return { ...feedback, next, done: !next, score: this.score, correctCount: this.correctCount, answered: this.answered };
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    const standing = { name: this.name, email: this.email, score: this.score, correctCount: this.correctCount, answered: this.answered, log: this.log };
    try {
      store.sessions.close(this.sessionId, [standing], this.quiz.questions.map(q => q.q));
    } catch (err) {
      console.error("Could not save results for self-paced attempt", this.id, err.message);
    }
  }

  summary() {
    return { score: this.score, correctCount: this.correctCount, answered: this.answered, total: this.total };
  }
}

/* Per-question feedback for the answering player: which of their own answer
   fields make sense depends on the type, same split as the live Game's
   resultFor(), just without any room-relative rank (there's no room). */
function feedbackFor(question, evaluated, points) {
  if (question.type === "text") return { correct: null, points: 0 };
  if (question.type === "numeric") {
    return { correct: evaluated.correct, points, target: question.target, distance: evaluated.distance };
  }
  if (question.type === "multi") {
    return { correct: evaluated.correct, points, correctTexts: question.correct.map(i => optionText(question, i)) };
  }
  return { correct: evaluated.correct, points, correctText: optionText(question, question.correct) };
}

export class Attempts {
  constructor() {
    this.attempts = new Map();
    this.sweeper = setInterval(() => this.sweep(), 10 * 60 * 1000);
    this.sweeper.unref?.();
  }

  /* Rejects a name/email the same way Game.addPlayer() would, so a
     self-paced attempt can't start without an identity the host asked for. */
  start(quiz, rawName, rawEmail) {
    const name = cleanName(rawName);
    if (!name) return { error: "Add your name to start." };
    const email = String(rawEmail || "").trim().toLowerCase();
    if (quiz.joinMode === "name_email" && !isValidEmail(email)) {
      return { error: "This quiz needs your email to start." };
    }

    const attempt = new Attempt({
      quiz,
      quizId: quiz.id,
      hostId: quiz.host_id,
      name,
      email: isValidEmail(email) ? email : null
    });
    this.attempts.set(attempt.id, attempt);
    const question = attempt.advance();
    if (!question) return { error: "That quiz has no usable questions." };
    return { attemptId: attempt.id, total: attempt.total, question };
  }

  get(id) { return this.attempts.get(id); }

  /* Mirrors the live game's own rule (see the comment on store.sessions.close
     in server/db.js): a session that's abandoned without the player ever
     engaging shouldn't land in history at all. An attempt that answered at
     least one question gets persisted as-is, mid-quiz, same as it would if
     they'd finished; one that never got past the join screen is just
     dropped, so the open session row it started never picks up an
     ended_at and is excluded from every stats query automatically. */
  sweep() {
    const cutoff = Date.now() - 3 * 60 * 60 * 1000;
    for (const [id, a] of this.attempts) {
      if (a.touchedAt < cutoff) {
        if (!a.finished && a.answered > 0) a.finish();
        this.attempts.delete(id);
      }
    }
  }
}
