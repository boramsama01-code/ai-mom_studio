import type { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {defaultPageDesigns} from '../shared/familyDialogue';

type RasterWorker = EventEmitter & {
  terminate: ReturnType<typeof vi.fn<() => Promise<number>>>;
  postMessage: ReturnType<typeof vi.fn>;
  svg: string;
};
const control = vi.hoisted(() => ({ workers: [] as RasterWorker[], constructorError: null as Error | null }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return { Worker: class extends EventEmitter {
    terminate = vi.fn<() => Promise<number>>().mockResolvedValue(0);
    postMessage = vi.fn();
    svg: string;
    constructor(_url: URL, options: { workerData: { svg: string } }) {
      super();
      const error = control.constructorError;
      control.constructorError = null;
      if (error) throw error;
      this.svg = options.workerData.svg;
      control.workers.push(this);
    }
  } };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
// Observe immediately: a delayed assertion must not introduce an unhandled
// rejection while the preceding worker is being drained.
const observe = <T>(promise: Promise<T>) => promise.then(
  value => ({ ok: true as const, value }),
  error => ({ ok: false as const, error: error as Error & { status?: number } }),
);
const flush = () => vi.advanceTimersByTimeAsync(0);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const succeed = (worker: RasterWorker) => worker.emit('message', { bytes: jpeg });
let rasterize: typeof import('../server/services/readingCardRaster').rasterizeReadingSvg;

// A next request alone proves queue progression but can miss a leaked admission
// counter. All four fresh requests must be usable after a failed page drains.
async function expectAllAdmissionSlotsReusable() {
  const before = control.workers.length;
  const requests = Array.from({ length: 4 }, (_, index) => observe(rasterize(() => `<svg data-recovered="${index}"/>`)));
  await flush();
  for (let index = 0; index < requests.length; index++) {
    expect(control.workers).toHaveLength(before + index + 1);
    succeed(control.workers[before + index]);
    await flush();
  }
  expect((await Promise.all(requests)).every(result => result.ok)).toBe(true);
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
  control.workers = [];
  control.constructorError = null;
  ({ rasterizeReadingSvg: rasterize } = await import('../server/services/readingCardRaster'));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('bounded reading-card preparation and raster worker lifecycle', () => {
  it('keeps artwork and SVG in one admission and returns only after its native owner terminates',async()=>{
    const makeSvg=vi.fn((imageDataUrl?:string)=>`<svg data-image="${imageDataUrl}"/>`);
    const result=observe(rasterize(makeSvg,{bytes:Buffer.from('source'),design:defaultPageDesigns().cover,slot:{width:64,height:64},background:'#102D49'}));
    await flush();expect(control.workers).toHaveLength(1);expect(makeSvg).not.toHaveBeenCalled();
    const worker=control.workers[0],stopped=deferred<number>();worker.terminate.mockReturnValue(stopped.promise);
    worker.emit('message',{imageDataUrl:'data:image/png;base64,AA=='});await flush();
    expect(makeSvg).toHaveBeenCalledWith('data:image/png;base64,AA==');expect(worker.postMessage).toHaveBeenCalledWith({svg:'<svg data-image="data:image/png;base64,AA=="/>'});
    let delivered=false;void result.then(()=>{delivered=true;});succeed(worker);await flush();expect(delivered).toBe(false);
    stopped.resolve(0);await flush();expect((await result).ok).toBe(true);await expectAllAdmissionSlotsReusable();
  });

  it('counts artwork and outline preparation in the same deadline and ignores late outline results',async()=>{
    const prepared=deferred<string>(),makeSvg=vi.fn(()=>prepared.promise);
    const result=observe(rasterize(makeSvg,{bytes:null,design:defaultPageDesigns().cover,slot:{width:64,height:64},background:'#102D49'}));
    await flush();const worker=control.workers[0];worker.emit('message',{imageDataUrl:'data:image/png;base64,AA=='});await flush();
    await vi.advanceTimersByTimeAsync(30_000);expect(await result).toMatchObject({ok:false,error:{status:503}});expect(worker.terminate).toHaveBeenCalledOnce();
    prepared.resolve('<svg data-late="true"/>');await flush();expect(worker.postMessage).not.toHaveBeenCalled();await expectAllAdmissionSlotsReusable();
  });

  it('rejects a full queue before preparing another image or SVG', async () => {
    const preparing = deferred<string>();
    const makers = [vi.fn(() => preparing.promise), ...Array.from({ length: 3 }, (_, index) => vi.fn(() => `<svg data-page="${index + 2}"/>`))];
    const accepted = makers.map(make => observe(rasterize(make)));
    await flush();
    const refusedPreparation = vi.fn(() => '<svg data-page="refused"/>');
    expect(await observe(rasterize(refusedPreparation))).toMatchObject({ ok: false, error: { status: 503 } });
    expect(refusedPreparation).not.toHaveBeenCalled();
    expect(control.workers).toHaveLength(0);
    expect(makers.slice(1).every(make => make.mock.calls.length === 0)).toBe(true);

    preparing.resolve('<svg data-page="1"/>');
    await flush();
    for (let index = 0; index < accepted.length; index++) {
      expect(control.workers).toHaveLength(index + 1);
      succeed(control.workers[index]);
      await flush();
    }
    expect((await Promise.all(accepted)).every(result => result.ok)).toBe(true);
  });

  it.each(['synchronous throw', 'rejected preparation'] as const)('releases admission after %s', async failure => {
    const error = new Error('isolated image preparation failed');
    const failed = observe(rasterize(() => {
      if (failure === 'synchronous throw') throw error;
      return Promise.reject(error);
    }));
    const makeNext = vi.fn(() => '<svg data-page="after-preparation-error"/>');
    const next = observe(rasterize(makeNext));
    await flush();
    expect(await failed).toEqual({ ok: false, error });
    expect(makeNext).toHaveBeenCalledOnce();
    expect(control.workers).toHaveLength(1);
    succeed(control.workers[0]);
    expect(await next).toEqual({ ok: true, value: Buffer.from(jpeg) });
    await expectAllAdmissionSlotsReusable();
  });

  it('releases admission when starting a worker throws', async () => {
    const error = new Error('isolated worker construction failed');
    control.constructorError = error;
    const failed = observe(rasterize(() => '<svg data-page="cannot-start"/>'));
    const makeNext = vi.fn(() => '<svg data-page="after-start-error"/>');
    const next = observe(rasterize(makeNext));
    await flush();
    expect(await failed).toEqual({ ok: false, error });
    expect(makeNext).toHaveBeenCalledOnce();
    expect(control.workers).toHaveLength(1);
    succeed(control.workers[0]);
    expect(await next).toEqual({ ok: true, value: Buffer.from(jpeg) });
    await expectAllAdmissionSlotsReusable();
  });

  it.each(['error event', 'error response', 'exit without result'] as const)('cleans up and serves the next page after a worker %s', async failure => {
    const failed = observe(rasterize(() => '<svg data-page="failed-worker"/>'));
    const next = observe(rasterize(() => '<svg data-page="after-worker-error"/>'));
    await flush();
    const first = control.workers[0];
    if (failure === 'error event') first.emit('error', new Error('isolated worker error'));
    else if (failure === 'error response') first.emit('message', { error: 'isolated worker error' });
    else first.emit('exit', 1);
    await flush();
    expect(await failed).toMatchObject({ ok: false, error: expect.any(Error) });
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(control.workers).toHaveLength(2);
    succeed(control.workers[1]);
    expect(await next).toEqual({ ok: true, value: Buffer.from(jpeg) });
    await expectAllAdmissionSlotsReusable();
  });

  it('does not prepare or start another page until worker termination completes', async () => {
    const stopped = deferred<number>();
    const first = observe(rasterize(() => '<svg data-page="finishing"/>'));
    const makeNext = vi.fn(() => '<svg data-page="next"/>');
    const next = observe(rasterize(makeNext));
    await flush();
    control.workers[0].terminate.mockReturnValue(stopped.promise);
    let delivered = false;
    void first.then(() => { delivered = true; });
    succeed(control.workers[0]);
    await flush();
    expect(delivered).toBe(false);
    expect(makeNext).not.toHaveBeenCalled();
    expect(control.workers).toHaveLength(1);

    stopped.resolve(0);
    await flush();
    expect(await first).toEqual({ ok: true, value: Buffer.from(jpeg) });
    expect(makeNext).toHaveBeenCalledOnce();
    expect(control.workers).toHaveLength(2);
    succeed(control.workers[1]);
    expect(await next).toEqual({ ok: true, value: Buffer.from(jpeg) });
  });

  it('expires a queued page without preparing it and permits a fresh request afterwards', async () => {
    const stopped = deferred<number>();
    const first = observe(rasterize(() => '<svg data-page="draining"/>'));
    const stalePreparation = vi.fn(() => '<svg data-page="expired"/>');
    const expired = observe(rasterize(stalePreparation));
    await flush();
    control.workers[0].terminate.mockReturnValue(stopped.promise);
    succeed(control.workers[0]);
    await vi.advanceTimersByTimeAsync(30_001);
    stopped.resolve(0);
    await flush();
    expect((await first).ok).toBe(true);
    expect(await expired).toMatchObject({ ok: false, error: { status: 503 } });
    expect(stalePreparation).not.toHaveBeenCalled();
    expect(control.workers).toHaveLength(1);

    const fresh = observe(rasterize(() => '<svg data-page="fresh"/>'));
    await flush();
    expect(control.workers).toHaveLength(2);
    succeed(control.workers[1]);
    expect(await fresh).toEqual({ ok: true, value: Buffer.from(jpeg) });
  });

  it('gives rasterization only the deadline left after image and SVG preparation', async () => {
    const preparing = deferred<string>();
    const result = observe(rasterize(() => preparing.promise));
    await flush();
    await vi.advanceTimersByTimeAsync(25_000);
    preparing.resolve('<svg data-page="slow-preparation"/>');
    await flush();
    expect(control.workers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(control.workers[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ ok: false, error: { status: 503 } });
    expect(control.workers[0].terminate).toHaveBeenCalledOnce();
    await expectAllAdmissionSlotsReusable();
  });
});
