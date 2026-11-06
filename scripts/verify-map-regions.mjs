import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const data = readFileSync(new URL("../app/lib/data/aracaju-neighborhoods.json", import.meta.url), "utf8");
const source = ts.transpileModule(readFileSync(new URL("../app/lib/map-regions.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace('import catalog from "./data/aracaju-neighborhoods.json";', `const catalog = ${data};`)
  .replace('import localities from "./data/ibge-localities.json";', `const localities = ${readFileSync(new URL("../app/lib/data/ibge-localities.json", import.meta.url), "utf8")};`);
const { aracajuRegions, localRegions, searchRegions, photonRegions, regionStreets, regionBoundary, clipStreet, pointInRegion, MapDataError } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
assert.equal(aracajuRegions.length, 48); assert.equal(new Set(aracajuRegions.map(row => row.id)).size, 48);
assert.equal(localRegions("Aracaju").length, 49); assert.equal(localRegions("").length, 49);
assert.equal(localRegions("BAIRRO FAROLANDIA ARACAJU SE")[0].name, "Farolândia");
assert.equal(localRegions("Marivan")[0].name, "Marivan");
assert.equal(localRegions("Aracaju bairro desconhecido").length, 0);
const never = async () => { throw new Error("Unexpected external call"); };
assert.equal((await searchRegions("Aracaju", never)).length, 49);
for (const region of aracajuRegions) {
  assert.equal(region.source, "Prefeitura de Aracaju"); assert.equal(region.geometry.type, "MultiPolygon");
  assert.ok(region.bbox[0] < region.bbox[2] && region.bbox[1] < region.bbox[3]);
  for (const polygon of region.geometry.coordinates) for (const ring of polygon) assert.deepEqual(ring[0], ring.at(-1));
}
const polygon = { type: "Polygon", coordinates: [ [[0,0],[10,0],[10,10],[0,10],[0,0]], [[4,4],[6,4],[6,6],[4,6],[4,4]] ] };
assert.equal(pointInRegion([2,5], polygon), true); assert.equal(pointInRegion([5,5], polygon), false);
assert.deepEqual(clipStreet([[-1,5],[11,5]], polygon), [ [[0,5],[4,5]], [[6,5],[10,5]] ]);
const photon = { features: [{ properties: { name: "Região de teste", type: "district", city: "Outra cidade", state: "Sergipe", osm_type: "R", osm_id: 123, extent: [10,5,12,4] }, geometry: { type: "Point", coordinates: [11,4.5] } }] };
assert.deepEqual(photonRegions(photon)[0].bbox, [10,4,12,5]); assert.equal(photonRegions(photon)[0].geometry, null);
assert.deepEqual(photonRegions({ features: [{ ...photon.features[0], properties: { ...photon.features[0].properties, type: "house" } }] }), []);
const state = photonRegions({ features: [{ ...photon.features[0], properties: { ...photon.features[0].properties, name: "Sergipe", type: "state" } }] })[0];
assert.equal(state.id, "ibge:state:28"); assert.equal(state.label, "Sergipe · Estado · Brasil");
const city = photonRegions({ features: [{ ...photon.features[0], properties: { ...photon.features[0].properties, name: "Recife", type: "city", state: "Pernambuco" } }] })[0];
assert.equal(city.id, "ibge:city:2611606"); assert.equal(city.label, "Recife · Município · PE");
assert.equal((await searchRegions("Região de teste inexistente", async (url, init) => {
  assert.equal(new URL(url).hostname, "photon.komoot.io"); assert.equal(init.redirect, "manual"); return Response.json(photon);
}))[0].name, "Região de teste");
for (const region of [{ id: "https://127.0.0.1/private" }, { id: "osm:N:123" }, { id: "unknown" }]) await assert.rejects(regionStreets(region, never), MapDataError);
await assert.rejects(regionStreets({ id: "aracaju:municipio" }, never), MapDataError);
const farol = localRegions("Farolândia")[0];
const sample = [-37.0736828, -10.9745238]; assert.equal(pointInRegion(sample, farol.geometry), true);
const inside = [[sample[0]-.0001,sample[1]], [sample[0]+.0001,sample[1]]];
const tiny = [[sample[0],sample[1]], [sample[0]+.00000001,sample[1]+.00000001]];
const response = { type: "FeatureCollection", totalFeatures: 2, features: [
  { id: "sample", properties: { nome: "Rua de teste" }, geometry: { type: "MultiLineString", coordinates: [inside] } },
  { id: "tiny", properties: { nome: "Muito pequena" }, geometry: { type: "MultiLineString", coordinates: [tiny] } },
] };
const result = await regionStreets({ ...farol, bbox: [-180,-85,180,85], geometry: polygon }, async (url, init) => {
  const request = new URL(url); assert.equal(request.hostname, "geoserver.fazenda.aracaju.se.gov.br"); assert.equal(init.redirect, "manual");
  assert.equal(request.searchParams.get("bbox"), `${farol.bbox.join(",")},EPSG:4326`);
  return Response.json(response);
});
assert.equal(result.streets.length, 1); assert.equal(result.streets[0].name, "Rua de teste");
assert.equal(result.source, "Prefeitura de Aracaju"); assert.equal(result.truncated, false);
await assert.rejects(regionStreets(farol, async () => new Response("x".repeat(4_194_305))), MapDataError);
await assert.rejects(regionStreets(farol, async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } })), MapDataError);
const nativeTimer = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => nativeTimer(callback, 5, ...args);
try {
  await assert.rejects(regionStreets(farol, async (url, init) => new Response(new ReadableStream({ start(controller) {
    init.signal.addEventListener("abort", () => controller.error(new DOMException("Timed out", "AbortError")), { once: true });
  } }))), MapDataError);
} finally { globalThis.setTimeout = nativeTimer; }
console.log(JSON.stringify({ passed: true, checks: ["48 official neighborhoods plus city view", "accent/case-independent local search", "closed factual polygons", "Photon bbox without invented boundary", "server ID ignores client bbox and polygon", "streets clipped across holes", "rounded tiny segments discarded", "fixed hosts and no redirects", "response size and full-stream deadline"] }));
if (process.argv.includes("--live")) for (const name of ["Farolândia", "Marivan"]) {
  const region = localRegions(name)[0], loaded = await regionStreets(region);
  assert.ok(loaded.streets.length > 0); assert.equal(loaded.source, "Prefeitura de Aracaju");
  assert.ok(loaded.streets.every(street => street.geometry.coordinates.length >= 2));
  console.log(JSON.stringify({ live: true, neighborhood: name, streets: loaded.streets.length, coordinates: loaded.streets.reduce((sum, street) => sum + street.geometry.coordinates.length, 0), truncated: loaded.truncated, examples: [...new Set(loaded.streets.map(s => s.name))].slice(0,6) }));
}
if (process.argv.includes("--live")) for (const [id, name] of [["aracaju:municipio", "Aracaju"], ["ibge:state:28", "Sergipe"]]) {
  const region = await regionBoundary({ id, name: "Wrong client label", geometry: polygon });
  assert.equal(region.name, name); assert.equal(region.source, "IBGE"); assert.ok(region.geometry);
  console.log(JSON.stringify({ live: true, officialBoundary: name, source: region.source, type: region.geometry.type,
    vertices: region.geometry.coordinates.flat(2).length, bbox: region.bbox }));
}
