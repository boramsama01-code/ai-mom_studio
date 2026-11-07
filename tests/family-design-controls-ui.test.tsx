// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FamilyDesignPicker, FamilyPageLayout } from "../client/src/FamilyDesignControls";
import { FAMILY_PAGE_IDS } from "../shared/familyDialogue";
import { READING_CARD_PROFILES } from "../shared/readingCardProfiles";
import { familyCollectionDesign } from "../shared/familyCollectionDesigns";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("family page roles and whole-deck design selection", () => {
  it("shows only distinct gray role diagrams, without artwork or manuscript content", async () => {
    await act(async () => root.render(createElement("div", {}, ...FAMILY_PAGE_IDS.map(pageId => createElement(FamilyPageLayout, { pageId, key: pageId })))));
    const diagrams = [...host.querySelectorAll('svg.family-page-layout')];
    expect(diagrams).toHaveLength(8);
    expect(new Set(diagrams.map(diagram => diagram.innerHTML)).size).toBe(8);
    expect(diagrams.every(diagram => diagram.getAttribute('aria-hidden') === 'true' && diagram.getAttribute('focusable') === 'false')).toBe(true);
    expect(host.querySelector('img,image,text')).toBeNull();
  });

  it("keeps the current collection palette and all legacy options in one closed design area", async () => {
    const onChange = vi.fn(), key = 'set:n03';
    await act(async () => root.render(createElement(FamilyDesignPicker, { templateKey: key, disabled: false, onChange })));
    const details = host.querySelector('details')!, select = host.querySelector('select')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toContain('전체 8장 디자인');
    expect(details.querySelector('summary')?.textContent).toContain(familyCollectionDesign(key)!.name);
    expect(select.getAttribute('aria-label')).toBe('전체 목록에서 선택');
    expect(select.value).toBe(key);
    expect([...select.options].map(option => option.value)).toEqual(['legacy', key, ...READING_CARD_PROFILES.map(profile => profile.templateKey)]);
    expect(details.textContent).toContain('현재 원고가 아닙니다');
    expect(details.querySelectorAll('.family-design-example')).toHaveLength(14);
    expect([...details.querySelectorAll('img')].every(image => /^\/cardnews14\/.+-cover\.webp$/.test(image.getAttribute('src')!))).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses the same real design value for example clicks and native selection, including classic and legacy profiles", async () => {
    const changes = vi.fn(), target = READING_CARD_PROFILES.find(profile => profile.templateKey === 'cardnews14-cinematic-v1')!;
    function Picker() {
      const [templateKey, setKey] = useState('builtin:classic');
      return createElement(FamilyDesignPicker, { templateKey, disabled: false, onChange: key => { changes(key); setKey(key); } });
    }
    await act(async () => root.render(createElement(Picker)));
    const details = host.querySelector('details')!; await act(async () => { details.open = true; });
    const example = [...host.querySelectorAll<HTMLButtonElement>('.family-design-example')].find(button => button.getAttribute('aria-label') === `디자인 선택 · ${target.label}`)!;
    await act(async () => example.click());
    expect(changes.mock.calls).toEqual([[target.templateKey]]);
    expect(host.querySelector('summary')?.textContent).toContain(target.label);
    expect(host.querySelector('select')?.value).toBe(target.templateKey);
    expect(example.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    const select = host.querySelector('select')!;
    const choose = async (value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); });
    await choose(READING_CARD_PROFILES[0].templateKey);
    expect(changes.mock.lastCall).toEqual([READING_CARD_PROFILES[0].templateKey]);
    expect(host.querySelector('summary')?.textContent).toContain(READING_CARD_PROFILES[0].label);
    expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
    await choose('legacy');
    expect(changes.mock.lastCall).toEqual(['builtin:classic']);
    expect(host.querySelector('summary')?.textContent).toContain('기존 8장 디자인');
  });

  it("prevents design changes while the editor is busy but leaves the disclosure accessible", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(createElement(FamilyDesignPicker, { templateKey: 'builtin:classic', disabled: true, onChange })));
    expect(host.querySelector('select')?.disabled).toBe(true);
    const examples = [...host.querySelectorAll<HTMLButtonElement>('.family-design-example')];
    expect(examples.every(button => button.disabled)).toBe(true);
    await act(async () => examples[0].click());
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('summary')?.getAttribute('tabindex')).not.toBe('-1');
  });
});
