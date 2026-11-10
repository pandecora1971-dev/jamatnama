// Shared by the app and operational scripts. sslmode in a URL would override the ssl object,
// so it is removed here and TLS verification is decided explicitly.
const LOCAL = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
/** @param {string} connectionString @param {Record<string, string | undefined>} env */
export function connectionConfig(connectionString, env = process.env) {
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  url.searchParams.delete("pgbouncer");
  if (LOCAL.has(url.hostname)) return { connectionString: url.toString(), ssl: false };
  const encoded = env.DATABASE_CA_CERT;
  if (!encoded)
    throw Error("DATABASE_CA_CERT is required for a remote database (base64 of the Supabase CA certificate).");
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ca: Buffer.from(encoded, "base64").toString("utf8") },
  };
}
