"use strict";

/* Host-facing changelog for the "What's new" panel on the sign-in screen
   (public/host.html, #whatsNew). Newest entry first.
   Convention (also in CLAUDE.md): whenever a user-facing feature, fix, or
   enhancement ships, add an entry here (or an item to today's entry if one
   already exists for this date). Keep items short and host-facing, no
   internal implementation detail, no file names. */
const CHANGELOG = [
  {
    date: "2026-09-18",
    items: [
      "Pictures and GIFs on a question now show on every player's phone, not just the host screen.",
      "GIFs stay animated instead of freezing into a still image when added to a question.",
      "Search and add GIFs from Giphy right in the question editor.",
      "The host screen calls out the fastest correct answer after each question.",
      "Added sound: a countdown tick, a reveal chime, and a podium fanfare on the host screen, plus correct/incorrect sounds in self-paced quizzes.",
      "Players get a small confetti moment when they're on a correct-answer streak."
    ]
  }
];

/* Shown on the sign-in screen only, capped to the most recent releases so
   it never grows into a wall of text a host has to scroll past to sign in. */
const MAX_RELEASES_SHOWN = 3;

document.addEventListener("DOMContentLoaded", () => {
  const wrap = document.getElementById("whatsNew");
  const list = document.getElementById("whatsNewList");
  if (!wrap || !list || !CHANGELOG.length) return;

  list.innerHTML = "";
  CHANGELOG.slice(0, MAX_RELEASES_SHOWN).forEach(release => {
    const block = document.createElement("div");
    block.className = "whatsnew-release";
    const date = document.createElement("p");
    date.className = "whatsnew-date";
    date.textContent = release.date;
    block.appendChild(date);
    const ul = document.createElement("ul");
    release.items.forEach(text => {
      const li = document.createElement("li");
      li.textContent = text;
      ul.appendChild(li);
    });
    block.appendChild(ul);
    list.appendChild(block);
  });
  wrap.hidden = false;
});
