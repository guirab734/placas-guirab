import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../app/lib/resolve-review.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const { resolvePlateDestination, plateTargetMode, ReviewLinkError } = module;
const short = "https://maps.app.goo.gl/U6nHDyUHdKBk2WCS6";
const fid = "0x71ab16934cc8219:0x750c7510e87c4446";
const full = `https://www.google.com/maps/place/Renatao/data=!4m6!3m5!1s${fid}!8m2!3d-10.9756373!4d-37.0719264`;
const id = "ChIJGYLMNGmxGgcRRkR86BB1DHU";
const review = `https://search.google.com/local/writereview?placeid=${id}`;
let unexpectedCalls = 0;
const never = async () => { unexpectedCalls++; throw new Error("No network should be needed"); };
assert.equal(plateTargetMode(undefined), "review"); assert.equal(plateTargetMode("review"), "review");
assert.equal(module.resolveProfileLink, undefined, "No profile downgrade entry point remains");
for (const mode of [undefined, "review"]) {
  for (const url of [review, "https://g.page/r/local-test/review", "https://g.page/local-test/review"]) {
    assert.deepEqual(await resolvePlateDestination(url, mode, never), { targetUrl: url, converted: false, destinationKind: "review" });
  }
  assert.deepEqual(await resolvePlateDestination(full, mode, never), {
    targetUrl: review, converted: true, destinationKind: "review", name: "Renatao",
  });
}
for (const mode of ["profile", "invalid", "", null, true, false, 0, {}, ["review"]]) {
  assert.throws(() => plateTargetMode(mode), error => error instanceof ReviewLinkError && error.reason === "InvalidMode");
  await assert.rejects(resolvePlateDestination(short, mode, never), error => error.reason === "InvalidMode" && !error.profileFallback);
}
assert.equal(unexpectedCalls, 0, "Direct review, FID conversion and mode validation make no requests");

let calls = 0;
assert.deepEqual(await resolvePlateDestination(short, undefined, async (url, options) => {
  calls++; assert.equal(url, short); assert.equal(options.redirect, "manual"); assert.ok(options.signal);
  return new Response(null, { status: 302, headers: { location: full } });
}), { targetUrl: review, converted: true, destinationKind: "review", name: "Renatao" });
assert.equal(calls, 1, "Short URL expansion does not fetch the place page");

async function noDowngrade(fetcher, url = short) {
  await assert.rejects(resolvePlateDestination(url, undefined, fetcher), error => {
    assert.ok(error instanceof ReviewLinkError); assert.equal(error.profileFallback, undefined);
    assert.equal(error.destinationKind, undefined); assert.equal(error.targetUrl, undefined);
    assert.doesNotMatch(error.message, /escolha usar|usar o perfil|integração oficial|API/i);
    return true;
  });
}
await noDowngrade(async () => new Response(null, { status: 429 }));
await noDowngrade(async () => { throw new DOMException("Timed out", "AbortError"); });
await noDowngrade(async () => new Response("<html>No Google redirect available</html>"));
await noDowngrade(async () => new Response(null, { status: 302, headers: { location: "https://www.google.com/sorry/index" } }));
for (const url of ["https://www.google.com/", "https://www.google.com/url?q=https://evil.example",
  "https://www.google.com/maps/place/Store/?q=Store+Aracaju", "https://example.com/store",
  full + `?placeid=${id}`, full + "!1s0x123:0x456"]) await noDowngrade(never, url);
for (const location of ["https://127.0.0.1/private", short, "http://[invalid"]) {
  await noDowngrade(async () => new Response(null, { status: 302, headers: { location } }));
}
assert.equal(unexpectedCalls, 0);
console.log(JSON.stringify({ passed: true, liveRequests: 0, checks: [
  "only direct review mode accepted", "profile fallback entry point removed", "full FID converts without metadata",
  "direct review links preserved", "one-hop short expansion", "blocks and timeouts never downgrade to profiles",
  "invalid and ambiguous URLs rejected", "unsafe redirects rejected",
] }));
