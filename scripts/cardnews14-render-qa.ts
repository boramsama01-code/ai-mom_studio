/** Offline fixture render only. No AI request, Canva mutation, or publication.
 * Replays all 112 supplied sample pages through the same layout, fonts, image
 * preparation, and rasterizer as Studio. These are local previews, not Canva
 * exports or proof of Canva's text wrapping. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {READING_CARD_PROFILES,readingProfileDesigns,type ReadingImageBox} from '../shared/readingCardProfiles';
import {defaultPageDesigns} from '../shared/familyDialogue';
import {layoutReadingProfilePage,rasterizeReadingCardSvg} from '../server/services/readingCard';
import {prepareReadingArtwork} from '../server/services/readingCardImages';

const root=process.cwd(),output=path.resolve(root,process.argv[2]??'test-results/cardnews14-render');
await fs.mkdir(output,{recursive:true});
const sourceRoot=path.join(root,'assets/cardnews14/layouts');
type SourceElement={kind:'text'|'rect'|'image';field?:string;copy?:string;asset?:string;position?:string};
type SourceLayout={id:string;pages:Array<{page:number;elements:SourceElement[]}>};
const sources:SourceLayout[]=await Promise.all((await fs.readdir(sourceRoot)).map(async folder=>JSON.parse(await fs.readFile(path.join(sourceRoot,folder,'layout.json'),'utf8'))));
const assets:Record<string,Buffer>={
  A:await fs.readFile(path.join(root,'assets/cardnews14/cinematic-ink-teal-background.jpg')),
  B:await fs.readFile(path.join(root,'assets/cardnews14/monochrome-editorial-background.jpg')),
  C:await fs.readFile(path.join(root,'assets/cardnews14/amber-cream-editorial-background.jpg')),
  logo:await fs.readFile(path.join(root,'assets/branding/allligodang-bw.png')),
};
function position(value='center'):{focalX:number;focalY:number} {
  const parts=value.split(/\s+/);
  const percentage=(part:string|undefined)=>part===undefined||part==='center'?50:Number(part.replace('%',''));
  return {focalX:percentage(parts[0]),focalY:percentage(parts[1])};
}
const checks:Array<{profile:string;page:number;file:string;sha256:string;textFields:number;imageFields:number}>=[],covers:Buffer[]=[];
for(const profile of READING_CARD_PROFILES.filter(candidate=>candidate.sourceStyleId)){
  const source=sources.find(candidate=>candidate.id===profile.sourceStyleId);
  if(!source)throw new Error(`Missing source layout ${profile.id}`);
  const dir=path.join(output,profile.sourceStyleId!);await fs.mkdir(dir,{recursive:true});
  const designs=readingProfileDesigns(profile,defaultPageDesigns()),thumbs:Buffer[]=[];
  for(const page of source.pages){
    const layout=profile.pages[page.page-1],images=new Map<string,string>();
    for(const element of page.elements.filter(candidate=>candidate.kind==='image')){
      const slot=layout.imageBoxes.find(candidate=>candidate.field===element.field) as ReadingImageBox;
      const raw=assets[element.asset??''];if(!slot||!raw)throw new Error(`Missing sample asset ${profile.id}:${element.field}`);
      let bytes:Buffer;
      if(slot.kind==='profile'){
        if(createHash('sha256').update(raw).digest('hex')!==profile.profileImageSha256)throw new Error('Unapproved profile logo');
        bytes=raw;
      }else{
        const current=designs[slot.pageId];
        const design={...current,background:{...current.background,fit:slot.fit??'cover',...position(slot.position)}};
        bytes=await prepareReadingArtwork(raw,design,slot,layout.background);
      }
      images.set(slot.field,`data:image/png;base64,${bytes.toString('base64')}`);
    }
    const values=Object.fromEntries(page.elements.filter(element=>element.kind==='text').map(element=>[element.field!,element.copy??'']));
    const result=layoutReadingProfilePage(profile,page.page,values,{images});
    for(const run of result.textRuns){
      if(run.lines.join('').replace(/\s/gu,'')!==run.text.replace(/\s/gu,''))throw new Error(`Lost text ${profile.id}:${run.field}`);
      if(run.fontSize!==run.size)throw new Error(`Shrunk text ${profile.id}:${run.field}`);
    }
    const bytes=await rasterizeReadingCardSvg(result.svg);
    const metadata=await sharp(bytes).metadata();
    if(metadata.width!==1080||metadata.height!==1350||metadata.channels!==3)throw new Error(`Wrong output size ${profile.id}:${page.page}`);
    const file=`${profile.sourceStyleId}/page-${page.page}.jpg`;await fs.writeFile(path.join(output,file),bytes);
    const thumb=await sharp(bytes).resize(270,338,{fit:'fill'}).png().toBuffer();thumbs.push(thumb);
    if(page.page===1)covers.push(thumb);
    checks.push({profile:profile.id,page:page.page,file,sha256:createHash('sha256').update(bytes).digest('hex'),textFields:result.textRuns.length,imageFields:images.size});
  }
  await sharp({create:{width:1080,height:676,channels:3,background:'#101417'}}).composite(thumbs.map((input,index)=>({input,left:(index%4)*270,top:Math.floor(index/4)*338}))).png().toFile(path.join(output,`${profile.sourceStyleId}-contact.png`));
  console.log(`${profile.sourceStyleId}: 8 pages, fixed type size, no missing text`);
}
await sharp({create:{width:1890,height:676,channels:3,background:'#101417'}}).composite(covers.map((input,index)=>({input,left:(index%7)*270,top:Math.floor(index/7)*338}))).png().toFile(path.join(output,'14-style-cover-overview.png'));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({kind:'local-render-only',pages:checks.length,textFields:checks.reduce((sum,page)=>sum+page.textFields,0),canvaExternalCalls:0,paidAiCalls:0,checks},null,2)+'\n');
console.log(`Wrote ${checks.length} local page previews to ${output}`);
