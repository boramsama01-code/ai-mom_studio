import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { CHARACTER_VARIANT_ASSETS, FAMILY_PROFILE_ASSET_ID, FAMILY_ENDING_ASSET_IDS, FAMILY_ENDING_ASSETS, isRegisteredProfileAssetId, selectedFamilyEnding } from "../shared/characterVariantAssets";
import { defaultPageDesigns, pageDesignsSchema } from "../shared/familyDialogue";
import { readingProfileForTemplateKey, readingProfileDesigns, READING_PROFILE_LOGO_ID } from "../shared/readingCardProfiles";
import { readRegisteredCharacterAsset, registeredProfileDataUrl, renderRegisteredFamilyEnding } from "../server/services/characterVariantAssets";
import { approvedReadingProfileLogo, renderReadingCard } from "../server/services/readingCard";
import { renderFamilyDialogueCard } from "../server/services/familyDialogueCard";
import { planCarousel, renderCarouselPage, renderCarouselPages } from "../server/services/cardCarousel";
import { assertCanvaDesignSettings } from "../server/services/canvaEditorialAssets";
import { familyDialogueCardFixture } from "./fixtures/familyDialogueCard";
import { CardOverflowError, type CardStyle } from "../server/services/card";

const style: CardStyle={layout:"minimal"};
const context={brandName:"ALLligodang",accent:"#D5FF45"};
function fixture(reading=false) {
  const copy=familyDialogueCardFixture();let designs=defaultPageDesigns();
  if(reading){const profile=readingProfileForTemplateKey("reading-ink-lime-v1")!;copy.templateKey=profile.templateKey;designs=readingProfileDesigns(profile,designs);if(copy.pages[0].id==='cover')copy.pages[0].fields.headline="똑똑함의 기준";}
  const outro=copy.pages[7];if(outro.id!=='outro')throw new Error("outro fixture required");
  outro.fields.logoAssetId=FAMILY_PROFILE_ASSET_ID;
  return {copy,designs,outro,input:{kind:"current_dialogue",payload:{cardCopy:copy,pageDesigns:designs},channelName:"ALLligodang",channelSlug:"news",accent:"#D5FF45",sourceOrg:"원문",checkedDate:"2026-11-05"}};
}

describe("preserved family profile and ending revisions",()=>{
  it("keeps all four source PNG bytes and dimensions and separates profile and full-page assets",async()=>{
    for(const asset of CHARACTER_VARIANT_ASSETS){const bytes=readRegisteredCharacterAsset(asset);expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);expect(await sharp(bytes).metadata()).toMatchObject({format:'png',width:asset.width,height:asset.height});}
    expect(isRegisteredProfileAssetId(FAMILY_PROFILE_ASSET_ID)).toBe(true);
    expect(isRegisteredProfileAssetId(FAMILY_ENDING_ASSET_IDS[0])).toBe(false);
    expect(()=>registeredProfileDataUrl('../../secrets')).toThrow('승인 목록');
    expect(FAMILY_ENDING_ASSETS.map(asset=>asset.revision)).toEqual(['latest','previous','previous']);
  });
  it("keeps old saved designs valid and accepts complete endings only on page eight",()=>{
    const designs=defaultPageDesigns();expect(pageDesignsSchema.safeParse(designs).success).toBe(true);
    designs.outro.outroPresentation={mode:'full_image',assetId:FAMILY_ENDING_ASSET_IDS[0]};
    expect(pageDesignsSchema.parse(designs).outro.outroPresentation).toEqual(designs.outro.outroPresentation);
    expect(selectedFamilyEnding('cover',designs.outro)).toBeUndefined();
    expect(pageDesignsSchema.safeParse({...designs,cover:{...designs.cover,outroPresentation:designs.outro.outroPresentation}}).success).toBe(false);
    expect(pageDesignsSchema.safeParse({...designs,outro:{...designs.outro,outroPresentation:{mode:'full_image',assetId:FAMILY_PROFILE_ASSET_ID}}}).success).toBe(false);
    expect(pageDesignsSchema.safeParse({...designs,outro:{...designs.outro,outroPresentation:{mode:'full_image',assetId:'../../secrets'}}}).success).toBe(false);
  });
  it("uses the selected square profile without replacing editable text or other pages",async()=>{
    const {copy,designs,outro}=fixture(true),before=structuredClone(copy);
    expect(approvedReadingProfileLogo(copy)).toBe(registeredProfileDataUrl(FAMILY_PROFILE_ASSET_ID));
    const rendered=await renderReadingCard(copy,outro,designs.outro,context);
    expect(await sharp(rendered).metadata()).toMatchObject({width:1080,height:1350,format:'jpeg'});
    expect(copy).toEqual(before);
    const coverWithFamily=await renderReadingCard(copy,copy.pages[0],designs.cover,context);
    outro.fields.logoAssetId=READING_PROFILE_LOGO_ID;
    const coverWithAll=await renderReadingCard(copy,copy.pages[0],designs.cover,context);
    expect(coverWithFamily.equals(coverWithAll)).toBe(true);
    const allOutro=await renderReadingCard(copy,outro,designs.outro,context);
    expect(rendered.equals(allOutro)).toBe(false);
  });
  it.each([false,true])("renders all complete ending revisions in the %s reading layout without drawing retained text",async(reading)=>{
    const {copy,designs,outro,input}=fixture(reading);
    outro.fields.brandLine='보관할 긴 문구'.repeat(70);
    const preserved=structuredClone(outro.fields);
    expect(()=>planCarousel(input,style)).toThrow(CardOverflowError);
    for(const asset of FAMILY_ENDING_ASSETS){
      designs.outro.outroPresentation={mode:'full_image',assetId:asset.id};
      const plan=planCarousel(input,style);expect(plan.count).toBe(8);
      expect(plan.pages[6].blocks.map(block=>block.text)).toEqual(['구독','좋아요','@spacepenguin.co']);
      const preview=await renderCarouselPage(plan,7,style,null,''),expected=await renderRegisteredFamilyEnding(asset.id);
      expect(preview.equals(expected)).toBe(true);
      const direct=reading?await renderReadingCard(copy,outro,designs.outro,context):await renderFamilyDialogueCard(outro,designs.outro,context,style);
      expect(direct.equals(preview)).toBe(true);
      expect(await sharp(preview).metadata()).toMatchObject({width:1080,height:1350,format:'jpeg',channels:3});
    }
    expect(outro.fields).toEqual(preserved);
    designs.outro.outroPresentation={mode:'template'};
    expect(()=>planCarousel(input,style)).toThrow(CardOverflowError);
    expect(outro.fields).toEqual(preserved);
  });
  it("keeps an eight-page export's ending alt text aligned with the complete PNG",async()=>{
    const {designs,outro,input}=fixture();outro.fields.brandLine='화면에 없는 보관 문구';outro.fields.cta='이 문구는 완성 이미지에 없습니다';
    designs.outro.outroPresentation={mode:'full_image',assetId:FAMILY_ENDING_ASSET_IDS[0]};
    const pages=await renderCarouselPages(planCarousel(input,style),style,null,'');
    expect(pages).toHaveLength(8);expect(pages[7].altText).toContain('구독');expect(pages[7].altText).toContain('@spacepenguin.co');
    expect(pages[7].altText).not.toContain('보관 문구');expect(pages[7].altText).not.toContain('이 문구는');
  });
  it("rejects whole-image endings before attempting an unsupported Canva layout",()=>{
    for(const reading of [false,true]){const {copy,designs}=fixture(reading);designs.outro.outroPresentation={mode:'full_image',assetId:FAMILY_ENDING_ASSET_IDS[0]};
      expect(()=>assertCanvaDesignSettings(designs,readingProfileForTemplateKey(copy.templateKey))).toThrow('스튜디오에서 8장');
      try{assertCanvaDesignSettings(designs,readingProfileForTemplateKey(copy.templateKey));}catch(error){expect(error).toMatchObject({status:422,extra:{code:'canva_full_image_outro_unsupported'}});}
    }
  });
});
