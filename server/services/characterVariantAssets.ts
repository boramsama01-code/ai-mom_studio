import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { familyEndingAsset, registeredProfileAsset } from "../../shared/characterVariantAssets";

type RegisteredAsset = { serverPath: string; sha256: string };
/** Read only a registry path; never use a client-supplied path or rewrite source bytes. */
export function readRegisteredCharacterAsset(asset: RegisteredAsset): Buffer {
  const paths = asset.serverPath.startsWith("client/public/")
    ? [asset.serverPath.replace(/^client\/public\//, "dist/public/"), asset.serverPath]
    : [asset.serverPath];
  const found = paths.map(value => path.resolve(process.cwd(), value)).find(value => fs.existsSync(value));
  if (!found) throw new Error("선택한 캐릭터 원본 이미지를 찾을 수 없습니다. 기존 원고는 유지했습니다.");
  const bytes = fs.readFileSync(found);
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("선택한 캐릭터 원본 이미지가 등록된 파일과 다릅니다. 기존 원고는 유지했습니다.");
  return bytes;
}
export function registeredProfileDataUrl(id: unknown): string {
  const asset = registeredProfileAsset(id);
  if (!asset) throw new Error("승인 목록에 없는 프로필 자산입니다. 원고는 유지했습니다.");
  return `data:image/png;base64,${readRegisteredCharacterAsset(asset).toString("base64")}`;
}
export async function renderRegisteredFamilyEnding(id: unknown): Promise<Buffer> {
  const asset = familyEndingAsset(id);
  if (!asset) throw new Error("등록된 가족 엔딩 이미지를 선택해 주세요. 기존 원고는 유지했습니다.");
  return sharp(readRegisteredCharacterAsset(asset), { limitInputPixels: 4_000_000, failOn: "error" })
    .resize(1080, 1350, { fit: "contain", background: "#FFFFFF" })
    .flatten({ background: "#FFFFFF" }).toColorspace("srgb").removeAlpha()
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}
