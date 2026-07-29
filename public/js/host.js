"use strict";

const $ = id => document.getElementById(id);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const LETTERS = ["A", "B", "C", "D"];
const COLORS = ["c1", "c2", "c3", "c4"];
const SWATCH = ["var(--a1)", "var(--a2)", "var(--a3)", "var(--a4)"];

function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("on"));
  $(id).classList.add("on");
  window.scrollTo(0, 0);
}

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401) { show("s-login"); throw new Error("Sign in first."); }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error((data && data.error) || "Request failed.");
  return data;
}

const socket = io({ transports: ["websocket", "polling"], reconnectionDelayMax: 4000 });

const S = {
  quiz: null,        // { id, title, questions, categoryId }
  editing: -1,
  pin: null,
  players: [],
  qIndex: -1,
  endsAt: 0,
  raf: null,
  sessionId: null
};

let CATEGORIES = [];
async function loadCategories() {
  if (!CATEGORIES.length) CATEGORIES = await api("/categories");
  return CATEGORIES;
}

const SAMPLE = {
  title: "CX Fundamentals",
  questions: [
    { q: "What does FCR measure?", t: 20, opts: ["Calls resolved on the first contact", "Average time in queue", "Forecast accuracy", "Agents on shift"], correct: 0 },
    { q: "CSAT and NPS measure the same thing.", t: 10, opts: ["True", "False"], correct: 1 },
    { q: "A service level of 80/20 means what?", t: 20, opts: ["80% of contacts answered within 20 seconds", "80 agents per 20 queues", "80% occupancy over 20 minutes", "20% abandon rate allowed"], correct: 0 },
    { q: "Which metric goes UP when handle time is cut too aggressively?", t: 20, opts: ["Repeat contact rate", "Forecast accuracy", "Schedule adherence", "Occupancy"], correct: 0 },
    { q: "Shrinkage in workforce planning refers to…", t: 20, opts: ["Paid time agents are not available to take contacts", "The drop in volume after a campaign", "Reduction in average order value", "Attrition in the first 90 days"], correct: 0 },
    { q: "In COPC terms, a 'critical to quality' item is defined by the client.", t: 10, opts: ["True", "False"], correct: 0 },
    { q: "Occupancy of 95% sustained over a week most likely leads to…", t: 20, opts: ["Burnout and higher attrition", "Better quality scores", "Lower shrinkage", "Improved forecast accuracy"], correct: 0 },
    { q: "Which one is a leading indicator rather than a lagging one?", t: 20, opts: ["Quality monitoring scores", "Monthly CSAT", "Quarterly attrition", "Annual client survey"], correct: 0 }
  ]
};

/* ------------------------------------------------------------- auth ----- */

$("loginGo").addEventListener("click", login);
$("pw").addEventListener("keydown", e => { if (e.key === "Enter") login(); });

async function login() {
  $("loginErr").textContent = "";
  try {
    await api("/login", { method: "POST", body: { email: $("email").value, password: $("pw").value } });
    $("pw").value = "";
    socket.disconnect().connect();   // reconnect so the handshake carries the cookie
    await openLibrary();
  } catch (e) {
    $("loginErr").textContent = e.message;
  }
}

$("logout").addEventListener("click", async () => {
  await api("/logout", { method: "POST" }).catch(() => { });
  show("s-login");
});

/* ---------------------------------------------------------- library ----- */

async function openLibrary() {
  const list = await api("/quizzes");
  const wrap = $("libList");
  wrap.innerHTML = "";
  $("libCount").textContent = list.length;

  if (!list.length) {
    wrap.appendChild(el("p", "note", "Nothing saved yet. Start a new quiz, or drop in the sample to see how it plays."));
  }

  list.forEach(q => {
    const item = el("div", "qitem");
    item.appendChild(el("span", "idx", String(q.questions.length).padStart(2, "0")));
    const body = el("div", "body");
    body.appendChild(el("p", "qt", q.title));
    const meta = el("div", "meta");
    meta.appendChild(el("span", null, q.questions.length + " questions"));
    meta.appendChild(el("span", null, "~" + Math.ceil(q.questions.reduce((s, x) => s + x.t + 12, 0) / 60) + " min"));
    meta.appendChild(el("span", null, "edited " + q.updated_at.replace("T", " ").slice(0, 16)));
    body.appendChild(meta);
    item.appendChild(body);

    const acts = el("div", "acts");
    const play = el("button", "iconbtn", "▶"); play.title = "Open lobby";
    play.addEventListener("click", () => { S.quiz = structuredClone(q); createGame(); });
    const ed = el("button", "iconbtn", "✎"); ed.title = "Edit";
    ed.addEventListener("click", () => { S.quiz = structuredClone(q); openSetup(); });
    acts.append(play, ed);
    item.appendChild(acts);
    wrap.appendChild(item);
  });
  show("s-library");
}

$("libNew").addEventListener("click", () => { S.quiz = { id: null, title: "New quiz", questions: [], categoryId: null, joinMode: "name" }; openSetup(); });
$("libSample").addEventListener("click", async () => {
  const saved = await api("/quizzes", { method: "POST", body: SAMPLE });
  S.quiz = saved;
  openSetup();
});
$("libImport").addEventListener("click", () => $("fileIn").click());
$("goHistory").addEventListener("click", openHistory);
$("histBack").addEventListener("click", openLibrary);

$("fileIn").addEventListener("change", e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    const parsed = parseImport(f.name, String(r.result));
    if (!parsed) return alert("That file didn't parse. CSV needs: question, option A, option B, option C, option D, correct letter, seconds.");
    S.quiz = { id: null, title: parsed.title, questions: parsed.questions };
    openSetup();
  };
  r.readAsText(f);
  e.target.value = "";
});

/* ------------------------------------------------------------- setup ---- */

async function openSetup() {
  $("quizTitle").value = S.quiz.title;
  const cats = await loadCategories();
  $("quizCategory").innerHTML = `<option value="">None</option>` + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  $("quizCategory").value = S.quiz.categoryId || "";
  $("quizJoinMode").value = S.quiz.joinMode || "name";
  renderSetup();
  show("s-setup");
}

function renderSetup() {
  const wrap = $("qlist");
  wrap.innerHTML = "";
  const qs = S.quiz.questions;
  if (!qs.length) wrap.appendChild(el("p", "note", "No questions yet."));

  qs.forEach((q, i) => {
    const item = el("div", "qitem");
    item.appendChild(el("span", "idx", String(i + 1).padStart(2, "0")));
    const body = el("div", "body");
    body.appendChild(el("p", "qt", q.q));
    const meta = el("div", "meta");
    meta.appendChild(el("span", null, q.t + "s"));
    meta.appendChild(el("span", null, q.opts.length + " options"));
    meta.appendChild(el("span", null, "correct: " + LETTERS[q.correct]));
    body.appendChild(meta);
    item.appendChild(body);

    const acts = el("div", "acts");
    const up = el("button", "iconbtn", "↑"); up.title = "Move up";
    up.addEventListener("click", () => { if (i > 0) { [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]; renderSetup(); } });
    const ed = el("button", "iconbtn", "✎"); ed.title = "Edit";
    ed.addEventListener("click", () => openEditor(i));
    const rm = el("button", "iconbtn", "✕"); rm.title = "Delete";
    rm.addEventListener("click", () => { qs.splice(i, 1); renderSetup(); });
    acts.append(up, ed, rm);
    item.appendChild(acts);
    wrap.appendChild(item);
  });

  $("setupTitle").textContent = S.quiz.title;
  $("setupCount").textContent = qs.length;
  $("openLobby").disabled = qs.length === 0;
  $("deleteQuiz").hidden = !S.quiz.id;
  $("setupNote").textContent = qs.length
    ? qs.length + " questions · about " + Math.ceil(qs.reduce((s, q) => s + q.t + 12, 0) / 60) + " min to play"
    : "Add at least one question to open a lobby.";
}

$("quizTitle").addEventListener("input", e => { S.quiz.title = e.target.value; $("setupTitle").textContent = e.target.value; });
$("quizCategory").addEventListener("change", e => { S.quiz.categoryId = e.target.value ? Number(e.target.value) : null; });
$("quizJoinMode").addEventListener("change", e => { S.quiz.joinMode = e.target.value; });
$("setupBack").addEventListener("click", openLibrary);
$("addQ").addEventListener("click", () => openEditor(-1));
$("browseBank").addEventListener("click", openBank);

$("saveQuiz").addEventListener("click", async () => {
  await persistQuiz();
  await openLibrary();
});

$("deleteQuiz").addEventListener("click", async () => {
  if (!S.quiz.id || !confirm("Delete this quiz? Past results stay in history.")) return;
  await api("/quizzes/" + S.quiz.id, { method: "DELETE" });
  await openLibrary();
});

$("exportBtn").addEventListener("click", () => {
  download(S.quiz.title.replace(/\W+/g, "_") + ".json", JSON.stringify(S.quiz, null, 2), "application/json");
});

async function persistQuiz() {
  const body = {
    title: S.quiz.title || "Quiz",
    questions: S.quiz.questions,
    categoryId: S.quiz.categoryId || null,
    joinMode: S.quiz.joinMode || "name"
  };
  S.quiz = S.quiz.id
    ? await api("/quizzes/" + S.quiz.id, { method: "PUT", body })
    : await api("/quizzes", { method: "POST", body });
  return S.quiz;
}

/* ------------------------------------------------------------ editor --- */

let editingImg = null;

function setEditorImage(dataUrl) {
  editingImg = dataUrl || null;
  $("eImgPreview").src = editingImg || "";
  $("eImgPreview").hidden = !editingImg;
  $("eImgClear").hidden = !editingImg;
}

/* Resized and re-encoded client side so a phone photo (often several MB)
   never has to round-trip at full size. Falls back to a lower quality pass
   if it's still too big for the server's per-image cap. */
function readImageResized(file, maxDim = 900) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That doesn't look like an image."));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        let out = canvas.toDataURL("image/jpeg", 0.72);
        if (out.length > 340_000) out = canvas.toDataURL("image/jpeg", 0.5);
        if (out.length > 340_000) return reject(new Error("That image is too large even after compression. Try a smaller photo."));
        resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

$("eImgPick").addEventListener("click", () => $("eImgFile").click());
$("eImgFile").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    setEditorImage(await readImageResized(file));
  } catch (err) {
    alert(err.message);
  }
});
$("eImgClear").addEventListener("click", () => setEditorImage(null));

function openEditor(i) {
  S.editing = i;
  const q = i >= 0 ? S.quiz.questions[i] : { q: "", t: 20, opts: ["", "", "", ""], correct: 0, img: null };
  $("editTitle").textContent = i >= 0 ? "Edit question" : "New question";
  $("editIdx").textContent = i >= 0 ? String(i + 1).padStart(2, "0") : "new";
  $("eQ").value = q.q;
  $("eTime").value = String(q.t);
  $("eType").value = q.opts.length === 2 ? "2" : "4";
  setEditorImage(q.img || null);
  renderOpts(q.opts, q.correct);
  show("s-edit");
  $("eQ").focus();
}

function renderOpts(opts, correct) {
  const wrap = $("eOpts");
  wrap.innerHTML = "";
  const count = parseInt($("eType").value, 10);
  for (let i = 0; i < count; i++) {
    const row = el("div", "optrow");
    const sw = el("span", "swatch"); sw.style.background = SWATCH[i];
    const inp = el("input", "inp");
    inp.value = count === 2 ? ["True", "False"][i] : (opts[i] || "");
    inp.placeholder = "Option " + LETTERS[i];
    inp.maxLength = 120;
    if (count === 2) inp.readOnly = true;
    const lab = el("label", "correct");
    const rad = el("input"); rad.type = "radio"; rad.name = "correct"; rad.value = String(i);
    if (i === correct) rad.checked = true;
    lab.append(rad, document.createTextNode("correct"));
    row.append(sw, inp, lab);
    wrap.appendChild(row);
  }
}

$("eType").addEventListener("change", () => {
  const vals = [...$("eOpts").querySelectorAll("input.inp")].map(n => n.value);
  const picked = $("eOpts").querySelector("input[type=radio]:checked");
  renderOpts(vals, picked ? parseInt(picked.value, 10) : 0);
});

$("eCancel").addEventListener("click", () => show("s-setup"));
$("eSave").addEventListener("click", () => {
  const text = $("eQ").value.trim();
  const opts = [...$("eOpts").querySelectorAll("input.inp")].map(n => n.value.trim());
  const picked = $("eOpts").querySelector("input[type=radio]:checked");
  if (!text) return alert("Add the question text.");
  if (opts.some(o => !o)) return alert("Fill in every answer option.");
  if (!picked) return alert("Mark one option as correct.");
  const q = { q: text, t: parseInt($("eTime").value, 10), opts, correct: parseInt(picked.value, 10), img: editingImg };
  if (S.editing >= 0) S.quiz.questions[S.editing] = q; else S.quiz.questions.push(q);
  renderSetup();
  show("s-setup");
});

/* --------------------------------------------------------- bank picker --- */

async function openBank() {
  const cats = await loadCategories();
  $("bankFilter").innerHTML = `<option value="">All categories</option>` + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  await renderBankPick();
  show("s-bank");
}

$("bankFilter").addEventListener("change", renderBankPick);
$("bankBack").addEventListener("click", () => { renderSetup(); show("s-setup"); });

async function renderBankPick() {
  const cat = $("bankFilter").value;
  const list = await api("/bank" + (cat ? "?category=" + cat : ""));
  const wrap = $("bankPickList");
  wrap.innerHTML = "";
  if (!list.length) wrap.appendChild(el("p", "note", "Nothing in this category yet."));
  list.forEach(q => {
    const item = el("div", "qitem");
    item.appendChild(el("span", "idx", q.t + "s"));
    const body = el("div", "body");
    body.appendChild(el("p", "qt", q.q));
    const meta = el("div", "meta");
    meta.append(el("span", null, q.categoryName), el("span", null, q.opts.length + " options"));
    body.appendChild(meta);
    item.appendChild(body);
    const add = el("button", "iconbtn", "+"); add.title = "Add to quiz";
    add.addEventListener("click", () => {
      S.quiz.questions.push({ q: q.q, t: q.t, opts: [...q.opts], correct: q.correct });
      add.textContent = "✓";
      add.disabled = true;
    });
    const acts = el("div", "acts"); acts.appendChild(add);
    item.appendChild(acts);
    wrap.appendChild(item);
  });
}

/* -------------------------------------------------------------- game ---- */

$("openLobby").addEventListener("click", async () => {
  await persistQuiz();
  createGame();
});

function createGame() {
  socket.emit("host:create", { quiz: { title: S.quiz.title, questions: S.quiz.questions, joinMode: S.quiz.joinMode }, quizId: S.quiz.id }, res => {
    if (!res || res.error) return alert((res && res.error) || "Could not open a lobby.");
    S.pin = res.pin;
    S.players = [];
    $("lobbyPin").textContent = res.pin;
    $("lobbyUrl").textContent = (res.joinUrl || "").replace(/^https?:\/\//, "") || "set PUBLIC_URL in .env";
    $("lobbyQuiz").textContent = S.quiz.title;
    $("lobbyQs").textContent = S.quiz.questions.length;
    $("roster").innerHTML = "";
    if (res.qr) { $("lobbyQr").src = res.qr; $("lobbyQr").hidden = false; } else { $("lobbyQr").hidden = true; }
    show("s-lobby");
  });
}

$("cancelGame").addEventListener("click", () => { socket.emit("host:end"); openLibrary(); });
$("startQuiz").addEventListener("click", () => socket.emit("host:start"));
$("pSkip").addEventListener("click", () => socket.emit("host:skip"));
$("pNext").addEventListener("click", () => socket.emit("host:next"));
$("sNext").addEventListener("click", () => socket.emit("host:next"));
$("fDone").addEventListener("click", openLibrary);

socket.on("lobby", d => {
  S.players = d.players;
  const r = $("roster");
  r.innerHTML = "";
  d.players.forEach(p => {
    const c = el("span", "chip" + (p.connected ? "" : " off"), p.name);
    c.title = (p.email ? p.email + " — " : "") + "Click to remove";
    c.addEventListener("click", () => { if (confirm("Remove " + p.name + "?")) socket.emit("host:kick", { playerId: p.id }); });
    r.appendChild(c);
  });
  $("lobbyCount").textContent = d.count;
  $("startQuiz").disabled = d.count === 0;
  $("lobbyHint").textContent = d.count
    ? d.count + (d.count === 1 ? " player is in." : " players are in.") + " Start when the room settles."
    : "Waiting for players…";
});

socket.on("state", s => {
  $("pPlayers").textContent = s.connected;
  $("sPlayers").textContent = s.players;

  if (s.phase === "question") {
    if (s.qIndex !== S.qIndex) { S.qIndex = s.qIndex; renderQuestion(s); }
    S.endsAt = Date.now() + s.msLeft;
    runClock(s.question.t * 1000);
    show("s-play");
  } else if (s.phase === "reveal") {
    stopClock();
    $("pClock").textContent = "0";
    $("pFill").style.width = "0%";
  }
});

function renderQuestion(s) {
  $("pPin").textContent = S.pin;
  $("pQn").textContent = (s.qIndex + 1) + "/" + s.total;
  $("pQ").textContent = s.question.q;
  $("pAnswered").textContent = "0";
  $("pFoot").textContent = "Answers are locked in as they arrive";
  $("pNext").hidden = true;
  $("pSkip").hidden = false;
  $("pTimerWrap").style.visibility = "visible";
  $("pImg").hidden = true;
  $("pImg").src = "";

  const wrap = $("pAnswers");
  wrap.innerHTML = "";
  s.question.opts.forEach((o, i) => {
    const b = el("div", "ans " + COLORS[i]);
    b.appendChild(el("span", "tag", LETTERS[i]));
    b.appendChild(el("span", "txt", o));
    b.append(el("span", "bar"), el("span", "n", ""));
    wrap.appendChild(b);
  });
}

socket.on("answered", d => { $("pAnswered").textContent = d.answered; });

/* Arrives on its own channel, host-only, so player phones never pull down
   image bytes for a picture only the projector screen shows. */
socket.on("question:image", d => {
  if (d.qIndex !== S.qIndex) return;
  $("pImg").src = d.img;
  $("pImg").hidden = false;
});

socket.on("reveal", d => {
  stopClock();
  $("pTimerWrap").style.visibility = "hidden";
  $("pSkip").hidden = true;
  const total = Math.max(1, d.answered);
  [...$("pAnswers").children].forEach((node, i) => {
    const n = d.counts[i] || 0;
    const pct = Math.round((n / total) * 100);
    node.querySelector(".bar").style.width = pct + "%";
    node.querySelector(".n").textContent = n + " · " + pct + "%";
    node.classList.add(i === d.correct ? "hit" : "dim");
  });
  $("pFoot").textContent = d.answered
    ? d.gotItRight + " of " + d.answered + " got it (" + Math.round((d.gotItRight / d.answered) * 100) + "%)"
    : "No answers received";
  $("pNext").hidden = false;
  $("pNext").textContent = S.qIndex + 1 < S.quiz.questions.length ? "Show standings" : "Show final result";
});

socket.on("scores", d => {
  $("sPin").textContent = S.pin;
  $("sQn").textContent = "Q" + (S.qIndex + 1);
  const board = $("sBoard");
  board.innerHTML = "";
  d.board.forEach((p, i) => {
    const row = el("div", "lrow" + (i === 0 ? " p1" : ""));
    row.style.animationDelay = i * 55 + "ms";
    row.append(el("span", "rank", String(i + 1)), el("span", "nm", p.name), el("span", "pts", String(p.score)));
    board.appendChild(row);
  });
  if (!d.board.length) board.appendChild(el("p", "note", "No scores yet."));
  $("sNext").textContent = S.qIndex + 1 < S.quiz.questions.length ? "Next question" : "Final result";
  show("s-scores");
});

socket.on("final", d => {
  stopClock();
  S.sessionId = d.sessionId;
  $("fQuiz").textContent = S.quiz.title;
  $("fPlayers").textContent = d.board.length;
  $("fWinner").textContent = d.board.length ? d.board[0].name + " takes it" : "No players";
  $("fExport").href = "/api/sessions/" + d.sessionId + "/csv";

  const pod = $("fPodium");
  pod.innerHTML = "";
  [1, 0, 2].forEach(r => {
    const p = d.board[r];
    const box = el("div", "pod r" + (r + 1));
    box.append(el("span", "medal", String(r + 1)), el("span", "pn", p ? p.name : "—"), el("span", "ps", p ? p.score + " pts" : ""));
    pod.appendChild(box);
  });

  const board = $("fBoard");
  board.innerHTML = "";
  d.board.slice(3, 12).forEach((p, i) => {
    const row = el("div", "lrow");
    row.style.animationDelay = i * 45 + "ms";
    row.append(el("span", "rank", String(i + 4)), el("span", "nm", p.name), el("span", "pts", String(p.score)));
    board.appendChild(row);
  });
  show("s-final");
});

/* -------------------------------------------------------------- clock --- */

function runClock(durMs) {
  stopClock();
  const fill = $("pFill"), clock = $("pClock");
  const step = () => {
    const left = Math.max(0, S.endsAt - Date.now());
    const frac = Math.min(1, left / durMs);
    fill.style.width = (frac * 100).toFixed(2) + "%";
    fill.className = "fill" + (frac < 0.2 ? " crit" : frac < 0.45 ? " warn" : "");
    clock.textContent = Math.ceil(left / 1000);
    S.raf = left > 0 ? requestAnimationFrame(step) : null;
  };
  S.raf = requestAnimationFrame(step);
}
function stopClock() { if (S.raf) { cancelAnimationFrame(S.raf); S.raf = null; } }

/* ------------------------------------------------------------ history --- */

async function openHistory() {
  const list = await api("/sessions");
  const wrap = $("histList");
  wrap.innerHTML = "";
  $("histCount").textContent = list.length;
  if (!list.length) wrap.appendChild(el("p", "note", "No completed games yet."));

  list.forEach(s => {
    const item = el("div", "qitem");
    item.appendChild(el("span", "idx", String(s.player_count).padStart(2, "0")));
    const body = el("div", "body");
    body.appendChild(el("p", "qt", s.title));
    const meta = el("div", "meta");
    meta.append(
      el("span", null, s.started_at.replace("T", " ").slice(0, 16)),
      el("span", null, "pin " + s.pin),
      el("span", null, s.player_count + " players")
    );
    body.appendChild(meta);
    item.appendChild(body);
    const a = el("a", "iconbtn", "↓");
    a.href = "/api/sessions/" + s.id + "/csv";
    a.title = "Download CSV";
    item.appendChild(a);
    wrap.appendChild(item);
  });
  show("s-history");
}

/* ------------------------------------------------------------- import --- */

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

function parseImport(name, text) {
  try {
    if (/\.json$/i.test(name) || /^[\[{]/.test(text.trim())) {
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : data.questions;
      const questions = arr.map(o => ({
        q: String(o.q || o.question || "").trim(),
        t: parseInt(o.t || o.time || 20, 10) || 20,
        opts: (o.opts || o.options || []).map(String).slice(0, 4),
        correct: parseInt(o.correct ?? 0, 10) || 0
      })).filter(q => q.q && q.opts.length >= 2);
      if (!questions.length) return null;
      return { title: (data && data.title) || name.replace(/\.\w+$/, ""), questions };
    }
    const rows = parseCSV(text);
    const start = rows.length && /question/i.test(rows[0][0] || "") ? 1 : 0;
    const questions = rows.slice(start).map(r => {
      const opts = r.slice(1, 5).map(s => s.trim()).filter(Boolean);
      const raw = (r[5] || "A").trim();
      let c = /^\d+$/.test(raw) ? parseInt(raw, 10) - 1 : LETTERS.indexOf(raw.toUpperCase());
      if (c < 0 || c >= opts.length) c = 0;
      return { q: (r[0] || "").trim(), t: parseInt(r[6] || "20", 10) || 20, opts, correct: c };
    }).filter(q => q.q && q.opts.length >= 2);
    if (!questions.length) return null;
    return { title: name.replace(/\.\w+$/, ""), questions };
  } catch {
    return null;
  }
}

function download(filename, text, type) {
  const blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = el("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* -------------------------------------------------------- connectivity -- */

const banner = $("offline");
socket.on("connect", () => { banner.classList.remove("on"); document.querySelectorAll(".dot").forEach(d => d.classList.remove("down")); });
socket.on("disconnect", () => { banner.classList.add("on"); document.querySelectorAll(".dot").forEach(d => d.classList.add("down")); });

/* Resume straight into the library if the cookie is still good. */
api("/me").then(r => { if (r.host) openLibrary(); }).catch(() => { });
