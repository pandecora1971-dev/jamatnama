import { randomBytes } from "node:crypto";
import { readFile, writeFile, unlink, chmod } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import nextEnv from "@next/env";
import { totpStep } from "../lib/totp.ts";
nextEnv.loadEnvConfig(process.cwd());
if (process.env.ADMIN_TOTP_SECRET)
  throw Error(
    "2FA already configured. Use the private server configuration for an intentional rotation.",
  );
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
let bits = 0,
  value = 0,
  secret = "";
for (const byte of randomBytes(20)) {
  value = (value << 8) | byte;
  bits += 8;
  while (bits >= 5) {
    bits -= 5;
    secret += alphabet[(value >>> bits) & 31];
  }
}
const pending = ".admin-2fa-enrollment.txt";
const uri = `otpauth://totp/JAMATNAMA:Admin?secret=${secret}&issuer=JAMATNAMA&algorithm=SHA1&digits=6&period=30`;
await writeFile(
  pending,
  `Private: do not share or commit.\nManual setup key: ${secret}\nAuthenticator URI: ${uri}\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Open .admin-2fa-enrollment.txt privately and add the key to your authenticator. Do not use an online QR service.",
);
const terminal = createInterface({
  input: process.stdin,
  output: process.stdout,
});
try {
  const code = (
    await terminal.question("Enter the current 6-digit code to activate: ")
  ).trim();
  if (totpStep(secret, code) === null)
    throw Error("Invalid code. No settings were changed.");
  const env = await readFile(".env.local", "utf8");
  await writeFile(
    ".env.local",
    env.replace(/^ADMIN_TOTP_SECRET=.*\n?/gm, "") +
      `\nADMIN_TOTP_SECRET=${secret}\n`,
    { mode: 0o600 },
  );
  await chmod(".env.local", 0o600);
  console.log(
    "Authenticator verified and enabled. Restart the app. Store an encrypted backup of the server secrets securely.",
  );
} finally {
  terminal.close();
  await unlink(pending);
}
