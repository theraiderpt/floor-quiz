"use strict";

const $ = id => document.getElementById(id);
const token = location.pathname.replace(/^\/invite\//, "");

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error((data && data.error) || "Request failed.");
  return data;
}

(async function init() {
  try {
    const res = await api("/invite/" + encodeURIComponent(token));
    if (!res.valid) {
      $("inviteWho").textContent = "This invite link is invalid or has expired. Ask your admin for a new one.";
      return;
    }
    $("inviteWho").textContent = `Setting a password for ${res.email}.`;
    $("inviteForm").hidden = false;
  } catch {
    $("inviteWho").textContent = "This invite link is invalid or has expired. Ask your admin for a new one.";
  }
})();

$("inviteGo").addEventListener("click", async () => {
  const err = $("inviteErr");
  err.textContent = "";
  const pw1 = $("pw1").value, pw2 = $("pw2").value;
  if (pw1.length < 8) { err.textContent = "Password must be at least 8 characters."; return; }
  if (pw1 !== pw2) { err.textContent = "Passwords don't match."; return; }
  try {
    await api("/invite/" + encodeURIComponent(token) + "/complete", { method: "POST", body: { password: pw1 } });
    $("inviteForm").hidden = true;
    $("inviteWho").textContent = "Password set. You can sign in now.";
    $("toHost").hidden = false;
  } catch (e) {
    err.textContent = e.message;
  }
});
