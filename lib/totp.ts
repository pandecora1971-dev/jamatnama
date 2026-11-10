import { createHmac, timingSafeEqual } from "node:crypto";

function decode(secret: string) {
  const clean = secret.replace(/[\s=]/g, "").toUpperCase();
  if (!/^[A-Z2-7]{32,128}$/.test(clean))
    throw Error("Invalid authenticator secret");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    value = 0;
  const output: number[] = [];
  for (const char of clean) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(output);
}
export function validTotpSecret(secret: string) {
  try {
    decode(secret);
    return true;
  } catch {
    return false;
  }
}
export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000,
  ).padStart(6, "0");
}
export function totpStep(
  secret: string,
  code: string,
  now = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code) || !validTotpSecret(secret)) return null;
  const current = Math.floor(now / 30000);
  for (const step of [current, current - 1, current + 1]) {
    if (
      step >= 0 &&
      timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))
    )
      return step;
  }
  return null;
}
