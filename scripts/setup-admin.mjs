import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
// Adds a generated key only when the file has none, so re-running never replaces existing keys.
const keep = (name, value, text) => (new RegExp(`^${name}=.+`, "m").test(text) ? "" : `${name}=${value}\n`);
const salt = randomBytes(16).toString("hex");
const password = randomBytes(18).toString("base64url");
const secret = randomBytes(48).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
const previous = existsSync(".env.local")
  ? readFileSync(".env.local", "utf8")
  : "";
const rest = previous
  .split("\n")
  .filter(
    (l) =>
      !l.startsWith("ADMIN_PASSWORD_HASH=") && !l.startsWith("SESSION_SECRET="),
  )
  .join("\n");
writeFileSync(
  ".env.local",
  `ADMIN_PASSWORD_HASH=${salt}:${hash}\nSESSION_SECRET=${secret}\n${keep("MFA_ENCRYPTION_KEY", randomBytes(32).toString("hex"), rest)}${keep("CRON_SECRET", randomBytes(32).toString("hex"), rest)}${rest}\n`,
  { mode: 0o600 },
);
writeFileSync(
  ".admin-access.txt",
  `অ্যাডমিন পৃষ্ঠা: http://127.0.0.1:3000/msrotsntmdhfjjfdjvfvbnnjnjdsnmkjhf\nপাসওয়ার্ড: ${password}\nএটি শুধু আপনার কম্পিউটারের জন্য। অন্য কারও সঙ্গে শেয়ার করবেন না।\n`,
  { mode: 0o600 },
);
console.log(
  "অ্যাডমিন প্রস্তুত। পাসওয়ার্ড .admin-access.txt ফাইলে রাখা হয়েছে। চালু সার্ভার পুনরায় চালু করুন।",
);
