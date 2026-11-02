// Restore the original approved PNGs byte-for-byte from repository transfer parts.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "assets/studio-poses-v2");
const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
const allowed = new Set(["pengpeng.png", "pempem.png", "penguin.png", "pengki.png", "family-v2.png"]);
if (manifest.version !== 2 || manifest.files.length !== allowed.size) throw new Error("Invalid pose asset manifest");
for (const asset of manifest.files) {
  if (!allowed.delete(asset.name)) throw new Error("Invalid or duplicate pose asset");
  const parts = await Promise.all(asset.parts.map(part => {
    if (!/^(pengpeng|pempem|penguin|pengki|family-v2)-\d{3}\.part$/.test(part)) throw new Error("Invalid pose asset part");
    return readFile(resolve(source, part));
  }));
  const bytes = Buffer.concat(parts);
  if (bytes.length !== asset.bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("Pose asset integrity check failed");
  const target = resolve(root, "client/public/studio-assets/poses-v2", asset.name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
console.log("Four 100-pose sheets and the family reference restored and verified.");
