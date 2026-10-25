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

const me = { pin: null, playerId: null, name: "", score: 0, streak: 0 };
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

  if (!/^\d{4}$/.test(pin)) return ($("jErr").textContent = t("play.pinFormat"));
  if (!name) return ($("jErr").textContent = t("err.name_required"));

  $("jGo").disabled = true;
  socket.emit("player:join", { pin, name, email, playerId: rejoinWith?.playerId }, res => {
    $("jGo").disabled = false;
    if (!res || res.error) {
      Session.clear();
      $("jErr").textContent = I18N.errorText(res, "play.unreachable");
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
    $("wMsg").textContent = res.rejoined ? t("play.backIn") : t("play.youreIn", { name: me.name.split(" ")[0] });
    updateScore();
    applyState(res.state);
  });
}

/* --------------------------------------------------------- state flow --- */

function applyState(s) {
  if (!s) return;
  if (s.phase === "question") {
    /* Rejoined (reload, locked phone) after already answering this one:
       go straight to "locked in" rather than offering a pad the server
       will only refuse. */
    if (s.youAnswered) {
      currentQ = s.qIndex;
      answered = true;
      stopClock();
      showLockedIn();
      return;
    }
    if (s.qIndex !== currentQ) {
      currentQ = s.qIndex;
      answered = false;
      renderPad(s);
    }
    endsAt = Date.now() + s.msLeft;
    show("s-answer");
    runClock(s.question.t * 1000);
  } else if (s.phase === "lobby") {
    $("wMsg").textContent = t("play.youreIn", { name: me.name.split(" ")[0] });
    $("wSub").textContent = t("play.waitSub");
    show("s-wait");
  } else if (s.phase === "scores") {
    $("wMsg").textContent = t("play.standingsMsg");
    $("wSub").textContent = t("play.standingsSub", { n: me.score });
    show("s-wait");
  }
}

socket.on("state", applyState);

const ICONS = {
  good: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  bad: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  none: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>'
};

/* The result screen floods with one colour so a player can tell how they
   did from across the room before reading a word. */
function setFlood(kind) {
  $("s-result").className = "screen flood " + kind;
  $("rIcon").innerHTML = ICONS[kind === "info" ? "good" : kind];
}

/* One line of movement since the last question. Every field is optional:
   a page served by an older server, or the first question (no prevRank),
   simply shows nothing rather than a wrong claim. */
function movementLine(r) {
  const num = x => typeof x === "number" && Number.isFinite(x);
  if (!num(r.prevRank) || !num(r.rank)) return null;
  if (r.rank > 1 && !num(r.gapToNext)) return null;
  const diff = r.prevRank - r.rank;
  const standing = r.rank === 1 ? t("play.inTheLead")
    : r.gapToNext === 0 ? t("play.tied")
    : t("play.pointsBehind", { n: r.gapToNext });
  const parts = [];
  if (diff > 0) parts.push(["up", t("play.rankUp", { n: diff })]);
  else if (diff < 0) parts.push(["down", t("play.rankDown", { n: -diff })]);
  /* A leader who stays a leader needs no "same place" next to "in the lead". */
  else if (r.rank !== 1) parts.push(["same", t("play.rankSame")]);
  parts.push(["standing", standing]);
  return parts;
}

function renderMovement(r) {
  const box = $("rMove");
  box.innerHTML = "";
  const parts = movementLine(r);
  box.hidden = !parts;
  if (parts) parts.forEach(([kind, text]) => box.appendChild(el("span", "mv " + kind, text)));
}

socket.on("result", r => {
  if (!r) return;
  stopClock();
  me.score = r.score;
  me.streak = r.streak || 0;
  updateScore();
  const v = $("rVerdict");
  $("rStreak").innerHTML = "";
  $("rMove").hidden = true;

  /* Unscored text questions have no right/wrong verdict - they're a
     discussion prompt, not something to grade. */
  if (r.type === "text") {
    v.textContent = r.answered ? t("common.answerRecorded") : t("common.noAnswer");
    v.className = "verdict";
    setFlood(r.answered ? "info" : "none");
    $("rPts").textContent = "";
    $("rRank").textContent = "—";
    $("rSub").textContent = t("common.totalPoints", { n: r.score });
    return show("s-result");
  }

  if (!r.answered) { v.textContent = t("common.noAnswer"); v.className = "verdict"; setFlood("none"); }
  else if (r.correct) { v.textContent = t("common.correct"); v.className = "verdict good"; setFlood("good"); }
  else { v.textContent = t("common.notThisTime"); v.className = "verdict bad"; setFlood("bad"); }
  renderMovement(r);

  $("rPts").textContent = r.points ? "+" + r.points : "+0";
  $("rRank").textContent = r.rank ? "#" + r.rank : "—";

  const correctDescription = r.type === "multi" ? r.correctTexts.join(", ")
    : r.type === "numeric" ? String(r.target)
    : r.correctText;
  const guessNote = r.type === "numeric" && r.answered ? t("play.youGuessed", { value: r.value }) + " " : "";
  const total = t("common.totalPoints", { n: r.score });
  $("rSub").textContent = r.correct
    ? total
    : guessNote + t("common.answerWas", { answer: correctDescription }) + " " + total;
  /* A small burst on a building streak (matches the streak badge's own
     threshold), not on every single correct answer - a 20-question quiz
     would make that feel like spam rather than a reward. Purely visual, no
     sound: see public/js/sound.js's note on why the live player screen
     stays silent in a room full of phones. */
  if (r.correct && r.streak > 1) { $("rStreak").appendChild(streakBadge(r.streak)); confetti(16); }
  show("s-result");
});

socket.on("gameover", g => {
  if (!g) return;
  stopClock();
  Session.clear();
  me.streak = 0;
  renderPodium(g);
  $("fRank").textContent = g.rank ? t("play.finishedRank", { rank: g.rank }) : t("play.thanks");
  $("fScore").textContent = t("common.pts", { n: g.score });
  $("fSub").textContent = g.of
    ? t("play.finalSub", { right: g.correctCount, total: g.total, n: g.of })
    : t("common.rightOutOf", { right: g.correctCount, total: g.total });
  if (g.rank && g.rank <= 3) confetti();
  show("s-final");
});

socket.on("cancelled", () => {
  Session.clear();
  stopClock();
  $("jErr").textContent = t("play.cancelled");
  show("s-join");
});

socket.on("kicked", () => {
  Session.clear();
  stopClock();
  $("jErr").textContent = t("play.kicked");
  show("s-join");
});

/* Top three from `gameover.top3`, laid out 2-1-3 like a real podium, plus
   the player's own row underneath when they finished outside it. An older
   server sends no top3, so the screen falls back to the plain rank and score. */
function renderPodium(g) {
  const pod = $("fPodium"), mine = $("fMe");
  const top3 = Array.isArray(g.top3) ? g.top3.slice(0, 3) : [];
  pod.innerHTML = "";
  mine.innerHTML = "";
  pod.hidden = !top3.length;
  mine.hidden = true;
  $("fScore").hidden = top3.length > 0;
  if (!top3.length) return;
  /* Missing places (one or two players) are skipped, not drawn empty:
     each block has a fixed column, so first place stays in the middle. */
  [1, 0, 2].forEach(r => {
    const p = top3[r];
    if (!p) return;
    const box = el("div", "pod r" + (r + 1));
    box.append(el("span", "medal", String(r + 1)), el("span", "pn", p.name), el("span", "ps", t("common.pts", { n: p.score })));
    if (g.rank === r + 1) { box.classList.add("you"); box.prepend(el("span", "youtag", t("play.podiumYou"))); }
    pod.appendChild(box);
  });
  if (g.rank > 3) {
    mine.append(el("span", "rank", "#" + g.rank), el("span", "nm", me.name), el("span", "youtag", t("play.podiumYou")), el("span", "pts", t("common.pts", { n: g.score })));
    mine.hidden = false;
  }
}

/* ------------------------------------------------------------ answering --- */

function renderPad(s) {
  $("aQn").textContent = (s.qIndex + 1) + "/" + s.total;
  /* The streak going into this question, so a player can see what a right
     answer now would extend. */
  const streak = $("aStreak");
  streak.innerHTML = "";
  streak.hidden = !(me.streak > 1);
  if (me.streak > 1) streak.appendChild(streakBadge(me.streak, true));
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
    /* "Already answered" means an earlier submit did land (say, before a
       reconnect), so this is locked in, not a failure to retry forever.
       "Too late" can't be retried either. */
    if (res?.code === "already_answered" || res?.code === "too_late") {
      stopClock();
      showLockedIn(res.code === "too_late" ? t("err.too_late") : null);
      return;
    }
    if (res && res.error) {
      answered = false;
      onError?.();
      return;
    }
    stopClock();
    setTimeout(() => { if (answered) showLockedIn(); }, 420);
  });
}

function showLockedIn(note) {
  $("wMsg").textContent = note || t("play.lockedIn");
  $("wSub").textContent = t("play.holdTight");
  show("s-wait");
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
  const submit = el("button", "btn big", t("common.submitAnswer"));
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
  input.rows = 3; input.maxLength = 300; input.placeholder = t("common.typeAnswerPh");
  const submit = el("button", "btn big", t("common.submit"));
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
  input.type = "number"; input.inputMode = "decimal"; input.placeholder = t("common.guessPh");
  const submit = el("button", "btn big", t("common.submit"));
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
/* `compact` is the top-bar version: flame and number only, the full
   "{n} in a row" kept as its accessible name and tooltip. */
function streakBadge(n, compact) {
  const b = el("span", "streakbadge" + (compact ? " sm" : ""));
  b.innerHTML = FLAME_ICON;
  const label = t("common.inARow", { n });
  if (compact) {
    b.appendChild(el("span", null, String(n)));
    b.setAttribute("role", "img");
    b.setAttribute("aria-label", label);
    b.title = label;
  } else b.appendChild(el("span", null, label));
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
socket.io.on("reconnect_attempt", () => { banner.textContent = t("common.offline"); });
