import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../app/lib/chunk-load-error.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { isChunkLoadError } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

const oldModule = "https://placas.guirab.com.br/_next/static/chunks/jspdf.es.min-DXabB2Uh.js";
const moduleFailure = new TypeError(`Failed to fetch dynamically imported module: ${oldModule}`);
const positives = [
  moduleFailure,
  new TypeError("error loading dynamically imported module: /_next/static/chunks/svg2pdf.old.js"),
  new TypeError("Importing a module script failed."),
  new Error("Loading chunk 581 failed.\n(error: /_next/static/chunks/fflate.old.js)"),
  new Error("Loading CSS chunk dashboard failed.\n(missing: /_next/static/chunks/dashboard.old.css)"),
  new Error("Unable to preload CSS for /_next/static/chunks/print.old.css"),
  new Error("Falha ao carregar impressão", { cause: moduleFailure }),
  { message: "Outra falha", cause: { message: "error loading dynamically imported module: /_next/static/chunks/qrcode.old.js" } },
  `Failed to fetch dynamically imported module: ${oldModule}`,
];
for (const error of positives) assert.equal(isChunkLoadError(error), true);

const cycle = new Error("Falha de rede comum"); cycle.cause = cycle;
const negatives = [
  null, undefined, 404, {}, [],
  new TypeError("Failed to fetch"),
  new TypeError("NetworkError when attempting to fetch resource."),
  new Error("Não foi possível carregar a arte. Tente novamente."),
  new Error("Não foi possível gerar a imagem da placa. Tente novamente."),
  new Error("Cada placa do lote precisa ter um QR Code diferente."),
  new Error("Unexpected token '<', response is not valid JSON"),
  new Error("Could not load image /_next/static/chunks/example.png"),
  Object.assign(new Error("Network connection lost"), { name: "ChunkLoadError" }),
  new Error("Falha ao gerar PDF", { cause: new TypeError("Failed to fetch") }),
  cycle,
  { get message() { throw new Error("Unavailable property"); } },
];
for (const error of negatives) assert.equal(isChunkLoadError(error), false);
assert.strictEqual(cycle.cause, cycle, "Classification must not mutate the original error");
console.log(JSON.stringify({ passed: true, positiveCases: positives.length, negativeCases: negatives.length, checks: ["reported stale jspdf import", "Firefox and Safari module messages", "JS and CSS chunks", "Vite CSS preload", "wrapped errors", "ordinary network and print errors excluded", "cycles and unknown values safe"] }));
