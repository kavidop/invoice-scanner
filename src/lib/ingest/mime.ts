/** Document types Gemini can read directly, plus text formats we pass as text. */
export const SUPPORTED_FILE_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number];

/** Inline Gemini requests are capped at ~20 MB and base64 adds a third. */
export const MAX_FILE_BYTES = 14 * 1024 * 1024;

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  bytes.every((b, i) => buf[offset + i] === b);

const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString("latin1");

/**
 * Detect the real type from magic bytes; browsers and servers often send
 * `application/octet-stream` or a wrong Content-Type.
 */
export function sniffFileType(buf: Buffer): SupportedFileType | null {
  if (ascii(buf, 0, 1024).includes("%PDF-")) return "application/pdf";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "image/webp";
  if (ascii(buf, 4, 8) === "ftyp") {
    const brand = ascii(buf, 8, 12);
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1", "heif"].includes(brand)) return "image/heif";
  }
  return null;
}

export const EXTENSION: Record<SupportedFileType, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};
