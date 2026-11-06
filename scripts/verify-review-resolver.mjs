import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Entire suite uses fixtures. Every allowed request is explicitly mocked.
const code = ts.transpileModule(readFileSync(new URL("../app/lib/resolve-review.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { featurePlaceId, resolveReviewLink, ReviewLinkError } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
assert.equal(typeof featurePlaceId, "function");

// Sydney/SFO pairs appear independently in Google's official developer examples.
// Point do Pastel was previously matched to Google's own metadata. Galdinos and
// Renatao FIDs came from the supplied short URLs' Google 302 responses.
const pairs = [
  { name: "Sydney Opera House", fid: "0x6b12ae665e892fdd:0x3133f8d75a1ac251", id: "ChIJ3S-JXmauEmsRUcIaWtf4MzE" },
  { name: "Point do Pastel", fid: "0x71ab14c4efc0541:0x4612ccb73fc79226", id: "ChIJQQX8TkyxGgcRJpLHP7fMEkY" },
  { name: "Galdinos", fid: "0x71ab180ee22c6d9:0xf70716bc857243ee", id: "ChIJ2cYi7oCxGgcR7kNyhbwWB_c" },
  { name: "Renatao", fid: "0x71ab16934cc8219:0x750c7510e87c4446", id: "ChIJGYLMNGmxGgcRRkR86BB1DHU" },
  { name: "San Francisco International Airport", fid: "0x808f778c55555555:0xa4f25c571acded3f", id: "ChIJVVVVVYx3j4ARP-3NGldc8qQ" },
];
const review = id => `https://search.google.com/local/writereview?placeid=${id}`;
let unexpectedCalls = 0;
const never = async () => { unexpectedCalls++; throw new Error("Unexpected Google/metadata request"); };
for (const { name, fid, id } of pairs) {
  assert.equal(featurePlaceId(fid), id, name);
  assert.equal(featurePlaceId(fid.toUpperCase().replaceAll("0X", "0x")), id, `${name}: uppercase hex`);
  const full = `https://www.google.com/maps/place/${name.replaceAll(" ", "+")}/data=!4m6!3m5!1s${fid}!8m2!3d-10.97!4d-37.07`;
  const result = await resolveReviewLink(full, never);
  assert.equal(result.targetUrl, review(id)); assert.equal(result.converted, true); assert.equal(result.name, name);
  assert.equal((await resolveReviewLink(`https://www.google.com/maps/place//data=!4m3!3m2!1s${fid}!12e1`, never)).targetUrl, review(id));
}

// Independent uint64 decoding catches endianness errors and Number rounding.
for (const fid of ["0x1:0x1", "0x0000000000000001:0x0000000000000002",
  "0x0102030405060708:0x1020304050607080", "0x20000000000001:0x20000000000003",
  "0xffffffffffffffff:0xffffffffffffffff"]) {
  const id = featurePlaceId(fid), bytes = Buffer.from(id, "base64url"), [first, second] = fid.split(":").map(BigInt);
  assert.equal(bytes.length, 20, fid); assert.deepEqual([...bytes.subarray(0, 3)], [0x0a, 0x12, 0x09]);
  assert.equal(bytes[11], 0x11); assert.equal(bytes.readBigUInt64LE(3), first); assert.equal(bytes.readBigUInt64LE(12), second);
  assert.equal(bytes.toString("base64url"), id); assert.ok(!/[+/=]/.test(id));
}
for (const fid of ["0x0:0x0", "0x0:0x1", "0x1:0x0", "0x0000000000000000:0x1", "0x-1:0x2", "-1:2",
  "0x10000000000000000:0x1", "0x1:0x10000000000000000", "0xg:0x1", "0x1:0xg", "0x1", "0x1:0x2:0x3",
  "1:2", " 0x1:0x2", "0x1:0x2 trailing", "0x:0x1", ""]) assert.equal(featurePlaceId(fid), undefined, fid);

const { fid, id } = pairs[1], expected = review(id), other = pairs[0].id;
const full = `https://www.google.com/maps/place/Point+do+Pastel/data=!4m6!3m5!1s${fid}!8m2!3d-10.9745238!4d-37.0736828`;
const short = "https://maps.app.goo.gl/test-code";
for (const key of ["query_place_id", "place_id", "placeid"]) {
  assert.equal((await resolveReviewLink(`https://www.google.com/maps/search/?${key}=${id}`, never)).targetUrl, expected);
}
assert.equal((await resolveReviewLink(`https://www.google.com/maps?q=place_id:${id}`, never)).targetUrl, expected);
assert.equal((await resolveReviewLink(expected, never)).converted, false);
assert.equal((await resolveReviewLink(`https://www.google.com/maps/place/Point/data=!1s${id}`, never)).targetUrl, expected);
for (const direct of ["https://g.page/r/local-test/review", "https://g.page/local-shortname/review/"]) {
  assert.deepEqual(await resolveReviewLink(direct, never), { targetUrl: direct, converted: false });
}
assert.equal(unexpectedCalls, 0, "FID, explicit ID and direct review links make zero requests");

let shortCalls = 0;
const expanded = await resolveReviewLink(short, async (url, options) => {
  shortCalls++; assert.equal(url, short); assert.equal(options.redirect, "manual"); assert.ok(options.signal);
  return new Response(null, { status: 302, headers: { location: full } });
});
assert.equal(expanded.targetUrl, expected); assert.equal(expanded.name, "Point do Pastel");
assert.equal(shortCalls, 1, "Stop after expansion; never request canonical HTML or metadata");
for (const html of [`<meta http-equiv="refresh" content="0;url=${full}">`, `<link rel="canonical" href="${full}">`]) {
  let calls = 0;
  assert.equal((await resolveReviewLink(short, async (url, options) => {
    calls++; assert.equal(url, short); assert.equal(options.redirect, "manual"); return new Response(html);
  })).targetUrl, expected);
  assert.equal(calls, 1);
}

for (const invalid of [
  "https://example.com", "http://maps.app.goo.gl/test", "https://maps.app.goo.gl.evil.test/x",
  "https://user:password@www.google.com/maps", "https://127.0.0.1/", "https://www.google.com:8443/maps",
  "https://maps.google.com/?cid=5049323219656872486",
  "https://search.google.com/local/writereview?placeid=5049323219656872486",
  `https://www.google.com/maps/place/data=!1s${fid}a`,
  "https://www.google.com/maps/place/data=!1s0x0:0x4612ccb73fc79226",
  `https://www.google.com/maps?placeid=${id}&place_id=${other}`,
  `${full}!1s0x123:0x456`, `${full}?query_place_id=${id}`,
  "https://www.google.com/maps/place/Store/?q=Store+Aracaju",
]) await assert.rejects(resolveReviewLink(invalid, never), ReviewLinkError, invalid);
assert.equal(unexpectedCalls, 0);
for (const external of ["https://127.0.0.1/private", "http://www.google.com/maps", "https://evil.example/", "https://www.google.com:8443/maps"]) {
  let calls = 0;
  await assert.rejects(resolveReviewLink(short, async (url, options) => {
    calls++; assert.equal(url, short); assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: external } });
  }), ReviewLinkError);
  assert.equal(calls, 1, "Never follow an unsafe redirect");
}
let blockedCalls = 0;
await assert.rejects(resolveReviewLink(short, async url => {
  blockedCalls++; assert.equal(url, short);
  return new Response(null, { status: 302, headers: { location: "https://www.google.com/sorry/index" } });
}), error => error instanceof ReviewLinkError && error.reason === "GoogleAccessBlocked");
assert.equal(blockedCalls, 1, "Never fetch or bypass the Google challenge");
await assert.rejects(resolveReviewLink(short, async () => new Response(null, { status: 429 })),
  error => error instanceof ReviewLinkError && error.reason === "GoogleAccessBlocked");
await assert.rejects(resolveReviewLink(short, async () => new Response(null, { status: 500 })), ReviewLinkError);
await assert.rejects(resolveReviewLink(short, async () => new Response(null, { status: 302 })), ReviewLinkError);
await assert.rejects(resolveReviewLink(short, async () => new Response(null, { status: 302, headers: { location: short } })), ReviewLinkError);
let hops = 0;
await assert.rejects(resolveReviewLink(short, async () => {
  hops++; return new Response(null, { status: 302, headers: { location: `https://maps.app.goo.gl/hop-${hops}` } });
}), ReviewLinkError);
assert.equal(hops, 5, "One five-hop budget for the complete chain");
await assert.rejects(resolveReviewLink(short, async () => new Response("x".repeat(262145))), ReviewLinkError);
await assert.rejects(resolveReviewLink(short, async () => { throw new DOMException("Timed out", "AbortError"); }), ReviewLinkError);

// Only speed up the fixture's timer. Production still has the shared 8s deadline.
const nativeTimer = globalThis.setTimeout; let timerDuration;
globalThis.setTimeout = (callback, ms, ...args) => { timerDuration = ms; return nativeTimer(callback, 5, ...args); };
try {
  await assert.rejects(resolveReviewLink(short, async (url, options) => {
    assert.equal(url, short);
    return new Response(new ReadableStream({ start(controller) {
      options.signal.addEventListener("abort", () => controller.error(new DOMException("Timed out", "AbortError")), { once: true });
    } }));
  }), ReviewLinkError);
  assert.equal(timerDuration, 8000);
} finally { globalThis.setTimeout = nativeTimer; }

console.log(JSON.stringify({ passed: true, liveRequests: 0, checks: [
  "five known FID and Place ID pairs", "20-byte uint64 little-endian serialization", "64-bit precision and canonical base64url",
  "zero invalid and maximum uint64 boundaries", "FID and explicit IDs need no metadata", "direct review links preserved",
  "single-hop short-link expansion", "HTML short-link expansion", "ambiguous and malformed identifiers rejected",
  "HTTPS host credential and port bounds", "unsafe redirects never followed", "stop before CAPTCHA and HTTP429",
  "five-hop budget and loops", "short-link stream size and deadline",
] }));
