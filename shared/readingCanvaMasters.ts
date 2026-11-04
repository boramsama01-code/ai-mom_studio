import type { ReadingCardProfile, ReadingProfileId } from './readingCardProfiles';

export type ReadingCanvaMasterBinding = { profileId:ReadingProfileId; templateVersion:string; sourceId:string };

/** Populate only after the user approves the final eight-page Canva preview,
 * the design is saved, and its ordered pages and 46/4 dataset are verified.
 * Equal field names cannot distinguish Ink/Lime from Cobalt/Paper artwork. */
export const READING_CANVA_MASTER_BINDINGS:readonly ReadingCanvaMasterBinding[] = [];

export function readingMasterSourceApproved(profile:ReadingCardProfile,sourceId:string):boolean {
  return READING_CANVA_MASTER_BINDINGS.some(binding => binding.profileId===profile.id && binding.templateVersion===profile.templateVersion && binding.sourceId===sourceId);
}
