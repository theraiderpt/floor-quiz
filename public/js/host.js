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
const SWATCH = ["var(--a1)", "var(--a2)", "var(--a3)", "var(--a4)"];

function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("on"));
  $(id).classList.add("on");
  window.scrollTo(0, 0);
  /* Confetti is position:fixed and outlives a quick screen switch (its own
     fall animation runs a couple of seconds), so without this a host who
     taps "back to library" right after the podium would see it still
     raining down over the library. */
  document.querySelectorAll(".confetti-piece").forEach(p => p.remove());
}

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401 && path !== "/login") { show("s-login"); throw new Error("Sign in first."); }
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
  sessionId: null,
  dash: { groupKey: null, backTo: "dashboard" }
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

$("libNew").addEventListener("click", () => { S.quiz = { id: null, title: "New quiz", questions: [], categoryId: null, joinMode: "name", gapSeconds: 5, deliveryMode: "live", shareToken: null }; openSetup(); });
$("libSample").addEventListener("click", async () => {
  const saved = await api("/quizzes", { method: "POST", body: SAMPLE });
  S.quiz = saved;
  openSetup();
});
$("libImport").addEventListener("click", () => $("fileIn").click());
$("goHistory").addEventListener("click", openHistory);
$("histBack").addEventListener("click", openLibrary);
$("goDashboard").addEventListener("click", openDashboard);
$("dashBack").addEventListener("click", openLibrary);
$("qsBack").addEventListener("click", openDashboard);
$("detailBack").addEventListener("click", () => {
  if (S.dash.backTo === "quiz" && S.dash.groupKey) openQuizSessions(S.dash.groupKey);
  else if (S.dash.backTo === "history") openHistory();
  else openDashboard();
});

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

const TYPE_LABELS = { single: "single choice", multi: "multiple choice", text: "open text", numeric: "numeric guess" };

async function openSetup() {
  $("quizTitle").value = S.quiz.title;
  const cats = await loadCategories();
  $("quizCategory").innerHTML = `<option value="">None</option>` + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  $("quizCategory").value = S.quiz.categoryId || "";
  $("quizJoinMode").value = S.quiz.joinMode || "name";
  $("quizGap").value = S.quiz.gapSeconds || 5;
  $("quizDelivery").value = S.quiz.deliveryMode || "live";
  updateDeliveryVisibility();
  renderSetup();
  show("s-setup");
}

function updateDeliveryVisibility() {
  const isSelfPaced = S.quiz.deliveryMode === "selfpaced";
  $("quizGapField").hidden = isSelfPaced;
  $("openLobby").textContent = isSelfPaced ? "Save & get link" : "Open lobby";
  if (isSelfPaced && S.quiz.shareToken) showShareLink(); else $("selfpacedShare").hidden = true;
}

function showShareLink() {
  $("shareLinkInput").value = location.origin + "/take/" + S.quiz.shareToken;
  $("selfpacedShare").hidden = false;
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
    meta.appendChild(el("span", null, TYPE_LABELS[q.type] || TYPE_LABELS.single));
    if (q.type === "multi") {
      meta.appendChild(el("span", null, q.opts.length + " options"));
      meta.appendChild(el("span", null, "correct: " + q.correct.map(idx => LETTERS[idx]).join(", ")));
    } else if (q.type === "numeric") {
      meta.appendChild(el("span", null, "target " + q.target + " ± " + q.tolerance));
    } else if (q.type !== "text") {
      meta.appendChild(el("span", null, q.opts.length + " options"));
      meta.appendChild(el("span", null, "correct: " + LETTERS[q.correct]));
    }
    if (q.shuffle) meta.appendChild(el("span", null, "shuffled"));
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
$("quizGap").addEventListener("change", e => { S.quiz.gapSeconds = Number(e.target.value) || 5; });
$("quizDelivery").addEventListener("change", e => { S.quiz.deliveryMode = e.target.value; updateDeliveryVisibility(); });
$("copyShareLink").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("shareLinkInput").value);
    $("copyShareLink").textContent = "Copied!";
    setTimeout(() => { $("copyShareLink").textContent = "Copy link"; }, 1500);
  } catch {
    $("shareLinkInput").select();
  }
});
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
    joinMode: S.quiz.joinMode || "name",
    gapSeconds: S.quiz.gapSeconds || 5,
    deliveryMode: S.quiz.deliveryMode || "live"
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
  const q = i >= 0 ? S.quiz.questions[i] : { type: "single", q: "", t: 20, opts: ["", "", "", ""], correct: 0, img: null, shuffle: false };
  $("editTitle").textContent = i >= 0 ? "Edit question" : "New question";
  $("editIdx").textContent = i >= 0 ? String(i + 1).padStart(2, "0") : "new";
  $("eQType").value = q.type || "single";
  $("eQ").value = q.q;
  $("eTime").value = String(q.t);
  $("eType").value = (q.opts && q.opts.length === 2) ? "2" : "4";
  $("eShuffle").checked = Boolean(q.shuffle);
  $("eTarget").value = q.target ?? "";
  $("eTolerance").value = q.tolerance ?? 0;
  setEditorImage(q.img || null);
  updateEditorVisibility();
  renderOpts(q.opts || ["", "", "", ""], q.correct);
  show("s-edit");
  $("eQ").focus();
}

function updateEditorVisibility() {
  const type = $("eQType").value;
  const isChoice = type === "single" || type === "multi";
  $("eOptsWrap").hidden = !isChoice;
  $("eTypeField").hidden = !isChoice;
  $("eShuffleField").hidden = !isChoice;
  $("eNumericFields").hidden = type !== "numeric";
  $("eOptsNote").textContent = type === "multi" ? "Mark every option that's correct." : "Mark exactly one option as correct.";
}

/* Reads whatever is currently typed into the option inputs, regardless of
   which question type is active, so switching type/option-count doesn't
   throw away text the host already wrote. */
function currentOptVals() {
  const vals = [...$("eOpts").querySelectorAll("input.inp")].map(n => n.value);
  return vals.length ? vals : ["", "", "", ""];
}
function currentCorrect() {
  if ($("eQType").value === "multi") {
    return [...$("eOpts").querySelectorAll("input[type=checkbox]:checked")].map(n => Number(n.value));
  }
  const picked = $("eOpts").querySelector("input[type=radio]:checked");
  return picked ? Number(picked.value) : 0;
}

function renderOpts(opts, correct) {
  const wrap = $("eOpts");
  wrap.innerHTML = "";
  const count = parseInt($("eType").value, 10);
  const isMulti = $("eQType").value === "multi";
  const correctSet = new Set(isMulti && Array.isArray(correct) ? correct : []);
  for (let i = 0; i < count; i++) {
    const row = el("div", "optrow");
    const sw = el("span", "swatch"); sw.style.background = SWATCH[i];
    const inp = el("input", "inp");
    inp.value = count === 2 ? ["True", "False"][i] : (opts[i] || "");
    inp.placeholder = "Option " + LETTERS[i];
    inp.maxLength = 120;
    if (count === 2) inp.readOnly = true;
    const lab = el("label", "correct");
    const box = el("input");
    box.value = String(i);
    if (isMulti) { box.type = "checkbox"; box.checked = correctSet.has(i); }
    else { box.type = "radio"; box.name = "correct"; box.checked = i === correct; }
    lab.append(box, document.createTextNode("correct"));
    row.append(sw, inp, lab);
    wrap.appendChild(row);
  }
}

$("eQType").addEventListener("change", () => {
  updateEditorVisibility();
  renderOpts(currentOptVals(), currentCorrect());
});

$("eType").addEventListener("change", () => {
  renderOpts(currentOptVals(), currentCorrect());
});

$("eCancel").addEventListener("click", () => show("s-setup"));
$("eSave").addEventListener("click", () => {
  const type = $("eQType").value;
  const text = $("eQ").value.trim();
  if (!text) return alert("Add the question text.");
  const t = parseInt($("eTime").value, 10);

  let q;
  if (type === "text") {
    q = { type, q: text, t, img: editingImg };
  } else if (type === "numeric") {
    const target = Number($("eTarget").value);
    if (!Number.isFinite(target)) return alert("Enter the correct number.");
    const tolerance = Math.max(0, Number($("eTolerance").value) || 0);
    q = { type, q: text, t, img: editingImg, target, tolerance };
  } else if (type === "multi") {
    const opts = currentOptVals().map(o => o.trim());
    if (opts.some(o => !o)) return alert("Fill in every answer option.");
    const correct = currentCorrect();
    if (!correct.length) return alert("Mark at least one option as correct.");
    q = { type, q: text, t, img: editingImg, opts, correct, shuffle: $("eShuffle").checked };
  } else {
    const opts = currentOptVals().map(o => o.trim());
    if (opts.some(o => !o)) return alert("Fill in every answer option.");
    const picked = $("eOpts").querySelector("input[type=radio]:checked");
    if (!picked) return alert("Mark one option as correct.");
    q = { type: "single", q: text, t, img: editingImg, opts, correct: Number(picked.value), shuffle: $("eShuffle").checked };
  }

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
  if (S.quiz.deliveryMode === "selfpaced") return showShareLink();
  createGame();
});

function createGame() {
  socket.emit("host:create", { quiz: { title: S.quiz.title, questions: S.quiz.questions, joinMode: S.quiz.joinMode, gapSeconds: S.quiz.gapSeconds }, quizId: S.quiz.id }, res => {
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

const TYPE_HINTS = { multi: "Select all that apply", text: "Players type their answer", numeric: "Players enter their best guess" };

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

  const hint = TYPE_HINTS[s.question.type];
  $("pTypeHint").textContent = hint || "";
  $("pTypeHint").hidden = !hint;

  const wrap = $("pAnswers");
  wrap.innerHTML = "";
  if (s.question.type === "text") {
    wrap.className = "resplist";
    wrap.appendChild(el("p", "placeholder", "Responses will appear here once time is up."));
  } else if (s.question.type === "numeric") {
    wrap.className = "resplist";
    wrap.appendChild(el("p", "placeholder", "Guesses will appear here, closest first, once time is up."));
  } else {
    wrap.className = "answers";
    s.question.opts.forEach((o, i) => {
      const b = el("div", "ans " + COLORS[i]);
      b.appendChild(shapeTag(i));
      b.appendChild(el("span", "txt", o));
      b.append(el("span", "bar"), el("span", "n", ""));
      wrap.appendChild(b);
    });
  }
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

  if (d.type === "text") {
    const wrap = $("pAnswers");
    wrap.innerHTML = "";
    if (!d.responses.length) wrap.appendChild(el("p", "placeholder", "No responses received."));
    d.responses.forEach((r, i) => {
      const item = el("div", "respitem");
      item.style.animationDelay = i * 40 + "ms";
      item.append(el("span", "who", r.name), el("span", "what", r.text));
      wrap.appendChild(item);
    });
    $("pFoot").textContent = d.responses.length + " response" + (d.responses.length === 1 ? "" : "s") + " collected";
  } else if (d.type === "numeric") {
    const wrap = $("pAnswers");
    wrap.innerHTML = "";
    if (!d.guesses.length) wrap.appendChild(el("p", "placeholder", "No guesses received."));
    d.guesses.forEach((g, i) => {
      const hit = g.distance <= d.tolerance;
      const item = el("div", "respitem" + (hit ? " hit" : ""));
      item.style.animationDelay = i * 40 + "ms";
      item.append(el("span", "who", g.name), el("span", "what", String(g.value)), el("span", "dist", (hit ? "within" : "off by ") + " " + g.distance));
      wrap.appendChild(item);
    });
    $("pFoot").textContent = "Target was " + d.target + " (±" + d.tolerance + "). " +
      (d.answered ? d.gotItRight + " of " + d.answered + " within tolerance" : "No answers received");
  } else {
    const correctSet = d.type === "multi" ? new Set(d.correct) : new Set([d.correct]);
    const total = Math.max(1, d.answered);
    [...$("pAnswers").children].forEach((node, i) => {
      const n = d.counts[i] || 0;
      const pct = Math.round((n / total) * 100);
      node.querySelector(".bar").style.width = pct + "%";
      node.querySelector(".n").textContent = n + " · " + pct + "%";
      node.classList.add(correctSet.has(i) ? "hit" : "dim");
    });
    $("pFoot").textContent = d.answered
      ? d.gotItRight + " of " + d.answered + " got it (" + Math.round((d.gotItRight / d.answered) * 100) + "%)"
      : "No answers received";
  }

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
  if (d.board.length) confetti();
  show("s-final");
});

/* -------------------------------------------------------------- clock --- */

/* A quick celebratory burst on the shared projector screen when a game
   ends - the single biggest "come back and play again" moment a live quiz
   has, and previously this screen just sat there static. */
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

function runClock(durMs) {
  stopClock();
  const fill = $("pFill"), clock = $("pClock");
  const step = () => {
    const left = Math.max(0, S.endsAt - Date.now());
    const frac = Math.min(1, left / durMs);
    fill.style.width = (frac * 100).toFixed(2) + "%";
    fill.className = "fill" + (frac < 0.2 ? " crit" : frac < 0.45 ? " warn" : "");
    clock.className = "clock" + (frac < 0.2 ? " crit" : "");
    clock.textContent = Math.ceil(left / 1000);
    S.raf = left > 0 ? requestAnimationFrame(step) : null;
  };
  S.raf = requestAnimationFrame(step);
}
function stopClock() { if (S.raf) { cancelAnimationFrame(S.raf); S.raf = null; } $("pClock")?.classList.remove("crit"); }

/* ------------------------------------------------------------ history --- */

async function openHistory() {
  const list = await api("/sessions");
  const wrap = $("histList");
  wrap.innerHTML = "";
  $("histCount").textContent = list.length;
  if (!list.length) wrap.appendChild(el("p", "note", "No completed games yet."));

  list.forEach(s => {
    const item = el("div", "qitem click");
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
    a.addEventListener("click", e => e.stopPropagation());
    item.appendChild(a);
    item.addEventListener("click", () => openSessionDetail(s.id, "history"));
    wrap.appendChild(item);
  });
  show("s-history");
}

/* ----------------------------------------------------------- dashboard --- */

function statTile(label, value) {
  const t = el("div", "stat");
  t.appendChild(el("span", "n", String(value)));
  t.appendChild(el("span", "l", label));
  return t;
}

function accClass(pct) {
  return pct == null ? "" : pct < 40 ? " crit" : pct < 70 ? " warn" : "";
}

async function openDashboard() {
  let overview, quizzes;
  try {
    [overview, quizzes] = await Promise.all([api("/stats/overview"), api("/stats/quizzes")]);
  } catch (e) {
    alert(e.message);
    return openLibrary();
  }

  const stats = $("dashStats");
  stats.innerHTML = "";
  [
    ["Games played", overview.games],
    ["Total players", overview.totalPlayers],
    ["Avg players / game", overview.avgPlayers],
    ["Quizzes in library", overview.quizzes],
    ["Last played", overview.lastPlayed ? overview.lastPlayed.replace("T", " ").slice(0, 16) : "—"]
  ].forEach(([label, value]) => stats.appendChild(statTile(label, value)));

  const wrap = $("dashList");
  wrap.innerHTML = "";
  if (!quizzes.length) wrap.appendChild(el("p", "note", "No completed games yet."));

  quizzes.forEach(q => {
    const item = el("div", "qitem click");
    item.appendChild(el("span", "idx", String(q.games).padStart(2, "0")));
    const body = el("div", "body");
    body.appendChild(el("p", "qt", q.title));
    const meta = el("div", "meta");
    meta.append(
      el("span", null, q.games + (q.games === 1 ? " game" : " games")),
      el("span", null, q.totalPlayers + " total players"),
      el("span", null, "avg score " + q.avgScore),
      el("span", null, q.accuracy != null ? q.accuracy + "% correct" : "—"),
      el("span", null, "last played " + (q.lastPlayed ? q.lastPlayed.replace("T", " ").slice(0, 16) : "—"))
    );
    body.appendChild(meta);
    item.appendChild(body);
    item.addEventListener("click", () => openQuizSessions(q.groupKey));
    wrap.appendChild(item);
  });
  show("s-dashboard");
}

async function openQuizSessions(groupKey) {
  S.dash.groupKey = groupKey;
  const key = encodeURIComponent(groupKey);
  let quiz, list, questions;
  try {
    [quiz, list, questions] = await Promise.all([
      api("/stats/quizzes/" + key),
      api("/stats/quizzes/" + key + "/sessions"),
      api("/stats/quizzes/" + key + "/questions")
    ]);
  } catch (e) {
    alert(e.message);
    return openDashboard();
  }
  if (!quiz) return openDashboard();
  $("qsTitle").textContent = quiz.title;

  const stats = $("qsStats");
  stats.innerHTML = "";
  [
    ["Games", quiz.games],
    ["Total players", quiz.totalPlayers],
    ["Avg score", quiz.avgScore],
    ["Accuracy", quiz.accuracy != null ? quiz.accuracy + "%" : "—"]
  ].forEach(([label, value]) => stats.appendChild(statTile(label, value)));

  const qwrap = $("qsQuestions");
  qwrap.innerHTML = "";
  if (!questions.length) qwrap.appendChild(el("p", "note", "No answers recorded yet."));
  questions
    .slice()
    .sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101))
    .forEach(q => {
      const bar = el("div", "qbar");
      const head = el("div", "qb-head");
      head.append(el("span", "qtxt", q.q), el("span", "qpct", q.accuracy != null ? q.accuracy + "%" : "—"));
      const track = el("div", "track sm");
      const fill = el("div", "fill" + accClass(q.accuracy));
      fill.style.width = (q.accuracy ?? 0) + "%";
      track.appendChild(fill);
      bar.append(head, track);
      qwrap.appendChild(bar);
    });

  const wrap = $("qsList");
  wrap.innerHTML = "";
  if (!list.length) wrap.appendChild(el("p", "note", "No games recorded for this quiz."));

  list.forEach(s => {
    const item = el("div", "qitem click");
    item.appendChild(el("span", "idx", String(s.player_count).padStart(2, "0")));
    const body = el("div", "body");
    body.appendChild(el("p", "qt", s.started_at.replace("T", " ").slice(0, 16)));
    const meta = el("div", "meta");
    meta.append(el("span", null, "pin " + s.pin), el("span", null, s.player_count + " players"));
    body.appendChild(meta);
    item.appendChild(body);
    const a = el("a", "iconbtn", "↓");
    a.href = "/api/sessions/" + s.id + "/csv";
    a.title = "Download CSV";
    a.addEventListener("click", e => e.stopPropagation());
    item.appendChild(a);
    item.addEventListener("click", () => openSessionDetail(s.id, "quiz"));
    wrap.appendChild(item);
  });
  show("s-quiz-sessions");
}

async function openSessionDetail(id, backTo) {
  S.dash.backTo = backTo;
  let s;
  try {
    s = await api("/sessions/" + id);
  } catch (e) {
    alert(e.message);
    return;
  }
  $("detTitle").textContent = s.title;
  $("detPin").textContent = s.pin;
  $("detWhen").textContent = s.started_at.replace("T", " ").slice(0, 16) + " · " + s.player_count + " players";
  $("detExport").href = "/api/sessions/" + s.id + "/csv";

  const board = $("detBoard");
  board.innerHTML = "";
  const head = el("div", "lrow detail head");
  head.append(el("span", null, "Rank"), el("span", null, "Name"), el("span", null, "Correct"), el("span", null, "Score"));
  board.appendChild(head);

  if (!s.results.length) board.appendChild(el("p", "note", "No results recorded."));
  s.results.forEach((r, i) => {
    const row = el("div", "lrow detail" + (r.rank === 1 ? " p1" : ""));
    row.style.animationDelay = i * 30 + "ms";
    row.append(
      el("span", "rank", String(r.rank)),
      el("span", "nm", r.name),
      el("span", "acc", r.correct_count + "/" + r.answered),
      el("span", "pts", String(r.score))
    );
    board.appendChild(row);
  });
  show("s-session-detail");
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
