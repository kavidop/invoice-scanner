/** Upper bound on markup sent to Gemini; e-invoice pages are far smaller. */
const MAX_CHARS = 200_000;

/**
 * Shrink an HTML page to the parts that matter for extraction: drop scripts,
 * styles, media and attributes, keep the tag structure (tables carry meaning).
 * The output only goes to the model, never back into a browser.
 */
export function reduceHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|iframe|template|head)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(img|link|meta|input|br|hr)\b[^>]*>/gi, (_, tag: string) =>
      tag.toLowerCase() === "br" ? "\n" : "",
    )
    .replace(/<([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tag: string) => {
      // Keep table spans; everything else loses its attributes.
      const spans = match.match(/\s(colspan|rowspan)\s*=\s*["']?\d+["']?/gi)?.join("") ?? "";
      return `<${tag.toLowerCase()}${spans}>`;
    })
    .replace(/<\/?(span|font|b|i|strong|em|u|a|div)>/gi, (m) => (m.startsWith("</div") ? "\n" : ""))
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, MAX_CHARS);
}

/** Visible text length, used to detect JS-only pages that render nothing server-side. */
export function textLength(html: string): number {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}
