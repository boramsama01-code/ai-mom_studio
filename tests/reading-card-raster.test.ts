import {describe,expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {rasterizeReadingSvg,readingRasterState} from '../server/services/readingCardRaster';

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#226655"/></svg>';
describe('bounded reading-card page preparation and native lifetime',()=>{
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
});
