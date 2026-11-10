async function boundedBody(req: Request, max: number, timeoutMs: number) {
  if (!req.body) throw Error("Empty body");
  const reader = req.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Error("Body timeout");
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error("Body timeout")), remaining);
        }),
      ]).finally(() => clearTimeout(timer));
      if (done) break;
      size += value.byteLength;
      if (size > max) throw Error("Body too large");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function limitedJson(req: Request, max = 8192) {
  const parsed: unknown = JSON.parse((await boundedBody(req, max, 10000)).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw Error("Expected a JSON object");
  return parsed as Record<string, unknown>;
}
