import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS quizzes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  questions  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pin          TEXT NOT NULL,
  quiz_id      INTEGER REFERENCES quizzes(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  player_count INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT
);

CREATE TABLE IF NOT EXISTS results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  rank          INTEGER NOT NULL,
  name          TEXT NOT NULL,
  score         INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  answered      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_results_session ON results(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
`);

const stmt = {
  listQuizzes: db.prepare(
    "SELECT id, title, questions, updated_at FROM quizzes ORDER BY updated_at DESC"
  ),
  getQuiz: db.prepare("SELECT id, title, questions FROM quizzes WHERE id = ?"),
  insertQuiz: db.prepare("INSERT INTO quizzes (title, questions) VALUES (?, ?)"),
  updateQuiz: db.prepare(
    "UPDATE quizzes SET title = ?, questions = ?, updated_at = datetime('now') WHERE id = ?"
  ),
  deleteQuiz: db.prepare("DELETE FROM quizzes WHERE id = ?"),

  insertSession: db.prepare(
    "INSERT INTO sessions (pin, quiz_id, title) VALUES (?, ?, ?)"
  ),
  closeSession: db.prepare(
    "UPDATE sessions SET ended_at = datetime('now'), player_count = ? WHERE id = ?"
  ),
  listSessions: db.prepare(
    `SELECT id, pin, title, player_count, started_at, ended_at
     FROM sessions WHERE ended_at IS NOT NULL
     ORDER BY started_at DESC LIMIT ?`
  ),
  getSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
  insertResult: db.prepare(
    `INSERT INTO results (session_id, rank, name, score, correct_count, answered)
     VALUES (?, ?, ?, ?, ?, ?)`
  ),
  listResults: db.prepare(
    "SELECT rank, name, score, correct_count, answered FROM results WHERE session_id = ? ORDER BY rank"
  )
};

const parse = row =>
  row && { id: row.id, title: row.title, questions: JSON.parse(row.questions), updated_at: row.updated_at };

export const store = {
  quizzes: {
    list: () => stmt.listQuizzes.all().map(parse),
    get: id => parse(stmt.getQuiz.get(id)),
    create: (title, questions) => {
      const info = stmt.insertQuiz.run(title, JSON.stringify(questions));
      return store.quizzes.get(info.lastInsertRowid);
    },
    update: (id, title, questions) => {
      stmt.updateQuiz.run(title, JSON.stringify(questions), id);
      return store.quizzes.get(id);
    },
    remove: id => stmt.deleteQuiz.run(id).changes > 0
  },

  sessions: {
    open: (pin, quizId, title) =>
      Number(stmt.insertSession.run(pin, quizId || null, title).lastInsertRowid),

    /* Written once, when a game finishes. A game that is abandoned midway
       never lands here, which keeps the history clean. */
    close: (sessionId, standings) => {
      const tx = db.transaction(rows => {
        rows.forEach((p, i) =>
          stmt.insertResult.run(sessionId, i + 1, p.name, p.score, p.correctCount, p.answered)
        );
        stmt.closeSession.run(rows.length, sessionId);
      });
      tx(standings);
    },

    list: (limit = 40) => stmt.listSessions.all(limit),
    get: id => {
      const s = stmt.getSession.get(id);
      return s ? { ...s, results: stmt.listResults.all(id) } : null;
    }
  }
};

export default db;
