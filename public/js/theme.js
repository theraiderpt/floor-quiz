"use strict";

/* Loaded synchronously in <head> on every page, before the stylesheet's
   default (light) theme can paint, so a visitor who has already chosen
   dark doesn't see a flash of light first. The click handler waits for
   DOMContentLoaded since the toggle button itself hasn't parsed yet at
   this point in <head>. */
(function () {
  const KEY = "fq-theme";

  // Only an explicit stored "dark" opts out: older visitors who stored
  // "light" and everyone with nothing stored get the new light default.
  function storedTheme() {
    try { return localStorage.getItem(KEY) === "dark" ? "dark" : "light"; } catch { return "light"; }
  }

  function syncIcon(theme) {
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    const sun = btn.querySelector(".ic-sun"), moon = btn.querySelector(".ic-moon");
    // The icons are SVG elements, which have no .hidden property (it only
    // exists on HTML elements), so the attribute has to be set directly.
    if (sun) sun.toggleAttribute("hidden", theme !== "dark");
    if (moon) moon.toggleAttribute("hidden", theme !== "light");
  }

  // Matches --bg in app.css, so the mobile browser chrome blends into the page.
  const GROUND = { light: "#dff1ff", dark: "#10223f" };

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    syncIcon(theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = GROUND[theme];
  }

  // persist defaults to false so a page can impose a theme (the per-quiz
  // projector setting) without overwriting the visitor's own saved choice.
  function set(theme, opts) {
    const t = theme === "dark" ? "dark" : "light";
    if (opts && opts.persist) {
      try { localStorage.setItem(KEY, t); } catch { /* private browsing, etc: theme just won't stick */ }
    }
    apply(t);
  }

  window.FQTheme = { set };

  apply(storedTheme());

  document.addEventListener("DOMContentLoaded", () => {
    syncIcon(document.documentElement.dataset.theme);
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      set(document.documentElement.dataset.theme === "dark" ? "light" : "dark", { persist: true });
    });
  });
})();
