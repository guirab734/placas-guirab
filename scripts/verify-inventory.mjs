import assert from "node:assert/strict";

const origin = "http://127.0.0.1:5173";
let cookie = "";
async function request(path, method = "GET", body, authenticated = true) {
  return fetch(origin + path, { method, redirect: "manual", headers: {
    Origin: origin, "Content-Type": "application/json", "cf-connecting-ip": "198.51.100.67",
    ...(authenticated && cookie ? { Cookie: cookie } : {}),
  }, body: body ? JSON.stringify(body) : undefined });
}
assert.equal((await request("/api/placas/lote", "POST", { quantity: 1 })).status, 401);
const login = await request("/api/auth/login", "POST", { password: "local-test-password" });
assert.equal(login.status, 200, await login.text());
cookie = login.headers.get("set-cookie").split(";", 1)[0];
for (const quantity of [0, 51, 1.5, "2"]) {
  assert.equal((await request("/api/placas/lote", "POST", { quantity })).status, 400);
}
const batches = await Promise.all([3, 2].map(async quantity => {
  const response = await request("/api/placas/lote", "POST", { quantity });
  const data = await response.json();
  assert.equal(response.status, 201, JSON.stringify(data));
  assert.equal(data.lojas.length, quantity);
  return data.lojas;
}));
const made = batches.flat();
assert.equal(new Set(made.map(row => row.code)).size, 5);
assert.equal(new Set(made.map(row => row.id)).size, 5);
assert.equal(new Set(made.map(row => row.plateNumber)).size, 5);
for (const row of made) {
  assert.match(row.code, /^[A-HJKMNP-Z][A-HJKMNP-Z2-9]{3}$/);
  assert.ok(Number.isInteger(row.plateNumber) && row.plateNumber > 0);
  assert.equal(row.targetUrl, ""); assert.equal(row.active, false); assert.equal(row.scans, 0);
}
const plate = made[0], path = `/r/${plate.code}`;
const draft = await request(path, "GET", undefined, false);
assert.equal(draft.status, 200); assert.match(await draft.text(), /ainda não foi ativada/);
assert.match(draft.headers.get("cache-control"), /no-store/);
assert.equal((await request(`/api/lojas/${plate.id}`, "PATCH", { active: true })).status, 409);
assert.equal((await request(`/api/lojas/${plate.id}`, "PATCH", { name: "Loja local", targetUrl: "https://example.com/review" })).status, 400);
const target = "https://g.page/r/inventory-local-one/review";
const activated = await request(`/api/lojas/${plate.id}`, "PATCH", { name: "Loja configurada localmente", targetUrl: target });
assert.equal(activated.status, 200);
const active = (await activated.json()).loja;
assert.equal(active.code, plate.code); assert.equal(active.active, true);
const head = await request(path, "HEAD", undefined, false);
assert.equal(head.status, 302); assert.equal(head.headers.get("location"), target);
assert.equal((await request(path, "GET", undefined, false)).status, 302);
const target2 = "https://g.page/r/inventory-local-two/review";
const changed = await request(`/api/lojas/${plate.id}`, "PATCH", { targetUrl: target2 });
assert.equal(changed.status, 200); assert.equal((await changed.json()).loja.code, plate.code);
assert.equal((await request(path, "HEAD", undefined, false)).headers.get("location"), target2);
assert.equal((await request(`/api/lojas/${plate.id}`, "PATCH", { active: false })).status, 200);
assert.equal((await request(path, "HEAD", undefined, false)).status, 410);
assert.equal((await request(`/api/lojas/${plate.id}`, "PATCH", { active: true })).status, 200);
assert.equal((await request(`/r/${made[1].code}`, "HEAD", undefined, false)).status, 200);
const old = await request("/api/lojas", "POST", { name: "Formato antigo local", targetUrl: target });
assert.equal(old.status, 201); const legacy = (await old.json()).loja;
assert.match(legacy.code, /^[A-HJKMNP-Z][A-HJKMNP-Z2-9]{3}$/);
assert.equal((await request(`/r/${legacy.code}`, "HEAD", undefined, false)).status, 302);
const list = (await (await request("/api/lojas")).json()).lojas;
assert.equal(list.find(row => row.id === plate.id).scans, 1, "Draft and HEAD reads must not count");
await request("/api/auth/logout", "POST");
console.log(JSON.stringify({ passed: true, generated_local_codes: made.map(row => row.code), checks: [
  "batch auth and bounds", "concurrent unique numbers", "unassigned public page", "activation requires destination",
  "Google-only targets", "configure after generation", "immutable QR on destination change", "pause and resume",
  "four-character handwritten codes", "draft and HEAD not counted"
] }));
