// Preloaded into local production-mode servers with `node --import`. The app has no bot-check bypass of
// its own; only this test preload answers Cloudflare's siteverify. A token "ok:<action>" passes as that action.
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://challenges.cloudflare.com/turnstile/")) return real(input, init);
  const { response } = JSON.parse(String(init.body));
  const [state, action] = String(response).split(":");
  return Response.json({ success: state === "ok", action, hostname: new URL(process.env.PUBLIC_ORIGIN).hostname });
};
