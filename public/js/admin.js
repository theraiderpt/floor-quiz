"use strict";

const $ = id => document.getElementById(id);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const LETTERS = ["A", "B", "C", "D"];
const SWATCH = ["var(--a1)", "var(--a2)", "var(--a3)", "var(--a4)"];

function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("on"));
  $(id).classList.add("on");
}

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401 && path !== "/admin/login") { show("s-login"); throw new Error("Sign in first."); }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error((data && data.error) || "Request failed.");
  return data;
}

let categories = [];

/* ------------------------------------------------------------- auth ----- */

$("loginGo").addEventListener("click", login);
$("aPw").addEventListener("keydown", e => { if (e.key === "Enter") login(); });

async function login() {
  $("loginErr").textContent = "";
  try {
    await api("/admin/login", { method: "POST", body: { email: $("aEmail").value, password: $("aPw").value } });
    $("aPw").value = "";
    show("s-dash");
    switchTab("overview");
  } catch (e) {
    $("loginErr").textContent = e.message;
  }
}

$("logout").addEventListener("click", async () => {
  await api("/admin/logout", { method: "POST" }).catch(() => { });
  show("s-login");
});

/* -------------------------------------------------------------- tabs ---- */

document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

function switchTab(name) {
  document.querySelectorAll(".tabpage").forEach(p => p.classList.remove("on"));
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $("tab-" + name).classList.add("on");
  if (name === "overview") loadOverview();
  else if (name === "hosts") loadHosts();
  else if (name === "categories") loadCategories();
  else if (name === "bank") loadBank();
}

/* --------------------------------------------------------- overview ----- */

async function loadOverview() {
  const o = await api("/admin/overview");
  const wrap = $("statCards");
  wrap.innerHTML = "";
  const cards = [
    ["Hosts", o.hosts, `${o.activeHosts} active · ${o.invitedHosts} invited`],
    ["Categories", o.categories, ""],
    ["Bank questions", o.bankQuestions, ""],
    ["Completed games", o.completedGames, ""],
    ["Live right now", o.live.games, `${o.live.players} players connected`]
  ];
  cards.forEach(([label, n, note]) => {
    const c = el("div", "card");
    c.appendChild(el("h3", null, String(n)));
    c.appendChild(el("p", null, label));
    if (note) c.appendChild(el("p", "note", note));
    wrap.appendChild(c);
  });

  const games = await api("/admin/games");
  const gl = $("gamesList");
  gl.innerHTML = "";
  if (!games.length) gl.appendChild(el("p", "note", "No completed games yet."));
  games.forEach(g => {
    const item = el("div", "qitem");
    item.appendChild(el("span", "idx", String(g.player_count).padStart(2, "0")));
    const body = el("div", "body");
    body.appendChild(el("p", "qt", g.title));
    const meta = el("div", "meta");
    meta.append(
      el("span", null, g.host_email || "unassigned"),
      el("span", null, g.started_at.replace("T", " ").slice(0, 16)),
      el("span", null, "pin " + g.pin)
    );
    body.appendChild(meta);
    item.appendChild(body);
    gl.appendChild(item);
  });
}

/* ------------------------------------------------------------- hosts ---- */

$("hCreate").addEventListener("click", async () => {
  $("hInviteNote").textContent = "";
  try {
    const email = $("hEmail").value.trim();
    const maxPlayers = parseInt($("hMax").value, 10) || 400;
    const res = await api("/admin/hosts", { method: "POST", body: { email, maxPlayers } });
    $("hEmail").value = "";
    $("hInviteNote").textContent = `Invite link for ${res.host.email}: ${res.inviteLink}`;
    await loadHosts();
  } catch (e) {
    $("hInviteNote").textContent = e.message;
  }
});

async function loadHosts() {
  const hosts = await api("/admin/hosts");
  const wrap = $("hostsList");
  wrap.innerHTML = "";
  if (!hosts.length) wrap.appendChild(el("p", "note", "No hosts yet. Create one above."));

  hosts.forEach(h => {
    const item = el("div", "qitem");
    item.appendChild(el("span", "idx", h.status === "active" ? "●" : h.status === "invited" ? "…" : "✕"));
    const body = el("div", "body");
    body.appendChild(el("p", "qt", h.email));
    const meta = el("div", "meta");
    meta.append(
      el("span", null, h.status),
      el("span", null, h.quiz_count + " quizzes"),
      el("span", null, h.game_count + " games"),
      el("span", null, "limit " + h.max_players)
    );
    body.appendChild(meta);

    const quotaRow = el("div", "row");
    const quotaInp = el("input", "inp");
    quotaInp.type = "number"; quotaInp.min = "1"; quotaInp.max = "2000";
    quotaInp.value = String(h.max_players);
    quotaInp.style.maxWidth = "110px";
    const saveQuota = el("button", "iconbtn", "✓"); saveQuota.title = "Save limit";
    saveQuota.addEventListener("click", async () => {
      await api("/admin/hosts/" + h.id, { method: "PATCH", body: { maxPlayers: parseInt(quotaInp.value, 10) || 400 } });
      await loadHosts();
    });
    quotaRow.append(quotaInp, saveQuota);
    body.appendChild(quotaRow);
    item.appendChild(body);

    const acts = el("div", "acts");
    const toggle = el("button", "iconbtn", h.status === "disabled" ? "▶" : "⏸");
    toggle.title = h.status === "disabled" ? "Enable" : "Disable";
    toggle.addEventListener("click", async () => {
      await api("/admin/hosts/" + h.id, { method: "PATCH", body: { status: h.status === "disabled" ? "active" : "disabled" } });
      await loadHosts();
    });
    const invite = el("button", "iconbtn", "↻"); invite.title = "New invite link";
    invite.addEventListener("click", async () => {
      const res = await api("/admin/hosts/" + h.id + "/reinvite", { method: "POST" });
      $("hInviteNote").textContent = `Invite link for ${h.email}: ${res.inviteLink}`;
    });
    const del = el("button", "iconbtn", "✕"); del.title = "Delete host";
    del.addEventListener("click", async () => {
      if (!confirm("Delete " + h.email + "? Their quizzes and games stay in history, unassigned.")) return;
      await api("/admin/hosts/" + h.id, { method: "DELETE" });
      await loadHosts();
    });
    acts.append(toggle, invite, del);
    item.appendChild(acts);
    wrap.appendChild(item);
  });
}

/* -------------------------------------------------------- categories ---- */

$("cCreate").addEventListener("click", async () => {
  const name = $("cName").value.trim();
  if (!name) return;
  try {
    await api("/admin/categories", { method: "POST", body: { name } });
    $("cName").value = "";
    await loadCategories();
  } catch (e) {
    alert(e.message);
  }
});

async function loadCategories() {
  categories = await api("/admin/categories");
  const wrap = $("categoriesList");
  wrap.innerHTML = "";
  if (!categories.length) wrap.appendChild(el("p", "note", "No categories yet."));
  categories.forEach(c => {
    const item = el("div", "qitem");
    item.appendChild(el("span", "idx", "—"));
    const body = el("div", "body");
    body.appendChild(el("p", "qt", c.name));
    item.appendChild(body);
    const del = el("button", "iconbtn", "✕"); del.title = "Delete category";
    del.addEventListener("click", async () => {
      if (!confirm("Delete “" + c.name + "”? Its bank questions go with it.")) return;
      await api("/admin/categories/" + c.id, { method: "DELETE" });
      await loadCategories();
    });
    const acts = el("div", "acts"); acts.appendChild(del);
    item.appendChild(acts);
    wrap.appendChild(item);
  });
}

/* --------------------------------------------------------------- bank --- */

function fillCategorySelects() {
  const opts = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  $("bCategory").innerHTML = opts;
  $("bFilter").innerHTML = `<option value="">All categories</option>` + opts;
}

$("bFilter").addEventListener("change", () => renderBankList());
$("bType").addEventListener("change", () => renderBankOpts());

function renderBankOpts(existingOpts, existingCorrect) {
  const wrap = $("bOpts");
  wrap.innerHTML = "";
  const count = parseInt($("bType").value, 10);
  for (let i = 0; i < count; i++) {
    const row = el("div", "optrow");
    const sw = el("span", "swatch"); sw.style.background = SWATCH[i];
    const inp = el("input", "inp");
    inp.value = count === 2 ? ["True", "False"][i] : ((existingOpts && existingOpts[i]) || "");
    inp.placeholder = "Option " + LETTERS[i];
    inp.maxLength = 120;
    if (count === 2) inp.readOnly = true;
    const lab = el("label", "correct");
    const rad = el("input"); rad.type = "radio"; rad.name = "bcorrect"; rad.value = String(i);
    if (i === (existingCorrect || 0)) rad.checked = true;
    lab.append(rad, document.createTextNode("correct"));
    row.append(sw, inp, lab);
    wrap.appendChild(row);
  }
}

$("bAdd").addEventListener("click", async () => {
  const q = $("bQ").value.trim();
  const categoryId = Number($("bCategory").value);
  const opts = [...$("bOpts").querySelectorAll("input.inp")].map(n => n.value.trim());
  const picked = $("bOpts").querySelector("input[type=radio]:checked");
  if (!q) return alert("Add the question text.");
  if (opts.some(o => !o)) return alert("Fill in every answer option.");
  if (!categoryId) return alert("Pick a category.");
  const body = {
    q, categoryId,
    t: parseInt($("bTime").value, 10),
    opts,
    correct: picked ? parseInt(picked.value, 10) : 0
  };
  await api("/admin/bank", { method: "POST", body });
  $("bQ").value = "";
  renderBankOpts();
  await renderBankList();
});

async function renderBankList() {
  const categoryId = $("bFilter").value || null;
  const list = await api("/admin/bank" + (categoryId ? "?category=" + categoryId : ""));
  const wrap = $("bankList");
  wrap.innerHTML = "";
  if (!list.length) wrap.appendChild(el("p", "note", "No bank questions yet."));
  list.forEach(q => {
    const item = el("div", "qitem");
    item.appendChild(el("span", "idx", "—"));
    const body = el("div", "body");
    body.appendChild(el("p", "qt", q.q));
    const meta = el("div", "meta");
    meta.append(el("span", null, q.categoryName), el("span", null, q.t + "s"), el("span", null, "correct: " + LETTERS[q.correct]));
    body.appendChild(meta);
    item.appendChild(body);
    const del = el("button", "iconbtn", "✕"); del.title = "Delete";
    del.addEventListener("click", async () => {
      await api("/admin/bank/" + q.id, { method: "DELETE" });
      await renderBankList();
    });
    const acts = el("div", "acts"); acts.appendChild(del);
    item.appendChild(acts);
    wrap.appendChild(item);
  });
}

async function loadBank() {
  if (!categories.length) categories = await api("/admin/categories");
  fillCategorySelects();
  renderBankOpts();
  await renderBankList();
}

/* Resume straight into the dashboard if the cookie is still good. */
api("/admin/me").then(r => { if (r.admin) { show("s-dash"); switchTab("overview"); } }).catch(() => { });
