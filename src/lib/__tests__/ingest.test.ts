import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "@/lib/ingest/fetch-url";
import { reduceHtml, textLength } from "@/lib/ingest/html";
import { sniffFileType } from "@/lib/ingest/mime";

describe("sniffFileType", () => {
  it.each([
    [Buffer.from("%PDF-1.7\n..."), "application/pdf"],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), "image/png"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    [Buffer.from("RIFF\0\0\0\0WEBPVP8 "), "image/webp"],
    [Buffer.from("\0\0\0\x18ftypheic"), "image/heic"],
    [Buffer.from("<html>"), null],
  ])("detects %#", (buf, expected) => {
    expect(sniffFileType(buf)).toBe(expected);
  });
});

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"])(
    "blocks %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "142.250.180.14", "2a00:1450:4001::200e"])("allows %s", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe("reduceHtml", () => {
  const page = `<!doctype html><html><head><title>x</title><style>td{color:red}</style></head>
    <body><script>alert(1)</script><!-- tracking -->
    <table class="lines"><tr><td colspan="2" style="x">Widget</td><td><span>10.00</span></td></tr></table>
    <img src="logo.png"></body></html>`;

  it("drops scripts, styles, comments and attributes but keeps table structure", () => {
    const out = reduceHtml(page);
    expect(out).not.toMatch(/alert|color:red|tracking|logo\.png|class=/);
    expect(out).toContain('<td colspan="2">Widget</td>');
    expect(out).toContain("<td>10.00</td>");
  });

  it("measures visible text", () => {
    expect(textLength(reduceHtml(page))).toBe("Widget 10.00".length);
  });
});
