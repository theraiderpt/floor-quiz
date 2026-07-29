/* One-time admin bootstrap, and the only way to reset an admin's password.
   Run manually over SSH, never through the web app:
     node scripts/create-admin.mjs admin@example.com
   Not a web endpoint, so there's no new .env secret involved - the admin
   account lives in the database, hashed with server/auth.js. */
import readline from "node:readline";
import { store } from "../server/db.js";
import { hashPassword } from "../server/auth.js";

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: node scripts/create-admin.mjs <email>");
  process.exit(1);
}

/* Two sequential rl.question() calls on the same interface can hang when
   stdin isn't a real interactive TTY (e.g. piped input in a test harness),
   so both prompts are read off one for-await loop instead. */
async function readHiddenLines(prompts) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let muted = false;
  rl._writeToOutput = str => { if (!muted) rl.output.write(str); };
  const answers = [];
  process.stdout.write(prompts[0]);
  muted = true;
  for await (const line of rl) {
    muted = false;
    process.stdout.write("\n");
    answers.push(line);
    if (answers.length >= prompts.length) break;
    process.stdout.write(prompts[answers.length]);
    muted = true;
  }
  rl.close();
  return answers;
}

const [password, confirm] = await readHiddenLines(["Password (min 8 characters): ", "Confirm password: "]);
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}
if (password !== confirm) {
  console.error("Passwords did not match.");
  process.exit(1);
}

const admin = store.admins.upsert(email, hashPassword(password));
console.log(`Admin account ready: ${admin.email}`);
process.exit(0);
