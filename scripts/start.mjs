import { productionErrors } from "../lib/production-config.mjs";
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import nextEnv from "@next/env";
const root = process.cwd();
nextEnv.loadEnvConfig(root);
const errors = productionErrors();
if (errors.length)
  throw Error(
    "Production security configuration is incomplete: " + errors.join(", "),
  );
const standalone = path.join(root, ".next/standalone");
if (!existsSync(path.join(standalone, "server.js")))
  throw Error("আগে npm run build চালান।");
cpSync(path.join(root, "public"), path.join(standalone, "public"), {
  recursive: true,
});
cpSync(path.join(root, ".next/static"), path.join(standalone, ".next/static"), {
  recursive: true,
});
const server = spawn(process.execPath, [path.join(standalone, "server.js")], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: process.env.BIND_HOST || "127.0.0.1",
    PORT: process.env.PORT || "3000",
  },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
