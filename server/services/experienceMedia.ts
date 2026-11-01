import { and, eq, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import type { DB } from "../db";
import { studioCards, studioMedia, studioRevisions } from "../../shared/schema";
import { EXPERIENCE_IMAGE_BYTES, EXPERIENCE_VIDEO_BYTES, EXPERIENCE_TOTAL_BYTES, EXPERIENCE_MAX_FILES, type Experience, type ExperienceMedia } from "../../shared/experience";
import { studioContentSchema } from "../../shared/studio";
import { assertStudioActive, loadStudioCard, studioCardDto } from "./studio";
import { normalizeStudioImage } from "./studioImageImport";
import { conflict, HttpError } from "../routes/util";
import { audit } from "../audit";

export async function validateExperienceMedia(db: DB, cardId: number, e?: Experience | null) {
  if (!e) return;
  const ids = [...new Set([...e.media.map(m=>m.id), ...(e.coverId ? [e.coverId] : []), ...e.pages.flatMap(p=>p.mediaId ? [p.mediaId] : [])])];
  if (!ids.length) return;
  const owned = await db.select({id:studioMedia.id}).from(studioMedia).where(and(eq(studioMedia.cardId,cardId),inArray(studioMedia.id,ids)));
  if (owned.length !== ids.length) throw new HttpError(400,"이 작업에 올린 사진·영상만 사용할 수 있습니다.");
}
export async function listExperienceMedia(db: DB, cardId: number): Promise<ExperienceMedia[]> {
  await loadStudioCard(db,cardId);
  const rows = await db.select({id:studioMedia.id,cardId:studioMedia.cardId,name:studioMedia.name,kind:studioMedia.kind,mimeType:studioMedia.mimeType,
    size:sql<number>`octet_length(${studioMedia.bytes})`,hasPreview:sql<boolean>`${studioMedia.preview} is not null`,frameTime:studioMedia.frameTime,createdAt:studioMedia.createdAt})
    .from(studioMedia).where(eq(studioMedia.cardId,cardId)).orderBy(studioMedia.id);
  return rows.map(r=>({...r,kind:r.kind as "photo"|"video",frameTime:r.frameTime === null ? null : r.frameTime/1000,createdAt:r.createdAt.toISOString()}));
}
export function videoMime(bytes: Buffer): string | null {
  if (bytes.length < 16) return null;
  if (bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) return "video/webm";
  if (bytes.toString("ascii",4,8) !== "ftyp") return null;
  const brand=bytes.toString("ascii",8,12);
  return brand === "qt  " ? "video/quicktime" : /^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|3gp[456])$/.test(brand) ? "video/mp4" : null;
}
export async function experiencePreview(bytes: Buffer) {
  const png=await normalizeStudioImage(bytes);
  return sharp(png).resize({width:1600,height:1600,fit:"inside",withoutEnlargement:true}).jpeg({quality:88}).toBuffer();
}
export async function uploadExperienceMedia(db:DB, cardId:number, version:number, bytes:Buffer, name:string, actor:string) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new HttpError(400,"사진이나 영상을 선택해 주세요.");
  const mime=videoMime(bytes); const kind=mime ? "video" : "photo";
  if(bytes.length>(mime?EXPERIENCE_VIDEO_BYTES:EXPERIENCE_IMAGE_BYTES)) throw new HttpError(413,"사진은 12MB, 영상은 25MB 이하로 올려 주세요.");
  const preview=mime ? null : await experiencePreview(bytes);
  const stored=preview ?? bytes;
  return db.transaction(async tx=>{
    const current=await loadStudioCard(tx as unknown as DB,cardId,true); assertStudioActive(current);
    if(current.version!==version) conflict(studioCardDto(current));
    const content=studioContentSchema.parse(current.content);
    if(!content.experience) throw new HttpError(400,"사진·영상 후기 작업에서 자료를 올려 주세요.");
    const [usage]=await tx.select({count:sql<number>`count(*)::int`,bytes:sql<number>`coalesce(sum(octet_length(${studioMedia.bytes}) + coalesce(octet_length(${studioMedia.preview}),0)),0)::bigint`}).from(studioMedia).where(eq(studioMedia.cardId,cardId));
    if(usage.count>=EXPERIENCE_MAX_FILES) throw new HttpError(400,`한 작업에 최대 ${EXPERIENCE_MAX_FILES}개를 올릴 수 있습니다. 다른 후기 작업으로 나눠 주세요.`);
    if(Number(usage.bytes)+stored.length+(preview?.length??0)>EXPERIENCE_TOTAL_BYTES) throw new HttpError(413,"이 작업의 자료 저장 한도 100MB를 넘었습니다. 다른 작업으로 나눠 주세요.");
    const [media]=await tx.insert(studioMedia).values({cardId,name:name.replace(/[\u0000-\u001f/\\]/g,"_").slice(0,180)||"촬영 자료",kind,mimeType:mime??"image/jpeg",bytes:stored,preview}).returning({id:studioMedia.id});
    const updated={...content,experience:{...content.experience,media:[...content.experience.media,{id:media.id,note:""}],coverId:content.experience.coverId??media.id}};
    const [saved]=await tx.update(studioCards).set({content:updated,version:version+1,updatedAt:new Date()}).where(eq(studioCards.id,cardId)).returning();
    await tx.insert(studioRevisions).values({cardId,version:saved.version,snapshot:updated,instruction:`${kind==="video"?"영상":"사진"} 자료 추가`});
    await audit(tx,{actor,action:"upload",entity:"studio_card",entityId:cardId,detail:{mediaId:media.id,kind}});
    return {card:studioCardDto(saved),mediaId:media.id};
  });
}
export async function saveVideoPreview(db:DB, cardId:number, mediaId:number, version:number, bytes:Buffer, seconds:number, actor:string) {
  const preview=await experiencePreview(bytes);
  return db.transaction(async tx=>{
    const current=await loadStudioCard(tx as unknown as DB,cardId,true);assertStudioActive(current);
    if(current.version!==version) conflict(studioCardDto(current));
    const [media]=await tx.select({id:studioMedia.id}).from(studioMedia).where(and(eq(studioMedia.id,mediaId),eq(studioMedia.cardId,cardId),eq(studioMedia.kind,"video")));
    if(!media) throw new HttpError(404,"이 작업의 영상을 찾을 수 없습니다.");
    // Immutable media revision: prior exports and version restores retain their original video frame.
    const [original]=await tx.select().from(studioMedia).where(eq(studioMedia.id,mediaId));
    if(original.preview) throw new HttpError(409,"대표 장면은 이미 저장되어 있습니다. 새 영상으로 올리면 다른 장면을 사용할 수 있습니다.");
    await tx.update(studioMedia).set({preview,frameTime:Math.round(seconds*1000)}).where(eq(studioMedia.id,mediaId));
    const [saved]=await tx.update(studioCards).set({version:version+1,updatedAt:new Date()}).where(eq(studioCards.id,cardId)).returning();
    await tx.insert(studioRevisions).values({cardId,version:saved.version,snapshot:saved.content,instruction:"영상 대표 장면 저장"});
    await audit(tx,{actor,action:"update",entity:"studio_card",entityId:cardId,detail:{mediaId,source:"video-frame"}});
    return studioCardDto(saved);
  });
}
export function mediaRange(value:string|undefined,length:number): {start:number;end:number}|null {
  if(!value) return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!match||(!match[1]&&!match[2])) throw new HttpError(416,"지원하지 않는 영상 범위입니다.");
  const start=match[1]?Number(match[1]):Math.max(0,length-Number(match[2]));
  const end=match[1]?(match[2]?Math.min(Number(match[2]),length-1):length-1):length-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=length||end<start) throw new HttpError(416,"영상 범위를 확인하세요.");
  return {start,end};
}
