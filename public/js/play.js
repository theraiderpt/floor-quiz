"use strict";

const $ = id => document.getElementById(id);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const LETTERS = ["A", "B", "C", "D"];
const COLORS = ["c1", "c2", "c3", "c4"];

function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("on"));
  $(id).classList.add("on");
  window.scrollTo(0, 0);
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
let picked = -1;
let endsAt = 0;
let rafId = null;

/* ------------------------------------------------------------- joining --- */

const prefill = new URLSearchParams(location.search).get("pin");
if (prefill && /^\d{4}$/.test(prefill)) $("jPin").value = prefill;

$("jPin").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); });
$("jName").addEventListener("keydown", e => { if (e.key === "Enter") join(); });
$("jGo").addEventListener("click", () => join());
$("fAgain").addEventListener("click", () => { Session.clear(); location.href = "/"; });

function join(rejoinWith) {
  const pin = rejoinWith ? rejoinWith.pin : $("jPin").value.trim();
  const name = rejoinWith ? rejoinWith.name : $("jName").value.trim();
  $("jErr").textContent = "";

  if (!/^\d{4}$/.test(pin)) return ($("jErr").textContent = "The PIN is four digits.");
  if (!name) return ($("jErr").textContent = "Add a name so the host can see you.");

  $("jGo").disabled = true;
  socket.emit("player:join", { pin, name, playerId: rejoinWith?.playerId }, res => {
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
    Session.save({ pin, name: res.name, playerId: res.playerId });

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
      picked = -1;
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
  if (!r.answered) { v.textContent = "No answer"; v.className = "verdict"; }
  else if (r.correct) { v.textContent = "Correct"; v.className = "verdict good"; }
  else { v.textContent = "Not this time"; v.className = "verdict bad"; }

  $("rPts").textContent = r.points ? "+" + r.points : "+0";
  $("rRank").textContent = r.rank ? "#" + r.rank : "—";
  $("rSub").textContent = r.correct
    ? (r.streak > 1 ? r.streak + " in a row. Total " + r.score + " points." : "Total " + r.score + " points.")
    : "The answer was " + LETTERS[r.correctIndex] + ". Total " + r.score + " points.";
  show("s-result");
});

socket.on("gameover", g => {
  stopClock();
  Session.clear();
  $("fRank").textContent = g.rank ? "You finished #" + g.rank : "Thanks for playing";
  $("fScore").textContent = g.score + " pts";
  $("fSub").textContent = g.correctCount + " right out of " + g.total +
    (g.of ? ", against " + g.of + " players." : ".");
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
  const pad = $("aPad");
  pad.innerHTML = "";
  s.question.opts.forEach((o, i) => {
    const b = el("button", "ans " + COLORS[i]);
    b.appendChild(el("span", "tag", LETTERS[i]));
    b.appendChild(el("span", "txt", o));
    b.addEventListener("click", () => answer(i));
    pad.appendChild(b);
  });
}

function answer(i) {
  if (picked >= 0) return;
  picked = i;
  [...$("aPad").children].forEach((n, k) => {
    n.classList.add(k === i ? "picked" : "faded");
    n.disabled = true;
  });
  socket.emit("player:answer", { choice: i }, res => {
    if (res && res.error) {
      picked = -1;
      [...$("aPad").children].forEach(n => { n.classList.remove("picked", "faded"); n.disabled = false; });
      return;
    }
    stopClock();
    $("wMsg").textContent = "Locked in";
    $("wSub").textContent = "Answer " + LETTERS[i] + " is in. Hold tight for the reveal.";
    setTimeout(() => { if (picked >= 0) show("s-wait"); }, 420);
  });
}

function runClock(durMs) {
  stopClock();
  const fill = $("aFill"), clock = $("aClock");
  const step = () => {
    const left = Math.max(0, endsAt - Date.now());
    const frac = Math.min(1, left / durMs);
    fill.style.width = (frac * 100).toFixed(2) + "%";
    fill.className = "fill" + (frac < 0.2 ? " crit" : frac < 0.45 ? " warn" : "");
    clock.textContent = Math.ceil(left / 1000);
    rafId = left > 0 ? requestAnimationFrame(step) : null;
  };
  rafId = requestAnimationFrame(step);
}
function stopClock() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }

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
