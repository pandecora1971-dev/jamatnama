/** Structural file checks; these do not transcribe or identify the speaker. */
export function audioMime(bytes: Buffer): "audio/wav" | "audio/mpeg" | null {
  if (
    bytes.length >= 44 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WAVE"
  ) {
    const end = bytes.readUInt32LE(4) + 8;
    if (end !== bytes.length) return null;
    let format = false,
      data = false,
      offset = 12;
    while (offset + 8 <= end) {
      const id = bytes.toString("ascii", offset, offset + 4),
        size = bytes.readUInt32LE(offset + 4),
        start = offset + 8;
      if (start + size > end) return null;
      if (id === "fmt ") {
        if (
          size < 16 ||
          ![1, 3].includes(bytes.readUInt16LE(start)) ||
          ![1, 2].includes(bytes.readUInt16LE(start + 2)) ||
          bytes.readUInt32LE(start + 4) === 0
        )
          return null;
        format = true;
      }
      if (id === "data") data = size > 0;
      offset = start + size + (size % 2);
    }
    return format && data && offset === end ? "audio/wav" : null;
  }
  let offset = 0;
  if (bytes.toString("ascii", 0, 3) === "ID3") {
    if (
      bytes.length < 10 ||
      ![2, 3, 4].includes(bytes[3]) ||
      bytes.subarray(6, 10).some((b) => b > 127)
    )
      return null;
    offset =
      10 + bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9];
    if (bytes[3] === 4 && bytes[5] & 16) offset += 10;
  }
  // Require at least two complete MPEG Layer III frames, not only an ID3 tag.
  for (let frame = 0; frame < 2; frame++) {
    if (
      offset + 4 > bytes.length ||
      bytes[offset] !== 255 ||
      (bytes[offset + 1] & 224) !== 224
    )
      return null;
    const version = (bytes[offset + 1] >> 3) & 3,
      layer = (bytes[offset + 1] >> 1) & 3;
    const rateIndex = bytes[offset + 2] >> 4,
      sampleIndex = (bytes[offset + 2] >> 2) & 3;
    if (
      version === 1 ||
      layer !== 1 ||
      rateIndex === 0 ||
      rateIndex === 15 ||
      sampleIndex === 3
    )
      return null;
    const rates =
      version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const sample =
      [44100, 48000, 32000][sampleIndex] /
      (version === 3 ? 1 : version === 2 ? 2 : 4);
    offset +=
      Math.floor(
        ((version === 3 ? 144000 : 72000) * rates[rateIndex]) / sample,
      ) +
      ((bytes[offset + 2] >> 1) & 1);
    if (offset > bytes.length) return null;
  }
  return "audio/mpeg";
}
