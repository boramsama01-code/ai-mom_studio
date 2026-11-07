// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ api: vi.fn(), path: '/today', navigate: vi.fn(), toast: vi.fn(), save: vi.fn(), discard: vi.fn() }));
vi.mock('react-dom/client', async original => {
  const actual = await original<typeof import('react-dom/client')>();
  return { ...actual, createRoot: (host: Element | Document | DocumentFragment | null) => host ? actual.createRoot(host) : { render() {} } };
});
vi.mock('../client/src/api', async original => ({ ...await original<object>(), api: mocks.api }));
vi.mock('wouter', () => ({ useLocation: () => [mocks.path, mocks.navigate], Route: () => null, Switch: () => null, Redirect: () => null }));
vi.mock('../client/src/toast', () => ({ useToast: () => mocks.toast, ToastProvider: ({ children }: { children: unknown }) => children }));
import { Shell } from '../client/src/main';
import { ChannelProvider, DirtyGuardProvider, useChannel, useDirtyGuard } from '../client/src/state';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const channels = [
  { id: 1, name: '우주펭귄상회', active: true, accentColor: '#287b76' },
  { id: 2, name: 'fryday', active: true, accentColor: '#b47829' },
  { id: 3, name: '보관 채널', active: false, accentColor: '#888888' },
];
let root: Root, host: HTMLDivElement, client: QueryClient;
function EditorProbe() {
  const { selected } = useChannel(), guard = useDirtyGuard();
  const [draft] = useState('저장하지 않은 원고');
  return <>
    <output data-testid="content-channel">{selected}</output><input aria-label="검증 원고" value={draft} readOnly />
    <button onClick={() => guard.setDirty('shell-editor', true, mocks.save, mocks.discard)}>미저장 입력</button>
  </>;
}
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><DirtyGuardProvider><ChannelProvider><Shell /><EditorProbe /></ChannelProvider></DirtyGuardProvider></QueryClientProvider>));
  await flush();
}
function picker() { return host.querySelector<HTMLSelectElement>('[aria-label="보기 채널"]')!; }
function menu() { return host.querySelector<HTMLButtonElement>('[aria-label="메뉴 열기"]')!; }
async function click(name: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === name || value.getAttribute('aria-label') === name)!;
  await act(async () => button.click()); await flush();
}
async function choose(value: string) {
  await act(async () => { picker().focus(); picker().value = value; picker().dispatchEvent(new Event('change', { bubbles: true })); });
  await flush();
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.path = '/today';
  mocks.save.mockResolvedValue(true);
  mocks.navigate.mockImplementation((path: string) => { mocks.path = path; });
  mocks.api.mockImplementation(async (path: string) => {
    if (path === '/auth/me') return { user: 'editor', demo: false, csrf: 'fixture', recoveryScope: 'shell-test' };
    if (path === '/channels') return channels;
    if (path === '/status') return { globalStop: false };
    if (/^\/channels\/\d+\/today$/.test(path)) return { counts: { pendingReview: 0 } };
    throw new Error(`Unexpected shell API: ${path}`);
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external calls in shell tests'); }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['channels'], channels);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it('has one sidebar channel picker and a guarded home brand, with no quick-navigation surface or keyboard entry', async () => {
  await render();
  expect(host.querySelectorAll('[aria-label="보기 채널"]')).toHaveLength(1);
  expect(picker().closest('.sidebar')).not.toBeNull();
  expect(host.querySelector('.workspace-header select')).toBeNull();
  expect([...picker().options].map(option => option.text)).toEqual(['모든 채널', '우주펭귄상회', 'fryday']);
  expect(host.querySelector('.brand-home')?.getAttribute('href')).toBe('/');
  expect(host.querySelector('.palette-trigger, .workspace-search')).toBeNull();
  const key = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
  await act(async () => window.dispatchEvent(key));
  expect(key.defaultPrevented).toBe(false);
  expect(host.querySelector('.palette')).toBeNull();
  expect(mocks.api.mock.calls.some(([path]) => String(path).startsWith('/collection/collect'))).toBe(false);
});

it('changes the real content scope from the drawer, closes it after acceptance and returns focus to its opener', async () => {
  await render(); await click('메뉴 열기');
  expect(menu().getAttribute('aria-expanded')).toBe('true');
  await choose('2');
  expect(picker().value).toBe('2');
  expect(host.querySelector('[data-testid="content-channel"]')?.textContent).toBe('2');
  expect(localStorage.getItem('spacepenguin.channel')).toBe('2');
  expect(menu().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(menu());
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(mocks.api).toHaveBeenCalledWith('/channels/2/today');
});

it('gives the dirty dialog sole focus ownership and preserves the original channel and draft on cancel or failed save', async () => {
  mocks.path = '/studio/11';
  await render(); await click('미저장 입력'); await click('메뉴 열기'); await choose('2');
  expect(menu().getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.sidebar[aria-modal="true"]')).toBeNull();
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('저장하지 않은 변경');
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(picker().value).toBe('all');
  await click('머무르기');
  expect(document.activeElement).toBe(menu());
  expect(picker().value).toBe('all');
  expect(host.querySelector<HTMLInputElement>('[aria-label="검증 원고"]')!.value).toBe('저장하지 않은 원고');
  mocks.save.mockResolvedValueOnce(false);
  await click('메뉴 열기'); await choose('2'); await click('저장하고 이동');
  expect(picker().value).toBe('all');
  expect(localStorage.getItem('spacepenguin.channel')).toBeNull();
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(menu());
});

it('finishes saving before changing a detail editor to the selected channel list', async () => {
  mocks.path = '/studio/11';
  await render(); await click('미저장 입력'); await click('메뉴 열기'); await choose('2');
  expect(mocks.navigate).not.toHaveBeenCalled();
  await click('저장하고 이동');
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(picker().value).toBe('2');
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/');
  expect(menu().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(menu());
});

it('uses the same guarded home link for the logo and name, with cancel preserving and discard explicitly leaving the editor', async () => {
  mocks.path = '/studio/11';
  await render(); await click('미저장 입력'); await click('메뉴 열기');
  const home = host.querySelector<HTMLAnchorElement>('.brand-home')!;
  await act(async () => home.querySelector('img')!.click()); await flush();
  expect(mocks.navigate).not.toHaveBeenCalled();
  await click('머무르기');
  expect(host.querySelector<HTMLInputElement>('[aria-label="검증 원고"]')!.value).toBe('저장하지 않은 원고');
  expect(document.activeElement).toBe(menu());
  await click('메뉴 열기');
  await act(async () => home.querySelector('span')!.click()); await flush();
  await click('버리고 이동');
  expect(mocks.discard).toHaveBeenCalledOnce();
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/');
  expect(menu().getAttribute('aria-expanded')).toBe('false');
});

it('keeps Escape dismissal and focus return for the mobile menu', async () => {
  await render(); await click('메뉴 열기');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await flush();
  expect(menu().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(menu());
});
