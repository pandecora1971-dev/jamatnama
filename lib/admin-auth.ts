import { query } from "./db";
import { totpStep } from "./totp";
// A code is accepted once per identity across every instance: only a strictly newer step can win.
export async function consumeTotp(secret: string, code: string, now = Date.now(), identity = "owner") {
  const step = totpStep(secret, code, now);
  if (step === null) return false;
  const { rowCount } = await query(
    `INSERT INTO jamatnama.totp_replay(identity,step) VALUES($1,$2)
     ON CONFLICT(identity) DO UPDATE SET step=excluded.step WHERE totp_replay.step<excluded.step`,
    [identity, step],
  );
  return rowCount === 1;
}
