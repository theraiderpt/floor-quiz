"use strict";

/* Shows a question's picture, slide deck or YouTube video into the elements
   a screen already has: `img` for a single picture, `box` for the rest.
   Used by the host screen, the phones and the self-paced page, so all three
   handle the three kinds of media the same way. */
(function () {
  let onKey = null;

  function clearKeys() {
    if (onKey) document.removeEventListener("keydown", onKey);
    onKey = null;
  }

  function slides(box, urls, { keys }) {
    let at = 0;
    const view = document.createElement("img");
    view.className = "qimg" + (box.classList.contains("compact") ? " compact" : "");
    const prev = document.createElement("button");
    const next = document.createElement("button");
    const count = document.createElement("span");
    for (const [b, label, glyph] of [[prev, "media.prev", "‹"], [next, "media.next", "›"]]) {
      b.type = "button";
      b.className = "iconbtn slidenav";
      b.textContent = glyph;
      b.setAttribute("aria-label", t(label));
    }
    count.className = "slidecount";
    const go = n => {
      at = Math.max(0, Math.min(urls.length - 1, n));
      view.src = urls[at];
      view.alt = t("media.slide", { i: at + 1, n: urls.length });
      count.textContent = (at + 1) + " / " + urls.length;
      prev.disabled = at === 0;
      next.disabled = at === urls.length - 1;
    };
    prev.addEventListener("click", () => go(at - 1));
    next.addEventListener("click", () => go(at + 1));
    /* Arrow keys only on the shared host screen, where a presenter expects
       them; a phone has no keyboard to speak of. */
    if (keys) {
      onKey = e => {
        if (e.target.closest?.("input,textarea,select")) return;
        if (e.key === "ArrowRight") go(at + 1);
        else if (e.key === "ArrowLeft") go(at - 1);
      };
      document.addEventListener("keydown", onKey);
    }
    const nav = document.createElement("div");
    nav.className = "slidebar";
    nav.append(prev, count, next);
    box.append(view, nav);
    go(0);
  }

  /* The privacy-enhanced domain, the only one the CSP lets a page frame. */
  function video(box, id) {
    const f = document.createElement("iframe");
    f.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?rel=0&playsinline=1";
    f.title = t("media.videoTitle");
    f.allow = "encrypted-media; picture-in-picture; fullscreen";
    f.allowFullscreen = true;
    f.referrerPolicy = "strict-origin-when-cross-origin";
    box.appendChild(f);
  }

  /* `video: false` (live phones) swaps the player for a pointer to the main
     screen: a room of phones each playing the same clip would be noise. */
  function show(img, box, q, { video: withVideo = true, keys = false } = {}) {
    clearKeys();
    img.hidden = !q.img;
    img.src = q.img || "";
    box.innerHTML = "";
    const has = Boolean(q.yt || q.slides?.length);
    box.hidden = !has;
    if (q.yt) {
      if (withVideo) video(box, q.yt);
      else {
        const p = document.createElement("p");
        p.className = "note u-tc";
        p.textContent = t("media.videoOnScreen");
        box.appendChild(p);
      }
    } else if (q.slides?.length) slides(box, q.slides, { keys });
  }

  /* Accepts the common YouTube link shapes and returns the 11 character id. */
  function youtubeId(input) {
    const s = String(input || "").trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    let u;
    try { u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s); } catch { return null; }
    const host = u.hostname.replace(/^(www|m)\./, "");
    let id = null;
    if (host === "youtu.be") id = u.pathname.split("/")[1];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = u.pathname === "/watch" ? u.searchParams.get("v") : (u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?]+)/) || [])[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? id : null;
  }

  window.Media = { show, youtubeId, clear: clearKeys };
})();
