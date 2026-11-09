import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/studio-final-v15");
const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
if (manifest.version !== "final-v1.5" || manifest.files.length !== 802) throw new Error("Invalid refreshed character manifest");
const parts = [];
for (const name of manifest.parts) {
  if (!/^\d{3}\.part$/.test(name)) throw new Error("Invalid refreshed character archive part");
  parts.push(await readFile(resolve(source, name)));
}
const archive = Buffer.concat(parts);
if (archive.length !== manifest.bytes || hash(archive) !== manifest.sha256) throw new Error("Refreshed character archive integrity failed");
const expected = new Set(manifest.files.map(file => file.file));
const files = unzipSync(archive, { filter: file => expected.has(file.name) });
const target = resolve(source, "restored");
await mkdir(target, { recursive: true });
const seen = new Set();
for (const entry of manifest.files) {
  if (!/^(?:(?:PP|PM|KG|KK)(?:00[1-9]|0[1-9]\d|100)|MODEL_FAMILY)$/.test(entry.id)
    || !["png", "svg"].includes(entry.format) || entry.file !== `${entry.id}.${entry.format}` || seen.has(entry.file)) throw new Error("Invalid refreshed character asset ID");
  seen.add(entry.file);
  const bytes = files[entry.file];
  if (!bytes || hash(bytes) !== entry.sha256) throw new Error(`Refreshed character integrity failed: ${entry.file}`);
  await writeFile(resolve(target, entry.file), bytes);
}
console.log("400 refreshed poses and family master restored as transparent PNG and editable SVG.");
