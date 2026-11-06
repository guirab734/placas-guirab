import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const brushSource = await readFile(new URL("../app/lib/brush.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(brushSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const brush = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const componentSource = await readFile(new URL("../app/components/visit-map.tsx", import.meta.url), "utf8");
const componentAst = ts.createSourceFile("visit-map.tsx", componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = componentAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "VisitMap");
assert.ok(component?.body, "The map component must be available for its state-transition checks");
const handlerNames = ["updateBrushHistory", "startBrush", "discardActiveStroke", "cancelDrawing", "finishActiveStroke", "confirmBrush"];
const handlers = handlerNames.map(name => {
  const declaration = component.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing map handler ${name}`);
  return declaration.getText(componentAst);
}).join("\n");
const handlerJavascript = ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

// Run the component's actual event handlers with state/map adapters, without a browser or server.
const createSession = new Function("brush", "initialDraft", `
  const { emptyBrushHistory, commitBrush } = brush;
  let draft = initialDraft, mode = null, error = null, notice = null, brushTool = null;
  const mapReady = true, saving = false, locating = false, streetLoading = false, regionResolving = false;
  const mapRef = { current: { getZoom: () => 16, closePopup() {}, stop() {} } };
  const paintingRef = { current: false }, currentStrokeRef = { current: null };
  const brushCursorRef = { current: null }, titleRef = { current: null };
  const brushHistoryRef = { current: emptyBrushHistory() };
  const scheduleBrush = () => {}, setBrushHistory = () => {}, requestAnimationFrame = () => {};
  const setDraft = next => { draft = typeof next === "function" ? next(draft) : next; };
  const setMode = next => { mode = next; paintingRef.current = next === "Brush"; };
  const setError = next => { error = next; }, setNotice = next => { notice = next; };
  const setBrushTool = next => { brushTool = next; };
  const newDraft = geometry => ({ title: "", geometry, status: "visited", visitedAt: "2026-10-15", notes: "", address: "" });
  ${handlerJavascript}
  return {
    startBrush, confirmBrush, cancelDrawing,
    addStroke(stroke) { const history = brushHistoryRef.current; updateBrushHistory(commitBrush(history, [...history.strokes, structuredClone(stroke)])); },
    clear() { updateBrushHistory(commitBrush(brushHistoryRef.current, [])); },
    undo() { updateBrushHistory(brush.undoBrush(brushHistoryRef.current)); },
    redo() { updateBrushHistory(brush.redoBrush(brushHistoryRef.current)); },
    edit(fields) { setDraft(current => ({ ...current, ...fields })); },
    activeStroke(value) { currentStrokeRef.current = value; },
    get draft() { return draft; }, get mode() { return mode; },
    get history() { return brushHistoryRef.current; }, get active() { return currentStrokeRef.current; },
    get error() { return error; }, get notice() { return notice; }, get tool() { return brushTool; }
  };
`);

const paintA = { mode: "paint", radiusMeters: 12, points: [[-37.0731, -10.9472], [-37.0732, -10.9473]] };
const paintB = { mode: "paint", radiusMeters: 9, points: [[-37.0741, -10.9482]] };
const eraseA = { mode: "erase", radiusMeters: 4, points: [[-37.0731, -10.9472]] };
const metadata = { title: "Rota do centro", status: "return", visitedAt: "2026-10-14", notes: "Voltar na sexta-feira", address: "Centro, Aracaju" };
const metadataOf = draft => Object.fromEntries(Object.keys(metadata).map(key => [key, draft[key]]));

const session = createSession(brush, null);
session.startBrush();
assert.equal(session.mode, "Brush");
assert.equal(session.draft, null);
assert.deepEqual(session.history.strokes, []);
session.addStroke(paintA);
session.confirmBrush();
session.edit(metadata);
const confirmedA = session.draft;
session.startBrush();
assert.strictEqual(session.draft, confirmedA, "The toolbar must preserve the confirmed draft and its metadata");
assert.deepEqual(session.history.strokes, [paintA], "Painting again must start with the previously confirmed area");
assert.notStrictEqual(session.history.strokes, confirmedA.geometry.strokes);
assert.notStrictEqual(session.history.strokes[0], confirmedA.geometry.strokes[0]);
assert.notStrictEqual(session.history.strokes[0].points, confirmedA.geometry.strokes[0].points);
assert.notStrictEqual(session.history.strokes[0].points[0], confirmedA.geometry.strokes[0].points[0]);
assert.equal(session.history.past.length, 0);
session.addStroke(paintB);
session.undo();
assert.deepEqual(session.history.strokes, [paintA]);
session.redo();
assert.deepEqual(session.history.strokes, [paintA, paintB]);
session.clear();
assert.deepEqual(session.history.strokes, []);
session.undo();
assert.deepEqual(session.history.strokes, [paintA, paintB]);
session.confirmBrush();
assert.equal(session.mode, null);
assert.deepEqual(session.draft.geometry.strokes, [paintA, paintB]);
assert.deepEqual(metadataOf(session.draft), metadata);
assert.equal(session.draft.id, undefined, "Continuing an unsaved draft must not invent a saved record");

const confirmedAB = structuredClone(session.draft);
session.startBrush();
session.addStroke(eraseA);
session.clear();
let releases = 0;
session.activeStroke({ pointerId: 17, canvas: { hasPointerCapture: () => true, releasePointerCapture: () => { releases++; } }, stroke: paintB });
session.cancelDrawing();
assert.equal(releases, 1);
assert.equal(session.active, null);
assert.equal(session.mode, null);
assert.deepEqual(session.draft, confirmedAB, "Cancel must restore the confirmed geometry and keep every field");
assert.deepEqual(session.history.strokes, []);

const savedVisit = { ...metadata, id: "saved-visit", geometry: { type: "Brush", strokes: [structuredClone(paintA)] } };
const otherVisit = { ...metadata, id: "other-visit", geometry: { type: "Brush", strokes: [structuredClone(paintB)] } };
const savedSnapshot = structuredClone([savedVisit, otherVisit]);
const editing = createSession(brush, { ...savedVisit });
editing.startBrush();
editing.history.strokes[0].points[0][0] += 0.001;
assert.deepEqual([savedVisit, otherVisit], savedSnapshot, "Working points must not alias saved records");
editing.cancelDrawing();
editing.startBrush(true);
editing.addStroke(eraseA);
editing.confirmBrush();
assert.equal(editing.draft.id, savedVisit.id, "Continuing a saved visit must keep its existing identity for PATCH");
assert.deepEqual(metadataOf(editing.draft), metadata);
assert.deepEqual(editing.draft.geometry.strokes, [paintA, eraseA]);
assert.deepEqual([savedVisit, otherVisit], savedSnapshot, "Confirming a draft must not mutate saved records before saving");

const fresh = createSession(brush, null);
fresh.startBrush();
assert.deepEqual(fresh.history.strokes, [], "A fresh painting must not inherit the previous editing session");
assert.equal(fresh.draft, null);

console.log("Brush continuation checks passed: toolbar resumes confirmed areas, deep copies, metadata, undo/redo/clear, cancel and pointer release, saved record identity and isolation, fresh sessions.");
