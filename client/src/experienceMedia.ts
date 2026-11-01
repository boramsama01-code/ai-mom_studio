import { EXPERIENCE_IMAGE_BYTES, EXPERIENCE_VIDEO_BYTES } from "@shared/experience";
export function validateExperienceFile(file:File) {
 const video=file.type.startsWith("video/")||/\.(mp4|mov|webm)$/i.test(file.name);
 if(!video&&!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)&&!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))throw new Error("JPG·PNG·WEBP 사진, MP4·MOV·WEBM 영상을 선택해 주세요.");
 if(file.size>(video?EXPERIENCE_VIDEO_BYTES:EXPERIENCE_IMAGE_BYTES))throw new Error(`${file.name}: ${video?"영상은 25MB":"사진은 12MB"} 이하로 올려 주세요.`);
 return video;
}
function waitMedia(video:HTMLVideoElement,event:string,action:()=>void){return new Promise<void>((resolve,reject)=>{
 const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,ok);video.removeEventListener("error",fail);};
 const ok=()=>{cleanup();resolve();};const fail=()=>{cleanup();reject(new Error("이 브라우저에서 영상 장면을 읽지 못했습니다. 영상 원본을 저장한 뒤 장면 사진을 따로 올릴 수 있습니다."));};
 const timer=window.setTimeout(fail,15000);video.addEventListener(event,ok,{once:true});video.addEventListener("error",fail,{once:true});action();
});}
export async function videoFrame(file:File):Promise<{file:File;seconds:number}>{
 const video=document.createElement("video"),url=URL.createObjectURL(file);video.muted=true;video.playsInline=true;video.preload="auto";
 try{
  await waitMedia(video,"loadeddata",()=>{video.src=url;video.load();});
  const seconds=Number.isFinite(video.duration)?Math.min(Math.max(video.duration*.1,.01),2,Math.max(video.duration-.01,0)):0;
  if(seconds>0)await waitMedia(video,"seeked",()=>{video.currentTime=seconds;});
  if(!video.videoWidth||!video.videoHeight)throw new Error("영상의 대표 장면을 읽지 못했습니다.");
  const scale=Math.min(1,1600/Math.max(video.videoWidth,video.videoHeight)),canvas=document.createElement("canvas");
  canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
  const ctx=canvas.getContext("2d");if(!ctx)throw new Error("이 브라우저에서 장면을 추출할 수 없습니다.");ctx.drawImage(video,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("장면 저장에 실패했습니다.")),"image/jpeg",.9));
  return {file:new File([blob],"video-frame.jpg",{type:"image/jpeg"}),seconds};
 }finally{video.removeAttribute("src");video.load();URL.revokeObjectURL(url);}
}
export async function compatiblePhoto(file:File):Promise<File>{
 if(!/heic|heif/i.test(file.type+file.name))return file;
 try{const bitmap=await createImageBitmap(file),canvas=document.createElement("canvas");const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
 const ctx=canvas.getContext("2d");if(!ctx)throw new Error();ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error()),"image/jpeg",.9));return new File([blob],file.name.replace(/\.(heic|heif)$/i,".jpg"),{type:"image/jpeg"});
 }catch{throw new Error(`${file.name}: 이 브라우저는 HEIC 변환을 지원하지 않습니다. 사진 앱에서 JPEG로 저장한 뒤 올려 주세요.`);}
}
