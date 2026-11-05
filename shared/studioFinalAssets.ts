import entries from "./studioFinalAssets.json";
import type { StudioCharacter } from "./studio";

export const FINAL_POSE_VERSION = "final-v1.4" as const;
export type FinalStudioAsset = (typeof entries)[number];
export const FINAL_STUDIO_ASSETS: readonly FinalStudioAsset[] = entries;
const prefixes: Record<StudioCharacter, string> = { pengpeng: "PP", pempem: "PM", penguin: "KG", pengki: "KK" };
const byId = new Map(entries.map(entry => [entry.id, entry]));
export function finalPose(character: StudioCharacter, pose: number) {
  return byId.get(`${prefixes[character]}${String(pose).padStart(3, "0")}`);
}
export function finalAsset(id: string) { return byId.get(id); }
export function finalAssetUrl(id: string) { return `/api/studio/characters/assets/${id}?version=${FINAL_POSE_VERSION}`; }
export const FINAL_FACE_FILTERS = [
  ["all", "모든 표정"], ["cheek_squash", "볼 눌림·납작"],
  ["uneven_eyes", "짝눈"], ["wobble_shock", "찌글찌글 놀람"], ["normal", "기본 표정"],
] as const;
