import { AwsClient, AwsV4Signer } from "aws4fetch";
// Minimal S3-compatible client for private Cloudflare R2. No object is ever public: every browser
// access is through a short-lived signed URL, and the bucket has neither r2.dev nor a custom domain.
export class R2Error extends Error {
  code: string;
  constructor(public status: number, operation: string, code = "") {
    super(`R2 ${operation} failed`);
    this.name = "R2Error";
    this.code = code || `HTTP_${status}`;
  }
}
type Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string };
export function r2Config(bucketOverride?: string): Config {
  const account = process.env.R2_ACCOUNT_ID;
  const endpoint = (process.env.R2_ENDPOINT || (account ? `https://${account}.r2.cloudflarestorage.com` : "")).replace(/\/$/, "");
  const bucket = bucketOverride || process.env.R2_BUCKET || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new R2Error(503, "configuration", "R2_NOT_CONFIGURED");
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}
const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");
const objectUrl = (config: Config, key: string) => `${config.endpoint}/${config.bucket}/${encodeKey(key)}`;
function client(config: Config) {
  return new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: "s3", region: "auto", retries: 2 });
}
async function presign(config: Config, method: string, url: URL, seconds: number, headers: Record<string, string> = {}) {
  url.searchParams.set("X-Amz-Expires", String(seconds));
  const signed = await new AwsV4Signer({
    method,
    url: url.toString(),
    headers,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
    signQuery: true,
    allHeaders: true,
  }).sign();
  return signed.url.toString();
}
const textValue = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];
const unescapeXml = (value: string) =>
  value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
async function failure(response: Response, operation: string) {
  const body = await response.text().catch(() => "");
  return new R2Error(response.status, operation, textValue(body, "Code"));
}
export type ObjectStore = ReturnType<typeof objectStore>;
export function objectStore(bucket?: string) {
  const config = r2Config(bucket);
  const aws = client(config);
  return {
    bucket: config.bucket,
    /** A single PUT signed for one exact type and length that refuses to overwrite an existing object. */
    presignPut(key: string, mime: string, size: number, seconds = 900) {
      const headers = { "content-type": mime, "content-length": String(size), "if-none-match": "*" };
      return presign(config, "PUT", new URL(objectUrl(config, key)), seconds, headers).then((url) => ({
        url,
        headers: { "Content-Type": mime, "If-None-Match": "*" },
      }));
    },
    presignPart(key: string, uploadId: string, partNumber: number, size: number, seconds = 900) {
      const url = new URL(objectUrl(config, key));
      url.searchParams.set("partNumber", String(partNumber));
      url.searchParams.set("uploadId", uploadId);
      return presign(config, "PUT", url, seconds, { "content-length": String(size) });
    },
    /** Reviewer download: expiring, always an attachment, never rendered on the app's origin. */
    presignGet(key: string, filename: string, mime: string, seconds = 120) {
      const url = new URL(objectUrl(config, key));
      url.searchParams.set("response-content-disposition", `attachment; filename="${filename}"`);
      url.searchParams.set("response-content-type", mime);
      url.searchParams.set("response-cache-control", "private, no-store");
      return presign(config, "GET", url, seconds);
    },
    async head(key: string) {
      const response = await aws.fetch(objectUrl(config, key), { method: "HEAD" });
      if (response.status === 404) return null;
      if (!response.ok) throw await failure(response, "head");
      return {
        size: Number(response.headers.get("content-length")),
        etag: response.headers.get("etag") || "",
        contentType: response.headers.get("content-type") || "",
        sha256: response.headers.get("x-amz-meta-sha256") || "",
      };
    },
    async readRange(key: string, start: number, end: number) {
      const response = await aws.fetch(objectUrl(config, key), { headers: { range: `bytes=${start}-${end}` } });
      if (response.status === 416) return new Uint8Array(0);
      if (!response.ok) throw await failure(response, "read");
      return new Uint8Array(await response.arrayBuffer());
    },
    async stream(key: string) {
      const response = await aws.fetch(objectUrl(config, key));
      if (!response.ok || !response.body) throw await failure(response, "stream");
      return response.body;
    },
    async put(key: string, body: BodyInit, mime: string, metadata: Record<string, string> = {}) {
      const headers: Record<string, string> = { "content-type": mime };
      for (const [name, value] of Object.entries(metadata)) headers[`x-amz-meta-${name}`] = value;
      const response = await aws.fetch(objectUrl(config, key), { method: "PUT", headers, body });
      if (!response.ok) throw await failure(response, "put");
    },
    /** Server-side copy with no transfer through this function. ifMatch pins the validated source. */
    async copy(source: string, target: string, ifMatch?: string, targetBucket?: string) {
      const url = targetBucket ? objectUrl(r2Config(targetBucket), target) : objectUrl(config, target);
      const headers: Record<string, string> = { "x-amz-copy-source": `/${config.bucket}/${encodeKey(source)}` };
      if (ifMatch) headers["x-amz-copy-source-if-match"] = ifMatch;
      const response = await aws.fetch(url, { method: "PUT", headers });
      if (!response.ok) throw await failure(response, "copy");
      const body = await response.text();
      if (body.includes("<Error>")) throw new R2Error(500, "copy", textValue(body, "Code"));
    },
    async remove(key: string) {
      const response = await aws.fetch(objectUrl(config, key), { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw await failure(response, "delete");
    },
    async createMultipart(key: string, mime: string) {
      const response = await aws.fetch(`${objectUrl(config, key)}?uploads`, { method: "POST", headers: { "content-type": mime } });
      if (!response.ok) throw await failure(response, "create-multipart");
      const uploadId = textValue(await response.text(), "UploadId");
      if (!uploadId) throw new R2Error(502, "create-multipart", "MISSING_UPLOAD_ID");
      return unescapeXml(uploadId);
    },
    /** The server trusts this listing, not the browser, for part sizes and ETags. */
    async listParts(key: string, uploadId: string) {
      const parts: { partNumber: number; etag: string; size: number }[] = [];
      let marker = "";
      for (;;) {
        const url = new URL(objectUrl(config, key));
        url.searchParams.set("uploadId", uploadId);
        url.searchParams.set("max-parts", "1000");
        if (marker) url.searchParams.set("part-number-marker", marker);
        const response = await aws.fetch(url.toString());
        if (response.status === 404) return null;
        if (!response.ok) throw await failure(response, "list-parts");
        const xml = await response.text();
        for (const [, part] of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g))
          parts.push({
            partNumber: Number(textValue(part, "PartNumber")),
            etag: unescapeXml(textValue(part, "ETag") || ""),
            size: Number(textValue(part, "Size")),
          });
        if (textValue(xml, "IsTruncated") !== "true") return parts;
        marker = textValue(xml, "NextPartNumberMarker") || "";
        if (!marker) return parts;
      }
    },
    async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
      const url = new URL(objectUrl(config, key));
      url.searchParams.set("uploadId", uploadId);
      const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      const body = `<CompleteMultipartUpload>${parts
        .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`)
        .join("")}</CompleteMultipartUpload>`;
      const response = await aws.fetch(url.toString(), { method: "POST", headers: { "content-type": "application/xml" }, body });
      if (!response.ok) throw await failure(response, "complete-multipart");
      const text = await response.text();
      if (text.includes("<Error>")) throw new R2Error(500, "complete-multipart", textValue(text, "Code"));
    },
    async abortMultipart(key: string, uploadId: string) {
      const url = new URL(objectUrl(config, key));
      url.searchParams.set("uploadId", uploadId);
      const response = await aws.fetch(url.toString(), { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw await failure(response, "abort-multipart");
    },
    async *list(prefix: string) {
      let token = "";
      for (;;) {
        const url = new URL(`${config.endpoint}/${config.bucket}`);
        url.searchParams.set("list-type", "2");
        url.searchParams.set("prefix", prefix);
        if (token) url.searchParams.set("continuation-token", token);
        const response = await aws.fetch(url.toString());
        if (!response.ok) throw await failure(response, "list");
        const xml = await response.text();
        for (const [, item] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g))
          yield {
            key: unescapeXml(textValue(item, "Key") || ""),
            size: Number(textValue(item, "Size")),
            lastModified: textValue(item, "LastModified") || "",
          };
        if (textValue(xml, "IsTruncated") !== "true") return;
        token = unescapeXml(textValue(xml, "NextContinuationToken") || "");
        if (!token) return;
      }
    },
  };
}
