import fs from "node:fs/promises";
import path from "node:path";
import { finalAsset } from "../../shared/studioFinalAssets";
import { HttpError } from "../routes/util";

const cache = new Map<string, Buffer>();
let cacheBytes = 0;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

/** Only packaged IDs are accepted. Final PNGs are served intact, without decoding. */
export async function studioFinalAsset(id: string): Promise<Buffer> {
  if (id !== "MODEL_FAMILY" && !finalAsset(id)) throw new HttpError(404, "등록된 캐릭터 그림을 찾을 수 없습니다.");
  const cached = cache.get(id);
  if (cached) { cache.delete(id); cache.set(id, cached); return cached; }
  let bytes: Buffer;
  try { bytes = await fs.readFile(path.resolve("assets/studio-final-v14/restored", `${id}.png`)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(503, "최종 캐릭터 그림이 준비되지 않았습니다. 잠시 후 다시 불러와 주세요.");
    throw error;
  }
  if (bytes.length > 4 * 1024 * 1024) throw new HttpError(503, "캐릭터 이미지가 저장 한도를 초과했습니다.");
  // A concurrent file read may have populated this entry while we awaited I/O.
  const existing = cache.get(id);
  if (existing) return existing;
  while (cacheBytes + bytes.length > MAX_CACHE_BYTES && cache.size) {
    const oldest = cache.keys().next().value!;
    cacheBytes -= cache.get(oldest)!.length;
    cache.delete(oldest);
  }
  cache.set(id, bytes); cacheBytes += bytes.length;
  return bytes;
}
