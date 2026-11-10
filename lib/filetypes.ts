// Upload policy and content sniffing. Pure code: shared by the browser form, API routes and the scan worker.
export type EvidenceKind = "image" | "document" | "audio" | "video";
export const MIME_TYPES: Record<string, { kind: EvidenceKind; extension: string }> = {
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/png": { kind: "image", extension: "png" },
  "image/webp": { kind: "image", extension: "webp" },
  "application/pdf": { kind: "document", extension: "pdf" },
  "audio/mpeg": { kind: "audio", extension: "mp3" },
  "audio/wav": { kind: "audio", extension: "wav" },
  "audio/mp4": { kind: "audio", extension: "m4a" },
  "audio/ogg": { kind: "audio", extension: "ogg" },
  "video/mp4": { kind: "video", extension: "mp4" },
  "video/quicktime": { kind: "video", extension: "mov" },
  "video/webm": { kind: "video", extension: "webm" },
  "video/3gpp": { kind: "video", extension: "3gp" },
};
const ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "audio/mp3": "audio/mpeg",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/opus": "audio/ogg",
};
const EXTENSIONS: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp",
};
export const ACCEPT_ATTRIBUTE = [...Object.keys(MIME_TYPES), ...Object.keys(EXTENSIONS).map((e) => `.${e}`)].join(",");
/** Browsers often report an empty or vendor-specific type, so the extension is a fallback only. */
export function canonicalMime(reported: string, filename = "") {
  const clean = reported.split(";")[0].trim().toLowerCase();
  const direct = ALIASES[clean] || clean;
  if (MIME_TYPES[direct]) return direct;
  return EXTENSIONS[filename.split(".").pop()?.toLowerCase() || ""] || null;
}

const MB = 1024 * 1024;
export type UploadLimits = {
  maxFiles: number;
  maxTotalBytes: number;
  maxBytes: Record<EvidenceKind, number>;
};
export const DEFAULT_LIMITS: UploadLimits = {
  maxFiles: 5,
  maxTotalBytes: 3 * 1024 * MB,
  maxBytes: { image: 25 * MB, document: 50 * MB, audio: 200 * MB, video: 2048 * MB },
};
export const MULTIPART_THRESHOLD = 32 * MB;
export const PART_SIZE = 16 * MB;
export const partCount = (size: number, partSize = PART_SIZE) => Math.ceil(size / partSize);

export const SNIFF_BYTES = 64 * 1024;
const ascii = (bytes: Uint8Array, start: number, end: number) => {
  let text = "";
  for (let i = start; i < Math.min(end, bytes.length); i++) text += String.fromCharCode(bytes[i]);
  return text;
};
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000));
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32be = (b: Uint8Array, o: number) => (b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);

function ftypMime(head: Uint8Array) {
  if (head.length < 12 || ascii(head, 4, 8) !== "ftyp") return null;
  const boxSize = u32be(head, 0);
  if (boxSize < 8 || boxSize > 4096) return null;
  const brands = [ascii(head, 8, 12)];
  for (let offset = 16; offset + 4 <= Math.min(boxSize, head.length); offset += 4) brands.push(ascii(head, offset, offset + 4));
  const major = brands[0].trim();
  if (major === "qt") return "video/quicktime";
  if (["M4A", "M4B", "M4P"].includes(major)) return "audio/mp4";
  if (major.startsWith("3g")) return "video/3gpp";
  const known = ["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "hvc1", "dash", "MSNV", "mmp4", "M4V", "f4v"];
  return brands.some((brand) => known.includes(brand.trim())) ? "video/mp4" : null;
}
function wavValid(head: Uint8Array, totalSize: number) {
  if (head.length < 44 || u32le(head, 4) + 8 !== totalSize) return false;
  let offset = 12, format = false;
  while (offset + 8 <= head.length) {
    const id = ascii(head, offset, offset + 4), size = u32le(head, offset + 4), start = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || start + 16 > head.length) return false;
      if (![1, 3].includes(u16le(head, start)) || ![1, 2].includes(u16le(head, start + 2)) || u32le(head, start + 4) === 0) return false;
      format = true;
    }
    if (id === "data") return format && size > 0 && start + size <= totalSize;
    offset = start + size + (size % 2);
  }
  return false;
}
function mp3FrameLength(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.length || bytes[offset] !== 255 || (bytes[offset + 1] & 224) !== 224) return null;
  const version = (bytes[offset + 1] >> 3) & 3, layer = (bytes[offset + 1] >> 1) & 3;
  const rateIndex = bytes[offset + 2] >> 4, sampleIndex = (bytes[offset + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || rateIndex === 0 || rateIndex === 15 || sampleIndex === 3) return null;
  const rates = version === 3
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const sample = [44100, 48000, 32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  return Math.floor(((version === 3 ? 144000 : 72000) * rates[rateIndex]) / sample) + ((bytes[offset + 2] >> 1) & 1);
}
/** Where the first MPEG frame should begin, past an ID3 tag such as embedded cover art. */
export function mp3AudioOffset(head: Uint8Array) {
  if (ascii(head, 0, 3) !== "ID3") return 0;
  if (head.length < 10 || ![2, 3, 4].includes(head[3]) || head.subarray(6, 10).some((b) => b > 127)) return null;
  return 10 + head[6] * 2097152 + head[7] * 16384 + head[8] * 128 + head[9] + (head[3] === 4 && head[5] & 16 ? 10 : 0);
}
/** Requires two whole frames within the object, not only an ID3 tag. */
function mp3Frames(bytes: Uint8Array, offset: number, remaining: number) {
  const first = mp3FrameLength(bytes, offset);
  if (first === null) return false;
  const second = mp3FrameLength(bytes, offset + first);
  return second !== null && first + second <= remaining;
}
/**
 * Identifies a file from its first bytes. `totalSize` catches truncated WAV files. When an ID3 tag
 * runs past `head`, supply `audio` read from mp3AudioOffset(head); otherwise such a file is rejected.
 */
export function sniffMime(head: Uint8Array, totalSize: number, audio?: Uint8Array) {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => head[i] === value)) return "image/png";
  if (ascii(head, 0, 5) === "%PDF-") return "application/pdf";
  if (ascii(head, 0, 4) === "RIFF") {
    const form = ascii(head, 8, 12);
    if (form === "WEBP") return "image/webp";
    if (form === "WAVE") return wavValid(head, totalSize) ? "audio/wav" : null;
    return null;
  }
  if (ascii(head, 0, 4) === "OggS") return "audio/ogg";
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  const iso = ftypMime(head);
  if (iso) return iso;
  const offset = mp3AudioOffset(head);
  if (offset === null) return null;
  if (offset > 0 && offset + 4096 > head.length) return audio && mp3Frames(audio, 0, totalSize - offset) ? "audio/mpeg" : null;
  return mp3Frames(head, offset, totalSize - offset) ? "audio/mpeg" : null;
}
