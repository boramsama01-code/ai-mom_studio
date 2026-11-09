import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { studioCharacters, studioPoseReferenceSchema, type StudioCharacter, type StudioPanel } from "../../shared/studio";
import poseRects from "../../shared/studioPoseRects.json";
import { HttpError } from "../routes/util";
import { FINAL_POSE_VERSION, PREVIOUS_POSE_VERSION, type PoseAssetVersion, finalPose } from "../../shared/studioFinalAssets";
import { studioFinalAsset } from "./studioFinalAssets";

const characterSchema = z.enum(studioCharacters);
const poseSchema = z.number().int().min(1).max(100);
const sourceCache = new Map<string, Promise<Buffer>>();
const cropCache = new Map<string, Buffer>();

/** Only packaged artwork is read. No browser URL, user filename or remote fetch is accepted. */
async function packagedAsset(name: string): Promise<Buffer> {
  const cached = sourceCache.get(name);
  if (cached) return cached;
  const pending = (async () => {
    for (const base of ["dist/public/studio-assets/poses-v2", "client/public/studio-assets/poses-v2"]) {
      try {
        const bytes = await fs.readFile(path.resolve(base, name));
        if (bytes.length > 20 * 1024 * 1024) throw new HttpError(503, "캐릭터 기준 이미지가 저장 한도를 초과했습니다.");
        return bytes;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    throw new HttpError(503, "캐릭터 기준 이미지가 없습니다. 배포 파일을 확인하세요.");
  })();
  sourceCache.set(name, pending);
  try { return await pending; } catch (error) { sourceCache.delete(name); throw error; }
}

export async function studioFamilyReference(assetVersion?: PoseAssetVersion): Promise<Buffer> {
  if (assetVersion) return studioFinalAsset("MODEL_FAMILY", assetVersion);
  return packagedAsset("family-v2.png");
}

/** Measured white-space boundaries preserve hats and feet on the hand-drawn sheets. */
export function studioPoseBounds(character: StudioCharacter, width: number, height: number, pose: number) {
  const id = characterSchema.parse(character);
  poseSchema.parse(pose);
  const sheet = poseRects[id];
  if (width !== sheet.width || height !== sheet.height || sheet.cells.length !== 100) {
    throw new HttpError(503, "캐릭터 기준 이미지가 등록된 포즈 시트와 일치하지 않습니다.");
  }
  const cell = sheet.cells[pose - 1];
  if (cell.x < 0 || cell.y < 0 || cell.width <= 0 || cell.height <= 0 || cell.x + cell.width > width || cell.y + cell.height > height) throw new HttpError(503, "캐릭터 기준 이미지의 포즈 영역이 올바르지 않습니다.");
  return { left: cell.x, top: cell.y, width: cell.width, height: cell.height };
}

export async function studioPoseReference(character: StudioCharacter, pose: number, assetVersion?: PoseAssetVersion): Promise<Buffer> {
  const id = characterSchema.parse(character);
  poseSchema.parse(pose);
  if (assetVersion) return studioFinalAsset(finalPose(id, pose, assetVersion)!.id, assetVersion);
  const key = `${id}:${pose}`;
  const cached = cropCache.get(key);
  if (cached) return cached;
  const source = await packagedAsset(`${id}.png`);
  const image = sharp(source, { limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height) throw new HttpError(503, "캐릭터 기준 이미지가 올바른 PNG가 아닙니다.");
  const result = await image.extract(studioPoseBounds(id, metadata.width, metadata.height, pose)).png().toBuffer();
  // A small bounded cache avoids retaining all 400 decoded crops indefinitely.
  if (cropCache.size >= 100) cropCache.delete(cropCache.keys().next().value!);
  cropCache.set(key, result);
  return result;
}

/** Identity master + up to four selected cells leaves room for an existing panel (at most six refs). */
export async function studioPanelReferences(panel: Pick<StudioPanel, "poseRefs">): Promise<string[]> {
  const selections = z.array(studioPoseReferenceSchema).max(4).refine(refs => new Set(refs.map(r => r.character)).size === refs.length).parse(panel.poseRefs ?? []);
  const version = selections.length && selections.every(ref => !ref.assetVersion) ? undefined : selections.length && selections.every(ref => ref.assetVersion === PREVIOUS_POSE_VERSION) ? PREVIOUS_POSE_VERSION : FINAL_POSE_VERSION;
  const family = await sharp(await studioFamilyReference(version), { limitInputPixels: 40_000_000 })
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const crops = await Promise.all(selections.map(ref => studioPoseReference(ref.character, ref.pose, ref.assetVersion)));
  return [family, ...crops].map(bytes => `data:image/png;base64,${bytes.toString("base64")}`);
}
