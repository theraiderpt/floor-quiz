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
  if (!res.ok) throw new Error(I18N.errorText(data));
  return data;
}

$("inviteWho").textContent = t("invite.checking");

(async function init() {
  try {
    const res = await api("/invite/" + encodeURIComponent(token));
    if (!res.valid) {
      $("inviteWho").textContent = t("invite.invalid");
      return;
    }
    $("inviteWho").textContent = t("invite.settingFor", { email: res.email });
    $("inviteForm").hidden = false;
  } catch {
    $("inviteWho").textContent = t("invite.invalid");
  }
})();

$("inviteGo").addEventListener("click", async () => {
  const err = $("inviteErr");
  err.textContent = "";
  const pw1 = $("pw1").value, pw2 = $("pw2").value;
  if (pw1.length < 8) { err.textContent = t("err.pw_short"); return; }
  if (pw1 !== pw2) { err.textContent = t("invite.mismatch"); return; }
  try {
    await api("/invite/" + encodeURIComponent(token) + "/complete", { method: "POST", body: { password: pw1 } });
    $("inviteForm").hidden = true;
    $("inviteWho").textContent = t("invite.done");
    $("toHost").hidden = false;
  } catch (e) {
    err.textContent = e.message;
  }
});
