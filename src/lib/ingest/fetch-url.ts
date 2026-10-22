import "server-only";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { reduceHtml, textLength } from "./html";
import { MAX_FILE_BYTES, sniffFileType, type SupportedFileType } from "./mime";

export class IngestError extends Error {}

export type FetchedDocument =
  | { kind: "file"; data: Buffer; mimeType: SupportedFileType; filename: string }
  | { kind: "text"; data: Buffer; text: string; format: "html" | "xml"; mimeType: string; filename: string };

const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    return mapped ? blocked.check(mapped[1], "ipv4") : blocked.check(address, "ipv6");
  }
  return true;
}

/** Only public https hosts: the server must not be usable to probe the internal network. */
async function assertPublicUrl(url: URL) {
  if (url.protocol !== "https:") throw new IngestError("Only https:// links are supported");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new IngestError(`Could not resolve ${url.hostname}`);
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new IngestError("Links to private or local addresses are not allowed");
  }
}

async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_FILE_BYTES) throw new IngestError("Document is too large (max 14 MB)");
  if (!res.body) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    size += r.value.byteLength;
    if (size > MAX_FILE_BYTES) {
      await reader.cancel();
      throw new IngestError("Document is too large (max 14 MB)");
    }
    chunks.push(r.value);
  }
  return Buffer.concat(chunks);
}

function filenameFrom(res: Response, url: URL, fallbackExt: string) {
  const disposition = res.headers.get("content-disposition") ?? "";
  const named = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  if (named) return decodeURIComponent(named);
  const last = url.pathname.split("/").filter(Boolean).pop();
  return last && last.includes(".") ? last : `${url.hostname}.${fallbackExt}`;
}

export async function fetchInvoiceUrl(raw: string): Promise<FetchedDocument> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new IngestError("That doesn't look like a valid URL");
  }

  let res: Response | undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/pdf,image/*,application/xml,text/xml,text/html;q=0.9,*/*;q=0.5" },
    }).catch((err: unknown) => {
      throw new IngestError(`Could not fetch the link: ${err instanceof Error ? err.message : err}`);
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    break;
  }
  if (!res || (res.status >= 300 && res.status < 400)) throw new IngestError("Too many redirects");
  if (!res.ok) throw new IngestError(`The link returned HTTP ${res.status}`);

  const data = await readCapped(res);
  const fileType = sniffFileType(data);
  if (fileType) return { kind: "file", data, mimeType: fileType, filename: filenameFrom(res, url, "pdf") };

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const body = data.toString("utf8");
  const head = body.trimStart().slice(0, 200).toLowerCase();

  if (contentType.includes("xml") || head.startsWith("<?xml")) {
    return {
      kind: "text",
      data,
      text: body,
      format: "xml",
      mimeType: "application/xml",
      filename: filenameFrom(res, url, "xml"),
    };
  }
  if (contentType === "text/html" || head.includes("<html") || head.startsWith("<!doctype html")) {
    const reduced = reduceHtml(body);
    if (textLength(reduced) < 100) {
      throw new IngestError(
        "This page has no readable invoice content (it probably needs JavaScript). Download the PDF and upload it instead.",
      );
    }
    return { kind: "text", data, text: reduced, format: "html", mimeType: "text/html", filename: filenameFrom(res, url, "html") };
  }

  throw new IngestError(`Unsupported content type: ${contentType || "unknown"}`);
}
