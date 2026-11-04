import type { ReadingCardProfile, ReadingProfileId } from './readingCardProfiles';

export type ReadingCanvaMasterBinding = { profileId:ReadingProfileId; templateVersion:string; sourceId:string; mappingVersion?:string; sourceLayoutSha256?:string; sourceAssetsSha256?:string };

/** Populate only after the user approves the final eight-page Canva preview,
 * the design is saved, and its ordered pages and exact dataset are verified.
 * New handoff styles also require a successful eight-page Autofill + export;
 * their saved source IDs in cardnews14Catalog are intentionally not bindings.
 * Equal field names cannot distinguish Ink/Lime from Cobalt/Paper artwork. */
export const READING_CANVA_MASTER_BINDINGS:readonly ReadingCanvaMasterBinding[] = [];

export function readingMasterSourceApproved(profile:ReadingCardProfile,sourceId:string):boolean {
  return READING_CANVA_MASTER_BINDINGS.some(binding => binding.profileId===profile.id && binding.templateVersion===profile.templateVersion && binding.sourceId===sourceId && (!profile.sourceLayoutSha256 || binding.mappingVersion===profile.mappingVersion && binding.sourceLayoutSha256===profile.sourceLayoutSha256 && binding.sourceAssetsSha256===profile.sourceAssetsSha256));
}
