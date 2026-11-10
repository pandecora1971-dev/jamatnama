// Run beside clamd: `npm run worker:scan` (or with --once from a scheduler).
// Set DATABASE_URL to the jamatnama_scanner role, which cannot read reports, accused details or staff.
import nextEnv from "@next/env";
import { clamdEngine, scanBatch } from "../lib/scanner";
import { closePool } from "../lib/db";
import { logError } from "../lib/log";

nextEnv.loadEnvConfig(process.cwd());
const once = process.argv.includes("--once");
const engine = clamdEngine();
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stopping = true));
while (!stopping) {
  let handled = 0;
  try {
    handled = await scanBatch(engine, 25);
  } catch (error) {
    logError("scanner.batch", error);
  }
  if (once && handled === 0) break;
  if (handled === 0) await new Promise((resolve) => setTimeout(resolve, 15_000));
}
await closePool();
