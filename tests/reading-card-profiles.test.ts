import {describe,expect,it} from 'vitest';
import sharp from 'sharp';
import {defaultPageDesigns} from '../shared/familyDialogue';
import {familyReadingTextValues} from '../shared/familyDisplay';
import {READING_CARD_PROFILES,READING_PROFILE_LOGO_ID,readingProfileDesigns,readingProfileDesignErrors,readingDisplayDescriptors} from '../shared/readingCardProfiles';
import {familyDialogueCardFixture,scientificFamilyCardFixture} from './fixtures/familyDialogueCard';
import {layoutReadingCard,renderReadingCard,readingPageText} from '../server/services/readingCard';
import {prepareReadingArtwork} from '../server/services/readingCardImages';
import {planCarousel,renderCarouselPage} from '../server/services/cardCarousel';
import {CardOverflowError} from '../server/services/card';
import {resolveStyle} from '../server/services/templates';
import type {DB} from '../server/db';

const context={brandName:'ALLligodang',accent:'#D5FF45',sourceCredit:'출처: 직접 확인한 기사'};
function copyFor(index=0,science=false) {
  const copy=science?scientificFamilyCardFixture():familyDialogueCardFixture();
  copy.templateKey=READING_CARD_PROFILES[index].templateKey;
  const cover=copy.pages[0],outro=copy.pages[7];
  if(cover.id==='cover')cover.fields.headline='똑똑함의 기준';
  if(outro.id==='outro')outro.fields.logoAssetId=READING_PROFILE_LOGO_ID;
  return copy;
}
describe('reading profiles with fixed typography and photo windows',()=>{
  it('keeps 46 editable text fields and four image slots in both palettes and both concept modes',async()=>{
    for(const [index,profile] of READING_CARD_PROFILES.filter(profile=>!profile.sourceStyleId).entries()) for(const science of [false,true]) {
      const copy=copyFor(index,science),values=familyReadingTextValues(copy,context),designs=readingProfileDesigns(profile,defaultPageDesigns());
      expect(profile.pages.flatMap(page=>page.textBoxes.map(box=>box.field)).sort()).toEqual(Object.keys(values).sort());
      expect(Object.keys(values)).toHaveLength(46);
      expect(profile.images.map(slot=>slot.field)).toEqual(['P01_COVER_IMAGE','P04_CONTEXT_IMAGE','P07_ACTIVITY_IMAGE','P08_PROFILE_IMAGE']);
      expect(readingProfileDesignErrors(profile,designs)).toEqual([]);
      expect(await resolveStyle({} as DB,profile.templateKey,3)).toEqual({layout:'minimal'});
      for(const page of copy.pages) {
        const runs=layoutReadingCard(copy,page,context).textRuns;
        expect(runs.map(run=>run.text)).toEqual(readingPageText(copy,page,context));
        for(const run of runs) {
          expect(run.lines.length).toBeLessThanOrEqual(run.maxLines);
          expect(run.size).toBe(run.fontSize);
          expect(run.lines.join('').replace(/\s/g,'')).toBe(run.text.replace(/\s/g,''));
        }
      }
      if(science) expect(readingDisplayDescriptors(profile,copy.pages[5]).map(field=>field.key)).toContain('definitionIndexA');
    }
  });
  it('retains article text and stored images when selecting a profile, and guards incompatible design settings',()=>{
    const profile=READING_CARD_PROFILES[0],before=defaultPageDesigns();
    before.news_summary.background={...before.news_summary.background,kind:'image',assetId:77};
    before.cover.background={...before.cover.background,kind:'image',assetId:78,focalX:12};
    const after=readingProfileDesigns(profile,before);
    expect(after.news_summary.background.kind).toBe('brand');expect(after.news_summary.previousAssetIds).toContain(77);
    expect(after.cover.background).toMatchObject({kind:'image',assetId:78,focalX:12});
    expect(before.news_summary.background.assetId).toBe(77);
    after.outro.alignment='center';expect(readingProfileDesignErrors(profile,after).join(' ')).toContain('8장');
  });
  it('reports exact overflow fields including explicit line breaks without shrinking or clipping',()=>{
    const copy=copyFor(),cover=copy.pages[0];if(cover.id!=='cover')throw new Error('cover');
    cover.fields.headline='첫 줄\n둘째 줄\n셋째 줄';
    expect(()=>layoutReadingCard(copy,cover,context)).toThrow(CardOverflowError);
    try{layoutReadingCard(copy,cover,context);}catch(error){expect(error).toMatchObject({field:'P01_HEADLINE'});}
    expect(cover.fields.headline).toBe('첫 줄\n둘째 줄\n셋째 줄');
  });
  it('uses identical frame crops and preserves fixed typography when a photograph changes',async()=>{
    const profile=READING_CARD_PROFILES[0],slot=profile.images[0],copy=copyFor(),design=readingProfileDesigns(profile,defaultPageDesigns()).cover;
    const red=await sharp({create:{width:1200,height:600,channels:3,background:'#E62020'}}).png().toBuffer();
    const blue=await sharp({create:{width:1200,height:600,channels:3,background:'#2040E6'}}).png().toBuffer();
    const crop=await prepareReadingArtwork(red,design,slot,profile.pages[0].background);
    expect(await sharp(crop).metadata()).toMatchObject({width:900,height:462,format:'png'});
    const first=await renderReadingCard(copy,copy.pages[0],design,context,red,'AI 이미지');
    const second=await renderReadingCard(copy,copy.pages[0],design,context,blue,'AI 이미지');
    const top=async(bytes:Buffer)=>sharp(bytes).extract({left:0,top:0,width:1080,height:646}).raw().toBuffer();
    expect((await top(first)).equals(await top(second))).toBe(true);
    expect(await sharp(first).metadata()).toMatchObject({width:1080,height:1350,format:'jpeg'});
    const plan=planCarousel({kind:'current_dialogue',payload:{cardCopy:copy,pageDesigns:readingProfileDesigns(profile,defaultPageDesigns())},channelName:'ALLligodang',channelSlug:'news',accent:'#D5FF45',sourceOrg:'원문',checkedDate:'2026-11-04'},{layout:'minimal'});
    expect(plan.count).toBe(8);
    expect(await sharp(await renderCarouselPage(plan,7,{layout:'minimal'},null,'')).metadata()).toMatchObject({width:1080,height:1350,format:'jpeg'});
    const outro=copy.pages[7];if(outro.id==='outro')outro.fields.logoAssetId='unapproved';
    await expect(renderReadingCard(copy,outro,readingProfileDesigns(profile,defaultPageDesigns()).outro,context)).rejects.toThrow('승인된 ALL');
  });
});
