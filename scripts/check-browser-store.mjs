import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ledgerRequest, receiptBlob, exportBackup, importBackup } from '../src/browser-store.ts';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F2kAAAAASUVORK5CYII=', 'base64'));
const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
function payload(extra = {}) { return { id: randomUUID(), paidOn: '2026-10-01', category: '교육비', child: '현우', title: '교육비 테스트', amount: 300000, retainedReceiptIds: [], ...extra }; }
function form(value, files = []) { const form = new FormData(); form.append('payload', JSON.stringify(value)); for (const [name, bytes, mime] of files) form.append('files', new Blob([bytes], { type: mime }), name); return form; }
async function save(value, files = [], edit = false) { return ledgerRequest(edit ? `/api/expenses/${value.id}` : '/api/expenses', { method: edit ? 'PUT' : 'POST', body: form(value, files) }); }
async function status(response, expected) { assert.equal(response.status, expected, await response.text()); }
async function list(query = '') { const response = await ledgerRequest('/api/expenses' + query); assert.equal(response.status, 200); return (await response.json()).expenses; }
async function remove(entry) { return ledgerRequest(`/api/expenses/${entry.id}?version=${entry.version}`, { method: 'DELETE' }); }
async function backupFile(blob) { return new File([blob], 'ledger-backup.json', { type: 'application/json' }); }

assert.equal((await list()).length, 0);
const first = payload();
await status(await save(first, [['한글 영수증.png', png, 'image/png'], ['수강료.pdf', pdf, 'application/pdf']]), 201);
const second = payload({ paidOn: '2026-10-31', child: '정우', amount: 200000 });
await status(await save(second), 201);
const outside = payload({ paidOn: '2026-09-30', category: '식비', child: null, title: '장보기', amount: 12500 });
await status(await save(outside), 201);
const october = await list('?from=2026-10-01&to=2026-10-31');
assert.equal(october.length, 2); assert.equal(october.reduce((sum, e) => sum + e.amount, 0), 500000);
assert.equal((await list('?from=2026-10-01&to=2026-10-01')).length, 1);
await status(await ledgerRequest('/api/expenses?from=2026-10-31&to=2026-10-01'), 400);
const stored = october.find(e => e.id === first.id); assert.equal(stored.receipts[0].name, '한글 영수증.png');
assert.deepEqual(new Uint8Array(await (await receiptBlob(stored.receipts[0].id)).arrayBuffer()), png);
assert.deepEqual(new Uint8Array(await (await receiptBlob(stored.receipts[1].id)).arrayBuffer()), pdf);
const restarted = await import('../src/browser-store.ts?new-connection');
assert.equal((await (await restarted.ledgerRequest('/api/expenses')).json()).expenses.length, 3);
assert.deepEqual(new Uint8Array(await (await restarted.receiptBlob(stored.receipts[1].id)).arrayBuffer()), pdf);
console.log('PASS: IndexedDB writes, a new DB connection, inclusive date totals, Korean filenames, image/PDF byte roundtrip');

await status(await save(first), 409);
for (const invalid of [payload({ amount: 0 }), payload({ amount: 1.5 }), payload({ paidOn: '2026-02-29' }), payload({ child: null })]) await status(await save(invalid), 400);
await status(await save(payload(), [['fake.png', new TextEncoder().encode('<html>fake</html>'), 'image/png']]), 400);
await status(await save(payload(), [['empty.pdf', new Uint8Array(), 'application/pdf']]), 400);
await status(await save(payload(), Array.from({ length: 6 }, (_, i) => [`r${i}.png`, png, 'image/png'])), 400);
const large = new Uint8Array(10 * 1024 * 1024 + 1); large.set(png);
await status(await save(payload(), [['too-big.png', large, 'image/png']]), 400);
const medium = new Uint8Array(7 * 1024 * 1024); medium.set(png);
await status(await save(payload(), Array.from({ length: 3 }, (_, i) => [`large${i}.png`, medium, 'image/png'])), 400);
assert.equal((await list()).length, 3);
console.log('PASS: duplicate IDs, invalid dates/amounts/education child, empty and forged files, receipt count and size caps');

const update = { ...first, version: stored.version, category: '식비', child: '현우', amount: 350000, title: '수정 내역', retainedReceiptIds: [stored.receipts[1].id] };
const edits = await Promise.all([save(update, [], true), save(update, [], true)]);
assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
let current = (await list()).find(e => e.id === first.id);
assert.equal(current.child, null); assert.equal(current.version, 2); assert.equal(current.receipts.length, 1);
await assert.rejects(receiptBlob(stored.receipts[0].id));
await status(await ledgerRequest(`/api/expenses/${current.id}?version=1`, { method: 'DELETE' }), 409);
console.log('PASS: atomic update, concurrent-version conflicts, category child cleanup, removed receipt cleanup');

const backup = await exportBackup(); const backupObject = JSON.parse(await backup.text());
assert.equal(backupObject.receipts.length, 1);
for (const entry of await list()) await status(await remove(entry), 200);
assert.equal((await list()).length, 0);
await assert.rejects(receiptBlob(stored.receipts[1].id));
assert.deepEqual(await importBackup(await backupFile(backup)), { imported: 3, preserved: 0 });
assert.deepEqual(new Uint8Array(await (await receiptBlob(stored.receipts[1].id)).arrayBuffer()), pdf);
assert.deepEqual(await importBackup(await backupFile(backup)), { imported: 0, preserved: 3 });
current = (await list()).find(e => e.id === first.id);
await status(await save({ ...current, title: '현재 내역을 유지', retainedReceiptIds: current.receipts.map(r => r.id) }, [], true), 200);
assert.deepEqual(await importBackup(await backupFile(backup)), { imported: 0, preserved: 3 });
assert.equal((await list()).find(e => e.id === first.id).title, '현재 내역을 유지');
const candidate = { ...backupObject.expenses.find(e => !e.receipts.length), id: randomUUID(), title: '부분 복원되면 안 됨' };
const invalidBackup = { format: backupObject.format, version: 1, expenses: [candidate, { ...candidate, id: randomUUID(), amount: -1 }], receipts: [] };
await assert.rejects(importBackup(new File([JSON.stringify(invalidBackup)], 'bad.json')));
assert.equal((await list()).length, 3); assert.ok(!(await list()).some(e => e.id === candidate.id));
const corrupted = structuredClone(backupObject); corrupted.receipts[0].data = Buffer.from('<html>bad receipt</html>').toString('base64'); corrupted.receipts[0].size = 24;
await assert.rejects(importBackup(new File([JSON.stringify(corrupted)], 'bad-receipt.json')));
assert.equal((await list()).length, 3);
console.log('PASS: full backup/restore including PDF bytes, duplicate/conflicting ID preservation, invalid backup rejected without partial writes');
