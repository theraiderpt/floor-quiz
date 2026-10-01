"use strict";

/* Interface language for every page. Loaded in <head> right after
   locales.js, before any page script, so `t()` is ready by the time a page
   builds its first dynamic string. Each device picks its own language
   (saved per browser, first guess from the browser's own preference): a
   floor with agents who read different languages can all play the same
   game, each phone in its own language. Quiz content itself is never
   translated, it is shown exactly as the host wrote it. */
(function () {
  const KEY = "fq-lang";
  const LOCALES = window.FQ_LOCALES || { en: {} };
  const SUPPORTED = Object.keys(LOCALES);

  function detect() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch { /* private browsing: fall through to the browser's preference */ }
    for (const tag of navigator.languages || [navigator.language || "en"]) {
      const base = String(tag).toLowerCase().split("-")[0];
      if (SUPPORTED.includes(base)) return base;
    }
    return "en";
  }

  let lang = detect();
  /* European Portuguese: "pt" alone gets Brazilian rules, where 0 is
     singular ("0 ponto"); Portugal says "0 pontos". */
  const PLURAL_LOCALE = { pt: "pt-PT" };
  const pluralCache = {};
  const plural = l => (pluralCache[l] ||= new Intl.PluralRules(PLURAL_LOCALE[l] || l));

  function lookup(l, key, n) {
    const dict = LOCALES[l];
    if (!dict) return undefined;
    if (typeof n === "number") {
      const hit = dict[key + "." + plural(l).select(n)] ?? dict[key + ".other"];
      if (hit != null) return hit;
    }
    return dict[key];
  }

  /** Translated string for `key`, with `{name}` placeholders filled from
   *  `vars`. A numeric `vars.n` picks the plural form (`key.one`,
   *  `key.few`, `key.other`...). Falls back to English, then to the key. */
  function t(key, vars) {
    const s = lookup(lang, key, vars?.n) ?? lookup("en", key, vars?.n) ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
  }

  /** Server errors carry a stable `code` next to the English `error` text;
   *  translate the code when we know it, otherwise show the server's text. */
  function errorText(res, fallbackKey) {
    if (res?.code && lookup("en", "err." + res.code) != null) return t("err." + res.code, res);
    return res?.error || t(fallbackKey || "err.generic");
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(n => { n.textContent = t(n.dataset.i18n); });
    scope.querySelectorAll("[data-i18n-ph]").forEach(n => { n.placeholder = t(n.dataset.i18nPh); });
    scope.querySelectorAll("[data-i18n-title]").forEach(n => { n.title = t(n.dataset.i18nTitle); });
    scope.querySelectorAll("[data-i18n-aria]").forEach(n => { n.setAttribute("aria-label", t(n.dataset.i18nAria)); });
    document.documentElement.lang = lang;
  }

  function setLang(next) {
    if (!SUPPORTED.includes(next) || next === lang) return;
    lang = next;
    try { localStorage.setItem(KEY, next); } catch { /* choice just won't stick */ }
    apply();
    syncPicker();
    /* Pages re-render whatever dynamic text they can cheaply rebuild. */
    document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
  }

  /* A compact pill showing the current language code, with a native
     <select> laid invisibly over it: the phone's own picker UI, full
     language names in the list, and nothing wider than the theme toggle
     sitting in the corner of a small screen. */
  function buildPicker() {
    const wrap = document.createElement("label");
    wrap.className = "langpick";
    const code = document.createElement("span");
    code.className = "langcode";
    const select = document.createElement("select");
    SUPPORTED.forEach(l => {
      const o = document.createElement("option");
      o.value = l;
      o.textContent = LOCALES[l]["lang.name"] || l;
      select.appendChild(o);
    });
    select.addEventListener("change", () => setLang(select.value));
    wrap.append(code, select);
    document.body.appendChild(wrap);
    syncPicker();
  }

  function syncPicker() {
    const wrap = document.querySelector(".langpick");
    if (!wrap) return;
    wrap.querySelector(".langcode").textContent = lang.toUpperCase();
    const select = wrap.querySelector("select");
    select.value = lang;
    select.setAttribute("aria-label", t("lang.choose"));
    wrap.title = t("lang.choose");
  }

  document.documentElement.lang = lang;
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    buildPicker();
  });

  window.I18N = { t, errorText, apply, setLang, get lang() { return lang; }, supported: SUPPORTED };
  window.t = t;
})();
