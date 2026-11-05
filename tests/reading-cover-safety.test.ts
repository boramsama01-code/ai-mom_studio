import { describe, expect, it } from 'vitest';
import { READING_CARD_PROFILES, readingProfileForTemplateVersion } from '../shared/readingCardProfiles';
import { READING_COVER_LAYOUT_REVISION, READING_COVER_SAFE_BOUNDS } from '../shared/readingCoverSafety';
import { layoutReadingProfilePage } from '../server/services/readingCard';
import { readingMasterSourceApproved } from '../shared/readingCanvaMasters';
import { resolveCanvaProfile, snapshotCanvaProfile, storedCanvaProfileSnapshot } from '../shared/canvaEditorial';
import { familyReadingTextValues } from '../shared/familyDisplay';
import { familyDialogueCardFixture } from './fixtures/familyDialogueCard';
import rawLayout from '../shared/readingCardLayout.json';

function contains(outer: {x:number;y:number;width:number;height:number}, inner: {x:number;y:number;width:number;height:number}) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width + .01 && inner.y + inner.height <= outer.y + outer.height + .01;
}

describe('reading cover crop margins', () => {
  it('keeps all five editable cover fields inside both crop previews with extra internal space', () => {
    expect(READING_CARD_PROFILES).toHaveLength(16);
    for (const profile of READING_CARD_PROFILES) {
      const cover = profile.pages[0];
      expect(cover.textBoxes.map(box=>box.field).sort()).toEqual(['P01_HEADLINE','P01_SUBTITLE','P01_TOPIC_TAG','P01_IMAGE_CREDIT','P01_PAGE_NUMBER'].sort());
      for (const box of cover.textBoxes) {
        expect(contains(READING_COVER_SAFE_BOUNDS, box), `${profile.id}:${box.field}`).toBe(true);
        expect(contains({x:0,y:135,width:1080,height:1080}, box)).toBe(true);
        expect(contains({x:33.75,y:0,width:1012.5,height:1350}, box)).toBe(true);
      }
      for (const image of cover.imageBoxes) {
        // Full-bleed photographs stay full-bleed. Framed article artwork must
        // retain its complete window in square and grid previews.
        if (image.x === 0 && image.y === 0 && image.width === 1080 && image.height === 1350) continue;
        expect(contains(READING_COVER_SAFE_BOUNDS, image), `${profile.id}:${image.field}`).toBe(true);
      }
    }
  });

  it('renders the source text in every new cover without deleting characters or silently reducing type', () => {
    for (const profile of READING_CARD_PROFILES.filter(profile=>profile.sourceStyleId)) {
      const copy = familyDialogueCardFixture();
      copy.templateKey = profile.templateKey;
      const page = copy.pages[0];
      if (page.id !== 'cover') throw new Error('Missing cover');
      page.fields.headline = '시험 잘 보는 AI,\n진짜 실력은?';
      page.fields.subtitle = '높은 점수와 깊은 이해,\n같은 뜻일까요?';
      const values = familyReadingTextValues(copy);
      values.P01_IMAGE_CREDIT = 'AI 생성 이미지';
      if(profile.sourceStyleId==='hello') { values.P01_TOPIC_TAG = 'AI ·\n생각의\n기준'; values.P01_PAGE_NUMBER = '01 /\n08'; }
      const before = JSON.stringify(values), result = layoutReadingProfilePage(profile,1,values);
      expect(result.textRuns).toHaveLength(5);
      for (const run of result.textRuns) {
        expect(run.lines.join('').replace(/\s/gu,'')).toBe(run.text.replace(/\s/gu,''));
        expect(run.size).toBe(run.fontSize);
        expect(run.lines.length).toBeLessThanOrEqual(run.maxLines);
      }
      expect(JSON.stringify(values)).toBe(before);
    }
  });

  it('preserves the original two reading styles on all seven inner pages', () => {
    for (const profile of READING_CARD_PROFILES.filter(profile=>!profile.sourceStyleId)) {
      const source = rawLayout.styles.find(style=>profile.id.includes(style.id.replace('_','-')))!;
      for (let index=1;index<8;index++) {
        expect(profile.pages[index].textBoxes).toEqual(source.pages[index].textBoxes);
        expect(profile.pages[index].shapes).toEqual(source.pages[index].shapes);
        const before = source.pages[index].imageBoxes;
        expect(profile.pages[index].imageBoxes.map(({pageId,kind,fit,...box})=>box)).toEqual(before.map(({fit,...box})=>box));
      }
    }
  });

  it('versions the new cover layout and refuses to reinterpret saved Canva jobs as the revised layout', () => {
    for (const profile of READING_CARD_PROFILES) {
      expect(profile.templateVersion.endsWith(`-${READING_COVER_LAYOUT_REVISION}`)).toBe(true);
      expect(readingProfileForTemplateVersion(profile.templateVersion)).toBe(profile);
      const snapshot = snapshotCanvaProfile(profile), prior = { ...snapshot, profileTemplateVersion:profile.templateVersion.replace(`-${READING_COVER_LAYOUT_REVISION}`,'') };
      expect(storedCanvaProfileSnapshot(prior)).toEqual(prior);
      expect(()=>resolveCanvaProfile(prior)).toThrow('버전');
      expect(readingMasterSourceApproved(profile,'unverified-cover-design')).toBe(false);
    }
  });
});
