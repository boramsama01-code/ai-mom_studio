/** Decode publisher HTML/XML without running page code or guessing an undeclared encoding. */
export function decodePublicText(bytes: Buffer, contentType = ""): string {
  const prefix = bytes.subarray(0, 8192).toString("latin1");
  const charset = /\bcharset\s*=\s*["']?\s*([\w.:-]+)/i;
  const declared = contentType.match(charset)?.[1]
    || prefix.match(/<meta\b[^>]*\bcharset\s*=\s*["']?\s*([\w.:-]+)/i)?.[1]
    || prefix.match(/<\?xml\b[^>]*\bencoding\s*=\s*["']\s*([\w.:-]+)/i)?.[1];
  const bom = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be"
      : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "utf-8" : undefined;
  let encoding = (bom || declared || "utf-8").toLowerCase();
  if (/^(?:ks_c_5601-1987|ksc5601|cp949|windows-949)$/.test(encoding)) encoding = "euc-kr";
  try { return new TextDecoder(encoding).decode(bytes); }
  catch { return new TextDecoder("utf-8").decode(bytes); }
}

/** Some public servers mislabel an HTML document as plain text. Binary files remain unsupported. */
export function isPublicHtmlResponse(contentType: string, text: string): boolean {
  const type = contentType.split(";", 1)[0].trim().toLowerCase();
  if (!type || type.includes("html") || type.includes("xml")) return true;
  return ["text/plain", "application/octet-stream"].includes(type)
    && /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(text);
}
