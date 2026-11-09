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

  /* One second of white noise, reused for drum and cymbal hits. */
  let noiseBuf = null;
  function noise(startOffset, durationMs, gainPeak, freq) {
    const c = ensureCtx();
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + startOffset;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    const gain = c.createGain();
    gain.gain.setValueAtTime(gainPeak, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationMs / 1000);
    src.connect(filter).connect(gain).connect(c.destination);
    src.start(t0);
    src.stop(t0 + durationMs / 1000 + 0.02);
  }

  /* Timed to the podium in app.css: places rise at 0.3s, 1.3s and 2.3s and
     each lands about 0.4s later. A roll builds under all three, a hit marks
     third and second landing, and first gets a crash, a fanfare and the crowd. */
  function podium() {
    for (let t = 0; t < 2.6; t += 0.05) noise(t, 70, 0.1 + 0.25 * (t / 2.6), 1900);
    [[0.7, 196, 392], [1.7, 262, 523]].forEach(([t, low, high]) => {
      tone(low, t, 260, "triangle", 0.22);
      noise(t, 160, 0.16, 2500);
      [high, high * 1.25, high * 1.5].forEach(f => tone(f, t, 360, "sawtooth", 0.035));
    });
    const win = 2.7;
    noise(win, 1600, 0.22, 7000);
    tone(131, win, 500, "triangle", 0.25);
    [392, 523, 659, 784].forEach((f, i) => {
      tone(f, win + i * 0.11, 220, "sawtooth", 0.05);
      tone(f, win + i * 0.11, 220, "triangle", 0.1);
    });
    [523, 659, 784, 1047].forEach(f => {
      tone(f, win + 0.48, 1500, "sawtooth", 0.03);
      tone(f, win + 0.48, 1500, "triangle", 0.07);
    });
    /* A recorded crowd cheer if one is installed in public/audio; without
       the file this stays silent and the synth fanfare carries it alone. */
    setTimeout(() => {
      if (muted) return;
      const cheer = new Audio("/audio/cheer.mp3");
      cheer.volume = 0.7;
      cheer.addEventListener("error", () => { /* no file installed */ });
      cheer.play().catch(() => {});
    }, win * 1000);
  }

  const SOUNDS = {
    tick: () => tone(880, 0, 70, "square", 0.05),
    reveal: () => { tone(659, 0, 100, "sine"); tone(880, 0.08, 180, "sine"); },
    correct: () => { tone(523, 0, 110, "sine"); tone(784, 0.09, 220, "sine"); },
    incorrect: () => tone(180, 0, 260, "sawtooth", 0.09),
    podium
  };

  function play(name) {
    if (muted || !SOUNDS[name]) return;
    /* Never let a sound glitch (autoplay block, no output device, an
       AudioContext that failed to construct) break the game around it. */
    try { SOUNDS[name](); } catch { /* ignore */ }
  }

  /* Looping background music, host screen only, same reasoning as above.
     Files live in public/audio and are royalty-free loops; a missing file
     just stays silent rather than erroring, so the game never depends on it. */
  const TRACKS = { lobby: "/audio/lobby.mp3", think: "/audio/think.mp3" };
  const music = new Audio();
  music.loop = true;
  music.volume = 0.35;
  music.addEventListener("error", () => { /* missing or unplayable file: stay silent */ });
  let track = null;

  function startMusic() {
    if (muted || !track) return;
    /* play() rejects when the browser hasn't seen a gesture yet; the
       pointerdown listener below retries once the host taps anything. */
    music.play().catch(() => {});
  }

  function setMusic(name) {
    const next = TRACKS[name] ? name : null;
    if (next === track) return startMusic();
    track = next;
    music.pause();
    if (!track) return;
    music.src = TRACKS[track];
    startMusic();
  }

  function syncToggles() {
    document.querySelectorAll("[data-sound-toggle]").forEach(btn => { btn.textContent = muted ? "🔇" : "🔊"; });
  }

  function setMuted(next) {
    muted = next;
    try { localStorage.setItem(KEY, muted ? "1" : "0"); } catch { /* ignore */ }
    syncToggles();
    if (muted) music.pause(); else startMusic();
  }

  document.addEventListener("DOMContentLoaded", () => {
    syncToggles();
    document.querySelectorAll("[data-sound-toggle]").forEach(btn => {
      btn.addEventListener("click", () => setMuted(!muted));
    });
    /* Any tap unlocks audio for the session, satisfying autoplay policy
       without a dedicated "enable sound" prompt. */
    document.addEventListener("pointerdown", () => { try { ensureCtx(); } catch { /* ignore */ } }, { once: true });
    document.addEventListener("pointerdown", () => { if (music.paused) startMusic(); });
  });

  window.Sound = { play, music: setMusic };
})();
