import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function moduleSource(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
}
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const resolver = dataModule(moduleSource("../app/lib/resolve-review.ts"));
const official = dataModule(moduleSource("../app/lib/places-official.ts").replace('"./resolve-review"', JSON.stringify(resolver)));
const profileModule = dataModule(moduleSource("../app/lib/places-profile.ts").replace('"./resolve-review"', JSON.stringify(resolver))
  .replace('"./places-official"', JSON.stringify(official)));
const { parseGooglePlaceProfile, googlePlaceProfile, profileValues, reviewLinkWithOptionalProfile } = await import(profileModule);
const { ReviewLinkError } = await import(resolver);
const fid = "0x71ab14c4efc0541:0x4612ccb73fc79226", id = "ChIJQQX8TkyxGgcRJpLHP7fMEkY";
const otherId = "ChIJBBBBBBBBBBBBBBBBBBBBBBB", otherFid = "0x123:0x456";
const target = `https://search.google.com/local/writereview?placeid=${id}`;
const canonical = `https://www.google.com/maps/place//data=!4m2!3m1!1s${fid}`;
const byId = `https://www.google.com/maps/place/?q=place_id:${id}`;
const full = `https://www.google.com/maps/place/Point+do+Pastel/data=!4m2!3m1!1s${fid}`;
const short = "https://maps.app.goo.gl/test-profile";
const preload = `<link rel="preload" href="/maps/preview/place?pb=${encodeURIComponent(`!1m2!1s${fid}!2sPoint`)}&amp;authuser=0">`;
// Minimal factual cells observed in Google's published Point do Pastel metadata on 2026-10-15.
// No customer review text, reviewer data, photos, or unrelated establishment metadata are copied.
function row(feature = fid, place = id) {
  const cells = Array(228).fill(null);
  cells[4] = [null, null, null, null, null, null, null, 4.7, 30];
  cells[9] = [null, null, -10.9745238, -37.0736828]; cells[10] = feature;
  cells[11] = "Point do Pastel"; cells[14] = "Farolândia";
  cells[39] = "R. Abraão Crispim de Souza, 437 - Farolândia, Aracaju - SE, 49030-070";
  cells[78] = place; cells[178] = [["(79) 99973-0303"]];
  cells[227] = [[feature, null, null, "/g/11v0qxhrrf", place]];
  return cells;
}
const json = rows => ")]}'\n" + JSON.stringify({ places: rows });
function fixture({ html = preload, metadata = json([row()]), redirect } = {}) {
  return async (url, options) => {
    assert.equal(options.redirect, "manual"); assert.ok(options.signal);
    if (url === short) return new Response(null, { status: 302, headers: { location: full } });
    if (url === canonical || url === byId) return new Response(html);
    assert.equal(new URL(url).pathname, "/maps/preview/place");
    return redirect ? new Response(null, { status: 302, headers: { location: redirect } }) : new Response(metadata);
  };
}
const expected = {
  placeId: id, targetUrl: target, googleMapsUrl: byId, name: "Point do Pastel", fetchedAt: "2026-10-15T01:00:00.000Z",
  address: "R. Abraão Crispim de Souza, 437 - Farolândia, Aracaju - SE, 49030-070", neighborhood: "Farolândia",
  latitude: -10.9745238, longitude: -37.0736828, rating: 4.7, reviewCount: 30, businessPhone: "(79) 99973-0303",
};
assert.deepEqual(parseGooglePlaceProfile(json([row()]), { fid }, expected.fetchedAt), expected);
for (const input of [short, full, target]) {
  const result = await googlePlaceProfile(input, fixture());
  assert.deepEqual({ ...result, fetchedAt: expected.fetchedAt }, expected);
}
const minimal = row();
for (const index of [4, 9, 14, 39, 178]) minimal[index] = null;
const missing = parseGooglePlaceProfile(json([minimal]), { fid });
for (const key of ["reviewCount", "rating", "address", "neighborhood", "latitude", "longitude", "businessPhone"]) assert.ok(!(key in missing), key);
const zero = row(); zero[4][8] = 0; zero[4][7] = 0;
assert.equal(parseGooglePlaceProfile(json([zero]), { fid }).reviewCount, 0);
const wrongTuple = row(); wrongTuple[227][0][4] = otherId;
for (const rows of [[], [row(otherFid)], [row(), row(fid, otherId)], [wrongTuple]]) assert.throws(() => parseGooglePlaceProfile(json(rows), { fid }), ReviewLinkError);
assert.throws(() => parseGooglePlaceProfile(json([row()]), { fid, expectedPlaceId: otherId }), ReviewLinkError);
const sameBusiness = await googlePlaceProfile(full, fixture({ metadata: json([row(otherFid, otherId), row()]) }));
assert.equal(sameBusiness.reviewCount, 30);
for (const options of [
  { metadata: json([row(otherFid, otherId)]) }, { metadata: json([row(), row(fid, otherId)]) }, { html: "No preload" },
  { html: `<link href="https://127.0.0.1/maps/preview/place?pb=${encodeURIComponent(`!1s${fid}`)}">` },
  { redirect: "https://127.0.0.1/private" }, { redirect: `https://www.google.com/maps/preview/place?pb=!1s${otherFid}` },
  { html: "x".repeat(262145) }, { metadata: "x".repeat(262145) },
]) await assert.rejects(googlePlaceProfile(full, fixture(options)), ReviewLinkError);
let calls = 0;
await assert.rejects(googlePlaceProfile(target, async url => {
  calls++; assert.equal(url, byId); return new Response(preload.replaceAll(encodeURIComponent(fid), encodeURIComponent(otherFid)));
}), ReviewLinkError);
assert.equal(calls, 2); // Wrong identity is checked against the requested Place ID after metadata loads.
const blank = { targetUrl: "", name: "Placa 001", address: "", neighborhood: "", businessPhone: "", initialReviews: null };
const fill = profileValues(expected, blank, {});
assert.equal(fill.currentReviews, 30); assert.equal(fill.initialReviews, 30); assert.equal(fill.reviewSource, "google");
assert.equal(profileValues({ ...expected, reviewCount: 0 }, blank, {}).initialReviews, 0);
assert.equal(profileValues(expected, { ...blank, name: "Nome manual", address: "Endereço manual", initialReviews: 5 }, {}).name, undefined);
assert.equal(profileValues(expected, { ...blank, address: "Endereço manual" }, {}).address, undefined);
const explicit = profileValues(expected, blank, { name: "Nome manual", currentReviews: 7, address: "Outro endereço", ownerPhone: "(79) 99999-8888" });
assert.ok(!("currentReviews" in explicit)); assert.ok(!("address" in explicit)); assert.ok(!("name" in explicit));
assert.equal(explicit.reviewSource, "manual"); assert.ok(!("ownerPhone" in explicit));
const sync = profileValues(expected, { ...blank, targetUrl: target, initialReviews: 3 }, {}, true);
assert.equal(sync.currentReviews, 30); assert.ok(!("initialReviews" in sync)); assert.ok(!("name" in sync));
assert.equal(sync.address, expected.address); assert.ok(!("ownerName" in sync)); assert.ok(!("notes" in sync));
const direct = "https://g.page/r/test-direct/review";
const fallback = await reviewLinkWithOptionalProfile(direct, async () => new Response("not identified", { status: 404 }));
assert.equal(fallback.targetUrl, direct); assert.equal(fallback.profile, undefined);
const nativeTimer = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => nativeTimer(callback, 5, ...args);
try {
  await assert.rejects(googlePlaceProfile(full, async (url, options) => {
    if (url === canonical) return new Response(preload);
    return new Response(new ReadableStream({ start(controller) { options.signal.addEventListener("abort", () => controller.error(new DOMException("Timed out", "AbortError")), { once: true }); } }));
  }), ReviewLinkError);
} finally { globalThis.setTimeout = nativeTimer; }
console.log(JSON.stringify({ passed: true, checks: ["same-row identity and factual fields", "short/FID/explicit Place ID", "missing fields omitted", "zero reviews preserved", "wrong and ambiguous identity rejected", "SSRF and payload bounds", "stream deadline", "manual CRM precedence", "initial base only first association", "sync preserves owner and baseline", "review-link fallback"] }));
if (process.argv.includes("--live")) {
  for (const input of ["https://maps.app.goo.gl/X5qE4duESJsgMB4g8", target]) {
    const result = await googlePlaceProfile(input);
    assert.equal(result.placeId, id); assert.equal(result.name, "Point do Pastel"); assert.equal(result.targetUrl, target);
    assert.equal(result.neighborhood, "Farolândia"); assert.equal(result.latitude, -10.9745238); assert.equal(result.longitude, -37.0736828);
    assert.ok(result.reviewCount >= 30); assert.ok(result.rating >= 0 && result.rating <= 5);
    console.log(JSON.stringify({ live: true, input, profile: result }));
  }
}
