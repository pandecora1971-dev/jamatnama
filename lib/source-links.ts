// People often paste "www.site.com/…" or "site.com/…" without a scheme, wrap a link in
// quotes or brackets, or end it with sentence punctuation. Tidy that up before checking.
export function normalizeSourceLink(raw: string) {
  let value = raw
    .trim()
    .replace(/^[<(\["'“‘]+/, "")
    .replace(/[>\]"'”’.,;:!?।]+$/, "");
  if (value && !/^[a-z][a-z0-9+.-]*:/i.test(value) && /^[^\s/]+\.[^\s/]+/.test(value))
    value = `https://${value}`;
  return value;
}

/** A public web page: http(s), a dotted hostname and no embedded login. Safe to show readers. */
export function isAcceptableSourceLink(value: string) {
  if (value.length > 2000) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.includes(".") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
