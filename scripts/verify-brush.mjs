import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../app/lib/brush.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const brush = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < Math.max(0.000001, Math.abs(expected) * 0.000001), `${actual} != ${expected}`);

close(brush.metersPerPixel(0, 0), 156543.03392804097);
close(brush.metersPerPixel(60, 14) / brush.metersPerPixel(0, 14), 0.5);
close(brush.metersPerPixel(-10.9472, 15) / brush.metersPerPixel(-10.9472, 14), 0.5);
const radius = brush.radiusInMeters(14, -10.9472, 16);
close(radius / brush.metersPerPixel(-10.9472, 16), 14);
close(radius / brush.metersPerPixel(-10.9472, 17), 28);
assert.equal(brush.radiusInMeters(10, 0, 30), 0.2);
assert.equal(brush.radiusInMeters(10, 0, 1), 500);

const center = [-37.0731, -10.9472];
const east = meters => [center[0] + meters / (6378137 * Math.cos(center[1] * Math.PI / 180)) * 180 / Math.PI, center[1]];
const paint = { points: [center], radiusMeters: 20, mode: "paint" };
const erase = { points: [center], radiusMeters: 5, mode: "erase" };
assert.equal(brush.brushContains([paint], center), true);
assert.equal(brush.brushContains([paint], east(10)), true);
assert.equal(brush.brushContains([paint], east(30)), false);
assert.equal(brush.brushContains([paint, erase], center), false);
assert.equal(brush.brushContains([paint, erase], east(10)), true);
assert.equal(brush.brushContains([paint], center), true, "Erasing one record must not mutate another record");
assert.equal(brush.brushContains([paint, erase, { ...paint, radiusMeters: 2 }], center), true);
assert.equal(brush.brushContains([{ points: [east(-30), east(30)], radiusMeters: 3, mode: "paint" }], center), true);
assert.equal(brush.brushPointCount([paint, erase]), 2);
const bounds = brush.brushCoordinates([paint], true);
assert.ok(bounds[0][0] < center[0] && bounds[1][0] > center[0] && bounds[0][1] < center[1] && bounds[1][1] > center[1]);

const initial = brush.emptyBrushHistory([paint]);
const erased = brush.commitBrush(initial, [paint, erase]);
assert.deepEqual(brush.undoBrush(erased).strokes, [paint]);
assert.deepEqual(brush.redoBrush(brush.undoBrush(erased)).strokes, [paint, erase]);
const cleared = brush.commitBrush(erased, []);
assert.deepEqual(brush.undoBrush(cleared).strokes, [paint, erase]);
assert.equal(brush.commitBrush(brush.undoBrush(erased), [paint, paint]).future.length, 0);
assert.deepEqual(initial.strokes, [paint]);

const composites = [];
const context = {
  globalCompositeOperation: "source-over", save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
  stroke() { composites.push(this.globalCompositeOperation); },
  arc() {}, fill() { composites.push(this.globalCompositeOperation); },
};
brush.drawBrushRecord(context, [paint, erase, paint], "#1a73e8", 16, ([x, y]) => ({ x, y }));
assert.deepEqual(composites, ["source-over", "destination-out", "source-over"]);
console.log("Brush checks passed: geographic scale, radius limits, paint/erase order, record isolation, bounds and undo/redo.");
