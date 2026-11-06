import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const data = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const resolverUrl = data(source("../app/lib/resolve-review.ts"));
const officialUrl = data(source("../app/lib/places-official.ts").replace('"./resolve-review"', JSON.stringify(resolverUrl)));
const profileUrl = data(source("../app/lib/places-profile.ts").replace('"./resolve-review"', JSON.stringify(resolverUrl)).replace('"./places-official"', JSON.stringify(officialUrl)));
const { resolveReviewLink, GoogleAccessBlocked, ReviewLinkError } = await import(resolverUrl);
const { officialGooglePlaceProfile, officialPlaceProfile, PLACES_FIELD_MASK } = await import(officialUrl);
const { googlePlaceProfile, reviewLinkWithOptionalProfile } = await import(profileUrl);
const id = "ChIJQQX8TkyxGgcRJpLHP7fMEkY", fid = "0x71ab14c4efc0541:0x4612ccb73fc79226";
const target = `https://search.google.com/local/writereview?placeid=${id}`;
const full = `https://www.google.com/maps/place/Point+do+Pastel/data=!4m2!3m1!1s${fid}`;
const key = "test-api-key-not-real", logs = [], nativeLog = console.info;
console.info = line => logs.push(line);
try {
  let calls = 0;
  const directFromFid = await resolveReviewLink(full, async () => {
    calls++; return new Response(null, { status: 429 });
  });
  assert.equal(directFromFid.targetUrl, target);
  assert.equal(calls, 0, "Full FID review conversion never requests blocked HTML or metadata");
  calls = 0;
  await assert.rejects(googlePlaceProfile(target, async () => { calls++; return new Response("do not read", { status: 429 }); }), GoogleAccessBlocked);
  assert.equal(calls, 1);
  const place = { id, displayName: { text: "Point do Pastel" }, formattedAddress: "Rua Central, 10 - Farolândia, Aracaju - SE",
    addressComponents: [{ longText: "Farolândia", types: ["sublocality_level_1", "sublocality"] }],
    location: { latitude: -10.9745238, longitude: -37.0736828 }, rating: 4.7, userRatingCount: 30,
    nationalPhoneNumber: "(79) 99973-0303", googleMapsUri: "https://maps.google.com/?cid=5049323219656872486" };
  const mock = async (url, options) => {
    assert.equal(new URL(url).hostname, "places.googleapis.com"); assert.equal(new URL(url).pathname, `/v1/places/${id}`);
    assert.equal(new URL(url).searchParams.has("key"), false); assert.equal(options.headers["X-Goog-Api-Key"], key);
    assert.equal(options.headers["X-Goog-FieldMask"], PLACES_FIELD_MASK); assert.equal(options.redirect, "manual"); assert.ok(options.signal);
    return Response.json(place);
  };
  const profile = await officialGooglePlaceProfile(target, key, mock);
  assert.equal(profile.placeId, id); assert.equal(profile.name, "Point do Pastel"); assert.equal(profile.targetUrl, target);
  assert.equal(profile.reviewCount, 30); assert.equal(profile.rating, 4.7); assert.equal(profile.businessPhone, place.nationalPhoneNumber);
  assert.equal(profile.neighborhood, "Farolândia"); assert.equal(profile.candidateConfirmationRequired, undefined);
  assert.equal((await googlePlaceProfile(target, mock, key)).placeId, id);
  const zero = officialPlaceProfile({ ...place, userRatingCount: 0, rating: 0 }, id); assert.equal(zero.reviewCount, 0); assert.equal(zero.rating, 0);
  const missing = officialPlaceProfile({ id, displayName: { text: "Point do Pastel" } }, id);
  for (const field of ["reviewCount", "rating", "businessPhone", "latitude", "longitude", "address", "neighborhood"]) assert.ok(!(field in missing));
  assert.throws(() => officialPlaceProfile({ ...place, id: "AnotherPlaceId123" }, id), error => error.reason === "GooglePlacesIdentityMismatch");
  assert.match(officialPlaceProfile({ ...place, googleMapsUri: "https://evil.example/" }, id).googleMapsUrl, /^https:\/\/www.google.com/);
  const short = "https://maps.app.goo.gl/official-mock";
  const expanded = await officialGooglePlaceProfile(short, key, async (url, options) => url === short
    ? new Response(null, { status: 302, headers: { location: target } }) : mock(url, options));
  assert.equal(expanded.placeId, id);
  calls = 0;
  await assert.rejects(officialGooglePlaceProfile(short, key, async url => {
    calls++; assert.equal(url, short); return new Response(null, { status: 302, headers: { location: full } });
  }), error => error.reason === "GooglePlaceIdRequired");
  assert.equal(calls, 1, "A FID never triggers a paid candidate search or guessed Place ID");
  const never = async () => { throw new Error("Unexpected request"); };
  for (const invalid of ["https://127.0.0.1/private", "https://www.google.com/maps?placeid=5049323219656872486", `${target}&place_id=AnotherPlaceId123`]) await assert.rejects(officialGooglePlaceProfile(invalid, key, never), ReviewLinkError);
  for (const response of [() => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } }),
    () => new Response("key must never be exposed", { status: 403 }), () => new Response("x".repeat(131073))]) {
    await assert.rejects(officialGooglePlaceProfile(target, key, async () => response()), error => error.reason === "GooglePlacesUnavailable");
  }
  const fallback = await reviewLinkWithOptionalProfile(target, async () => new Response(null, { status: 403 }), key);
  assert.equal(fallback.targetUrl, target); assert.equal(fallback.profile, undefined);
  const nativeTimer = globalThis.setTimeout;
  globalThis.setTimeout = (callback, ms, ...args) => nativeTimer(callback, 5, ...args);
  try {
    await assert.rejects(officialGooglePlaceProfile(target, key, async (url, options) => new Response(new ReadableStream({ start(controller) {
      options.signal.addEventListener("abort", () => controller.error(new DOMException("Timed out", "AbortError")), { once: true });
    } }))), error => error.reason === "GooglePlacesUnavailable");
  } finally { globalThis.setTimeout = nativeTimer; }
  const diagnostic = logs.join("\n");
  for (const secret of [key, id, fid, "Point do Pastel", "continue=private", "5049323219656872486"]) assert.equal(diagnostic.includes(secret), false);
} finally { console.info = nativeLog; }
console.log(JSON.stringify({ passed: true, paidCalls: 0, checks: ["stop before CAPTCHA", "429 structured block reason", "official exact Place ID with minimal field mask", "key only in backend header", "short expansion to explicit ID", "FID requires verified review link", "missing fields omitted and zero preserved", "identity mismatch rejected", "SSRF/redirect/body/deadline bounds", "manual direct review fallback", "diagnostics contain no key or business identifiers"] }));
