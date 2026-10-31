// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Modal } from "../client/src/ui";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); document.body.innerHTML = ""; });
it("traps keyboard focus, closes with Escape, and restores the trigger", async () => {
 const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 function Example(){const [open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>열기</button>{open && <Modal title="검증" onClose={()=>setOpen(false)}><input aria-label="제목"/><button>저장</button></Modal>}</>;}
 await act(async()=>root!.render(<Example/>));
 const trigger=host.querySelector('button')!; trigger.focus();
 await act(async()=>trigger.click()); await act(async()=>{await new Promise(r=>setTimeout(r,5));});
 const dialog=host.querySelector('[role="dialog"]')!;
 const first=dialog.querySelector('button')!; const last=dialog.querySelectorAll('button')[1];
 expect(document.activeElement).toBe(first);
 last.focus(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})); expect(document.activeElement).toBe(first);
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})); expect(document.activeElement).toBe(last);
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger); expect(document.body.style.overflow).toBe('');
});
it("does not reset focus when dialog content rerenders", async () => {
 const host=document.createElement('div');document.body.append(host);root=createRoot(host);
 function Example(){const [value,setValue]=useState(0);return <Modal title="검증" onClose={()=>{}}><button onClick={()=>setValue(value+1)}>추가 {value}</button></Modal>;}
 await act(async()=>root!.render(<Example/>));await act(async()=>{await new Promise(r=>setTimeout(r,5));});
 const edit=host.querySelectorAll('button')[1];edit.focus();await act(async()=>edit.click());
 expect(document.activeElement).toBe(edit);expect(edit.textContent).toBe('추가 1');
});
