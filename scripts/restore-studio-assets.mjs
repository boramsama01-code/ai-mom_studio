// Keep transfer units small; restore the original PNG without re-encoding it.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "assets/studio-comic");
const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
const bytes = Buffer.concat(await Promise.all(manifest.parts.map((part) => {
  if (!/^\d{3}\.part$/.test(part)) throw new Error("Invalid studio asset part");
  return readFile(resolve(source, part));
})));
if (bytes.length !== manifest.bytes || createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) {
  throw new Error("Studio asset integrity check failed");
}
const target = resolve(root, "client/public/studio-assets/webtoon-01.png");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);
console.log("Studio sample image restored and verified.");

await import("./restore-studio-pose-assets.mjs");

