"use strict";

const $ = id => document.getElementById(id);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const LETTERS = ["A", "B", "C", "D"];
const COLORS = ["c1", "c2", "c3", "c4"];
/* One shape per position - triangle/diamond/circle/square - the same
   pairing the live-quiz genre uses so an option reads by shape and color
   together, not just a letter. */
const SHAPES = [
  '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,3 22,20 2,20"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,2 22,12 12,22 2,12"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>'
];
function shapeTag(i) {
  const t = el("span", "tag");
  t.innerHTML = SHAPES[i];
  t.setAttribute("aria-label", window.t("common.optionX", { x: LETTERS[i] }));
  return t;
}

function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("on"));
  $(id).classList.add("on");
  window.scrollTo(0, 0);
  /* Confetti is position:fixed and outlives a quick screen switch, so
     without this it would keep raining over whatever screen comes next. */
  document.querySelectorAll(".confetti-piece").forEach(p => p.remove());
}

/* No socket here at all - this is a plain request/response flow, one
   question at a time, with no shared clock. See server/selfpaced.js for why
   this is deliberately a separate, simpler engine from the live game. */
const token = location.pathname.split("/take/")[1]?.split("/")[0] || "";

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error(I18N.errorText(data));
  return data;
}

const S = { meta: null, attemptId: null, total: 0, qIndex: 0, name: "", score: 0, answered: false };

$("tIntro").textContent = t("take.intro");

async function init() {
  try {
    S.meta = await api("/api/selfpaced/" + token);
  } catch (e) {
    $("tTitle").textContent = t("take.linkNotFound");
    $("tIntro").textContent = e.message;
    $("tStart").hidden = true;
    return;
  }
  $("tTitle").textContent = S.meta.title;
  $("tEmailField").hidden = S.meta.joinMode !== "name_email";
}
init();

$("tName").addEventListener("keydown", e => { if (e.key === "Enter") start(); });
$("tStart").addEventListener("click", start);

async function start() {
  $("tErr").textContent = "";
  const name = $("tName").value.trim();
  const email = $("tEmail").value.trim();
  if (!name) { $("tErr").textContent = t("err.name_required"); return; }
  $("tStart").disabled = true;
  try {
    const res = await api("/api/selfpaced/" + token + "/start", { method: "POST", body: { name, email } });
    S.attemptId = res.attemptId;
    S.total = res.total;
    S.name = name;
    S.score = 0;
    $("finName").textContent = name;
    renderQuestion(res.question);
  } catch (e) {
    $("tErr").textContent = e.message;
  } finally {
    $("tStart").disabled = false;
  }
}

const TYPE_HINTS = { multi: "hint.selectAll", text: "hint.typeAnswer", numeric: "hint.enterGuess" };

function renderQuestion(q) {
  /* Trust the server's qIndex rather than counting locally, since that's
     the same value the server checks a submitted answer against - see the
     comment on Attempt.answer() in server/selfpaced.js. */
  S.qIndex = q.qIndex;
  $("tQn").textContent = (S.qIndex + 1) + "/" + S.total;
  $("tQ").textContent = q.q;
  $("tImg").hidden = !q.img;
  $("tImg").src = q.img || "";
  $("tScore").textContent = S.score;
  const hint = TYPE_HINTS[q.type] ? t(TYPE_HINTS[q.type]) : "";
  $("tHint").textContent = hint;
  $("tHint").hidden = !hint;

  const pad = $("tPad");
  pad.innerHTML = "";
  pad.className = "pad";
  S.answered = false;

  if (q.type === "text") renderTextPad(pad);
  else if (q.type === "numeric") renderNumericPad(pad);
  else if (q.type === "multi") renderMultiPad(pad, q);
  else renderSinglePad(pad, q);

  show("t-question");
}

function submitAnswer(value) {
  if (S.answered) return;
  S.answered = true;
  api("/api/selfpaced/attempts/" + S.attemptId + "/answer", { method: "POST", body: { answer: value, qIndex: S.qIndex } })
    .then(showFeedback)
    .catch(e => { S.answered = false; alert(e.message); });
}

function renderSinglePad(pad, q) {
  q.opts.forEach((o, i) => {
    const b = el("button", "ans " + COLORS[i]);
    b.appendChild(shapeTag(i));
    b.appendChild(el("span", "txt", o));
    b.addEventListener("click", () => {
      if (S.answered) return;
      [...pad.children].forEach((n, k) => { n.classList.add(k === i ? "picked" : "faded"); n.disabled = true; });
      submitAnswer(i);
    });
    pad.appendChild(b);
  });
}

function renderMultiPad(pad, q) {
  pad.className = "pad multi";
  q.opts.forEach((o, i) => {
    const b = el("button", "ans " + COLORS[i]);
    b.appendChild(shapeTag(i));
    b.appendChild(el("span", "txt", o));
    b.dataset.i = String(i);
    b.addEventListener("click", () => { if (!S.answered) b.classList.toggle("picked"); });
    pad.appendChild(b);
  });
  const tiles = () => [...pad.querySelectorAll(".ans")];
  const submitBtn = el("button", "btn big", t("common.submitAnswer"));
  submitBtn.addEventListener("click", () => {
    if (S.answered) return;
    const picks = tiles().filter(n => n.classList.contains("picked")).map(n => Number(n.dataset.i));
    if (!picks.length) return;
    tiles().forEach(n => { n.disabled = true; if (!n.classList.contains("picked")) n.classList.add("faded"); });
    submitBtn.disabled = true;
    submitAnswer(picks);
  });
  pad.appendChild(submitBtn);
}

function renderTextPad(pad) {
  pad.className = "pad stack";
  const input = el("textarea", "inp");
  input.rows = 3; input.maxLength = 300; input.placeholder = t("common.typeAnswerPh");
  const submitBtn = el("button", "btn big", t("common.submit"));
  submitBtn.addEventListener("click", () => {
    if (S.answered) return;
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true; submitBtn.disabled = true;
    submitAnswer(text);
  });
  pad.append(input, submitBtn);
}

function renderNumericPad(pad) {
  pad.className = "pad stack";
  const input = el("input", "inp");
  input.type = "number"; input.inputMode = "decimal"; input.placeholder = t("common.guessPh");
  const submitBtn = el("button", "btn big", t("common.submit"));
  submitBtn.addEventListener("click", () => {
    if (S.answered) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    input.disabled = true; submitBtn.disabled = true;
    submitAnswer(value);
  });
  pad.append(input, submitBtn);
}

function showFeedback(res) {
  S.score = res.score;
  const v = $("fbVerdict");
  $("fbScore").textContent = S.score;

  if (res.correct === null) {
    v.textContent = t("common.answerRecorded");
    v.className = "verdict";
    $("fbPts").textContent = "";
    $("fbSub").textContent = t("common.totalPoints", { n: S.score });
  } else {
    Sound.play(res.correct ? "correct" : "incorrect");
    v.textContent = res.correct ? t("common.correct") : t("common.notThisTime");
    v.className = "verdict " + (res.correct ? "good" : "bad");
    $("fbPts").textContent = res.points ? "+" + res.points : "+0";
    const correctDescription = res.correctTexts ? res.correctTexts.join(", ")
      : res.target != null ? String(res.target)
      : res.correctText;
    const total = t("common.totalPoints", { n: S.score });
    $("fbSub").textContent = res.correct
      ? total
      : t("common.answerWas", { answer: correctDescription }) + " " + total;
  }

  $("fbNext").textContent = res.done ? t("take.seeResults") : t("common.nextQuestion");
  $("fbNext").onclick = () => {
    if (res.done) return showFinal(res);
    renderQuestion(res.next);
  };
  show("t-feedback");
}

function showFinal(res) {
  $("finScore").textContent = t("common.pts", { n: res.score });
  $("finSub").textContent = t("common.rightOutOf", { right: res.correctCount, total: res.answered });
  Sound.play("podium");
  confetti();
  show("t-final");
}

/* A quick celebratory burst on finishing - self-paced has no rank or
   streak to celebrate, so this is the one moment that gets to feel good
   regardless of score, matching the encouraging tone the rest of the
   quiz genre uses at the finish line. */
function confetti(count = 46) {
  /* The global prefers-reduced-motion rule just speeds every animation to
     near-zero, which for a burst of falling pieces would read as an
     instant flash rather than nothing - skip spawning entirely instead. */
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["var(--a1)", "var(--a2)", "var(--a3)", "var(--a4)", "var(--live)"];
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.transform = "rotate(" + Math.floor(Math.random() * 360) + "deg)";
    const duration = 2200 + Math.random() * 1400;
    piece.style.animationDuration = duration + "ms";
    piece.style.animationDelay = Math.random() * 300 + "ms";
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), duration + 400);
  }
}

$("finAgain").addEventListener("click", () => location.reload());
