// Structured logging that cannot leak request data: database errors carry row values in `detail`,
// and object-store errors can carry signed URLs, so only the scope, name and code are ever written.
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,40}$/;
export function safeError(error: unknown) {
  const { name, code } = (error || {}) as { name?: unknown; code?: unknown };
  return {
    name: typeof name === "string" && SAFE_CODE.test(name) ? name : "Error",
    code: typeof code === "string" && SAFE_CODE.test(code) ? code : undefined,
  };
}
export function logError(scope: string, error: unknown) {
  console.error(JSON.stringify({ level: "error", scope, ...safeError(error) }));
}
export function logEvent(scope: string, fields: Record<string, number | boolean> = {}) {
  console.log(JSON.stringify({ level: "info", scope, ...fields }));
}
