import { describe, expect, it } from 'vitest';
import { resolveCanvaProfile, snapshotCanvaProfile, storedCanvaProfileSnapshot } from '../shared/canvaEditorial';
import { CARDNEWS14_STYLE_IDS, LEGACY_READING_PROFILE_IDS, readingProfileForTemplateKey } from '../shared/readingCardProfiles';
import { READING_CANVA_MASTER_BINDINGS, readingMasterSourceApproved } from '../shared/readingCanvaMasters';

// Pin independently from the production catalog so an unreviewed version bump
// still fails. Amber Cream alone includes the reviewed credit-line correction.
const expectedTemplateVersions = {
  cinematic: 'cardnews14-cinematic-v1-20261104',
  'monochrome-coral': 'cardnews14-monochrome-coral-v1-20261104',
  'amber-cream': 'cardnews14-amber-cream-v1-20261104-r2',
  'cobalt-paper': 'cardnews14-cobalt-paper-v1-20261104',
  'ink-lime': 'cardnews14-ink-lime-v1-20261104',
  'swiss-modernism': 'cardnews14-swiss-modernism-v1-20261104',
  'studio-2am': 'cardnews14-studio-2am-v1-20261104',
  ichestyime: 'cardnews14-ichestyime-v1-20261104',
  'sharp-serif': 'cardnews14-sharp-serif-v1-20261104',
  'bang-bang': 'cardnews14-bang-bang-v1-20261104',
  hello: 'cardnews14-hello-v1-20261104',
  'ekiden-pack': 'cardnews14-ekiden-pack-v1-20261104',
  'you-and-me': 'cardnews14-you-and-me-v1-20261104',
  'ott-recommendation': 'cardnews14-ott-recommendation-v1-20261104',
} satisfies Record<(typeof CARDNEWS14_STYLE_IDS)[number], string>;

describe('Canva source fingerprints and historical snapshots', () => {
  it.each(LEGACY_READING_PROFILE_IDS)('keeps the original four-field %s snapshot readable', id => {
    const profile = readingProfileForTemplateKey(id)!;
    const historical = { mappingVersion: profile.mappingVersion, profileId: id,
      profileTemplateVersion: profile.templateVersion, profileImageSha256: profile.profileImageSha256 };
    expect(snapshotCanvaProfile(profile)).toEqual(historical);
    expect(storedCanvaProfileSnapshot(historical)).toEqual(historical);
    expect(resolveCanvaProfile(historical)).toBe(profile);
  });

  it.each(CARDNEWS14_STYLE_IDS)('pins the exact layout and asset set for %s', styleId => {
    const profile = readingProfileForTemplateKey(`cardnews14-${styleId}-v1`)!;
    const snapshot = snapshotCanvaProfile(profile);
    expect(snapshot).toEqual({ mappingVersion: 'family-reading-8/v1.0', profileId: profile.id,
      profileTemplateVersion: expectedTemplateVersions[styleId], profileImageSha256: profile.profileImageSha256,
      sourceLayoutSha256: profile.sourceLayoutSha256, sourceAssetsSha256: profile.sourceAssetsSha256 });
    expect(snapshot.sourceLayoutSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.sourceAssetsSha256).toMatch(/^[a-f0-9]{64}$/);
    const roundTrip = JSON.parse(JSON.stringify(snapshot));
    expect(storedCanvaProfileSnapshot(roundTrip)).toEqual(snapshot);
    expect(resolveCanvaProfile(roundTrip)).toBe(profile);
  });

  it('rejects the original Amber Cream version for a new job while retaining its historical trace', () => {
    const profile = readingProfileForTemplateKey('cardnews14-amber-cream-v1')!;
    const original = { ...snapshotCanvaProfile(profile), profileTemplateVersion: 'cardnews14-amber-cream-v1-20261104' };
    expect(() => resolveCanvaProfile(original)).toThrow('읽기 디자인·매핑·프로필 이미지 버전');
    expect(storedCanvaProfileSnapshot(original)).toEqual(original);
  });

  it.each(['sourceLayoutSha256', 'sourceAssetsSha256'] as const)('rejects a missing, malformed or different %s before a new provider request', field => {
    const profile = readingProfileForTemplateKey('cardnews14-cinematic-v1')!;
    const snapshot = snapshotCanvaProfile(profile);
    for (const value of [undefined, '', 'not-a-sha256', '0'.repeat(64)]) {
      const changed = { ...snapshot, [field]: value };
      expect(() => resolveCanvaProfile(changed)).toThrow('원본 배치·자산 버전');
    }
  });

  it('cannot erase both hashes to downgrade a new profile to the old snapshot contract', () => {
    const { sourceLayoutSha256: _layout, sourceAssetsSha256: _assets, ...partial } = snapshotCanvaProfile(readingProfileForTemplateKey('cardnews14-hello-v1')!);
    expect(() => resolveCanvaProfile(partial)).toThrow('원본 배치·자산 버전');
  });

  it('preserves historical source fingerprints for import without replacing them from the current catalog', () => {
    const snapshot = snapshotCanvaProfile(readingProfileForTemplateKey('cardnews14-cobalt-paper-v1')!);
    const historical = { ...snapshot, sourceLayoutSha256: '1'.repeat(64), sourceAssetsSha256: '2'.repeat(64) };
    expect(storedCanvaProfileSnapshot(historical)).toEqual(historical);
    expect(() => resolveCanvaProfile(historical)).toThrow('원본 배치·자산 버전');
    expect(snapshotCanvaProfile(readingProfileForTemplateKey('cardnews14-cobalt-paper-v1')!)).toEqual(snapshot);
  });

  it('does not promote saved designs or their valid fingerprints into production bindings', () => {
    expect(READING_CANVA_MASTER_BINDINGS).toEqual([]);
    for (const styleId of CARDNEWS14_STYLE_IDS) {
      const profile = readingProfileForTemplateKey(`cardnews14-${styleId}-v1`)!;
      expect(readingMasterSourceApproved(profile, 'Dregistered_but_unverified')).toBe(false);
    }
  });
});
