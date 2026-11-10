// Runs the real production build (NODE_ENV=production, all security configuration on) as several
// instances against one database, the way separate Vercel instances share state.
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes, scryptSync } from "node:crypto";

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
export const PUBLIC_ORIGIN = "https://jamatnama.test";
export function appEnvironment(stack, ownerPassword = randomBytes(18).toString("base64url")) {
  const salt = randomBytes(8).toString("hex");
  return {
    ownerPassword,
    env: {
      ...stack.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      COOKIE_SECURE: "true",
      PUBLIC_ORIGIN,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      ADMIN_PASSWORD_HASH: `${salt}:${scryptSync(ownerPassword, salt, 64).toString("hex")}`,
      RESEND_API_KEY: "re_local_test",
      ADMIN_EMAIL: "owner@jamatnama.test",
      TEST_OTP_OUTBOX: path.join(os.tmpdir(), `jamatnama-otp-${process.pid}-${randomBytes(4).toString("hex")}.log`),
      MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      CRON_SECRET: randomBytes(24).toString("hex"),
      TURNSTILE_SITE_KEY: "local-test-site-key",
      TURNSTILE_SECRET_KEY: "local-test-secret-key",
    },
  };
}
export async function startServers(env, count, extra = {}) {
  const root = process.cwd(), standalone = path.join(root, ".next/standalone");
  if (!existsSync(path.join(standalone, "server.js"))) throw Error("Run npm run build first.");
  cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
  cpSync(path.join(root, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
  const preload = pathToFileURL(path.join(root, "tests/support/mock-turnstile.mjs")).href;
  const output = [];
  const servers = [];
  for (let i = 0; i < count; i++) {
    const port = await freePort();
    const child = spawn(process.execPath, ["--import", preload, path.join(standalone, "server.js")], {
      env: { ...process.env, ...env, ...extra, HOSTNAME: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => output.push(d.toString()));
    child.stderr.on("data", (d) => output.push(d.toString()));
    servers.push({ child, port, base: `http://127.0.0.1:${port}` });
  }
  for (const server of servers)
    for (let attempt = 0; ; attempt++) {
      try {
        if ((await fetch(`${server.base}/api/health`)).ok) break;
      } catch {}
      if (attempt > 120) throw Error(`Server did not start: ${output.join("").slice(-800)}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  return {
    servers,
    output,
    stop: () =>
      Promise.all(
        servers.map(
          ({ child }) =>
            new Promise((resolve) => {
              child.once("exit", resolve);
              child.kill();
            }),
        ),
      ),
  };
}
