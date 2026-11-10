// Adds the Supabase owner connection and CA certificate to .env.local without showing either.
// Usage, from the JAMATNAMA folder: npm run setup:db-env
// 1. Paste the "Session pooler" URI from Supabase → Connect, exactly as copied.
// 2. If it still contains [YOUR-PASSWORD], type the database password when asked (input is hidden).
// The certificate is taken from ./supabase-ca.crt, or the newest prod-ca*.crt in your Downloads folder.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline";

const lines = [];
let waiting = null;
const input = readline.createInterface({ input: process.stdin, terminal: false });
input.on("line", (line) => (waiting ? (waiting(line), (waiting = null)) : lines.push(line)));
function ask(question, hidden = false) {
  process.stdout.write(question);
  // Hide typed characters on an interactive terminal; piped input is never echoed anyway.
  if (hidden && process.stdin.isTTY) process.stdin.setRawMode?.(false);
  return new Promise((resolve) => (lines.length ? resolve(lines.shift()) : (waiting = resolve))).then((answer) => {
    process.stdout.write("\n");
    return answer.trim();
  });
}
async function askHidden(question) {
  if (!process.stdin.isTTY) return ask(question, true);
  process.stdout.write(question);
  input.pause();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  return new Promise((resolve) => {
    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          input.resume();
          return resolve(value);
        }
        if (char === "\u0003") process.exit(1);
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}
function findCertificate() {
  if (existsSync("supabase-ca.crt")) return "supabase-ca.crt";
  const downloads = path.join(homedir(), "Downloads");
  if (!existsSync(downloads)) return null;
  const candidates = readdirSync(downloads)
    .filter((name) => /\.(crt|pem)$/i.test(name) && /ca/i.test(name))
    .map((name) => path.join(downloads, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] || null;
}
function setLine(text, name, value) {
  const kept = text.split(/\r?\n/).filter((line) => !line.startsWith(`${name}=`) && line.trim() !== "");
  return [...kept, `${name}=${value}`].join("\n") + "\n";
}

if (!existsSync("package.json") || !JSON.parse(readFileSync("package.json", "utf8")).name?.includes("jamatnama")) {
  console.error("Run this from the JAMATNAMA folder.");
  process.exit(1);
}
const certificatePath = findCertificate();
if (!certificatePath) {
  console.error("No certificate found. Download it from Supabase → Project Settings → Database → SSL Configuration, then run this again.");
  process.exit(1);
}
const pem = readFileSync(certificatePath, "utf8");
if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
  console.error("The certificate file is not in the expected format. Download it again from Supabase.");
  process.exit(1);
}
if (certificatePath !== "supabase-ca.crt") copyFileSync(certificatePath, "supabase-ca.crt");
console.log("Certificate found.");

let uri = (await ask("Paste the Session pooler URI from Supabase → Connect, then press Enter:\n> ")).replace(/^["']|["']$/g, "");
if (/\[YOUR-PASSWORD\]/.test(uri)) {
  const password = await askHidden("Type your database password (it will not be shown), then press Enter: ");
  if (!password) {
    console.error("No password entered. Nothing was changed.");
    process.exit(1);
  }
  uri = uri.replace("[YOUR-PASSWORD]", encodeURIComponent(password));
}
let parsed;
try {
  parsed = new URL(uri);
} catch {
  console.error("That does not look like a connection URI. Nothing was changed.");
  process.exit(1);
}
const problems = [];
if (!/^postgres(ql)?:$/.test(parsed.protocol)) problems.push("it should start with postgresql://");
if (!/^postgres\.[a-z0-9]{20}$/.test(decodeURIComponent(parsed.username))) problems.push("the user should look like postgres.<project-ref>");
if (!parsed.password) problems.push("the password is missing");
if (!parsed.hostname.endsWith(".pooler.supabase.com")) problems.push("use the Session pooler address (…pooler.supabase.com)");
if (parsed.port !== "5432") problems.push("use the Session pooler (port 5432), not the Transaction pooler (6543)");
if (problems.length) {
  console.error(`Nothing was changed: ${problems.join("; ")}.`);
  process.exit(1);
}
const envFile = ".env.local";
let env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
env = setLine(env, "DATABASE_ADMIN_URL", parsed.toString());
env = setLine(env, "DATABASE_CA_CERT", Buffer.from(pem, "utf8").toString("base64"));
writeFileSync(envFile, env, { mode: 0o600 });
console.log(`Saved to .env.local for project ${decodeURIComponent(parsed.username).split(".")[1]}. Tell Claude it is done.`);
input.close();
