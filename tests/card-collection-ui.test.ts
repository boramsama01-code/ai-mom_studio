// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TemplatePicker } from "../client/src/pages/Design";
import { editorialTemplateCatalogOptions, templateCatalogOptions } from "../shared/templateCatalog";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const current = editorialTemplateCatalogOptions({slug:'news',name:'알리고당'});
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});

describe('current common template browser',()=>{
 it('shows six current masters even if a caller supplies historical choices',async()=>{
  const onChange=vi.fn();
  await act(async()=>root.render(createElement(TemplatePicker,{cid:2,value:'set:n03',items:[...current,...templateCatalogOptions()],onChange,brandName:'알리고당'})));
  expect(host.querySelectorAll('.highscoop-kit-card')).toHaveLength(6);
  expect([...host.querySelectorAll('.highscoop-kit-category')].map(node=>node.textContent)).toEqual(['과학','사회','정치','예술','여행','최신이슈']);
  for(const old of ['포토 디스패치','캠퍼스 에디토리얼','BANG BANG','기존 버전'])expect(host.textContent).not.toContain(old);
  expect(host.textContent).toContain('원고와 이미지는 유지');expect(onChange).not.toHaveBeenCalled();
 });
 it('applies only a selected current key and its variable-page contract',async()=>{
  const changed=vi.fn();
  function Picker(){const [value,setValue]=useState('editorial:red');return createElement(TemplatePicker,{cid:2,value,items:current,onChange:(key,item)=>{changed(key,item);setValue(key);}});}
  await act(async()=>root.render(createElement(Picker)));
  const button=host.querySelector<HTMLButtonElement>('[aria-label="여행 마스터 선택"]')!;
  await act(async()=>button.click());
  expect(changed).toHaveBeenCalledExactlyOnceWith('editorial:yellow',expect.objectContaining({cardCopyVersion:1,pageCountMode:'variable',templateKey:'editorial:yellow'}));
  expect(button.getAttribute('aria-pressed')).toBe('true');
 });
 it('disables all six choices while preserving the current work',async()=>{
  const onChange=vi.fn();await act(async()=>root.render(createElement(TemplatePicker,{cid:2,value:'set:n03',items:current,disabled:true,onChange})));
  const buttons=[...host.querySelectorAll<HTMLButtonElement>('.highscoop-kit-card button')];expect(buttons).toHaveLength(6);expect(buttons.every(button=>button.disabled)).toBe(true);
  await act(async()=>buttons[0].click());expect(onChange).not.toHaveBeenCalled();
 });
 it('requests channel-bound previews for Inbox and Studio rather than the old cover assets',async()=>{
  await act(async()=>root.render(createElement(TemplatePicker,{cid:2,value:'editorial:red',items:current,onChange:vi.fn()})));
  expect(host.querySelector('img')?.getAttribute('src')).toContain('/api/channels/2/templates/preview?size=sm&key=editorial%3Ared&page=0');
  await act(async()=>root.render(createElement(TemplatePicker,{cid:'studio',studioChannel:'news',value:'editorial:red',items:current,onChange:vi.fn()})));
  const src=host.querySelector('img')?.getAttribute('src');expect(src).toContain('/api/studio/design-preview?');expect(src).toContain('&channel=news');
  expect(host.querySelector('img[src^="/cardnews14/"]')).toBeNull();
 });
});