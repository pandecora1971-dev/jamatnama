import { revision } from "./db";
// Published data only. Staleness is bounded and documented in docs/DEPLOYMENT.md:
//   revision endpoint: 5s CDN + 5s stale. Data URLs keyed by revision: 30s CDN, no stale serving.
//   Instance memo: 2s. A bump changes the data URL clients use, so old entries stop being requested.
export const REVISION_CDN_SECONDS = 5;
export const REVISION_STALE_SECONDS = 5;
export const DATA_CDN_SECONDS = 30;
export const MEMO_MS = 2000;

/** Vercel-CDN-Cache-Control applies at Vercel's edge only, so browsers and proxies keep no copy. */
export function publicJson(body: unknown, cdnSeconds: number, staleSeconds = 0, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Vercel-CDN-Cache-Control": `max-age=${cdnSeconds}${staleSeconds ? `, stale-while-revalidate=${staleSeconds}` : ""}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
// Single-flight memo: concurrent identical misses on one instance share one database query.
type Entry = { expires: number; value: Promise<unknown> };
const memoEntries = new Map<string, Entry>();
export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now(), hit = memoEntries.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  if (memoEntries.size >= 500)
    for (const [entryKey, entry] of memoEntries) if (entry.expires <= now || memoEntries.size >= 500) memoEntries.delete(entryKey);
  const value = load();
  memoEntries.set(key, { expires: now + ttlMs, value });
  value.catch(() => memoEntries.delete(key));
  return value;
}
export function clearMemo() {
  memoEntries.clear();
}
export const currentRevision = () => memo("revision", 1000, () => revision());
/**
 * Only a response for the current revision may be stored by the CDN. A stale or invented `rev`
 * still gets live data, but no-store, so it can neither pin old data nor poison the cache.
 */
export function dataResponse(body: unknown, requested: string | null, current: number) {
  if (requested === null) return publicJson(body, 10);
  if (requested !== String(current)) return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  return publicJson(body, DATA_CDN_SECONDS);
}
