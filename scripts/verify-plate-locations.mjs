import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../app/lib/plate-location.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { hasPlateLocation, plateLocationLabel } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
for (const [latitude, longitude] of [[0, 0], [-10.9745238, -37.0736828], [85, 180], [-85, -180]]) {
  assert.equal(hasPlateLocation({ latitude, longitude }), true);
}
for (const [latitude, longitude] of [[null, 0], [0, null], [undefined, 0], [0, undefined], ["0", 0], [0, "0"],
  [NaN, 0], [0, NaN], [Infinity, 0], [0, -Infinity], [85.000001, 0], [0, 180.000001]]) {
  assert.equal(hasPlateLocation({ latitude, longitude }), false);
}
const fixture = { address: "", neighborhood: "", latitude: null, longitude: null };
assert.equal(plateLocationLabel(fixture), "Sem localização cadastrada");
assert.equal(plateLocationLabel({ ...fixture, neighborhood: " Farolândia " }), "Farolândia");
assert.equal(plateLocationLabel({ ...fixture, address: " Rua Central, 100 " }), "Rua Central, 100");
assert.equal(plateLocationLabel({ ...fixture, address: "Rua Central, 100", neighborhood: "Farolândia" }), "Rua Central, 100 · Farolândia");
assert.equal(plateLocationLabel({ ...fixture, address: "Rua Central, 100 - FAROLANDIA, Aracaju", neighborhood: "Farolândia" }), "Rua Central, 100 - FAROLANDIA, Aracaju");
assert.equal(plateLocationLabel({ ...fixture, address: "Rua Central, 100 - Centro Sul", neighborhood: "Centro" }), "Rua Central, 100 - Centro Sul");
assert.equal(plateLocationLabel({ ...fixture, latitude: 0, longitude: 0 }), "0.000000, 0.000000");
assert.equal(plateLocationLabel({ ...fixture, latitude: -10.9745238, longitude: -37.0736828 }), "-10.974524, -37.073683");
assert.equal(plateLocationLabel({ ...fixture, latitude: NaN, longitude: 0 }), "Sem localização cadastrada");
console.log(JSON.stringify({ passed: true, checks: ["finite paired coordinates", "zero and map boundaries accepted", "invalid or out-of-range coordinates rejected", "address and neighborhood without duplication", "six decimal coordinate fallback", "missing location label"] }));
