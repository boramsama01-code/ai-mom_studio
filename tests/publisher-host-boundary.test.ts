import {beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),dns:vi.fn()}));
vi.mock('undici',()=>({Agent:class{},fetch:mocks.fetch}));
vi.mock('../server/services/url',async original=>({...await original<object>(),assertPublicHttpUrl:async(url:string)=>{mocks.dns(url);return new URL(url);}}));
const {safeFetch}=await import('../server/services/safeFetch');
beforeEach(()=>{mocks.fetch.mockReset();mocks.dns.mockClear();});
it('checks the allowed host before following any redirect',async()=>{
 mocks.fetch.mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://www.google.com/sorry/'}}));
 await expect(safeFetch('https://press.example/',{allowedHosts:['press.example']})).rejects.toMatchObject({kind:'blocked'});
 expect(mocks.fetch).toHaveBeenCalledOnce();expect(mocks.dns).toHaveBeenCalledOnce();
});
it('allows an explicitly allowed publisher hostname, rechecking DNS',async()=>{
 mocks.fetch.mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://www.press.example/news/1'}})).mockResolvedValueOnce(new Response('본문'));
 expect(await safeFetch('https://press.example/',{allowedHosts:['press.example','www.press.example']})).toMatchObject({status:200,finalUrl:'https://www.press.example/news/1'});
 expect(mocks.dns).toHaveBeenCalledTimes(2);
});
it('does not request an unlisted initial host',async()=>{
 await expect(safeFetch('https://news.google.com/',{allowedHosts:['press.example']})).rejects.toMatchObject({kind:'blocked'});
 expect(mocks.fetch).not.toHaveBeenCalled();
});
