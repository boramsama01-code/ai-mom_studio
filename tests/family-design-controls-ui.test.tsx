// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FamilyDesignPicker, FamilyPageLayout } from "../client/src/FamilyDesignControls";
import { FAMILY_PAGE_IDS } from "../shared/familyDialogue";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
describe('whole-deck current design selection',()=>{
 it('keeps eight distinct page role diagrams without manuscript or artwork',async()=>{
  await act(async()=>root.render(createElement('div',{},...FAMILY_PAGE_IDS.map(pageId=>createElement(FamilyPageLayout,{pageId,key:pageId})))));
  const diagrams=[...host.querySelectorAll('svg.family-page-layout')];expect(diagrams).toHaveLength(8);expect(new Set(diagrams.map(diagram=>diagram.innerHTML)).size).toBe(8);expect(host.querySelector('img,image,text')).toBeNull();
 });
 it('offers only the six current designs while retaining an old draft as the current display',async()=>{
  const changed=vi.fn();await act(async()=>root.render(createElement(FamilyDesignPicker,{templateKey:'set:n03',disabled:false,onChange:changed})));
  const details=host.querySelector('details')!,select=host.querySelector('select')!;
  expect(details.open).toBe(false);expect(details.querySelector('summary')?.textContent).toContain('이전 디자인 · 원고 보관 중');
  expect([...select.options].filter(option=>!option.disabled).map(option=>option.value)).toEqual(['editorial:red','editorial:mint','editorial:purple','editorial:blue','editorial:yellow','editorial:cyan']);
  expect(host.querySelectorAll('.highscoop-kit-card')).toHaveLength(6);expect(host.textContent).not.toContain('포토 디스패치');expect(host.textContent).not.toContain('BANG BANG');expect(changed).not.toHaveBeenCalled();
 });
 it('uses the same current key for the selector and thumbnail',async()=>{
  const changed=vi.fn();function Picker(){const [templateKey,setKey]=useState('editorial:red');return createElement(FamilyDesignPicker,{templateKey,disabled:false,onChange:key=>{changed(key);setKey(key);}});}
  await act(async()=>root.render(createElement(Picker)));
  const thumbnail=host.querySelector<HTMLButtonElement>('[aria-label="여행 마스터 선택"]')!;await act(async()=>thumbnail.click());
  expect(changed.mock.calls).toEqual([['editorial:yellow']]);expect(host.querySelector('select')?.value).toBe('editorial:yellow');expect(thumbnail.getAttribute('aria-pressed')).toBe('true');
  const select=host.querySelector('select')!;await act(async()=>{select.value='editorial:mint';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(changed.mock.lastCall).toEqual(['editorial:mint']);expect(host.querySelector('summary')?.textContent).toContain('사회');
 });
 it('blocks changes while busy but leaves the disclosure usable',async()=>{
  const changed=vi.fn();await act(async()=>root.render(createElement(FamilyDesignPicker,{templateKey:'editorial:red',disabled:true,onChange:changed})));
  expect(host.querySelector('select')?.disabled).toBe(true);const buttons=[...host.querySelectorAll<HTMLButtonElement>('.highscoop-kit-card button')];expect(buttons.every(button=>button.disabled)).toBe(true);await act(async()=>buttons[0].click());expect(changed).not.toHaveBeenCalled();
 });
});