/* Question pictures: either uploaded by the host (stored on disk, served
   back as a short /uploads/... URL) or picked from Giphy (stored as Giphy's
   own CDN URL, nothing to host). Either way `img` on a question ends up as
   a short string cheap enough to travel in every state broadcast, unlike
   the old scheme of embedding the picture itself as base64 on the question. */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { store } from "./db.js";

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif"
};

/* GIFs pass through untouched (see the client-side compressor's note on why
   it skips canvas re-encoding for them), so they can legitimately be a few
   MB. Static images are already canvas-compressed to ~340KB client side
   before they ever reach this endpoint, but the server enforces its own
   ceiling regardless of what the client claims to have done. */
/* Kept comfortably under express.json's 8mb body limit even after base64's
   ~33% overhead (a 4MB GIF becomes a ~5.3MB request body). */
const MAX_BYTES = { "image/gif": 4_000_000, default: 1_000_000 };

/* `code` (and `vars`) let the client show the message in the host's own
   language; `message` stays the English fallback. */
function codedError(code, message, vars) {
  return Object.assign(new Error(message), { code, vars });
}

/* The data-URL prefix is client-claimed, so check the bytes really start like
   the image type they say they are. */
const MAGIC = {
  "image/jpeg": b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/gif": b => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("latin1")),
  "image/webp": b => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"
};

let dirReady = null;
function ensureDir() {
  if (!dirReady) dirReady = fs.mkdir(config.uploadsDir, { recursive: true });
  return dirReady;
}

/** @param {string} dataUrl  A `data:<mime>;base64,<data>` string from the
 *  host console's file picker. @returns {Promise<string>} the `/uploads/...`
 *  URL to store on the question, or throws with a message safe to show the host. */
export async function saveImageUpload(dataUrl) {
  const m = typeof dataUrl === "string" && dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!m) throw codedError("img_type", "That doesn't look like a supported image (JPEG, PNG, WebP or GIF).");
  const [, mime, b64] = m;
  const bytes = Buffer.from(b64, "base64");
  if (!MAGIC[mime](bytes)) throw codedError("img_type", "That doesn't look like a supported image (JPEG, PNG, WebP or GIF).");
  const cap = MAX_BYTES[mime] || MAX_BYTES.default;
  if (bytes.length > cap) {
    const size = (bytes.length / 1e6).toFixed(1), max = (cap / 1e6).toFixed(1);
    throw codedError("img_too_big", `That file is too large (${size}MB, max ${max}MB).`, { size, max });
  }
  await ensureDir();
  const filename = randomUUID() + EXT_BY_MIME[mime];
  await fs.writeFile(path.join(config.uploadsDir, filename), bytes);
  return "/uploads/" + filename;
}

/** Proxies a Giphy search server-side so the API key never reaches the
 *  client. Empty `query` returns trending GIFs, matching Giphy's own picker UX. */
export async function searchGiphy(query, limit = 15) {
  if (!config.giphyApiKey) {
    throw codedError("giphy_no_key", "Giphy isn't configured on this server (missing GIPHY_API_KEY).");
  }
  const endpoint = query ? "search" : "trending";
  const params = new URLSearchParams({
    api_key: config.giphyApiKey,
    limit: String(Math.min(Math.max(Number(limit) || 15, 1), 24)),
    rating: "g"
  });
  if (query) params.set("q", query);

  const res = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`, {
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw codedError("giphy_failed", "Giphy search failed (" + res.status + ").", { status: res.status });
  const body = await res.json();

  return (body.data || []).map(g => ({
    id: g.id,
    title: g.title || "",
    previewUrl: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url,
    url: g.images?.fixed_width?.url || g.images?.original?.url
  })).filter(g => g.previewUrl && g.url);
}

/* Deletes uploaded pictures no saved quiz refers to any more (a question or
   quiz was edited or deleted). Files younger than a day are kept, since a
   picture is uploaded before the quiz that will use it is saved. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export async function sweepOrphanUploads() {
  let names;
  try { names = await fs.readdir(config.uploadsDir); } catch { return 0; }
  const referenced = store.quizzes.allQuestionsJson();
  let removed = 0;
  for (const name of names) {
    if (referenced.includes(name)) continue;
    const file = path.join(config.uploadsDir, name);
    try {
      const { mtimeMs } = await fs.stat(file);
      if (Date.now() - mtimeMs < ORPHAN_GRACE_MS) continue;
      await fs.unlink(file);
      removed++;
    } catch { /* gone already, or unreadable: try again next sweep */ }
  }
  return removed;
}
