// A local S3-compatible test double. It verifies SigV4 with its own implementation, enforces expiry and
// signed headers, and applies CORS, so client signing is checked independently. It is NOT Cloudflare R2:
// passing against it proves our logic, not live connectivity. See docs/DEPLOYMENT.md for staging checks.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
const rfc3986 = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const xmlEscape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const errorXml = (code) => `<?xml version="1.0"?><Error><Code>${code}</Code></Error>`;

function verifySignature(req, url, secret, accessKeyId) {
  const query = url.searchParams;
  const presigned = query.has("X-Amz-Signature");
  let credential, signedHeaders, signature, amzDate, payloadHash;
  if (presigned) {
    credential = query.get("X-Amz-Credential");
    signedHeaders = query.get("X-Amz-SignedHeaders");
    signature = query.get("X-Amz-Signature");
    amzDate = query.get("X-Amz-Date");
    payloadHash = "UNSIGNED-PAYLOAD";
    const expires = Number(query.get("X-Amz-Expires"));
    const issued = Date.parse(amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"));
    if (!Number.isFinite(expires) || !Number.isFinite(issued)) return "AccessDenied";
    if (Date.now() > issued + expires * 1000) return "ExpiredRequest";
  } else {
    const match = (req.headers.authorization || "").match(/^AWS4-HMAC-SHA256 Credential=([^,]+), ?SignedHeaders=([^,]+), ?Signature=(\w+)$/);
    if (!match) return "AccessDenied";
    [, credential, signedHeaders, signature] = match;
    amzDate = req.headers["x-amz-date"];
    payloadHash = req.headers["x-amz-content-sha256"] || "UNSIGNED-PAYLOAD";
  }
  const [id, day, region, service] = (credential || "").split("/");
  if (id !== accessKeyId) return "AccessDenied";
  const pairs = [];
  for (const [key, value] of query) if (key !== "X-Amz-Signature") pairs.push([rfc3986(key), rfc3986(value)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const headerNames = signedHeaders.split(";");
  if (!headerNames.includes("host")) return "AccessDenied";
  const canonicalHeaders = headerNames.map((h) => `${h}:${String(req.headers[h] ?? "").trim()}\n`).join("");
  const canonical = [req.method, url.pathname, pairs.map((p) => p.join("=")).join("&"), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), "aws4_request");
  return createHmac("sha256", key).update(toSign).digest("hex") === signature ? null : "SignatureDoesNotMatch";
}
export async function startFakeR2({ port = 0, accessKeyId, secretAccessKey, allowedOrigins = [] }) {
  const objects = new Map(); // "bucket/key" -> { body, type, etag, meta, modified }
  const uploads = new Map(); // uploadId -> { id, name, type, parts: Map }
  const stats = { requests: 0, presignedPuts: 0 };
  const server = createServer(async (req, res) => {
    stats.requests++;
    const url = new URL(req.url, "http://fake-r2");
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      if (!origin || !allowedOrigins.includes(origin)) return res.writeHead(403).end();
      const wanted = (req.headers["access-control-request-headers"] || "").toLowerCase().split(",").map((h) => h.trim()).filter(Boolean);
      if (req.headers["access-control-request-method"] !== "PUT" || wanted.some((h) => !["content-type", "if-none-match"].includes(h))) return res.writeHead(403).end();
      res.setHeader("Access-Control-Allow-Methods", "PUT");
      res.setHeader("Access-Control-Allow-Headers", "content-type, if-none-match");
      res.setHeader("Access-Control-Max-Age", "3600");
      return res.writeHead(204).end();
    }
    const fail = (status, code) => res.writeHead(status, { "content-type": "application/xml" }).end(req.method === "HEAD" ? undefined : errorXml(code));
    const denied = verifySignature(req, url, secretAccessKey, accessKeyId);
    if (denied) return fail(403, denied);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const segments = url.pathname.split("/").filter(Boolean);
    const bucket = segments[0];
    const key = segments.slice(1).map(decodeURIComponent).join("/");
    const full = `${bucket}/${key}`;
    const q = url.searchParams;
    if (!key && req.method === "GET") {
      const prefix = q.get("prefix") || "";
      const items = [...objects.entries()].filter(([name]) => name.startsWith(`${bucket}/${prefix}`)).map(([name, o]) => ({ key: name.slice(bucket.length + 1), o })).sort((a, b) => (a.key < b.key ? -1 : 1));
      const start = Number(q.get("continuation-token") || 0), page = items.slice(start, start + 1000);
      const more = start + 1000 < items.length;
      return res.writeHead(200, { "content-type": "application/xml" }).end(`<ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 1000}</NextContinuationToken>` : ""}${page.map(({ key: k, o }) => `<Contents><Key>${xmlEscape(k)}</Key><Size>${o.body.length}</Size><LastModified>${o.modified}</LastModified></Contents>`).join("")}</ListBucketResult>`);
    }
    if (req.method === "POST" && q.has("uploads")) {
      const id = randomBytes(12).toString("hex");
      uploads.set(id, { id, name: full, type: req.headers["content-type"] || "application/octet-stream", parts: new Map() });
      return res.writeHead(200, { "content-type": "application/xml" }).end(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (q.has("uploadId")) {
      const upload = uploads.get(q.get("uploadId"));
      if (!upload || upload.name !== full) return fail(404, "NoSuchUpload");
      if (req.method === "PUT") {
        const etag = `"${createHash("md5").update(body).digest("hex")}"`;
        upload.parts.set(Number(q.get("partNumber")), { body, etag });
        stats.presignedPuts++;
        return res.writeHead(200, { etag }).end();
      }
      if (req.method === "GET") {
        const list = [...upload.parts.entries()].sort((a, b) => a[0] - b[0]);
        return res.writeHead(200, { "content-type": "application/xml" }).end(`<ListPartsResult><IsTruncated>false</IsTruncated>${list.map(([n, p]) => `<Part><PartNumber>${n}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag><Size>${p.body.length}</Size></Part>`).join("")}</ListPartsResult>`);
      }
      if (req.method === "DELETE") {
        uploads.delete(upload.id);
        return res.writeHead(204).end();
      }
      if (req.method === "POST") {
        const wanted = [...body.toString().matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>([^<]*)<\/ETag>/g)].map((m) => [Number(m[1]), m[2].replace(/&quot;/g, '"')]);
        const buffers = [];
        for (const [n, etag] of wanted) {
          const part = upload.parts.get(n);
          if (!part || part.etag !== etag) return fail(400, "InvalidPart");
          buffers.push(part.body);
        }
        const data = Buffer.concat(buffers);
        objects.set(full, { body: data, type: upload.type, etag: `"${sha256(data).slice(0, 32)}-${wanted.length}"`, meta: {}, modified: new Date().toISOString() });
        uploads.delete(upload.id);
        return res.writeHead(200, { "content-type": "application/xml" }).end("<CompleteMultipartUploadResult/>");
      }
    }
    if (req.method === "PUT") {
      const copySource = req.headers["x-amz-copy-source"];
      if (copySource) {
        const source = objects.get(decodeURIComponent(copySource.replace(/^\//, "")));
        if (!source) return fail(404, "NoSuchKey");
        if (req.headers["x-amz-copy-source-if-match"] && req.headers["x-amz-copy-source-if-match"] !== source.etag) return fail(412, "PreconditionFailed");
        objects.set(full, { ...source, modified: new Date().toISOString() });
        return res.writeHead(200, { "content-type": "application/xml" }).end("<CopyObjectResult/>");
      }
      if (req.headers["if-none-match"] === "*" && objects.has(full)) return fail(412, "PreconditionFailed");
      const meta = {};
      for (const [name, value] of Object.entries(req.headers)) if (name.startsWith("x-amz-meta-")) meta[name] = value;
      const etag = `"${createHash("md5").update(body).digest("hex")}"`;
      objects.set(full, { body, type: req.headers["content-type"] || "application/octet-stream", etag, meta, modified: new Date().toISOString() });
      if (q.has("X-Amz-Signature")) stats.presignedPuts++;
      return res.writeHead(200, { etag }).end();
    }
    if (req.method === "DELETE") {
      objects.delete(full);
      return res.writeHead(204).end();
    }
    const object = objects.get(full);
    if (!object) return fail(404, "NoSuchKey");
    const headers = {
      "content-type": q.get("response-content-type") || object.type,
      etag: object.etag,
      "accept-ranges": "bytes",
      ...object.meta,
    };
    if (q.get("response-content-disposition")) headers["content-disposition"] = q.get("response-content-disposition");
    if (q.get("response-cache-control")) headers["cache-control"] = q.get("response-cache-control");
    if (req.method === "HEAD") return res.writeHead(200, { ...headers, "content-length": object.body.length }).end();
    const range = (req.headers.range || "").match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : object.body.length - 1, object.body.length - 1);
      if (start >= object.body.length) return res.writeHead(416).end();
      const slice = object.body.subarray(start, end + 1);
      return res.writeHead(206, { ...headers, "content-length": slice.length, "content-range": `bytes ${start}-${end}/${object.body.length}` }).end(slice);
    }
    return res.writeHead(200, { ...headers, "content-length": object.body.length }).end(object.body);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actual = server.address().port;
  return {
    port: actual,
    endpoint: `http://127.0.0.1:${actual}`,
    objects,
    uploads,
    stats,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}
