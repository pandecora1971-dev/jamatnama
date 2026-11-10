// Local development services: real PostgreSQL plus the R2 and clamd doubles. Local-only credentials.
// Usage: npm run dev:stack, then copy the printed values into .env.local and run npm run dev.
import path from "node:path";
import { startStack } from "../tests/support/stack.mjs";

const stack = await startStack({
  dataDir: path.resolve(".local-stack/postgres"),
  persistent: true,
  pgPort: 54329,
  r2Port: 54330,
  clamdPort: 54331,
  publicOrigin: process.env.LOCAL_ORIGIN || "http://127.0.0.1:3000",
});
console.log("Local stack is running. Add these to .env.local:\n");
for (const [key, value] of Object.entries(stack.env)) console.log(`${key}=${value}`);
console.log("\nThe R2 double keeps objects in memory only. Press Ctrl+C to stop.");
const stop = async () => {
  await stack.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 60_000);
