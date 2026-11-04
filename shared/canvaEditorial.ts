/** Flat Canva fields are a boundary adapter, never the authoring schema. */
import type { CardCopyV2, FamilyPageId } from './familyDialogue';
import { familyDisplayDescriptors, familyReadingTextValues, resolveFamilyDisplay, type FamilyDisplayContext } from './familyDisplay';

export const CANVA_MAPPING_VERSION = 'family-dialogue-8/v1.1';
export const CANVA_PAGE_IDS = ['cover','news_summary','implication','discussion','perspectives','concept','activity','outro'] as const;
export const CANVA_APPROVED_PARENT_LOGO = 'brand:space-penguin-company:20261101';
export type CanvaConceptMode = 'value_definition' | 'scientific_explanation';
export type CanvaField = { type:'text'; text:string } | { type:'image'; asset_id:string };
export type CanvaDataset = Record<string, { type:string }>;
export type CanvaVariant = { conceptMode:CanvaConceptMode; hasExternalActivity:boolean };

const commonText = ['P01_HEADLINE','P01_SUBTITLE','P02_TITLE','P02_FACTS','P02_CAVEAT','P03_TITLE','P03_TAKEAWAY','P04_TITLE','P04_SCENARIO','P04_QUESTION','P05_TITLE','P05_A_LABEL','P05_A_BODY','P05_B_LABEL','P05_B_BODY','P06_TITLE','P06_CONCEPT','P06_FILL_IN','P07_TITLE','P07_HOME_LABEL','P07_HOME_ACTION','P08_BRAND_NAME','P08_PARENT_BRAND','P08_BRAND_LINE','P08_CTA','P08_HANDLE'];
const commonImages = ['P01_IMAGE','P02_BACKGROUND','P03_BACKGROUND','P04_BACKGROUND','P05_BACKGROUND','P06_BACKGROUND','P07_BACKGROUND','P08_LOGO'];

export function canvaVariant(copy:CardCopyV2):CanvaVariant {
  const concept=copy.pages.find(p=>p.type==='concept')!;
  const activity=copy.pages.find(p=>p.type==='activity')!;
  if (!concept || !activity || !['value_definition','scientific_explanation'].includes(concept.fields.mode)) throw new Error('6장 개념 구조를 확인해 주세요.');
  return { conceptMode:concept.fields.mode, hasExternalActivity:activity.fields.optionalActivity !== null };
}

export function expectedCanvaDataset(variant:CanvaVariant):CanvaDataset {
  const text=[...commonText,...(variant.conceptMode==='value_definition' ? ['P06_DEFINITION_A','P06_DEFINITION_B','P06_BOUNDARY_CASE'] : ['P06_ACCEPTED_DEFINITION','P06_EXAMPLE_OR_NON_EXAMPLE']),...(variant.hasExternalActivity ? ['P07_OPTIONAL_LABEL','P07_OPTIONAL_ACTION'] : [])];
  return Object.fromEntries([...text.map(k=>[k,{type:'text'}]),...commonImages.map(k=>[k,{type:'image'}])]);
}

/** Unknown supplied labels are silently skipped by Canva, so check every field before POST. */
export function validateCanvaDataset(dataset:CanvaDataset,variant:CanvaVariant) {
  const required=expectedCanvaDataset(variant), errors:string[]=[];
  for(const [name,expected] of Object.entries(required)) {
    if(!dataset[name]) errors.push(`${name}: 필드 없음`);
    else if(dataset[name].type!==expected.type) errors.push(`${name}: ${expected.type} 형식 필요`);
  }
  const forbidden=variant.conceptMode==='value_definition' ? ['P06_ACCEPTED_DEFINITION','P06_EXAMPLE_OR_NON_EXAMPLE'] : ['P06_DEFINITION_A','P06_DEFINITION_B','P06_BOUNDARY_CASE'];
  if(!variant.hasExternalActivity) forbidden.push('P07_OPTIONAL_LABEL','P07_OPTIONAL_ACTION');
  for(const name of forbidden) if(dataset[name]) errors.push(`${name}: 선택한 변형에 있으면 안 되는 필드`);
  for(const [name,field] of Object.entries(dataset)) {
    if(/^P0[1-8]_(HEADER_BRAND|PAGE_NUMBER|TOPIC_TAG|KICKER|SOURCE|IMAGE_CREDIT|FACT_INDEX_[1-3]|DEFINITION_INDEX_[AB]|DURATION|ACTIVITY_HELP)$/.test(name) && field.type!=='text') errors.push(name+': text 형식 필요');
  }
  return errors;
}

export type CanvaTextOptions = { context?: FamilyDisplayContext; pageContexts?: Partial<Record<FamilyPageId, FamilyDisplayContext>>; dataset?: CanvaDataset };
export function canvaDisplayTextFields(copy:CardCopyV2,options:CanvaTextOptions={}):Record<string,{type:'text';text:string}> {
  const fields:Record<string,{type:'text';text:string}>={};
  for(const page of copy.pages) {
    const display=resolveFamilyDisplay(page,{...options.context,...options.pageContexts?.[page.id]});
    for(const descriptor of familyDisplayDescriptors(page)) fields[descriptor.canvaField]={type:'text',text:display[descriptor.key]};
  }
  return fields;
}
/** Never silently export a template's old static label after the user edits it. */
export function canvaDisplaySupportErrors(copy:CardCopyV2,dataset:CanvaDataset):string[] {
  const errors:string[]=[];
  for(const page of copy.pages) for(const descriptor of familyDisplayDescriptors(page)) {
    if(Object.hasOwn(page.displayOverrides??{},descriptor.key) && dataset[descriptor.canvaField]?.type!=='text') errors.push(page.page+'페이지 '+descriptor.label+' ('+descriptor.canvaField+'): 편집 가능한 텍스트 필드가 필요합니다.');
  }
  return errors;
}
/** Only a prepared 46-text contract. Runtime registration must still validate the
 * actual profile, every image slot and the live Canva dataset. */
export function canvaReadingTextFields(copy:CardCopyV2,options:CanvaTextOptions={}):Record<string,{type:'text';text:string}> {
  return Object.fromEntries(Object.entries(familyReadingTextValues(copy,options.context,options.pageContexts)).map(([key,text])=>[key,{type:'text' as const,text}]));
}

export function canvaTextFields(copy:CardCopyV2,options:CanvaTextOptions={}):Record<string,{type:'text';text:string}> {
  const byType=new Map(copy.pages.map(p=>[p.type,p]));
  const fields:Record<string,string>={};
  // All fields visible on the master are mapped, including labels and optional text.
  for(const page of copy.pages) {
    switch(page.id){
      case 'cover': { const f=page.fields; Object.assign(fields,{P01_HEADLINE:f.headline,P01_SUBTITLE:f.subtitle});break; }
      case 'news_summary': { const f=page.fields; Object.assign(fields,{P02_TITLE:f.title,P02_FACTS:f.facts.join('\n\n'),P02_CAVEAT:f.caveat ?? ''});break; }
      case 'implication': { const f=page.fields; Object.assign(fields,{P03_TITLE:f.title,P03_TAKEAWAY:f.takeaway});break; }
      case 'discussion': { const f=page.fields; Object.assign(fields,{P04_TITLE:f.title,P04_SCENARIO:f.scenario ?? '',P04_QUESTION:f.question});break; }
      case 'perspectives': { const f=page.fields; Object.assign(fields,{P05_TITLE:f.title,P05_A_LABEL:f.viewA.label,P05_A_BODY:f.viewA.body,P05_B_LABEL:f.viewB.label,P05_B_BODY:f.viewB.body});break; }
      case 'concept': { const f=page.fields;
        Object.assign(fields,{P06_TITLE:f.title,P06_CONCEPT:f.concept,P06_FILL_IN:f.fillIn});
        if(f.mode==='value_definition') Object.assign(fields,{P06_DEFINITION_A:f.definitionA,P06_DEFINITION_B:f.definitionB,P06_BOUNDARY_CASE:f.boundaryCase});
        else Object.assign(fields,{P06_ACCEPTED_DEFINITION:f.acceptedDefinition,P06_EXAMPLE_OR_NON_EXAMPLE:f.exampleOrNonExample});
        break; }
      case 'activity': { const f=page.fields;
        Object.assign(fields,{P07_TITLE:f.title,P07_HOME_LABEL:f.homeActivity.label,P07_HOME_ACTION:f.homeActivity.action});
        if(f.optionalActivity) Object.assign(fields,{P07_OPTIONAL_LABEL:f.optionalActivity.label,P07_OPTIONAL_ACTION:f.optionalActivity.action});
        break; }
      case 'outro': { const f=page.fields; Object.assign(fields,{P08_BRAND_NAME:f.brandName,P08_PARENT_BRAND:f.parentBrand,P08_BRAND_LINE:f.brandLine,P08_CTA:f.cta,P08_HANDLE:f.handle});break; }
    }
  }
  if(byType.size!==8 || copy.pages.some((p,i)=>p.id!==CANVA_PAGE_IDS[i] || p.type!==CANVA_PAGE_IDS[i])) throw new Error('표지부터 닫는 표지까지 8장 순서가 맞지 않습니다.');
  if(Object.values(fields).some(v=>typeof v!=='string')) throw new Error('Canva로 보낼 문구가 빠졌습니다.');
  if(options.dataset) {
    const errors=canvaDisplaySupportErrors(copy,options.dataset);
    if(errors.length) throw new Error('현재 표시 문구를 Canva에 반영할 수 없습니다. '+errors.join(' '));
    for(const [name,value] of Object.entries(canvaDisplayTextFields(copy,options))) if(options.dataset[name]?.type==='text') fields[name]=value.text;
  }
  return Object.fromEntries(Object.entries(fields).map(([k,text])=>[k,{type:'text' as const,text}]));
}

export type CanvaMasterDto = { id:number; conceptMode:string; hasExternalActivity:boolean; templateVersion:string; sourceType:string; sourceId:string; status:string; editUrl:string|null; validatedAt:string };
export type CanvaJobDto = { id:number; requestId:string; purpose:string; status:string; phase:string; sourceRevisionId:number; sourceVersion:number; designId:string|null; exportJobId:string|null; editUrl:string|null; outputAssetId:number|null; outputRevisionId:number|null; errorCode:string|null; errorMessage:string|null; result:Record<string,unknown>|null; createdAt:string; recoveryToken?:string|null };
