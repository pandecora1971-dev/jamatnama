import type { NextConfig } from "next";
// Browsers upload directly to this one origin. Bucket contents stay private.
function storageOrigin() {
  const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "");
  try {
    return endpoint ? new URL(endpoint).origin : "";
  } catch {
    return "";
  }
}
const connect = `connect-src 'self' https://challenges.cloudflare.com ${storageOrigin()}`.trim();
const config: NextConfig = {
  // Vercel uses its own output format; standalone is for self-hosted and local production runs.
  output: process.env.VERCEL ? undefined : "standalone",
  distDir: process.env.JAMATNAMA_BUILD_DIR || ".next",
  devIndicators: false,
  poweredByHeader: false,
  webpack(config) {
    if (process.env.JAMATNAMA_DISABLE_WEBPACK_CACHE === "true") config.cache = false;
    return config;
  },
  // Lets phones on the local Wi-Fi load dev assets (next dev --hostname 0.0.0.0)
  allowedDevOrigins: ["192.168.*.*"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              process.env.NODE_ENV === "development"
                ? `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; ${connect}; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
                : `default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; ${connect}; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};
export default config;
