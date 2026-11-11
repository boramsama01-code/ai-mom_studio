import type {NotionStudioDetail,NotionStudioLink} from '@shared/notionStudio';

export const canvaAutoSavePending=(link:NotionStudioLink)=>!!link.canvaAutoSave?.enabled&&['queued','processing'].includes(link.canvaAutoSave.phase);
export const canvaJobPending=(link:NotionStudioLink)=>['importing','exporting'].includes(link.canva.phase)||canvaAutoSavePending(link);
export function canvaWaitingForPhotos(data:Partial<Pick<NotionStudioDetail,'source'|'photos'|'designEdits'>>):boolean{
  if(!data.source||!data.photos)return false;
  return data.source.pages.some((page,index)=>{
    const key=page.key??`page:${index+1}`;
    if(data.designEdits?.templateByPage?.[key]!=='image_text')return false;
    const selected=data.designEdits.photoByPage?.[key];
    return selected===undefined?!data.photos![index]:!data.photos!.some(photo=>photo.id===selected);
  });
}
export function canvaEditUrl(link:NotionStudioLink):string|undefined{
  // A continuation link must open the editable design, never a rendered image.
  try{const url=new URL(link.canva.editUrl??'');return url.protocol==='https:'?url.href:undefined;}catch{return undefined;}
}
export function latestCanvaReady(data:Pick<NotionStudioDetail,'link'|'itemVersion'>):boolean{
  return !!canvaEditUrl(data.link)&&(data.link.canvaAutoSave?data.link.canva.currentSource===true:data.link.canva.currentSource!==false)&&['ready','complete'].includes(data.link.canva.phase)&&!canvaAutoSavePending(data.link);
}
export function canvaAutoSaveMessage(data:Pick<NotionStudioDetail,'link'|'itemVersion'>&Partial<Pick<NotionStudioDetail,'source'|'photos'|'designEdits'>>):string{
  const auto=data.link.canvaAutoSave;
  if(!auto?.enabled)return '캔바 자동 저장이 꺼져 있습니다.';
  if(canvaWaitingForPhotos(data))return '사진 추가 대기 · 초안은 저장됐어요. 사진을 선택하고 저장하면 Canva 제작을 이어갑니다.';
  if(auto.phase==='queued')return '캔바 자동 저장 대기 중';
  if(auto.phase==='processing')return '캔바에 편집 가능한 디자인을 저장하는 중';
  if(auto.phase==='failed')return '스튜디오에는 저장됐지만 캔바 자동 저장을 완료하지 못했습니다.';
  if(auto.phase==='blocked')return '스튜디오에는 저장됐습니다. 캔바 자동 저장 상태를 확인해 주세요.';
  if(latestCanvaReady(data))return '최신 저장본이 캔바에 저장됐습니다.';
  return '저장한 원고와 페이지별 템플릿을 캔바에 자동 저장합니다.';
}
