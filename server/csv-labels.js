/* Column headers and outcome cells for the results CSV, in the language the
   host console was using when they clicked download (?lang=...). The
   database keeps logging outcomes as the English literals "Right" /
   "Wrong" / "No answer", which store.stats.questionBreakdown() matches on,
   so translation happens here at export time only. */
const LABELS = {
  en: { rank: "Rank", name: "Name", email: "Email", score: "Score", correct: "Correct", answered: "Answered", q: "Q", right: "Right", wrong: "Wrong", none: "No answer" },
  fr: { rank: "Rang", name: "Nom", email: "E-mail", score: "Score", correct: "Bonnes réponses", answered: "Répondues", q: "Q", right: "Juste", wrong: "Faux", none: "Pas de réponse" },
  de: { rank: "Platz", name: "Name", email: "E-Mail", score: "Punkte", correct: "Richtig", answered: "Beantwortet", q: "F", right: "Richtig", wrong: "Falsch", none: "Keine Antwort" },
  es: { rank: "Puesto", name: "Nombre", email: "Correo", score: "Puntos", correct: "Aciertos", answered: "Respondidas", q: "P", right: "Correcta", wrong: "Incorrecta", none: "Sin respuesta" },
  el: { rank: "Θέση", name: "Όνομα", email: "Email", score: "Πόντοι", correct: "Σωστές", answered: "Απαντήθηκαν", q: "Ε", right: "Σωστό", wrong: "Λάθος", none: "Χωρίς απάντηση" },
  pt: { rank: "Posição", name: "Nome", email: "Email", score: "Pontos", correct: "Certas", answered: "Respondidas", q: "P", right: "Certa", wrong: "Errada", none: "Sem resposta" },
  ro: { rank: "Loc", name: "Nume", email: "Email", score: "Scor", correct: "Corecte", answered: "Răspunse", q: "Î", right: "Corect", wrong: "Greșit", none: "Niciun răspuns" }
};

export function csvLabels(lang) {
  return LABELS[String(lang || "").toLowerCase()] || LABELS.en;
}

/** Maps a stored per-question log entry to the export language. Free-text
 *  answers (anything that isn't one of the three outcome literals) pass
 *  through untouched. */
export function csvOutcome(entry, labels) {
  if (entry === "Right") return labels.right;
  if (entry === "Wrong") return labels.wrong;
  if (entry === "No answer") return labels.none;
  return entry;
}
