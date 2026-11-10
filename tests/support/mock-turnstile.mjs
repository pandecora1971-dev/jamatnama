// Preloaded into local production-mode servers with `node --import`. The app has no bot-check bypass of
// its own; only this test preload answers Cloudflare's siteverify and captures Resend email. A token "ok:<action>" passes as that action.
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.resend.com/") && process.env.TEST_OTP_OUTBOX) {
    // Test-only mail sink: the email is written to a local file instead of being sent.
    const { appendFileSync } = await import("node:fs");
    const mail = JSON.parse(String(init.body));
    appendFileSync(process.env.TEST_OTP_OUTBOX, JSON.stringify({ to: mail.to, subject: mail.subject }) + "\n");
    return Response.json({ id: "test-email" });
  }
  if (!url.startsWith("https://challenges.cloudflare.com/turnstile/")) return real(input, init);
  const { response } = JSON.parse(String(init.body));
  const [state, action] = String(response).split(":");
  return Response.json({ success: state === "ok", action, hostname: new URL(process.env.PUBLIC_ORIGIN).hostname });
};
