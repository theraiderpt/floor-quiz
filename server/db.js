import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { QUESTION_BANK_SEED } from "./question-bank-seed.js";
import { randomToken } from "./auth.js";

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

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hosts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  max_players   INTEGER NOT NULL DEFAULT 400,
  status        TEXT NOT NULL DEFAULT 'invited',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id    INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE TABLE IF NOT EXISTS bank_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  q           TEXT NOT NULL,
  t           INTEGER NOT NULL DEFAULT 20,
  opts        TEXT NOT NULL,
  correct     INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_results_session ON results(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_category ON bank_questions(category_id);
`);

/* SQLite has no ADD COLUMN IF NOT EXISTS, so check first. table/col/decl are
   always our own literals, never request data, so string interpolation here
   carries no injection risk. */
function ensureColumn(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
  }
}
ensureColumn("quizzes", "host_id", "INTEGER REFERENCES hosts(id) ON DELETE SET NULL");
ensureColumn("quizzes", "category_id", "INTEGER REFERENCES categories(id) ON DELETE SET NULL");
ensureColumn("sessions", "host_id", "INTEGER REFERENCES hosts(id) ON DELETE SET NULL");
/* 'name' (fun, nickname-friendly) or 'name_email' (formal, email required to join). */
ensureColumn("quizzes", "join_mode", "TEXT NOT NULL DEFAULT 'name'");
ensureColumn("quizzes", "gap_seconds", "INTEGER NOT NULL DEFAULT 5");
ensureColumn("results", "email", "TEXT");
ensureColumn("sessions", "questions_json", "TEXT");
ensureColumn("results", "answers_json", "TEXT");
/* 'live' (host-paced, real-time, scored/leaderboard) or 'selfpaced' (a
   shareable link, no lobby, taken individually - see server/selfpaced.js).
   share_token is only ever set for 'selfpaced' quizzes. */
ensureColumn("quizzes", "delivery_mode", "TEXT NOT NULL DEFAULT 'live'");
ensureColumn("quizzes", "share_token", "TEXT");
ensureColumn("sessions", "mode", "TEXT NOT NULL DEFAULT 'live'");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_quizzes_share_token ON quizzes(share_token) WHERE share_token IS NOT NULL");

const stmt = {
  listQuizzes: db.prepare(
    `SELECT id, title, questions, category_id, join_mode, gap_seconds, delivery_mode, share_token, updated_at
     FROM quizzes WHERE host_id = ? ORDER BY updated_at DESC`
  ),
  getQuiz: db.prepare(
    `SELECT id, title, questions, host_id, category_id, join_mode, gap_seconds, delivery_mode, share_token
     FROM quizzes WHERE id = ?`
  ),
  getQuizByShareToken: db.prepare(
    `SELECT id, title, questions, host_id, category_id, join_mode, gap_seconds, delivery_mode, share_token
     FROM quizzes WHERE share_token = ? AND delivery_mode = 'selfpaced'`
  ),
  insertQuiz: db.prepare(
    `INSERT INTO quizzes (title, questions, host_id, category_id, join_mode, gap_seconds, delivery_mode, share_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateQuiz: db.prepare(
    `UPDATE quizzes SET title = ?, questions = ?, category_id = ?, join_mode = ?, gap_seconds = ?,
       delivery_mode = ?, share_token = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteQuiz: db.prepare("DELETE FROM quizzes WHERE id = ?"),

  insertSession: db.prepare(
    "INSERT INTO sessions (pin, quiz_id, title, host_id, mode) VALUES (?, ?, ?, ?, ?)"
  ),
  closeSession: db.prepare(
    "UPDATE sessions SET ended_at = datetime('now'), player_count = ?, questions_json = ? WHERE id = ?"
  ),
  listSessions: db.prepare(
    `SELECT id, pin, title, player_count, mode, started_at, ended_at
     FROM sessions WHERE ended_at IS NOT NULL AND host_id = ?
     ORDER BY started_at DESC LIMIT ?`
  ),
  listAllSessions: db.prepare(
    `SELECT sessions.id, sessions.pin, sessions.title, sessions.player_count, sessions.mode,
            sessions.started_at, sessions.ended_at, hosts.email AS host_email
     FROM sessions LEFT JOIN hosts ON hosts.id = sessions.host_id
     WHERE sessions.ended_at IS NOT NULL
     ORDER BY sessions.started_at DESC LIMIT ?`
  ),
  getSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
  countSessions: db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE ended_at IS NOT NULL"),
  insertResult: db.prepare(
    `INSERT INTO results (session_id, rank, name, score, correct_count, answered, email, answers_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  listResults: db.prepare(
    "SELECT rank, name, score, correct_count, answered, email, answers_json FROM results WHERE session_id = ? ORDER BY rank"
  ),

  hostOverview: db.prepare(
    `SELECT COUNT(*) AS games, COALESCE(SUM(player_count), 0) AS totalPlayers,
            AVG(player_count) AS avgPlayers, MAX(started_at) AS lastPlayed
     FROM sessions WHERE ended_at IS NOT NULL AND host_id = ?`
  ),
  countQuizzesByHost: db.prepare("SELECT COUNT(*) AS n FROM quizzes WHERE host_id = ?"),

  /* Grouped by quiz_id when a session came from a saved quiz, or by title
     when it didn't (quiz_id NULL covers both "never saved" and "quiz later
     deleted", and two such sessions can be genuinely different quizzes that
     just happen to share no quiz_id, so title is what keeps them apart).
     Session-level sums (player_count) and result-level sums (score,
     correct_count) are aggregated in separate CTEs before being joined 1:1
     by group: joining sessions straight to results before aggregating would
     multiply every session-level number by that session's player count.
     The `grp` CTE applies the ended_at filter once, up front, so an
     abandoned session can never supply the title or last-played date for a
     bucket it doesn't actually count toward. */
  statsByQuiz: db.prepare(
    `WITH grp AS (
       SELECT id, quiz_id, title, player_count, started_at,
              COALESCE(quiz_id, 'title:' || title) AS gkey
       FROM sessions
       WHERE ended_at IS NOT NULL AND host_id = ?
     ),
     bySession AS (
       SELECT gkey, MAX(quiz_id) AS quizId, COUNT(*) AS games,
              COALESCE(SUM(player_count), 0) AS totalPlayers,
              MAX(started_at) AS lastPlayed
       FROM grp GROUP BY gkey
     ),
     byResult AS (
       SELECT grp.gkey AS gkey, AVG(r.score) AS avgScore,
              SUM(r.correct_count) AS totalCorrect, SUM(r.answered) AS totalAnswered
       FROM grp JOIN results r ON r.session_id = grp.id
       GROUP BY grp.gkey
     )
     SELECT bySession.quizId AS quizId,
            COALESCE(q.title, (
              SELECT title FROM grp WHERE grp.gkey = bySession.gkey ORDER BY grp.started_at DESC LIMIT 1
            )) AS title,
            bySession.games AS games,
            bySession.totalPlayers AS totalPlayers,
            bySession.lastPlayed AS lastPlayed,
            byResult.avgScore AS avgScore,
            byResult.totalCorrect AS totalCorrect,
            byResult.totalAnswered AS totalAnswered
     FROM bySession
     LEFT JOIN byResult ON byResult.gkey = bySession.gkey
     LEFT JOIN quizzes q ON q.id = bySession.quizId
     ORDER BY bySession.lastPlayed DESC`
  ),

  sessionsForGroup: db.prepare(
    `SELECT id, pin, title, player_count, started_at, ended_at
     FROM sessions
     WHERE ended_at IS NOT NULL AND host_id = ?
       AND ((? IS NOT NULL AND quiz_id = ?) OR (? IS NULL AND quiz_id IS NULL AND title = ?))
     ORDER BY started_at DESC`
  ),

  questionLogsForGroup: db.prepare(
    `SELECT s.id AS session_id, s.questions_json AS questions_json, r.answers_json AS answers_json
     FROM sessions s
     JOIN results r ON r.session_id = s.id
     WHERE s.ended_at IS NOT NULL AND s.host_id = ?
       AND ((? IS NOT NULL AND s.quiz_id = ?) OR (? IS NULL AND s.quiz_id IS NULL AND s.title = ?))`
  ),

  getAdminByEmail: db.prepare("SELECT * FROM admins WHERE email = ?"),
  getAdmin: db.prepare("SELECT * FROM admins WHERE id = ?"),
  upsertAdmin: db.prepare(
    `INSERT INTO admins (email, password_hash) VALUES (?, ?)
     ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash`
  ),

  listCategories: db.prepare("SELECT id, name, created_at FROM categories ORDER BY name"),
  getCategory: db.prepare("SELECT id, name FROM categories WHERE id = ?"),
  countCategories: db.prepare("SELECT COUNT(*) AS n FROM categories"),
  insertCategory: db.prepare("INSERT INTO categories (name) VALUES (?)"),
  deleteCategory: db.prepare("DELETE FROM categories WHERE id = ?"),

  listHosts: db.prepare(
    `SELECT hosts.id, hosts.email, hosts.max_players, hosts.status, hosts.created_at,
            (SELECT COUNT(*) FROM quizzes WHERE quizzes.host_id = hosts.id) AS quiz_count,
            (SELECT COUNT(*) FROM sessions WHERE sessions.host_id = hosts.id) AS game_count
     FROM hosts ORDER BY hosts.created_at DESC`
  ),
  getHost: db.prepare("SELECT * FROM hosts WHERE id = ?"),
  getHostByEmail: db.prepare("SELECT * FROM hosts WHERE email = ?"),
  insertHost: db.prepare("INSERT INTO hosts (email, max_players) VALUES (?, ?)"),
  setHostPassword: db.prepare(
    "UPDATE hosts SET password_hash = ?, status = 'active' WHERE id = ?"
  ),
  updateHostQuota: db.prepare("UPDATE hosts SET max_players = ? WHERE id = ?"),
  setHostStatus: db.prepare("UPDATE hosts SET status = ? WHERE id = ?"),
  deleteHost: db.prepare("DELETE FROM hosts WHERE id = ?"),

  insertInvite: db.prepare(
    "INSERT INTO invites (host_id, token, expires_at) VALUES (?, ?, ?)"
  ),
  getInviteByToken: db.prepare(
    `SELECT invites.*, hosts.email AS host_email
     FROM invites JOIN hosts ON hosts.id = invites.host_id
     WHERE token = ?`
  ),
  markInviteUsed: db.prepare("UPDATE invites SET used_at = datetime('now') WHERE id = ?"),

  listBank: db.prepare(
    `SELECT bank_questions.id, bank_questions.category_id, bank_questions.q,
            bank_questions.t, bank_questions.opts, bank_questions.correct,
            categories.name AS category_name
     FROM bank_questions JOIN categories ON categories.id = bank_questions.category_id
     WHERE (? IS NULL OR bank_questions.category_id = ?)
       AND (? IS NULL OR bank_questions.q LIKE ?)
     ORDER BY bank_questions.id`
  ),
  getBank: db.prepare("SELECT * FROM bank_questions WHERE id = ?"),
  insertBank: db.prepare(
    "INSERT INTO bank_questions (category_id, q, t, opts, correct) VALUES (?, ?, ?, ?, ?)"
  ),
  deleteBank: db.prepare("DELETE FROM bank_questions WHERE id = ?")
};

const parseQuiz = row =>
  row && {
    id: row.id,
    title: row.title,
    questions: JSON.parse(row.questions),
    categoryId: row.category_id ?? null,
    joinMode: row.join_mode || "name",
    gapSeconds: row.gap_seconds || 5,
    deliveryMode: row.delivery_mode || "live",
    shareToken: row.share_token || null,
    updated_at: row.updated_at,
    host_id: row.host_id
  };

const parseBank = row =>
  row && {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    q: row.q,
    t: row.t,
    opts: JSON.parse(row.opts),
    correct: row.correct
  };

export const store = {
  quizzes: {
    list: hostId => stmt.listQuizzes.all(hostId).map(parseQuiz),
    /* Scoped by host so one host can never see or touch another's quiz; a
       mismatch reads exactly like "doesn't exist" to the caller. */
    get: (id, hostId) => {
      const row = stmt.getQuiz.get(id);
      return row && row.host_id === hostId ? parseQuiz(row) : null;
    },
    create: (title, questions, hostId, categoryId, joinMode, gapSeconds, deliveryMode) => {
      const mode = deliveryMode === "selfpaced" ? "selfpaced" : "live";
      const shareToken = mode === "selfpaced" ? randomToken() : null;
      const info = stmt.insertQuiz.run(
        title, JSON.stringify(questions), hostId, categoryId || null, joinMode || "name", gapSeconds || 5, mode, shareToken
      );
      return store.quizzes.get(info.lastInsertRowid, hostId);
    },
    /* The share link stays stable across edits - only generated the first
       time a quiz becomes self-paced, reused after that - so a link a host
       has already handed out never silently breaks when they tweak a
       question. Switching back to 'live' clears it; switching to
       'selfpaced' again later mints a fresh one. */
    update: (id, title, questions, categoryId, hostId, joinMode, gapSeconds, deliveryMode) => {
      const mode = deliveryMode === "selfpaced" ? "selfpaced" : "live";
      const existing = stmt.getQuiz.get(id);
      const shareToken = mode === "selfpaced" ? (existing?.share_token || randomToken()) : null;
      stmt.updateQuiz.run(
        title, JSON.stringify(questions), categoryId || null, joinMode || "name", gapSeconds || 5, mode, shareToken, id
      );
      return store.quizzes.get(id, hostId);
    },
    remove: (id, hostId) => {
      const row = stmt.getQuiz.get(id);
      if (!row || row.host_id !== hostId) return false;
      return stmt.deleteQuiz.run(id).changes > 0;
    },
    /* Public lookup for the self-paced player flow - no host scoping, since
       the token itself is the access control. */
    getByShareToken: token => parseQuiz(stmt.getQuizByShareToken.get(String(token || "")))
  },

  sessions: {
    open: (pin, quizId, title, hostId, mode) =>
      Number(stmt.insertSession.run(pin, quizId || null, title, hostId || null, mode === "selfpaced" ? "selfpaced" : "live").lastInsertRowid),

    /* Written once, when a game finishes. A game that is abandoned midway
       never lands here, which keeps the history clean. */
    close: (sessionId, standings, questionTexts) => {
      const tx = db.transaction(rows => {
        rows.forEach((p, i) =>
          stmt.insertResult.run(sessionId, i + 1, p.name, p.score, p.correctCount, p.answered, p.email || null, JSON.stringify(p.log || []))
        );
        stmt.closeSession.run(rows.length, JSON.stringify(questionTexts || []), sessionId);
      });
      tx(standings);
    },

    list: (hostId, limit = 40) => stmt.listSessions.all(hostId, limit),
    listAll: (limit = 100) => stmt.listAllSessions.all(limit),
    count: () => stmt.countSessions.get().n,
    get: (id, hostId) => {
      const s = stmt.getSession.get(id);
      if (!s || (hostId != null && s.host_id !== hostId)) return null;
      return { ...s, results: stmt.listResults.all(id) };
    }
  },

  /* Host-facing analytics. Everything here is scoped to a single host's own
     games, mirroring the ownership check already done in quizzes/sessions
     above, so one host can never see another's results. */
  stats: {
    overview: hostId => {
      const row = stmt.hostOverview.get(hostId);
      return {
        games: row.games,
        totalPlayers: row.totalPlayers,
        avgPlayers: row.games ? Math.round((row.avgPlayers || 0) * 10) / 10 : 0,
        lastPlayed: row.lastPlayed,
        quizzes: stmt.countQuizzesByHost.get(hostId).n
      };
    },

    /* `groupKey` is the stable handle the client passes back to drill into
       one quiz: a saved quiz's own id as a string, or `t:<title>` for an
       ad-hoc/deleted-quiz bucket. Kept out of the SQL so the id/title pair
       stays the single source of truth for how a group is identified. */
    byQuiz: hostId =>
      stmt.statsByQuiz.all(hostId).map(r => ({
        quizId: r.quizId,
        groupKey: r.quizId != null ? String(r.quizId) : "t:" + r.title,
        title: r.title || "Untitled quiz",
        games: r.games,
        totalPlayers: r.totalPlayers,
        avgScore: r.avgScore ? Math.round(r.avgScore) : 0,
        accuracy: r.totalAnswered ? Math.round((r.totalCorrect / r.totalAnswered) * 100) : null,
        lastPlayed: r.lastPlayed
      })),

    forQuiz: (hostId, groupKey) => store.stats.byQuiz(hostId).find(q => q.groupKey === groupKey) || null,

    sessionsForQuiz: (hostId, quizId, title) => stmt.sessionsForGroup.all(hostId, quizId, quizId, quizId, title),

    /* Lines up each session's frozen question texts against every player's
       per-question answer log to find which questions actually trip people
       up across every time this quiz has been played. Sessions can differ in
       question count/order if the quiz was edited between games, so this
       tallies by question text rather than by index. One query for the
       whole group rather than one round trip per session. */
    questionBreakdown: (hostId, quizId, title) => {
      const tally = new Map();
      const questionsCache = new Map();
      for (const row of stmt.questionLogsForGroup.all(hostId, quizId, quizId, quizId, title)) {
        let questions = questionsCache.get(row.session_id);
        if (!questions) {
          try { questions = JSON.parse(row.questions_json || "[]"); } catch { questions = []; }
          questionsCache.set(row.session_id, questions);
        }
        let log = [];
        try { log = JSON.parse(row.answers_json || "[]"); } catch { log = []; }
        log.forEach((outcome, i) => {
          const text = questions[i] || `Question ${i + 1}`;
          if (!tally.has(text)) tally.set(text, { right: 0, wrong: 0, skipped: 0 });
          const t = tally.get(text);
          if (outcome === "Right") t.right++;
          else if (outcome === "Wrong") t.wrong++;
          else t.skipped++;
        });
      }
      return [...tally.entries()].map(([q, t]) => {
        const total = t.right + t.wrong + t.skipped;
        return {
          q,
          right: t.right,
          wrong: t.wrong,
          skipped: t.skipped,
          total,
          accuracy: total ? Math.round((t.right / total) * 100) : null
        };
      });
    }
  },

  admins: {
    getByEmail: email => stmt.getAdminByEmail.get(email),
    get: id => stmt.getAdmin.get(id),
    upsert: (email, passwordHash) => {
      stmt.upsertAdmin.run(email, passwordHash);
      return store.admins.getByEmail(email);
    }
  },

  categories: {
    list: () => stmt.listCategories.all(),
    get: id => stmt.getCategory.get(id),
    count: () => stmt.countCategories.get().n,
    create: name => {
      const info = stmt.insertCategory.run(name);
      return store.categories.get(info.lastInsertRowid);
    },
    remove: id => stmt.deleteCategory.run(id).changes > 0
  },

  hosts: {
    list: () => stmt.listHosts.all(),
    get: id => stmt.getHost.get(id),
    getByEmail: email => stmt.getHostByEmail.get(email),
    create: (email, maxPlayers) => {
      const info = stmt.insertHost.run(email, maxPlayers || 400);
      return store.hosts.get(info.lastInsertRowid);
    },
    setPassword: (id, passwordHash) => stmt.setHostPassword.run(passwordHash, id).changes > 0,
    updateQuota: (id, maxPlayers) => stmt.updateHostQuota.run(maxPlayers, id).changes > 0,
    setStatus: (id, status) => stmt.setHostStatus.run(status, id).changes > 0,
    remove: id => stmt.deleteHost.run(id).changes > 0
  },

  invites: {
    create: (hostId, token, expiresAt) => {
      stmt.insertInvite.run(hostId, token, expiresAt);
      return store.invites.getByToken(token);
    },
    getByToken: token => stmt.getInviteByToken.get(token),
    markUsed: id => stmt.markInviteUsed.run(id).changes > 0
  },

  bank: {
    list: (categoryId, search) => {
      const like = search ? `%${search}%` : null;
      return stmt.listBank.all(categoryId ?? null, categoryId ?? null, like, like).map(parseBank);
    },
    get: id => parseBank(stmt.getBank.get(id)),
    create: (categoryId, q, t, opts, correct) => {
      const info = stmt.insertBank.run(categoryId, q, t, JSON.stringify(opts), correct);
      return store.bank.get(info.lastInsertRowid);
    },
    remove: id => stmt.deleteBank.run(id).changes > 0
  }
};

/* Populate the starter question bank once, the first time this ever runs
   against a fresh database. Never re-seeds once categories exist, so admin
   edits/deletes to the bank stick across restarts. */
(function seedQuestionBank() {
  if (store.categories.count() > 0) return;
  const tx = db.transaction(() => {
    for (const { category, questions } of QUESTION_BANK_SEED) {
      const cat = store.categories.create(category);
      for (const q of questions) store.bank.create(cat.id, q.q, q.t, q.opts, q.correct);
    }
  });
  tx();
})();

export default db;
