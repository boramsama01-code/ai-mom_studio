import entries from "./studioFinalAssets.json";
import refreshedEntries from "./studioRefreshedAssets.json";
import type { StudioCharacter } from "./studio";

export const FINAL_POSE_VERSION = "final-v1.5" as const;
export const PREVIOUS_POSE_VERSION = "final-v1.4" as const;
export const POSE_ASSET_VERSIONS = [PREVIOUS_POSE_VERSION, FINAL_POSE_VERSION] as const;
export type PoseAssetVersion = (typeof POSE_ASSET_VERSIONS)[number];
export type FinalStudioAsset = (typeof entries)[number];
export const FINAL_STUDIO_ASSETS: readonly FinalStudioAsset[] = [...refreshedEntries, ...entries.filter(entry => entry.category !== "individual")];
const prefixes: Record<StudioCharacter, string> = { pengpeng: "PP", pempem: "PM", penguin: "KG", pengki: "KK" };
const byId = new Map(entries.map(entry => [entry.id, entry]));
const refreshedById = new Map(refreshedEntries.map(entry => [entry.id, entry]));
export function finalPose(character: StudioCharacter, pose: number, version: PoseAssetVersion = FINAL_POSE_VERSION) {
  const id = `${prefixes[character]}${String(pose).padStart(3, "0")}`;
  return version === FINAL_POSE_VERSION ? refreshedById.get(id) : byId.get(id);
}
export function finalAsset(id: string) { return refreshedById.get(id) ?? byId.get(id); }
export function finalAssetUrl(id: string) {
  const version = refreshedById.has(id) ? FINAL_POSE_VERSION : PREVIOUS_POSE_VERSION;
  return `/api/studio/characters/assets/${id}?version=${version}`;
}
export const FINAL_FACE_FILTERS = [
  ["all", "모든 표정"], ["cheek_squash", "볼 눌림·납작"],
  ["uneven_eyes", "짝눈"], ["wobble_shock", "찌글찌글 놀람"], ["normal", "기본 표정"],
] as const;
