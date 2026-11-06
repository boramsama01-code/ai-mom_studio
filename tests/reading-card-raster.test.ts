import {describe,expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {Resvg} from '@resvg/resvg-js';
import {rasterizeReadingSvg,readingRasterState,tryBackgroundImageWork} from '../server/services/readingCardRaster';
import {prepareReadingArtwork,readingArtworkInput} from '../server/services/readingCardImages';
import {defaultPageDesigns} from '../shared/familyDialogue';

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#226655"/></svg>';
describe('bounded reading-card page preparation and native lifetime',()=>{
  it('preserves the existing JPEG recipe and releases its native worker before resolving',async()=>{
    const rendered=new Resvg(svg,{font:{loadSystemFonts:false}}).render();
    const expected=await sharp(rendered.pixels,{raw:{width:rendered.width,height:rendered.height,channels:4}}).flatten({background:'#ffffff'}).toColorspace('srgb').removeAlpha().jpeg({quality:92,chromaSubsampling:'4:4:4'}).toBuffer();
    expect((await rasterizeReadingSvg(()=>svg)).equals(expected)).toBe(true);
    expect(readingRasterState()).toMatchObject({nativeBackend:'worker-thread',activeWorkers:0,pendingPages:0,maxObservedWorkers:1});
  });
  it.each(['cover','rounded contain','monochrome overlay','empty artwork'] as const)('prepares %s inside the same page worker with exact existing JPEG bytes',async kind=>{
    const photo=kind==='empty artwork'?null:await sharp({create:{width:23,height:37,channels:4,background:{r:214,g:67,b:92,alpha:.7}}}).png().toBuffer();
    const design=defaultPageDesigns().cover;
    design.background={...design.background,fit:kind==='rounded contain'?'contain':'cover',focalX:21,focalY:77,brightness:kind==='monochrome overlay'?83:100,overlay:kind==='monochrome overlay'?24:0};
    const slot={width:64.4,height:63.6,...(kind==='rounded contain'?{radius:32}:{}),...(kind==='monochrome overlay'?{treatment:{tone:'monochrome' as const}}:{})};
    const prepared=await prepareReadingArtwork(photo,design,slot,'#102D49');
    const makeSvg=(dataUrl?:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image width="64" height="64" href="${dataUrl}"/></svg>`;
    const expected=await rasterizeReadingSvg(()=>makeSvg(`data:image/png;base64,${prepared.toString('base64')}`));
    const before=readingRasterState().artworkPagesPrepared;
    const actual=await rasterizeReadingSvg(makeSvg,readingArtworkInput(photo,design,slot,'#102D49'));
    expect(actual.equals(expected)).toBe(true);
    expect(readingRasterState()).toMatchObject({activeWorkers:0,pendingPages:0,maxObservedWorkers:1,artworkPreparation:'page-worker',artworkPagesPrepared:before+1});
    // The JPEG stays valid after isolate termination and subsequent native work.
    await rasterizeReadingSvg(()=>svg);expect(actual.equals(expected)).toBe(true);
  });
  it('rejects a fifth page before its preparation and runs admitted pages with one native worker',async()=>{
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const first=rasterizeReadingSvg(async()=>{await gate;return svg;});
    const others=Array.from({length:3},()=>rasterizeReadingSvg(()=>svg));
    const rejectedPreparation=vi.fn(()=>svg);
    await expect(rasterizeReadingSvg(rejectedPreparation)).rejects.toMatchObject({status:503});
    expect(rejectedPreparation).not.toHaveBeenCalled();
    release();
    for(const bytes of await Promise.all([first,...others]))expect(await sharp(bytes).metadata()).toMatchObject({width:2,height:2,format:'jpeg',channels:3});
    expect(readingRasterState()).toMatchObject({pendingPages:0,activeWorkers:0,maxObservedWorkers:1});
  });

  it('releases admission after preparation or native SVG failure so retry can produce a result',async()=>{
    await expect(rasterizeReadingSvg(()=>{throw new Error('local source unavailable');})).rejects.toThrow('local source unavailable');
    await expect(rasterizeReadingSvg(()=>'<svg invalid')).rejects.toThrow();
    expect(readingRasterState()).toMatchObject({pendingPages:0,activeWorkers:0});
    expect((await rasterizeReadingSvg(()=>svg)).byteLength).toBeGreaterThan(0);
    expect(readingRasterState()).toMatchObject({pendingPages:0,activeWorkers:0});
  });

  it('counts preparation and queue time in the page deadline instead of granting another thirty seconds',async()=>{
    const realNow=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(realNow);
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const first=rasterizeReadingSvg(async()=>{await gate;return svg;});
    const queuedPreparation=vi.fn(()=>svg),queued=rasterizeReadingSvg(queuedPreparation);
    const results=Promise.allSettled([first,queued]);
    try{
      await Promise.resolve();clock.mockReturnValue(realNow+30_001);release();
      expect((await results).map(result=>result.status)).toEqual(['rejected','rejected']);
      expect(queuedPreparation).not.toHaveBeenCalled();
      expect(readingRasterState()).toMatchObject({pendingPages:0,activeWorkers:0});
    }finally{clock.mockRestore();}
  });

  it('defers background image work before fetching when a foreground page is queued',async()=>{
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    const foreground=rasterizeReadingSvg(async()=>{await wait;return svg;});
    const download=vi.fn(async()=>Buffer.from('cache'));
    try{expect(await tryBackgroundImageWork(download)).toEqual({accepted:false});expect(download).not.toHaveBeenCalled();}
    finally{release();await foreground;}
    expect(readingRasterState()).toMatchObject({activeBackgroundWork:0,pendingPages:0,maxObservedHeavyWork:1});
  });

  it('holds the shared slot before background allocation so a newly arriving foreground page waits',async()=>{
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    const background=tryBackgroundImageWork(async()=>{await wait;return 'small cached image';});
    const prepare=vi.fn(()=>svg),foreground=rasterizeReadingSvg(prepare);
    try{
      await Promise.resolve();expect(prepare).not.toHaveBeenCalled();
      expect(readingRasterState()).toMatchObject({activeBackgroundWork:1,activeWorkers:0,pendingPages:1});
      const otherDownload=vi.fn(async()=>undefined);expect(await tryBackgroundImageWork(otherDownload)).toEqual({accepted:false});expect(otherDownload).not.toHaveBeenCalled();
    }finally{release();}
    expect(await background).toEqual({accepted:true,value:'small cached image'});expect((await foreground).byteLength).toBeGreaterThan(0);
    expect(readingRasterState()).toMatchObject({activeBackgroundWork:0,activeWorkers:0,pendingPages:0,maxObservedHeavyWork:1});
  });

  it('releases the shared slot after a failed background download',async()=>{
    await expect(tryBackgroundImageWork(async()=>{throw new Error('preview deadline');})).rejects.toThrow('preview deadline');
    expect((await rasterizeReadingSvg(()=>svg)).byteLength).toBeGreaterThan(0);
    expect(readingRasterState()).toMatchObject({activeBackgroundWork:0,activeWorkers:0,pendingPages:0,maxObservedHeavyWork:1});
  });
});
