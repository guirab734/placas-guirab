import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../app/lib/manual-reviews.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { initialManualReviews } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const empty = { targetUrl: "", initialReviews: null };
const direct = "https://search.google.com/local/writereview?placeid=ChIJQQX8TkyxGgcRJpLHP7fMEkY";
assert.equal(initialManualReviews(empty, { targetUrl: direct, currentReviews: 12 }), 12);
assert.equal(initialManualReviews(empty, { targetUrl: direct, currentReviews: 0, initialReviews: null }), 0);
assert.equal(initialManualReviews(empty, { targetUrl: direct, currentReviews: null }), undefined);
assert.equal(initialManualReviews(empty, { targetUrl: direct, currentReviews: 12, initialReviews: 5 }), 5);
assert.equal(initialManualReviews({ targetUrl: direct, initialReviews: null }, { targetUrl: direct, currentReviews: 12 }), undefined);
assert.equal(initialManualReviews({ targetUrl: "", initialReviews: 0 }, { targetUrl: direct, currentReviews: 12 }), undefined);

// The integration harness is deliberately restricted to localhost and a local-only password.
const origin = "http://127.0.0.1:5173";
let cookie = "";
async function request(path, method = "GET", body, auth = true, sentOrigin = origin) {
  return fetch(origin + path, { method, redirect: "manual", headers: {
    Origin: sentOrigin, "Content-Type": "application/json", "cf-connecting-ip": "198.51.100.97",
    ...(auth && cookie ? { Cookie: cookie } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function success(path, method = "GET", body, status = 200) {
  const response = await request(path, method, body);
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  assert.match(response.headers.get("cache-control"), /no-store/);
  return data;
}
for (const path of ["/api/links/profile", "/api/lojas/nonexistent/sincronizar"]) {
  assert.equal((await request(path, "POST", {}, false)).status, 401);
}
const login = await request("/api/auth/login", "POST", { password: "local-test-password" });
assert.equal(login.status, 200, await login.text());
cookie = login.headers.get("set-cookie").split(";", 1)[0];
const config = await success("/api/config");
assert.equal(config.reviewMode, "manual"); assert.equal(config.locationMode, "device");
assert.equal((await request("/api/links/profile", "POST", { url: direct })).status, 409);
assert.equal((await request("/api/links/profile", "POST", {}, true, "https://other.example")).status, 403);
assert.equal((await request("/api/lojas/nonexistent/sincronizar", "POST", {})).status, 404);

const [plate, zero, legacy] = (await success("/api/placas/lote", "POST", { quantity: 3 }, 201)).lojas;
const path = `/api/lojas/${plate.id}`;
const localDate = "2026-10-16";
let row = (await success(path, "PATCH", { name: "Teste local — cadastro manual", targetUrl: direct,
  joinedAt: localDate, currentReviews: 12, initialReviews: null, latitude: -10.95, longitude: -37.07,
  address: "Endereço de teste local", neighborhood: "Bairro de teste" })).loja;
assert.equal(row.currentReviews, 12); assert.equal(row.initialReviews, 12); assert.equal(row.reviewSource, "manual");
assert.equal(row.joinedAt, localDate); assert.equal(row.latitude, -10.95); assert.equal(row.longitude, -37.07);
assert.equal(row.googleSyncedAt, null); assert.equal(row.googleRating, null);
row = (await success(path, "PATCH", { currentReviews: 18 })).loja;
assert.equal(row.initialReviews, 12); assert.equal(row.currentReviews, 18); assert.equal(row.joinedAt, localDate);
assert.equal(row.latitude, -10.95); assert.equal(row.longitude, -37.07);
assert.equal((await request(`${path}/sincronizar`, "POST", {})).status, 409);
assert.equal((await request(`${path}/sincronizar`, "POST", {}, true, "https://other.example")).status, 403);

const zeroRow = (await success(`/api/lojas/${zero.id}`, "PATCH", { name: "Teste local — avaliações zero", targetUrl: direct,
  joinedAt: localDate, currentReviews: 0 })).loja;
assert.equal(zeroRow.initialReviews, 0); assert.equal(zeroRow.currentReviews, 0);
await success(`/api/lojas/${legacy.id}`, "PATCH", { name: "Teste local — base desconhecida", targetUrl: direct, joinedAt: localDate });
const legacyRow = (await success(`/api/lojas/${legacy.id}`, "PATCH", { targetUrl: direct, currentReviews: 30 })).loja;
assert.equal(legacyRow.initialReviews, null, "Never invent a historical baseline");
assert.equal((await request(`/r/${plate.code}`, "HEAD", undefined, false)).headers.get("location"), direct);
const reset = (await success(`${path}/redefinir`, "POST", { confirm: true })).loja;
assert.equal(reset.latitude, null); assert.equal(reset.longitude, null); assert.equal(reset.initialReviews, null);
const history = (await success(`${path}/historico`)).historico;
const restored = (await success(`${path}/restaurar`, "POST", { historyId: history[0].id })).loja;
assert.equal(restored.initialReviews, 12); assert.equal(restored.currentReviews, 18); assert.equal(restored.joinedAt, localDate);
assert.equal(restored.latitude, -10.95); assert.equal(restored.reviewSource, "manual");
await request("/api/auth/logout", "POST");
console.log(JSON.stringify({ passed: true, checks: ["manual review API mode", "profile and sync disabled behind auth/origin",
  "device date and GPS persisted", "first manual baseline including zero", "baseline/date/GPS preserved on edits",
  "unknown historical baseline preserved", "public QR redirect", "reset and restoration preserve manual snapshot"] }));
