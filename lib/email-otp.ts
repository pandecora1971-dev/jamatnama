import { randomInt } from "node:crypto";
import { query } from "./db";
import { hash } from "./security";

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const maskedUser = user.length <= 2 ? user[0] + "*" : user[0] + "*".repeat(user.length - 2) + user[user.length - 1];
  return `${maskedUser}@${domain}`;
}

export async function sendOtpEmail(email: string, code: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const from = process.env.RESEND_FROM || "JAMATNAMA Security <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email.toLowerCase().trim()],
        subject: `আপনার JAMATNAMA অ্যাডমিন লগইন ওটিপি: ${code}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 25px; border: 1px solid #e2e8f0; border-radius: 10px; background-color: #ffffff;">
            <h2 style="color: #dc2626; margin-top: 0; font-size: 20px;">জামাতনামা (JAMATNAMA) অ্যাডমিন লগইন</h2>
            <p style="color: #334155; font-size: 15px; line-height: 1.5;">আপনার অ্যাডমিন প্যানেলে লগইন করার জন্য নিচের ৬ সংখ্যার ওটিপি (OTP) কোডটি ব্যবহার করুন:</p>
            <div style="background: #f8fafc; border: 2px dashed #cbd5e1; padding: 18px; text-align: center; font-size: 34px; font-weight: bold; letter-spacing: 8px; color: #0f172a; border-radius: 8px; margin: 24px 0;">
              ${code}
            </div>
            <p style="color: #64748b; font-size: 13px;">কোডটির মেয়াদ থাকবে <strong>১০ মিনিট</strong>। আপনি যদি এই লগইনের চেষ্টা না করে থাকেন, তবে এটি উপেক্ষা করুন।</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">নিরাপত্তা নোটিফিকেশন · jamaatnama.org</p>
          </div>
        `,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("Resend API error:", err);
    return false;
  }
}

export async function createEmailOtp(account: string): Promise<string> {
  // Random 6-digit code from a cryptographic source
  const code = randomInt(100000, 1000000).toString();
  const bucketKey = `email_otp:${account}:${hash(code)}`;
  const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

  // Store in rate_limits table (clean up any previous expired ones)
  await query("DELETE FROM jamatnama.rate_limits WHERE bucket LIKE $1 OR expires <= $2", [
    `email_otp:${account}:%`,
    Date.now(),
  ]);
  await query(
    "INSERT INTO jamatnama.rate_limits (bucket, count, expires) VALUES ($1, $2, $3)",
    [bucketKey, 0, expires]
  );

  return code;
}

// True while an unexpired code exists for this account (it was requested after a bot check).
export async function hasPendingEmailOtp(account: string): Promise<boolean> {
  const { rows } = await query<{ n: number }>(
    "SELECT 1 AS n FROM jamatnama.rate_limits WHERE bucket LIKE $1 AND expires > $2 LIMIT 1",
    [`email_otp:${account}:%`, Date.now()],
  );
  return rows.length > 0;
}

export async function verifyEmailOtp(account: string, code: string): Promise<boolean> {
  const bucketKey = `email_otp:${account}:${hash(code)}`;
  const { rows } = await query<{ bucket: string; count: number; expires: string }>(
    "SELECT bucket, count, expires FROM jamatnama.rate_limits WHERE bucket = $1 AND expires > $2",
    [bucketKey, Date.now()]
  );

  if (!rows || rows.length === 0) {
    return false;
  }

  // OTP is single-use: delete immediately upon verification
  await query("DELETE FROM jamatnama.rate_limits WHERE bucket = $1", [bucketKey]);
  return true;
}

