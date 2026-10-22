import { csvLabels, csvOutcome } from "./csv-labels.js";
import { sendMail } from "./mail.js";
import { store } from "./db.js";

/* Player names and free-text answers come from the public. A cell that
   starts with = + - @ (or a tab/CR) is run as a formula by Excel and
   Sheets, so prefix those with an apostrophe (OWASP's advice for CSV
   injection). Numbers, like scores, pass through untouched. */
const cell = v => {
  let text = String(v ?? "");
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
};

/* `s` is a session as returned by store.sessions.get(). Shared by the
   download route and the emailed copy so the two can never drift apart. */
export function sessionCsv(s, lang) {
  let questions = [];
  try { questions = JSON.parse(s.questions_json || "[]"); } catch { questions = []; }
  const L = csvLabels(lang);
  const qHeaders = questions.map((q, i) => `${L.q}${i + 1}: ${q}`);
  const lines = [[L.rank, L.name, L.email, L.score, L.correct, L.answered, ...qHeaders].map(cell).join(",")];
  s.results.forEach(r => {
    let log = [];
    try { log = JSON.parse(r.answers_json || "[]"); } catch { log = []; }
    const perQuestion = questions.map((_, i) => csvOutcome(log[i] || "", L));
    lines.push([r.rank, r.name, r.email, r.score, r.correct_count, r.answered, ...perQuestion].map(cell).join(","));
  });
  return "\uFEFF" + lines.join("\r\n");
}

export const csvFilename = s => `${s.title.replace(/[^\w]+/g, "_").slice(0, 40)}_${s.id}.csv`;

/* Called when a live game's results have been saved. Emails the owning host a
   summary with the full CSV. Never throws: a mail problem must not touch the
   game that just finished. */
export async function emailSessionResults(sessionId, hostId) {
  try {
    const host = hostId != null ? store.hosts.get(hostId) : null;
    const s = host && store.sessions.get(sessionId, hostId);
    if (!s || !s.results.length) return false;
    const n = s.results.length;
    const avg = Math.round(s.results.reduce((a, r) => a + r.score, 0) / n);
    const top = s.results.slice(0, 5).map(r => `${r.rank}. ${r.name} - ${r.score}`).join("\n");
    const title = s.title.replace(/[\r\n]+/g, " ");
    return await sendMail({
      to: host.email,
      subject: `Results: ${title}`,
      text:
        `Your quiz "${title}" has finished.\n\nPlayers: ${n}\nAverage score: ${avg}\n\nTop players:\n${top}\n\n` +
        `The full results are attached as a CSV file. They also stay in Past games.\n`,
      attachments: [{ filename: csvFilename(s), content: sessionCsv(s, "en"), contentType: "text/csv; charset=utf-8" }]
    });
  } catch (err) {
    console.error("results email failed:", err.message);
    return false;
  }
}
