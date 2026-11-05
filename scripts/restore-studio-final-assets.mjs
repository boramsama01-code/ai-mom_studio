// Restore approved PNG bytes without cropping, resizing, or changing alpha.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "assets/studio-final-v14");
const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
if (manifest.version !== "final-v1.4" || manifest.files.length !== 449) throw new Error("Invalid final character manifest");
const parts = [];
for (const name of manifest.parts) {
  if (!/^\d{3}\.part$/.test(name)) throw new Error("Invalid final character archive part");
  parts.push(await readFile(resolve(source, name)));
}
const archive = Buffer.concat(parts);
if (archive.length !== manifest.bytes || hash(archive) !== manifest.sha256) throw new Error("Final character archive integrity failed");
const expected = new Set(manifest.files.map(file => file.file));
const files = unzipSync(archive, { filter: file => expected.has(file.name) });
const target = resolve(source, "restored");
await mkdir(target, { recursive: true });
const seen = new Set();
for (const entry of manifest.files) {
  if (!/^(?:PP|PM|KG|KK|FA|CP|SB|FX)\d{3}$|^MODEL_FAMILY$/.test(entry.id) || seen.has(entry.id)) throw new Error("Invalid final character asset ID");
  seen.add(entry.id);
  const bytes = files[entry.file];
  if (!bytes || hash(bytes) !== entry.sha256) throw new Error(`Final character PNG integrity failed: ${entry.id}`);
  await writeFile(resolve(target, `${entry.id}.png`), bytes);
}
console.log("449 final transparent character PNGs restored and verified.");
