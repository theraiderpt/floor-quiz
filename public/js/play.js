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
  t.setAttribute("aria-label", "Option " + LETTERS[i]);
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

/* This is a normal web app on your own domain, not a sandboxed page, so
   sessionStorage is available and is exactly the right tool here: it lets a
   player who refreshes or locks their phone rejoin the same game with their
   score intact, and it clears itself when the tab closes. */
const Session = {
  save(v) { try { sessionStorage.setItem("fq", JSON.stringify(v)); } catch { } },
  load() { try { return JSON.parse(sessionStorage.getItem("fq") || "null"); } catch { return null; } },
  clear() { try { sessionStorage.removeItem("fq"); } catch { } }
};

const socket = io({ transports: ["websocket", "polling"], reconnectionDelayMax: 4000 });

const me = { pin: null, playerId: null, name: "", score: 0 };
let currentQ = -1;
let answered = false;
let endsAt = 0;
let rafId = null;

/* ------------------------------------------------------------- joining --- */

const prefill = new URLSearchParams(location.search).get("pin");
if (prefill && /^\d{4}$/.test(prefill)) $("jPin").value = prefill;

/* Purely a fun display-name suggestion, never the identity key - a host
   that requires email still gets a real identity via the email field. */
const NICK_ADJ = ["Turbo", "Sneaky", "Bubbly", "Zesty", "Mighty", "Chatty", "Breezy", "Cosmic", "Plucky", "Jolly", "Nifty", "Swift", "Dapper", "Spicy", "Loyal", "Clever"];
const NICK_NOUN = ["Panda", "Llama", "Waffle", "Falcon", "Otter", "Comet", "Ninja", "Biscuit", "Penguin", "Rocket", "Walrus", "Yeti", "Koala", "Pretzel", "Badger", "Narwhal"];
function randomNickname() {
  const a = NICK_ADJ[Math.floor(Math.random() * NICK_ADJ.length)];
  const n = NICK_NOUN[Math.floor(Math.random() * NICK_NOUN.length)];
  return `${a} ${n}`;
}
$("jNick").addEventListener("click", () => { $("jName").value = randomNickname(); });

$("jPin").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); });
$("jName").addEventListener("keydown", e => { if (e.key === "Enter") join(); });
$("jGo").addEventListener("click", () => join());
$("fAgain").addEventListener("click", () => { Session.clear(); location.href = "/"; });

function join(rejoinWith) {
  const pin = rejoinWith ? rejoinWith.pin : $("jPin").value.trim();
  const name = rejoinWith ? rejoinWith.name : $("jName").value.trim();
  const email = rejoinWith ? rejoinWith.email : $("jEmail").value.trim();
  $("jErr").textContent = "";

  if (!/^\d{4}$/.test(pin)) return ($("jErr").textContent = "The PIN is four digits.");
  if (!name) return ($("jErr").textContent = "Add a name so the host can see you.");

  $("jGo").disabled = true;
  socket.emit("player:join", { pin, name, email, playerId: rejoinWith?.playerId }, res => {
    $("jGo").disabled = false;
    if (!res || res.error) {
      Session.clear();
      $("jErr").textContent = (res && res.error) || "Could not reach the game.";
      show("s-join");
      return;
    }
    me.pin = pin;
    me.playerId = res.playerId;
    me.name = res.name;
    me.score = res.score || 0;
    Session.save({ pin, name: res.name, email, playerId: res.playerId });

    $("wName").textContent = me.name;
    $("rName").textContent = me.name;
    $("fName").textContent = me.name;
    $("wMsg").textContent = res.rejoined ? "Back in" : "You're in, " + me.name.split(" ")[0];
    updateScore();
    applyState(res.state);
  });
}

/* --------------------------------------------------------- state flow --- */

function applyState(s) {
  if (!s) return;
  if (s.phase === "question") {
    if (s.qIndex !== currentQ) {
      currentQ = s.qIndex;
      answered = false;
      renderPad(s);
    }
    endsAt = Date.now() + s.msLeft;
    show("s-answer");
    runClock(s.question.t * 1000);
  } else if (s.phase === "lobby") {
    $("wMsg").textContent = "You're in, " + me.name.split(" ")[0];
    $("wSub").textContent = "Keep this screen open. The question appears here when the host starts.";
    show("s-wait");
  } else if (s.phase === "scores") {
    $("wMsg").textContent = "Standings are on the big screen";
    $("wSub").textContent = "You're on " + me.score + " points. Next question coming up.";
    show("s-wait");
  }
}

socket.on("state", applyState);

socket.on("result", r => {
  stopClock();
  me.score = r.score;
  updateScore();
  const v = $("rVerdict");
  $("rStreak").innerHTML = "";

  /* Unscored text questions have no right/wrong verdict - they're a
     discussion prompt, not something to grade. */
  if (r.type === "text") {
    v.textContent = r.answered ? "Answer recorded" : "No answer";
    v.className = "verdict";
    $("rPts").textContent = "";
    $("rRank").textContent = "—";
    $("rSub").textContent = "Total " + r.score + " points.";
    return show("s-result");
  }

  if (!r.answered) { v.textContent = "No answer"; v.className = "verdict"; }
  else if (r.correct) { v.textContent = "Correct"; v.className = "verdict good"; }
  else { v.textContent = "Not this time"; v.className = "verdict bad"; }

  $("rPts").textContent = r.points ? "+" + r.points : "+0";
  $("rRank").textContent = r.rank ? "#" + r.rank : "—";

  const correctDescription = r.type === "multi" ? r.correctTexts.join(", ")
    : r.type === "numeric" ? String(r.target)
    : r.correctText;
  const guessNote = r.type === "numeric" && r.answered ? "You guessed " + r.value + ". " : "";
  $("rSub").textContent = r.correct
    ? "Total " + r.score + " points."
    : guessNote + "The answer was " + correctDescription + ". Total " + r.score + " points.";
  /* A small burst on a building streak (matches the streak badge's own
     threshold), not on every single correct answer - a 20-question quiz
     would make that feel like spam rather than a reward. Purely visual, no
     sound: see public/js/sound.js's note on why the live player screen
     stays silent in a room full of phones. */
  if (r.correct && r.streak > 1) { $("rStreak").appendChild(streakBadge(r.streak)); confetti(16); }
  show("s-result");
});

socket.on("gameover", g => {
  stopClock();
  Session.clear();
  $("fRank").textContent = g.rank ? "You finished #" + g.rank : "Thanks for playing";
  $("fScore").textContent = g.score + " pts";
  $("fSub").textContent = g.correctCount + " right out of " + g.total +
    (g.of ? ", against " + g.of + " players." : ".");
  if (g.rank && g.rank <= 3) confetti();
  show("s-final");
});

socket.on("kicked", () => {
  Session.clear();
  stopClock();
  $("jErr").textContent = "The host removed you from that game.";
  show("s-join");
});

/* ------------------------------------------------------------ answering --- */

function renderPad(s) {
  $("aQn").textContent = (s.qIndex + 1) + "/" + s.total;
  $("aQ").textContent = s.question.q;
  $("aImg").hidden = !s.question.img;
  $("aImg").src = s.question.img || "";
  const pad = $("aPad");
  pad.innerHTML = "";
  pad.className = "pad";
  const type = s.question.type;
  if (type === "text") renderTextPad(pad);
  else if (type === "numeric") renderNumericPad(pad);
  else if (type === "multi") renderMultiPad(pad, s);
  else renderSinglePad(pad, s);
}

/* Shared by every question type: submits once, locks the UI, and either
   moves on to the "locked in, wait for reveal" screen or - on a rejected
   answer - hands back control via `onError` so the player can retry. */
function sendAnswer(value, onError) {
  if (answered) return;
  answered = true;
  socket.emit("player:answer", { answer: value }, res => {
    if (res && res.error) {
      answered = false;
      onError?.();
      return;
    }
    stopClock();
    $("wMsg").textContent = "Locked in";
    $("wSub").textContent = "Hold tight for the reveal.";
    setTimeout(() => { if (answered) show("s-wait"); }, 420);
  });
}

function renderSinglePad(pad, s) {
  s.question.opts.forEach((o, i) => {
    const b = el("button", "ans " + COLORS[i]);
    b.appendChild(shapeTag(i));
    b.appendChild(el("span", "txt", o));
    b.addEventListener("click", () => {
      if (answered) return;
      [...pad.children].forEach((n, k) => { n.classList.add(k === i ? "picked" : "faded"); n.disabled = true; });
      sendAnswer(i, () => [...pad.children].forEach(n => { n.classList.remove("picked", "faded"); n.disabled = false; }));
    });
    pad.appendChild(b);
  });
}

function renderMultiPad(pad, s) {
  pad.className = "pad multi";
  s.question.opts.forEach((o, i) => {
    const b = el("button", "ans " + COLORS[i]);
    b.appendChild(shapeTag(i));
    b.appendChild(el("span", "txt", o));
    b.dataset.i = String(i);
    b.addEventListener("click", () => {
      if (answered) return;
      b.classList.toggle("picked");
    });
    pad.appendChild(b);
  });
  const tiles = () => [...pad.querySelectorAll(".ans")];
  const submit = el("button", "btn big", "Submit answer");
  submit.addEventListener("click", () => {
    if (answered) return;
    const picks = tiles().filter(n => n.classList.contains("picked")).map(n => Number(n.dataset.i));
    if (!picks.length) return;
    tiles().forEach(n => { n.disabled = true; if (!n.classList.contains("picked")) n.classList.add("faded"); });
    submit.disabled = true;
    sendAnswer(picks, () => { tiles().forEach(n => { n.disabled = false; n.classList.remove("faded"); }); submit.disabled = false; });
  });
  pad.appendChild(submit);
}

function renderTextPad(pad) {
  pad.className = "pad stack";
  const input = el("textarea", "inp");
  input.rows = 3; input.maxLength = 300; input.placeholder = "Type your answer…";
  const submit = el("button", "btn big", "Submit");
  submit.addEventListener("click", () => {
    if (answered) return;
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true; submit.disabled = true;
    sendAnswer(text, () => { input.disabled = false; submit.disabled = false; });
  });
  pad.append(input, submit);
}

function renderNumericPad(pad) {
  pad.className = "pad stack";
  const input = el("input", "inp");
  input.type = "number"; input.inputMode = "decimal"; input.placeholder = "Your best guess";
  const submit = el("button", "btn big", "Submit");
  submit.addEventListener("click", () => {
    if (answered) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    input.disabled = true; submit.disabled = true;
    sendAnswer(value, () => { input.disabled = false; submit.disabled = false; });
  });
  pad.append(input, submit);
}

function runClock(durMs) {
  stopClock();
  const fill = $("aFill"), clock = $("aClock");
  const step = () => {
    const left = Math.max(0, endsAt - Date.now());
    const frac = Math.min(1, left / durMs);
    fill.style.width = (frac * 100).toFixed(2) + "%";
    fill.className = "fill" + (frac < 0.2 ? " crit" : frac < 0.45 ? " warn" : "");
    clock.className = "clock" + (frac < 0.2 ? " crit" : "");
    clock.textContent = Math.ceil(left / 1000);
    rafId = left > 0 ? requestAnimationFrame(step) : null;
  };
  rafId = requestAnimationFrame(step);
}
function stopClock() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } $("aClock")?.classList.remove("crit"); }

/* Shown on a player's own result when they're a few correct answers into a
   row - surfaces the streak bonus that already exists in scoring but
   otherwise never shows up anywhere in the UI. */
const FLAME_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3-3 4-3 8a3 3 0 106 0c0-1-1-2-1-3 2 1 4 4 4 7a6 6 0 11-12 0c0-6 4-9 6-12z"/></svg>';
function streakBadge(n) {
  const b = el("span", "streakbadge");
  b.innerHTML = FLAME_ICON + "<span>" + n + " in a row</span>";
  return b;
}

/* A quick celebratory burst for a top-3 finish - the single biggest "come
   back and play again" moment a live quiz has. */
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

function updateScore() {
  $("wScore").textContent = me.score;
  $("aScore").textContent = me.score;
}

/* ------------------------------------------------------- connectivity --- */

const banner = $("offline");
socket.on("connect", () => {
  banner.classList.remove("on");
  document.querySelectorAll(".dot").forEach(d => d.classList.remove("down"));
  const saved = Session.load();
  if (saved && saved.pin && saved.playerId) join(saved);
});
socket.on("disconnect", () => {
  banner.classList.add("on");
  document.querySelectorAll(".dot").forEach(d => d.classList.add("down"));
});
socket.io.on("reconnect_attempt", () => { banner.textContent = "Connection lost. Reconnecting…"; });
