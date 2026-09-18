"use strict";

/* Small Web Audio synth: short oscillator stingers for the moments Kahoot
   uses music/SFX for, without needing to ship or license audio files.
   Deliberately only wired into the host screen (public/js/host.js) and the
   self-paced flow (public/js/take.js), not the live player screen: a room
   of 30-150 phones each playing their own correct/wrong sound would be
   noise, not engagement. Kahoot's own sound comes from the one shared
   screen/speakers, not individual devices, and this matches that. */
(function () {
  const KEY = "fq-sound-muted";
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem(KEY) === "1"; } catch { /* private browsing: falls back to sound on, just won't remember the choice */ }

  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, startOffset, durationMs, type, gainPeak) {
    const c = ensureCtx();
    const t0 = c.currentTime + startOffset;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak || 0.16, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationMs / 1000);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + durationMs / 1000 + 0.03);
  }

  const SOUNDS = {
    tick: () => tone(880, 0, 70, "square", 0.05),
    reveal: () => { tone(659, 0, 100, "sine"); tone(880, 0.08, 180, "sine"); },
    correct: () => { tone(523, 0, 110, "sine"); tone(784, 0.09, 220, "sine"); },
    incorrect: () => tone(180, 0, 260, "sawtooth", 0.09),
    podium: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 260, "sine", 0.14)); }
  };

  function play(name) {
    if (muted || !SOUNDS[name]) return;
    /* Never let a sound glitch (autoplay block, no output device, an
       AudioContext that failed to construct) break the game around it. */
    try { SOUNDS[name](); } catch { /* ignore */ }
  }

  function syncToggles() {
    document.querySelectorAll("[data-sound-toggle]").forEach(btn => { btn.textContent = muted ? "🔇" : "🔊"; });
  }

  function setMuted(next) {
    muted = next;
    try { localStorage.setItem(KEY, muted ? "1" : "0"); } catch { /* ignore */ }
    syncToggles();
  }

  document.addEventListener("DOMContentLoaded", () => {
    syncToggles();
    document.querySelectorAll("[data-sound-toggle]").forEach(btn => {
      btn.addEventListener("click", () => setMuted(!muted));
    });
    /* Any tap unlocks audio for the session, satisfying autoplay policy
       without a dedicated "enable sound" prompt. */
    document.addEventListener("pointerdown", () => { try { ensureCtx(); } catch { /* ignore */ } }, { once: true });
  });

  window.Sound = { play };
})();
