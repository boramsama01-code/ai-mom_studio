import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
const originalHash = "a66350333b86e9e0c14981154e67e26218497ecc2942dc4b826f87a48fff55ad";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
describe("Original brand asset integrity", () => {
  it("preserves the complete approved PNG for new cards", () => {
    expect(hash(fs.readFileSync("assets/branding/space-penguin-company.png"))).toBe(originalHash);
  });
  it.each(["client/public/favicon.svg", "client/public/branding/space-penguin-company.svg"])("%s embeds the complete original raster", (file) => {
    const svg = fs.readFileSync(file, "utf8");
    const match = svg.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
    expect(match).not.toBeNull();
    expect(hash(Buffer.from(match![1], "base64"))).toBe(originalHash);
  });
});
