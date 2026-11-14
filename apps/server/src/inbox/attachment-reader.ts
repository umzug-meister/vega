import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";

export const ATTACHMENT_LIMITS = {
  maxCount: 10,
  maxTotalBytes: 20 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxExtractedChars: 60_000,
  maxUncompressedBytes: 50 * 1024 * 1024,
  maxZipEntries: 2_000,
  minImageBytes: 20 * 1024,
  maxInlineImageBytes: 100 * 1024,
  maxSheets: 5,
  maxRows: 500,
  maxColumns: 30,
} as const;

export type AttachmentKind =
  | "pdf"
  | "image"
  | "docx"
  | "xlsx"
  | "csv"
  | "legacy-office"
  | "unsupported";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function classifyAttachment(
  filename: string | null,
  contentType: string,
): AttachmentKind {
  const extension = /\.([a-z0-9]+)$/iu.exec(filename ?? "")?.[1]?.toLowerCase();
  if (extension === "doc" || extension === "xls" || extension === "ppt")
    return "legacy-office";
  if (
    contentType === "application/msword" ||
    contentType === "application/vnd.ms-excel"
  )
    return "legacy-office";
  if (contentType === "application/pdf" || extension === "pdf") return "pdf";
  if (IMAGE_TYPES.has(contentType) || ["jpg", "jpeg", "png", "webp"].includes(extension ?? ""))
    return "image";
  if (
    extension === "docx" ||
    contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  if (
    extension === "xlsx" ||
    contentType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )
    return "xlsx";
  if (extension === "csv" || contentType === "text/csv") return "csv";
  return "unsupported";
}

export function imageMimeType(buffer: Buffer): string | null {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  if (buffer.length > 8 && buffer.subarray(1, 4).toString("latin1") === "PNG")
    return "image/png";
  if (
    buffer.length > 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  return null;
}

export function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

export class AttachmentError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "AttachmentError";
  }
}

/**
 * Rejects ZIP-based Office files with too many entries or a declared
 * uncompressed size above the limit before any parser inflates them.
 */
export function assertSafeZip(buffer: Buffer): void {
  const minEocd = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let index = buffer.length - 22; index >= minEocd; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new AttachmentError("Beschädigte Office-Datei.");
  const entries = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || directoryOffset === 0xffffffff)
    throw new AttachmentError("Zu große Office-Datei (ZIP64).");
  if (entries > ATTACHMENT_LIMITS.maxZipEntries)
    throw new AttachmentError("Office-Datei enthält zu viele Teile.");
  let position = directoryOffset;
  let total = 0;
  for (let entry = 0; entry < entries; entry += 1) {
    if (
      position + 46 > buffer.length ||
      buffer.readUInt32LE(position) !== 0x02014b50
    )
      throw new AttachmentError("Beschädigte Office-Datei.");
    total += buffer.readUInt32LE(position + 24);
    if (total > ATTACHMENT_LIMITS.maxUncompressedBytes)
      throw new AttachmentError("Office-Datei ist entpackt zu groß.");
    position +=
      46 +
      buffer.readUInt16LE(position + 28) +
      buffer.readUInt16LE(position + 30) +
      buffer.readUInt16LE(position + 32);
  }
}

function limitText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .slice(0, ATTACHMENT_LIMITS.maxExtractedChars);
}

export async function extractDocxText(buffer: Buffer): Promise<string> {
  assertSafeZip(buffer);
  const result = await mammoth.extractRawText({ buffer });
  return limitText(result.value);
}

export async function extractXlsxText(buffer: Buffer): Promise<string> {
  assertSafeZip(buffer);
  const sheets = await readXlsxFile(buffer, { trim: false });
  const lines: string[] = [];
  for (const sheet of sheets.slice(0, ATTACHMENT_LIMITS.maxSheets)) {
    lines.push(`## ${sheet.sheet}`);
    let rowCount = 0;
    for (const row of sheet.data) {
      if (row.every((cell) => cell === null)) continue;
      if (rowCount >= ATTACHMENT_LIMITS.maxRows) break;
      rowCount += 1;
      const lastColumn = row.findLastIndex((cell) => cell !== null) + 1;
      const cells = row
        .slice(0, Math.min(lastColumn, ATTACHMENT_LIMITS.maxColumns))
        .map((cell) => cell === null ? "" : String(cell).trim());
      if (cells.some(Boolean)) lines.push(cells.join("\t"));
    }
  }
  return limitText(lines.join("\n"));
}

export function extractCsvText(buffer: Buffer): string {
  return limitText(buffer.toString("utf8").replace(/^\uFEFF/u, ""));
}
