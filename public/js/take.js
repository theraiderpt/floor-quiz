"use strict";

const $ = id => document.getElementById(id);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const LETTERS = ["A", "B", "C", "D"];
const COLORS = ["c1", "c2", "c3", "c4"];
/* One shape per position - triangle/diamond/circle/square - the same
   pairing the live-quiz genre uses so an option reads by shape and color
   together, not just a letter. */
const SHAPES = [
  '<svg viewBox="0 0 24 24"><polygon points="12,3 22,20 2,20"/></svg>',
  '<svg viewBox="0 0 24 24"><polygon points="12,2 22,12 12,22 2,12"/></svg>',
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>',
  '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>'
];
function shapeTag(i) {
  const t = el("span", "tag");
  t.innerHTML = SHAPES[i];
  t.setAttribute("aria-label", "Option " + LETTERS[i]);
  return t;
}

function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("on"));
  $(id).classList.add("on");
  window.scrollTo(0, 0);
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
  if (!res.ok) throw new Error((data && data.error) || "Something went wrong.");
  return data;
}

const S = { meta: null, attemptId: null, total: 0, qIndex: 0, name: "", score: 0, answered: false };

async function init() {
  try {
    S.meta = await api("/api/selfpaced/" + token);
  } catch (e) {
    $("tTitle").textContent = "Link not found";
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
  if (!name) { $("tErr").textContent = "Add your name to start."; return; }
  $("tStart").disabled = true;
  try {
    const res = await api("/api/selfpaced/" + token + "/start", { method: "POST", body: { name, email } });
    S.attemptId = res.attemptId;
    S.total = res.total;
    S.qIndex = 0;
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

const TYPE_HINTS = { multi: "Select all that apply", text: "Type your answer", numeric: "Enter your best guess" };

function renderQuestion(q) {
  $("tQn").textContent = (S.qIndex + 1) + "/" + S.total;
  $("tQ").textContent = q.q;
  $("tScore").textContent = S.score;
  const hint = TYPE_HINTS[q.type];
  $("tHint").textContent = hint || "";
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
  api("/api/selfpaced/attempts/" + S.attemptId + "/answer", { method: "POST", body: { answer: value } })
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
  const submitBtn = el("button", "btn big", "Submit answer");
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
  input.rows = 3; input.maxLength = 300; input.placeholder = "Type your answer…";
  const submitBtn = el("button", "btn big", "Submit");
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
  input.type = "number"; input.inputMode = "decimal"; input.placeholder = "Your best guess";
  const submitBtn = el("button", "btn big", "Submit");
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
    v.textContent = "Answer recorded";
    v.className = "verdict";
    $("fbPts").textContent = "";
    $("fbSub").textContent = "Total " + S.score + " points.";
  } else {
    v.textContent = res.correct ? "Correct" : "Not this time";
    v.className = "verdict " + (res.correct ? "good" : "bad");
    $("fbPts").textContent = res.points ? "+" + res.points : "+0";
    const correctDescription = res.correctTexts ? res.correctTexts.join(", ")
      : res.target != null ? String(res.target)
      : res.correctText;
    $("fbSub").textContent = res.correct
      ? "Total " + S.score + " points."
      : "The answer was " + correctDescription + ". Total " + S.score + " points.";
  }

  $("fbNext").textContent = res.done ? "See results" : "Next question";
  $("fbNext").onclick = () => {
    if (res.done) return showFinal(res);
    S.qIndex++;
    renderQuestion(res.next);
  };
  show("t-feedback");
}

function showFinal(res) {
  $("finScore").textContent = res.score + " pts";
  $("finSub").textContent = res.correctCount + " right out of " + res.answered + ".";
  confetti();
  show("t-final");
}

/* A quick celebratory burst on finishing - self-paced has no rank or
   streak to celebrate, so this is the one moment that gets to feel good
   regardless of score, matching the encouraging tone the rest of the
   quiz genre uses at the finish line. */
function confetti(count = 46) {
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
