"use strict";

/* Loaded synchronously in <head> on every page, before the stylesheet's
   default (dark) theme can paint, so a visitor who has already chosen
   light doesn't see a flash of dark first. The click handler waits for
   DOMContentLoaded since the toggle button itself hasn't parsed yet at
   this point in <head>. */
(function () {
  const KEY = "fq-theme";

  function currentTheme() {
    try { return localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch { return "dark"; }
  }

  function syncIcon(theme) {
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    const sun = btn.querySelector(".ic-sun"), moon = btn.querySelector(".ic-moon");
    if (sun) sun.hidden = theme !== "dark";
    if (moon) moon.hidden = theme !== "light";
  }

  const INK = { dark: "#09092d", light: "#f3f3f7" };

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    syncIcon(theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = INK[theme];
  }

  apply(currentTheme());

  document.addEventListener("DOMContentLoaded", () => {
    syncIcon(currentTheme());
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      try { localStorage.setItem(KEY, next); } catch { /* private browsing, etc: theme just won't stick */ }
      apply(next);
    });
  });
})();
