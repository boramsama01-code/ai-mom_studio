import { z } from 'zod';
import { familyCardCopySchema } from './familyDialogue';
const text=(max:number)=>z.string().trim().min(1).max(max);
export const familyManualFactBindingSchema=z.object({
  fieldPath:z.enum(['pages.news_summary.fields.facts.0','pages.news_summary.fields.facts.1','pages.news_summary.fields.facts.2','pages.concept.fields.acceptedDefinition']),
  excerpt:text(600),claimType:z.enum(['reported_event','research_finding','attributed_statement','forecast']),
  speaker:text(200).nullable().optional(),timeScope:text(300).nullable().optional(),conditions:z.array(text(400)).max(8).optional(),
}).strict();
const sourceUrl=z.string().url().max(4000).refine(value=>{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;},'HTTP 원문 주소를 입력해 주세요.');
export const familyManualCreateSchema=z.object({
  requestId:z.string().uuid(),title:text(200),copy:familyCardCopySchema,
  source:z.object({title:text(1000),text:text(100_000),url:sourceUrl.optional()}).strict(),
  factBindings:z.array(familyManualFactBindingSchema).min(2).max(4),confirmed:z.literal(true),
}).strict().superRefine((body,ctx)=>{
  if(new Set(body.factBindings.map(binding=>binding.fieldPath)).size!==body.factBindings.length)ctx.addIssue({code:'custom',path:['factBindings'],message:'같은 문구의 근거를 중복 연결할 수 없습니다.'});
});
export const familyManualInitializeSchema=familyManualCreateSchema.safeExtend({version:z.number().int().positive()});
export type FamilyManualCreate=z.infer<typeof familyManualCreateSchema>;
export type FamilyManualInitialize=z.infer<typeof familyManualInitializeSchema>;
export const familyManualReceiptSchema=z.object({requestId:z.string().uuid(),itemId:z.number().int().positive(),studioCardId:z.number().int().positive(),version:z.number().int().positive(),revisionId:z.number().int().positive()}).strict();
export type FamilyManualReceipt=z.infer<typeof familyManualReceiptSchema>;
