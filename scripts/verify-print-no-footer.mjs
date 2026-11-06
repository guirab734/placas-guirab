import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import QRCode from "qrcode";
import ts from "typescript";

const source = await readFile(new URL("../app/lib/print.ts", import.meta.url), "utf8");
const template = await readFile(new URL("../public/plaque-template.svg", import.meta.url), "utf8");
const preview = await readFile(new URL("../app/components/plaquinha.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("print.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)?.getText(ast);
const escape = value => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// Only the SVG DOM methods used by the real composition function are adapted here.
// Raw artwork and the real qrcode library output are preserved verbatim.
class Element {
  constructor(tag, raw = "") { this.tag = tag; this.raw = raw; this.attributes = new Map(); this.children = []; this.textContent = ""; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  appendChild(child) { this.children.push(child); }
  serialize() {
    const children = this.children.map(child => child.serialize()).join("") + escape(this.textContent);
    if (!this.raw) return `<${this.tag}${[...this.attributes].map(([name, value]) => ` ${name}="${escape(value)}"`).join("")}>${children}</${this.tag}>`;
    const opening = this.raw.match(/<svg\b[^>]*>/)[0];
    let nextOpening = opening;
    for (const [name, value] of this.attributes) {
      const attribute = new RegExp(`\\s${name}="[^"]*"`);
      nextOpening = attribute.test(nextOpening) ? nextOpening.replace(attribute, ` ${name}="${escape(value)}"`) : nextOpening.replace(/>$/, ` ${name}="${escape(value)}">`);
    }
    return this.raw.replace(opening, nextOpening).replace(/<\/svg>\s*$/, `${children}</svg>`);
  }
}
class Parser {
  parseFromString(markup) {
    return { documentElement: new Element("svg", markup), querySelector: () => null, createElementNS: (_, tag) => new Element(tag), importNode: node => new Element(node.tag, node.raw) };
  }
}
class Serializer { serializeToString(element) { return element.serialize(); } }
const encodedUrls = [];
const qr = { toString(url, options) { encodedUrls.push(url); return QRCode.toString(url, options); } };
const javascript = ts.transpileModule([declaration("qrSvg"), declaration("plaqueSvg")].join("\n").replace(/export /g, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const make = new Function("QRCode", "DOMParser", "XMLSerializer", "templateMarkup", `const SVG_NS="http://www.w3.org/2000/svg",MM_TO_PT=72/25.4;${javascript};return plaqueSvg;`);
const plaqueSvg = make(qr, Parser, Serializer, () => Promise.resolve(template));
const firstUrl = "https://placas.guirab.com.br/r/AB23", secondUrl = "https://placas.guirab.com.br/r/CD45";
const first = await plaqueSvg(firstUrl, "Placa 001 · AB23"), second = await plaqueSvg(secondUrl, "Placa 002 · CD45");
assert.deepEqual(encodedUrls, [firstUrl, secondUrl], "Each plaque must encode its original, distinct permanent URL");
assert.notEqual(first, second, "Different plaques must retain different QR artwork");
for (const markup of [first, second]) {
  assert.equal(/<text(?:\s|>)/.test(markup), false, "The artwork must not contain an added visible footer label");
  assert.equal(/Placa 00[12]|AB23|CD45/.test(markup), false);
  assert.equal(markup.match(/<svg\b[^>]*>/)[0], template.match(/<svg\b[^>]*>/)[0], "Root dimensions and viewBox must remain unchanged");
  assert.ok(markup.includes('x="72.4" y="95.7" width="34.2" height="34.2"'), "QR placement and size must stay unchanged");
}
assert.ok(template.includes('width="124mm" height="144mm"'));
assert.ok(template.includes('preserveAspectRatio="none"'), "The full artwork must fill 124x144mm without an unprinted strip from meet scaling");
assert.ok(template.includes('viewBox="0 0 345.82677165 396.85039370"'));
assert.match(source, /const PLAQUE_WIDTH_MM = 124;/); assert.match(source, /const PLAQUE_HEIGHT_MM = 144;/);
assert.match(source, /const A4_PLAQUE_X = \[20\.5, 152\.5\];/); assert.match(source, /const A4_PLAQUE_Y = 34;/);
assert.match(declaration("templateMarkup"), /fetch\("\/plaque-template\.svg\?v=124x144-v1"/, "The new template must use a new cache key");
assert.ok(declaration("plaquePng").includes("plaqueSvg(url, label)"));
assert.ok(declaration("renderableSvg").includes("plaqueSvg(url, label)"));
for (const name of ["downloadPlaquePdf", "downloadA4Pdf", "downloadBatchA4Pdf"]) assert.ok(declaration(name).includes("renderableSvg("));
for (const name of ["downloadPlaquePng", "downloadBatchPlaquePngs"]) assert.ok(declaration(name).includes("plaquePng("));
assert.ok(preview.includes("plaqueSvg(url).then")); assert.ok(preview.includes("alt={`${label ?"), "The accessible name must still identify the selected plate");
assert.ok(source.includes('manifest.push([label, name, item.url]'), "ZIP manifest identities must remain available");
console.log(JSON.stringify({ passed: true, checks: ["visible footer absent in shared SVG composition", "distinct QR destinations preserved", "124x144mm root fills both axes with original viewBox", "QR coordinates preserved and A4 layout matches adjusted print", "versioned template cache key", "PDF/PNG/ZIP and live preview share unlabeled artwork", "accessible names and ZIP manifest identities preserved"] }));
