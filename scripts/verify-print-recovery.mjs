import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compiled = ts.transpileModule(readFileSync(new URL('../app/lib/print-recovery.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { rememberPrintSelection, takePrintSelection } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const store = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
const now = 1_000_000;
const original = { view: 'impressao', selectedId: 'plate-1', checkedIds: ['plate-1', 'plate-2'], printMode: 'batch' };
const storage = store();
assert.equal(rememberPrintSelection(storage, original, now), true);
assert.deepEqual(takePrintSelection(storage, now + 1000), original);
assert.equal(takePrintSelection(storage, now + 1001), null, 'Selection is consumed only once');
assert.equal(rememberPrintSelection(storage, original, now + 1100), false, 'No reload loop');
assert.equal(rememberPrintSelection(storage, original, now + 120_001), true);
assert.equal(takePrintSelection(storage, now + 120_001 + 600_001), null, 'Expired recovery ignored');
const singleStorage = store();
const single = { ...original, printMode: 'single' };
assert.equal(rememberPrintSelection(singleStorage, single, now), true);
assert.deepEqual(takePrintSelection(singleStorage, now + 1000), single, 'Individual printing survives a reload');
const oldStorage = store();
const legacy = { view: 'impressao', selectedId: 'plate-1', checkedIds: ['plate-1', 'plate-2'] };
oldStorage.values.set('guirab-print-selection', JSON.stringify({ ...legacy, version: 1, createdAt: now }));
assert.deepEqual(takePrintSelection(oldStorage, now), original, 'Existing version 1 selections resume in batch mode');
assert.equal(rememberPrintSelection(oldStorage, legacy, now), true, 'Older callers can omit printMode');
assert.equal(takePrintSelection(oldStorage, now).printMode, 'batch');
const invalidModeStorage = store();
invalidModeStorage.values.set('guirab-print-selection', JSON.stringify({ ...original, printMode: 'invalid', version: 1, createdAt: now }));
assert.equal(takePrintSelection(invalidModeStorage, now).printMode, 'batch', 'Unsupported modes use a valid batch default');
const bounded = store();
assert.equal(rememberPrintSelection(bounded, { view: 'lojas', selectedId: null,
  checkedIds: ['bad<script>', 'plate-1', 'plate-1', ...Array.from({ length: 80 }, (_, i) => `plate-${i}`)] }, now), true);
const recovered = takePrintSelection(bounded, now);
assert.equal(recovered.checkedIds.length, 50); assert.equal(new Set(recovered.checkedIds).size, 50);
assert.equal(recovered.checkedIds.includes('bad<script>'), false);
assert.equal(recovered.selectedId, null);
assert.equal(recovered.printMode, 'batch');
const corrupt = store();
corrupt.values.set('guirab-print-selection', '{invalid'); assert.equal(takePrintSelection(corrupt, now), null);
corrupt.values.set('guirab-print-selection', JSON.stringify({ ...original, version: 1, createdAt: now + 1 }));
assert.equal(takePrintSelection(corrupt, now), null);
const denied = { getItem() { throw new Error('Storage disabled'); }, setItem() { throw new Error('Storage disabled'); }, removeItem() { throw new Error('Storage disabled'); } };
assert.equal(rememberPrintSelection(denied, original, now), false); assert.equal(takePrintSelection(denied, now), null);

// Exercise the actual Dashboard recovery handler, including the unsaved-form guard.
const source = readFileSync(new URL('../app/dashboard.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('dashboard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const dashboard = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Dashboard');
const handler = dashboard.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'recoverPrintFailure');
const handlerJs = ts.transpileModule(handler.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const session = new Function('modal', 'rememberPrintSelection', 'storage', 'printMode', `${handlerJs}
  let reloads=0, notices=[]; const window={sessionStorage:storage,location:{reload(){reloads++}}};
  const isChunkLoadError=e=>e==='stale-module';const notify=(...v)=>notices.push(v);
  const view='lojas',selectedId='plate-1',checkedIds=['plate-1','plate-2'];
  return {run:recoverPrintFailure,get state(){return{reloads,notices}}};`);
let run = session(null, () => true, {});
assert.equal(run.run('normal-print-error'), false); assert.equal(run.state.reloads, 0);
assert.equal(run.run('stale-module'), true); assert.equal(run.state.reloads, 1);
run = session({ kind: 'store' }, () => { throw new Error('Must preserve unsaved form'); }, {});
assert.equal(run.run('stale-module'), true); assert.equal(run.state.reloads, 0); assert.equal(run.state.notices.length, 1);
run = session(null, () => false, {}); run.run('stale-module'); assert.equal(run.state.reloads, 0);
for (const printMode of ['batch', 'single']) {
  const handlerStorage = store();
  const handlerSession = session(null, rememberPrintSelection, handlerStorage, printMode);
  assert.equal(handlerSession.run('stale-module'), true);
  assert.equal(handlerSession.state.reloads, 1);
  assert.deepEqual(takePrintSelection(handlerStorage), { ...original, view: 'lojas', printMode },
    `Dashboard passes ${printMode} mode and selected plates into recovery`);
}
console.log(JSON.stringify({ passed: true, checks: ['selected plates and print view survive reload', 'single use and bounded recovery',
  'batch and individual print modes preserved', 'existing version 1 selections and older callers compatible',
  'cooldown prevents reload loop', 'corrupt expired and unavailable storage safe', 'ordinary errors do not reload', 'unsaved forms never reload'] }));
