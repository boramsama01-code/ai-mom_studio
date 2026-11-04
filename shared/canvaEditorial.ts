/** Flat Canva fields are a boundary adapter, never the authoring schema. */
import type { CardCopyV2, FamilyPageId } from './familyDialogue';
import { familyDisplayDescriptors, familyReadingTextValues, resolveFamilyDisplay, type FamilyDisplayContext } from './familyDisplay';
import { LEGACY_READING_PROFILE_IDS, readingProfileForTemplateKey, type ReadingCardProfile } from './readingCardProfiles';

export const CANVA_MAPPING_VERSION = 'family-dialogue-8/v1.1';
export const CANVA_PAGE_IDS = ['cover','news_summary','implication','discussion','perspectives','concept','activity','outro'] as const;
export const CANVA_APPROVED_PARENT_LOGO = 'brand:space-penguin-company:20261101';
export type CanvaConceptMode = 'value_definition' | 'scientific_explanation';
export type CanvaField = { type:'text'; text:string } | { type:'image'; asset_id:string };
export type CanvaDataset = Record<string, { type:string }>;
export type CanvaVariant = { conceptMode:CanvaConceptMode; hasExternalActivity:boolean };

const commonText = ['P01_HEADLINE','P01_SUBTITLE','P02_TITLE','P02_FACTS','P02_CAVEAT','P03_TITLE','P03_TAKEAWAY','P04_TITLE','P04_SCENARIO','P04_QUESTION','P05_TITLE','P05_A_LABEL','P05_A_BODY','P05_B_LABEL','P05_B_BODY','P06_TITLE','P06_CONCEPT','P06_FILL_IN','P07_TITLE','P07_HOME_LABEL','P07_HOME_ACTION','P08_BRAND_NAME','P08_PARENT_BRAND','P08_BRAND_LINE','P08_CTA','P08_HANDLE'];
const commonImages = ['P01_IMAGE','P02_BACKGROUND','P03_BACKGROUND','P04_BACKGROUND','P05_BACKGROUND','P06_BACKGROUND','P07_BACKGROUND','P08_LOGO'];

/** The reading profiles have their own native Canva contract. These labels do
 * not imply that a design has been created, bound or validated in Canva. */
export const CANVA_READING_TEXT_FIELDS = [
  'P01_TOPIC_TAG','P01_HEADLINE','P01_SUBTITLE','P01_IMAGE_CREDIT','P01_PAGE_NUMBER',
  'P02_KICKER','P02_TITLE','P02_READING_BODY','P02_SOURCE','P02_PAGE_NUMBER',
  'P03_KICKER','P03_READING_BODY','P03_SOURCE','P03_PAGE_NUMBER',
  'P04_KICKER','P04_SCENARIO','P04_QUESTION','P04_IMAGE_CREDIT','P04_PAGE_NUMBER',
  'P05_KICKER','P05_VIEW_A_LABEL','P05_VIEW_A_BODY','P05_VIEW_B_LABEL','P05_VIEW_B_BODY','P05_PAGE_NUMBER',
  'P06_KICKER','P06_CONCEPT','P06_DEFINITION_INDEX_A','P06_DEFINITION_A','P06_DEFINITION_INDEX_B','P06_DEFINITION_B','P06_BOUNDARY_CASE','P06_FILL_IN','P06_PAGE_NUMBER',
  'P07_KICKER','P07_DURATION','P07_ACTIVITY_LABEL','P07_ACTIVITY_ACTIONS','P07_ACTIVITY_HELP','P07_IMAGE_CREDIT','P07_PAGE_NUMBER',
  'P08_PARENT_BRAND','P08_BRAND_LINE','P08_CTA','P08_HANDLE','P08_PAGE_NUMBER',
] as const;

export type CanvaProfileSnapshot = {
  mappingVersion: string; profileId?: string; profileTemplateVersion?: string; profileImageSha256?: string;
  sourceLayoutSha256?: string; sourceAssetsSha256?: string;
};
export function snapshotCanvaProfile(profile?: ReadingCardProfile): CanvaProfileSnapshot {
  return profile ? {
    mappingVersion: profile.mappingVersion, profileId: profile.id,
    profileTemplateVersion: profile.templateVersion, profileImageSha256: profile.profileImageSha256,
    ...(profile.sourceLayoutSha256 !== undefined ? { sourceLayoutSha256: profile.sourceLayoutSha256 } : {}),
    ...(profile.sourceAssetsSha256 !== undefined ? { sourceAssetsSha256: profile.sourceAssetsSha256 } : {}),
  } : { mappingVersion: CANVA_MAPPING_VERSION };
}
/** Import/reconciliation retains the original renderer binding. It must never
 * select a new profile from the current editor or the latest master catalog. */
export function storedCanvaProfileSnapshot(input: CanvaProfileSnapshot): CanvaProfileSnapshot {
  return {
    mappingVersion: input.mappingVersion,
    ...(input.profileId !== undefined ? { profileId: input.profileId } : {}),
    ...(input.profileTemplateVersion !== undefined ? { profileTemplateVersion: input.profileTemplateVersion } : {}),
    ...(input.profileImageSha256 !== undefined ? { profileImageSha256: input.profileImageSha256 } : {}),
    ...(input.sourceLayoutSha256 !== undefined ? { sourceLayoutSha256: input.sourceLayoutSha256 } : {}),
    ...(input.sourceAssetsSha256 !== undefined ? { sourceAssetsSha256: input.sourceAssetsSha256 } : {}),
  };
}
/** Jobs created before profiles existed are legacy jobs. New handoff profiles
 * pin both source files and the asset set before any upload/Autofill. Completed
 * exports use their own immutable trace and do not resolve the live catalog. */
export function resolveCanvaProfile(input: CanvaProfileSnapshot): ReadingCardProfile | undefined {
  if (input.profileId === undefined) return undefined;
  const profile = readingProfileForTemplateKey(input.profileId);
  if (!profile || profile.id !== input.profileId || profile.mappingVersion !== input.mappingVersion
      || profile.templateVersion !== input.profileTemplateVersion || profile.profileImageSha256 !== input.profileImageSha256) {
    throw new Error('이 Canva 작업에 저장된 읽기 디자인·매핑·프로필 이미지 버전을 확인할 수 없습니다. 기존 결과를 유지했습니다.');
  }
  const legacy = LEGACY_READING_PROFILE_IDS.some(id => id === profile.id);
  const hasStoredFingerprint = input.sourceLayoutSha256 !== undefined || input.sourceAssetsSha256 !== undefined;
  if (!legacy || hasStoredFingerprint) {
    const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    if (!validHash(input.sourceLayoutSha256) || !validHash(input.sourceAssetsSha256)
        || !validHash(profile.sourceLayoutSha256) || !validHash(profile.sourceAssetsSha256)
        || input.sourceLayoutSha256 !== profile.sourceLayoutSha256 || input.sourceAssetsSha256 !== profile.sourceAssetsSha256) {
      throw new Error('이 Canva 작업에 저장된 원본 배치·자산 버전이 현재 읽기 디자인과 다릅니다. 기존 원고와 결과를 유지했습니다.');
    }
  }
  return profile;
}


export function canvaVariant(copy:CardCopyV2):CanvaVariant {
  const concept=copy.pages.find(p=>p.type==='concept')!;
  const activity=copy.pages.find(p=>p.type==='activity')!;
  if (!concept || !activity || !['value_definition','scientific_explanation'].includes(concept.fields.mode)) throw new Error('6장 개념 구조를 확인해 주세요.');
  return { conceptMode:concept.fields.mode, hasExternalActivity:activity.fields.optionalActivity !== null };
}

export function expectedCanvaDataset(variant:CanvaVariant,profile?:ReadingCardProfile):CanvaDataset {
  if(profile) return Object.fromEntries([
    ...CANVA_READING_TEXT_FIELDS.map(name=>[name,{type:'text'}]),
    ...profile.images.map(slot=>[slot.field,{type:'image'}]),
  ]);
  const text=[...commonText,...(variant.conceptMode==='value_definition' ? ['P06_DEFINITION_A','P06_DEFINITION_B','P06_BOUNDARY_CASE'] : ['P06_ACCEPTED_DEFINITION','P06_EXAMPLE_OR_NON_EXAMPLE']),...(variant.hasExternalActivity ? ['P07_OPTIONAL_LABEL','P07_OPTIONAL_ACTION'] : [])];
  return Object.fromEntries([...text.map(k=>[k,{type:'text'}]),...commonImages.map(k=>[k,{type:'image'}])]);
}

/** Unknown supplied labels are silently skipped by Canva, so check every field before POST. */
export function validateCanvaDataset(dataset:CanvaDataset,variant:CanvaVariant,profile?:ReadingCardProfile) {
  const required=expectedCanvaDataset(variant,profile), errors:string[]=[];
  for(const [name,expected] of Object.entries(required)) {
    if(!dataset[name]) errors.push(`${name}: 필드 없음`);
    else if(dataset[name].type!==expected.type) errors.push(`${name}: ${expected.type} 형식 필요`);
  }
  if(profile) {
    for(const name of Object.keys(dataset)) if(!required[name]) errors.push(name+': 선택한 읽기 디자인에 없는 필드');
    return errors;
  }
  const forbidden=variant.conceptMode==='value_definition' ? ['P06_ACCEPTED_DEFINITION','P06_EXAMPLE_OR_NON_EXAMPLE'] : ['P06_DEFINITION_A','P06_DEFINITION_B','P06_BOUNDARY_CASE'];
  if(!variant.hasExternalActivity) forbidden.push('P07_OPTIONAL_LABEL','P07_OPTIONAL_ACTION');
  for(const name of forbidden) if(dataset[name]) errors.push(`${name}: 선택한 변형에 있으면 안 되는 필드`);
  for(const [name,field] of Object.entries(dataset)) {
    if(/^P0[1-8]_(HEADER_BRAND|PAGE_NUMBER|TOPIC_TAG|KICKER|SOURCE|IMAGE_CREDIT|FACT_INDEX_[1-3]|DEFINITION_INDEX_[AB]|DURATION|ACTIVITY_HELP)$/.test(name) && field.type!=='text') errors.push(name+': text 형식 필요');
  }
  return errors;
}

export type CanvaTextOptions = { context?: FamilyDisplayContext; pageContexts?: Partial<Record<FamilyPageId, FamilyDisplayContext>>; dataset?: CanvaDataset; requireDisplayFields?: boolean; profile?: ReadingCardProfile };
export function canvaDisplayTextFields(copy:CardCopyV2,options:CanvaTextOptions={}):Record<string,{type:'text';text:string}> {
  const fields:Record<string,{type:'text';text:string}>={};
  for(const page of copy.pages) {
    const display=resolveFamilyDisplay(page,{...options.context,...options.pageContexts?.[page.id]});
    for(const descriptor of familyDisplayDescriptors(page)) fields[descriptor.canvaField]={type:'text',text:display[descriptor.key]};
  }
  return fields;
}
/** Never silently export a template's old static label after the user edits it. */
export function canvaDisplaySupportErrors(copy:CardCopyV2,dataset:CanvaDataset,requireDefaults=false,profile?:ReadingCardProfile):string[] {
  const errors:string[]=[];
  const readingFields=new Set<string>(CANVA_READING_TEXT_FIELDS);
  for(const page of copy.pages) for(const descriptor of familyDisplayDescriptors(page)) {
    const overridden=Object.hasOwn(page.displayOverrides??{},descriptor.key);
    if(profile && !readingFields.has(descriptor.canvaField)) {
      // A deliberately absent label does not need a fake blank text element.
      // An explicit nonempty edit cannot silently disappear in the new layout.
      if(overridden && page.displayOverrides?.[descriptor.key] !== '') errors.push(page.page+'페이지 '+descriptor.label+': 이 읽기 디자인에 표시 칸이 없습니다. 문구를 기본값으로 되돌리거나 표시 가능한 디자인을 선택해 주세요.');
      continue;
    }
    if((requireDefaults || overridden) && dataset[descriptor.canvaField]?.type!=='text') errors.push(page.page+'페이지 '+descriptor.label+' ('+descriptor.canvaField+'): 편집 가능한 텍스트 필드가 필요합니다.');
  }
  return errors;
}
/** Only a prepared 46-text contract. Runtime registration must still validate the
 * actual profile, every image slot and the live Canva dataset. */
export function canvaReadingTextFields(copy:CardCopyV2,options:CanvaTextOptions={}):Record<string,{type:'text';text:string}> {
  if(options.dataset && options.profile) {
    const errors=[...validateCanvaDataset(options.dataset,canvaVariant(copy),options.profile),...canvaDisplaySupportErrors(copy,options.dataset,options.requireDisplayFields,options.profile)];
    if(errors.length) throw new Error('현재 읽기 디자인에 문구를 반영할 수 없습니다. '+errors.join(' '));
  }
  return Object.fromEntries(Object.entries(familyReadingTextValues(copy,options.context,options.pageContexts)).map(([key,text])=>[key,{type:'text' as const,text}]));
}

export function canvaTextFields(copy:CardCopyV2,options:CanvaTextOptions={}):Record<string,{type:'text';text:string}> {
  const byType=new Map(copy.pages.map(p=>[p.type,p]));
  if(options.profile) {
    if(byType.size!==8 || copy.pages.some((p,i)=>p.id!==CANVA_PAGE_IDS[i] || p.type!==CANVA_PAGE_IDS[i])) throw new Error('표지부터 닫는 표지까지 8장 순서가 맞지 않습니다.');
    return canvaReadingTextFields(copy,options);
  }
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
    const errors=canvaDisplaySupportErrors(copy,options.dataset,options.requireDisplayFields);
    if(errors.length) throw new Error('현재 표시 문구를 Canva에 반영할 수 없습니다. '+errors.join(' '));
    for(const [name,value] of Object.entries(canvaDisplayTextFields(copy,options))) if(options.dataset[name]?.type==='text') fields[name]=value.text;
  }
  return Object.fromEntries(Object.entries(fields).map(([k,text])=>[k,{type:'text' as const,text}]));
}

export type CanvaMasterDto = { id:number; conceptMode:string; hasExternalActivity:boolean; templateVersion:string; sourceType:string; sourceId:string; status:string; editUrl:string|null; validatedAt:string };
export type CanvaJobDto = { id:number; requestId:string; purpose:string; status:string; phase:string; sourceRevisionId:number; sourceVersion:number; designId:string|null; exportJobId:string|null; editUrl:string|null; outputAssetId:number|null; outputRevisionId:number|null; errorCode:string|null; errorMessage:string|null; result:Record<string,unknown>|null; createdAt:string; recoveryToken?:string|null };
