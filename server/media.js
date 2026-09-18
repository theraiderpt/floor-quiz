/* Question pictures: either uploaded by the host (stored on disk, served
   back as a short /uploads/... URL) or picked from Giphy (stored as Giphy's
   own CDN URL, nothing to host). Either way `img` on a question ends up as
   a short string cheap enough to travel in every state broadcast, unlike
   the old scheme of embedding the picture itself as base64 on the question. */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

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
  if (!m) throw new Error("That doesn't look like a supported image (JPEG, PNG, WebP or GIF).");
  const [, mime, b64] = m;
  const bytes = Buffer.from(b64, "base64");
  const cap = MAX_BYTES[mime] || MAX_BYTES.default;
  if (bytes.length > cap) {
    throw new Error(`That file is too large (${(bytes.length / 1e6).toFixed(1)}MB, max ${(cap / 1e6).toFixed(1)}MB).`);
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
    const err = new Error("Giphy isn't configured on this server (missing GIPHY_API_KEY).");
    err.code = "no_key";
    throw err;
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
  if (!res.ok) throw new Error("Giphy search failed (" + res.status + ").");
  const body = await res.json();

  return (body.data || []).map(g => ({
    id: g.id,
    title: g.title || "",
    previewUrl: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url,
    url: g.images?.fixed_width?.url || g.images?.original?.url
  })).filter(g => g.previewUrl && g.url);
}
