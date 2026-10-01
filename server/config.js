import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..");
export const PUBLIC_DIR = path.join(ROOT, "public");

export const config = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  sessionSecret: process.env.SESSION_SECRET || "",
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
  dbPath: process.env.DB_PATH || path.join(ROOT, "data", "floor-quiz.db"),
  maxPlayers: Number(process.env.MAX_PLAYERS || 400),
  giphyApiKey: process.env.GIPHY_API_KEY || ""
};

/* Next to the database, outside the app directory, for the same reason:
   a redeploy (deploy/update.sh untars over APP_DIR) never wipes uploaded
   question pictures. */
config.uploadsDir = path.join(path.dirname(config.dbPath), "uploads");

config.isProd = config.env === "production";

/* Scoring. Kept here so you can retune the game feel without touching logic.
   A correct answer never scores less than BASE, so slow-but-right still pays.
   SPEED is the slice that decays linearly to zero across the time limit. */
export const SCORING = {
  BASE: 600,
  SPEED: 400,
  STREAK_STEP: 60,
  STREAK_CAP: 5
};

/* How long the room sits on the reveal (answer breakdown) and the standings
   screen before the game moves on by itself. A host click still jumps ahead
   immediately; these just mean nobody has to. */
export const FLOW = {
  revealMs: Number(process.env.REVEAL_MS || 6000),
  scoresMs: Number(process.env.SCORES_MS || 5000),
  /* How long a finished game stays reachable (host reload on the podium,
     a player's phone reconnecting) before it is dropped from memory. */
  finishedGraceMs: Number(process.env.FINISHED_GRACE_MS || 2 * 60 * 1000)
};

/* Fail loudly rather than booting a public server with default secrets.
   HOST_PASSWORD is no longer read anywhere: host and admin accounts live in
   the database now, hashed with server/auth.js. */
const weak = ["", "change-me-before-you-deploy", "change-me-too"];
if (config.isProd) {
  const problems = [];
  if (weak.includes(config.sessionSecret) || config.sessionSecret.length < 32) problems.push("SESSION_SECRET");
  if (!config.publicUrl) problems.push("PUBLIC_URL");
  if (problems.length) {
    console.error("Refusing to start in production. Fix these in .env: " + problems.join(", "));
    process.exit(1);
  }
}
