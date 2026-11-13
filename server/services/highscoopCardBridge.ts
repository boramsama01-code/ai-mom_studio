/** The generic card editor and Notion share the current page geometry for every brand. */
import sharp from "sharp";
import {editorialTemplateForKey,editorialTemplateForChannel,editorialBrandForChannel,type EditorialChannel,type EditorialBrand} from '../../shared/editorialTemplates';
import type {CardCopy} from '../../shared/cardCopy';
import type {CardCopyV2,PageDesign,PageDesigns} from '../../shared/familyDialogue';
import {familyPageTitle} from './familyDialogueCard';
import {familyDisplayDescriptors,resolveFamilyDisplay,type FamilyDisplayContext} from '../../shared/familyDisplay';
import type {NotionInteriorTemplate} from '../../shared/notionPageTemplates';
import {editorialFamilyPageBody} from '../../shared/editorialPageContent';
import {prepareReadingArtwork} from './readingCardImages';
import {registeredProfileDataUrl} from './characterVariantAssets';
import { CardOverflowError, type CardModel } from "./card";
import { CanvaRestError } from "./canvaRest";
import { buildNotionCanvaPptx, type NotionCanvaDocument, type NotionCanvaPhoto } from "./notionCanva";
import { HttpError } from "../routes/util";

export type HighScoopCardBridge = { templateKey: string; document: NotionCanvaDocument;brand?:EditorialBrand;soft?:string;pageAssetIds?:Array<number|undefined>;pageDesigns?:PageDesign[];pageImageOpacity?:Array<number|undefined>;outroProfileId?:string };

/** Preserve the generic editor's correctable overflow contract at the native boundary. */
function validateTextLengths(document: NotionCanvaDocument) {
  const check = (text: string | undefined, max: number, field: string) => {
    if (text && text.length > max) throw new CardOverflowError(field, `문구가 ${max}자를 넘습니다. 문구를 줄이거나 장을 나눠 주세요. 원고는 유지했습니다.`);
  };
  check(document.title, 255, "title");
  document.pages.forEach((page, index) => {
    const field = (name: string) => index === 0 ? name === "title" ? "title" : `cardCopy.cover.${name}` : `cardCopy.pages.${index - 1}.${name}`;
    check(page.title, 300, field("title"));
    check(page.body, 2400, field("body"));
    check(page.interiorSubtitle, 500, field("subtitle"));
    check(page.footnote, 1000, "footer");
    check(page.sourceLabel, 300, "footer");
  });
}

/** Keep every original page and block. The editor's last page is never replaced by a CTA. */
export function highScoopCardDocument(templateKey: string, cover: CardModel, pages: CardModel[],channel?:EditorialChannel,copy?:CardCopy): HighScoopCardBridge {
  const current=editorialTemplateForKey(templateKey);
  const kit=channel&&current?editorialTemplateForChannel(channel,templateKey):current;
  if (!kit) throw new HttpError(422, "현재 공통 템플릿을 다시 선택해 주세요.");
  const document: NotionCanvaDocument = {
    title: cover.title,
    coverStyle: "A",
    category: kit.category,
    categoryColor: kit.color,
    pages: [
      { title: cover.title, body: cover.subtitle, footnote: cover.footer },
      ...pages.map((page,index) => {
       const source=copy?.pages[index],columns=source?.columns;
       const body=columns?columns.map((column,i)=>[i===0?source?.body:undefined,column.title,column.body].filter(Boolean).join('\n\n')).join('\n---\n'):page.blocks.map(block => page.blocks.length > 1 && block.label ? `${block.label}\n${block.text}` : block.text).join("\n\n");
       return {
        title: page.title,
        interiorTemplate:source?.interiorTemplate??(columns?'two_columns':source?.background?'image_text':'text'),
        interiorSubtitle: page.subtitle ?? (page.blocks.length === 1 ? page.blocks[0].label : undefined),
        body,
        footnote:[source?.footnote,page.footer,source?.resource?[source.resource.title,source.resource.url].join('\n'):undefined].filter(Boolean).join('\n'),
        emphasis:source?.emphasis,
      };}),
    ],
  };
  return { templateKey, document,...(channel?{brand:editorialBrandForChannel(channel)}:{}),soft:kit.soft,pageAssetIds:[copy?.cover.background?.assetId,...(copy?.pages.map(page=>page.background?.assetId)??pages.map(()=>undefined))],pageImageOpacity:[copy?.cover.background?.opacity,...(copy?.pages.map(page=>page.background?.opacity)??pages.map(()=>undefined))] };
}

/** Render every semantic field of an eight-slot manuscript without changing its stored schema. */
export function editorialFamilyCardDocument(templateKey:string,copy:CardCopyV2,designs:PageDesigns,channel:EditorialChannel,context:FamilyDisplayContext={}):HighScoopCardBridge{
 const kit=editorialTemplateForChannel(channel,templateKey);
 if(!kit)throw new HttpError(422,'현재 공통 템플릿을 다시 선택해 주세요.');
 const assets=copy.pages.map(page=>{const bg=designs[page.id].background;return bg.assetId??(bg.inheritCover?designs.cover.background.assetId:undefined);});
 const pages:NotionCanvaDocument['pages']=copy.pages.map((page,index)=>{
  const design=designs[page.id],display=resolveFamilyDisplay(page,context),title=familyPageTitle(page);
  const notes=familyDisplayDescriptors(page).filter(item=>item.key!=='kicker'&&(item.key!=='pageNumber'||page.displayOverrides?.pageNumber!==undefined)).map(item=>display[item.key]).filter(Boolean);
  const body=design.interiorBody??editorialFamilyPageBody(page);
  const profile=page.id==='outro'?page.fields.logoAssetId:undefined;
  const interiorTemplate:NotionInteriorTemplate|undefined=index===0?undefined:design.interiorTemplate??(assets[index]||profile?'image_text':'text');
  return {title,body:index===0?[body,display.kicker].filter(Boolean).join('\n'):body,...(interiorTemplate?{interiorTemplate}:{}),interiorSubtitle:display.kicker,emphasis:design.emphasis,footnote:[design.footnote,...notes].filter(Boolean).join('\n')};
 });
 const closing=copy.pages.find(page=>page.id==='outro');
 return {templateKey,document:{title:pages[0].title,coverStyle:'A',category:kit.category,categoryColor:kit.color,pages},brand:editorialBrandForChannel(channel),soft:kit.soft,pageAssetIds:assets,pageDesigns:copy.pages.map(page=>designs[page.id]),...(closing?.id==='outro'&&closing.fields.logoAssetId?{outroProfileId:closing.fields.logoAssetId}:{})};
}

/** Native Canva SVG is also the generic editor preview and publication raster source. */
export async function highScoopCardPageSvg(bridge: HighScoopCardBridge, pageIndex: number, art: Buffer | null, credit: string,pageImages:ReadonlyMap<number,Buffer>&{credits?:ReadonlyMap<number,string>}=new Map()) {
  const assetId=bridge.pageAssetIds?.[pageIndex];
  const profileId=pageIndex===bridge.document.pages.length-1?bridge.outroProfileId:undefined;
  if(assetId&&profileId)throw new HttpError(422,'마지막 장의 선택한 프로필과 사진을 함께 배치하려면 장을 나눠 주세요. 두 원본과 원고는 보존했습니다.');
  const selected=assetId?pageImages.get(assetId):profileId?Buffer.from(registeredProfileDataUrl(profileId).split(',')[1],'base64'):pageIndex===0?art:null;
  if(assetId&&!selected)throw new HttpError(422,'이 페이지에 저장한 사진을 불러올 수 없습니다. 사진을 다시 선택해 주세요. 원고는 유지했습니다.');
  const selectedCredit=assetId?pageImages.credits?.get(assetId)??credit:credit;
  const document: NotionCanvaDocument = {
    ...bridge.document,
    pages: bridge.document.pages.map((page, index) => index === pageIndex ? {
      ...page,
      ...(selected ? { imageId: "generic_cover" } : {}),
      ...((selectedCredit || page.sourceLabel) ? { sourceLabel: [page.sourceLabel, selectedCredit].filter(Boolean).join("\n") } : {}),
    } : { ...page }),
  };
  const photos: NotionCanvaPhoto[] = [];
  validateTextLengths(document);
  if (selected) {
    // Normalize a copy, leaving the selected source artwork and saved media untouched.
    const design=bridge.pageDesigns?.[pageIndex],template=document.pages[pageIndex].interiorTemplate;
    let pixels=selected;
    if(design&&assetId){
      const width=pageIndex===0?1080:template==='document_excerpt'?952:440,height=pageIndex===0?1350:776;
      pixels=await prepareReadingArtwork(selected,design,{width,height},design.background.color??'#FFFFFF');
    }
    const opacity=bridge.pageImageOpacity?.[pageIndex];
    if(opacity!==undefined&&opacity<100){const meta=await sharp(pixels).metadata();const tint=await sharp({create:{width:meta.width!,height:meta.height!,channels:4,background:{r:255,g:255,b:255,alpha:1-Math.max(0,opacity)/100}}}).png().toBuffer();pixels=await sharp(pixels).composite([{input:tint}]).png().toBuffer();}
    const bytes = await sharp(pixels, { limitInputPixels: 40_000_000 }).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
    photos.push({ id: "generic_cover", bytes, mimeType: "image/jpeg" });
  }
  try {
    const result = await buildNotionCanvaPptx(document, photos, { previewPage: pageIndex, previewOnly: true, includeOutro: false,brand:bridge.brand,soft:bridge.soft,pageAlignments:bridge.pageDesigns?.map(design=>design.alignment) });
    if (!result.previewSvg || result.pageCount !== document.pages.length) throw new HttpError(500, "현재 템플릿의 페이지 수를 확인할 수 없습니다. 저장한 원고는 유지했습니다.");
    return result.previewSvg;
  } catch (error) {
    if (error instanceof CanvaRestError && error.status === 422) {
      if (/원고가 페이지에 너무 깁니다|글자가 텍스트 폭보다 큽니다/.test(error.message)) {
        const field = /각주|출처/.test(error.message) ? "footer" : /제목/.test(error.message) ? pageIndex === 0 ? "title" : `cardCopy.pages.${pageIndex - 1}.title` : pageIndex === 0 ? "cardCopy.cover.subtitle" : `cardCopy.pages.${pageIndex - 1}.body`;
        throw new CardOverflowError(field, error.message);
      }
      throw new HttpError(422, error.message);
    }
    throw error;
  }
}

export async function renderHighScoopCardPage(bridge: HighScoopCardBridge, pageIndex: number, art: Buffer | null, credit: string,pageImages:ReadonlyMap<number,Buffer>&{credits?:ReadonlyMap<number,string>}=new Map()) {
  const svg = await highScoopCardPageSvg(bridge, pageIndex, art, credit,pageImages);
  return sharp(Buffer.from(svg)).flatten({ background: "#ffffff" }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}
