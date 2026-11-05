import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls=vi.hoisted(()=>({validate:vi.fn(),fetch:vi.fn()}));
vi.mock('undici',()=>({Agent:class{},fetch:calls.fetch}));
vi.mock('../server/services/url',async original=>({...await original<object>(),assertPublicHttpUrl:calls.validate}));
const {safeFetch}=await import('../server/services/safeFetch');
const first='https://export-download.canva.com/first.png',second='https://export-download.canva.com/second.png';

beforeEach(()=>{vi.useFakeTimers({now:0});calls.validate.mockReset();calls.fetch.mockReset();calls.fetch.mockRejectedValue(new Error('Unexpected HTTP request'));});
afterEach(()=>{vi.useRealTimers();});

describe('safeFetch includes DNS validation in its overall deadline',()=>{
  it('times out a stalled lookup and never starts HTTP when the late DNS answer arrives',async()=>{
    let finishLookup!:(url:URL)=>void;
    calls.validate.mockImplementation(()=>new Promise<URL>(resolve=>{finishLookup=resolve;}));
    const result=safeFetch(first,{timeoutMs:18_000}).catch(error=>error);
    await vi.advanceTimersByTimeAsync(18_001);
    expect(await result).toMatchObject({kind:'timeout'});expect(calls.fetch).not.toHaveBeenCalled();
    finishLookup(new URL(first));await vi.advanceTimersByTimeAsync(0);
    expect(calls.fetch).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the original deadline across a redirect and its second DNS lookup',async()=>{
    let finishSecond!:(url:URL)=>void;
    calls.validate.mockImplementationOnce(()=>new Promise<URL>(resolve=>setTimeout(()=>resolve(new URL(first)),12_000)))
      .mockImplementationOnce(()=>new Promise<URL>(resolve=>{finishSecond=resolve;}));
    calls.fetch.mockResolvedValueOnce(new Response(null,{status:302,headers:{location:second}}));
    const result=safeFetch(first,{timeoutMs:18_000,allowedHosts:['export-download.canva.com']}).catch(error=>error);
    await vi.advanceTimersByTimeAsync(12_000);expect(calls.fetch).toHaveBeenCalledOnce();expect(calls.validate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(6_001);expect(await result).toMatchObject({kind:'timeout'});
    finishSecond(new URL(second));await vi.advanceTimersByTimeAsync(0);
    expect(calls.fetch).toHaveBeenCalledOnce();expect(calls.fetch.mock.calls[0][0]).toBe(first);expect(vi.getTimerCount()).toBe(0);
  });
});
