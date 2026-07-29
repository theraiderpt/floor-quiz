import crypto from "node:crypto";

const KEYLEN = 64;

/* scrypt over bcrypt: it's in node:crypto already, so no native dependency
   to compile alongside better-sqlite3. Stored as "saltHex:hashHex". */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !stored.includes(":")) return false;
  const [saltHex, hashHex] = stored.split(":");
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(String(password), salt, KEYLEN);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function randomToken() {
  return crypto.randomBytes(24).toString("hex");
}
