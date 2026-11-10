import { productionErrors } from "../lib/production-config.mjs";
const errors = productionErrors();
if (errors.length) {
  console.error(
    "Production security configuration is incomplete: " + errors.join(", "),
  );
  process.exit(1);
}
await import("../server.js");
