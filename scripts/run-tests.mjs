// `npm test`: runs every test file against real PostgreSQL, the R2 double and the clamd double.
// The doubles live in this process, so the child must be spawned asynchronously or they stop answering.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { startStack, testSecrets } from "../tests/support/stack.mjs";

const stack = await startStack();
let status = 1;
try {
  const secrets = testSecrets();
  const files = readdirSync("tests").filter((f) => f.endsWith(".test.ts")).sort().map((f) => path.join("tests", f));
  const only = process.argv.slice(2);
  status = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--test", "--test-force-exit", "--test-timeout=120000", "--test-concurrency=1", ...(only.length ? only : files)],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          ...stack.env,
          MFA_ENCRYPTION_KEY: secrets.mfaKey,
          CRON_SECRET: secrets.cronSecret,
          TEST_ADMIN_BASE: stack.adminBase,
        },
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await stack.stop();
}
process.exit(status);
