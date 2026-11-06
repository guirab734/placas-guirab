import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, join, relative } from "node:path";
import { randomUUID } from "node:crypto";

// Deliberately fixed to localhost. Fixture writes are restricted to Wrangler's local SQLite directory.
const origin = "http://127.0.0.1:5173";
const repo = fileURLToPath(new URL("../", import.meta.url));
const stateRoot = resolve(repo, ".wrangler/state/v3/d1");
function sqliteFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sqliteFiles(join(directory, entry.name)) : entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite" ? [join(directory, entry.name)] : []);
}
const files = sqliteFiles(stateRoot);
assert.equal(files.length, 1, "Expected exactly one local D1 database; never select a remote database");
const fixturePath = resolve(files[0]);
assert.ok(!relative(stateRoot, fixturePath).startsWith(".."));
function fixture(query, ...params) {
  const db = new DatabaseSync(fixturePath);
  try { db.exec("PRAGMA busy_timeout=5000"); return db.prepare(query).all(...params); }
  finally { db.close(); }
}

let cookie = "";
async function request(path, method = "GET", body, auth = true, sentOrigin = origin) {
  return fetch(origin + path, { method, redirect: "manual", headers: {
    Origin: sentOrigin, "Content-Type": "application/json", "cf-connecting-ip": "198.51.100.91",
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
const absent = randomUUID();
for (const [path, method, body] of [
  ["/api/lojas", "GET"], [`/api/lojas/${absent}`, "GET"], [`/api/lojas/${absent}/historico`, "GET"],
  [`/api/lojas/${absent}/redefinir`, "POST", { confirm: true }],
  [`/api/lojas/${absent}/restaurar`, "POST", { historyId: randomUUID() }], ["/api/placas/codigos", "POST", {}],
]) assert.equal((await request(path, method, body)).status, 401);
const login = await request("/api/auth/login", "POST", { password: "local-test-password" });
assert.equal(login.status, 200, await login.text());
cookie = login.headers.get("set-cookie").split(";", 1)[0];

const plates = (await success("/api/placas/lote", "POST", { quantity: 2 }, 201)).lojas;
const [plate, second] = plates;
for (const row of plates) {
  assert.match(row.code, /^[A-HJKMNP-Z][A-HJKMNP-Z2-9]{3}$/); assert.ok(row.plateNumber > 0);
  assert.equal(row.legacyCode, null); assert.equal(row.joinedAt, null);
  assert.equal(row.initialReviews, null); assert.equal(row.currentReviews, null);
  assert.equal(row.ownerName, ""); assert.equal(row.ownerPhone, "");
  assert.ok(!("ownerId" in row));
}
const path = `/api/lojas/${plate.id}`;
assert.equal((await request(path, "PATCH", { notes: "bad origin" }, true, "https://untrusted.example")).status, 403);
await success(path, "PATCH", { notes: "CRM antes da ativação", ownerName: "Responsável local" });
for (const invalid of [
  { initialReviews: -1 }, { currentReviews: 1.5 }, { currentReviews: 10_000_001 }, { currentReviews: "10" },
  { joinedAt: "2026-02-30" }, { joinedAt: "2026-2-14" }, { nextContactAt: "2025-02-29" },
  { ownerPhone: "1234" }, { ownerPhone: "+55 telefone" }, { ownerName: "x".repeat(121) },
  { address: "x".repeat(301) }, { neighborhood: "x".repeat(101) }, { notes: "x".repeat(2001) },
]) assert.equal((await request(path, "PATCH", invalid)).status, 400, JSON.stringify(invalid));
const target = "https://g.page/r/crm-local-one/review";
let configured = (await success(path, "PATCH", {
  name: "Loja de teste CRM", targetUrl: target, initialReviews: 0, currentReviews: 12,
  ownerName: "Maria da Loja", ownerPhone: "+55 (31) 99999-8888", address: "Rua Central, 100",
  neighborhood: "Centro", notes: "Retornar após a demonstração", nextContactAt: "2026-12-01",
})).loja;
assert.equal(configured.active, true);
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
assert.equal(configured.joinedAt, today); assert.equal(configured.initialReviews, 0);
assert.match(configured.reviewsUpdatedAt, /^\d{4}-\d{2}-\d{2}T/);
const reviewsAt = configured.reviewsUpdatedAt;
assert.equal((await success(path, "PATCH", { notes: "Alteração apenas de contato" })).loja.reviewsUpdatedAt, reviewsAt);
assert.equal((await success(path, "PATCH", { currentReviews: 12 })).loja.reviewsUpdatedAt, reviewsAt);
assert.equal((await success(path, "PATCH", { currentReviews: null })).loja.reviewsUpdatedAt, null);
configured = (await success(path, "PATCH", { currentReviews: 18, joinedAt: "2024-02-29" })).loja;
assert.equal(configured.joinedAt, "2024-02-29");

// Simulate one pre-upgrade numeric plate without modifying any previous local test record.
const numericCode = String(plate.plateNumber);
fixture("UPDATE lojas SET code = ?, plate_number = NULL, legacy_code = NULL WHERE id = ?", numericCode, plate.id);
const foreignId = randomUUID(), foreignOwner = `crm-foreign-${randomUUID()}`;
const foreignCode = String(700_000_000 + Math.floor(Math.random() * 200_000_000));
const now = new Date().toISOString();
fixture("INSERT INTO lojas (id,owner_id,code,name,target_url,active,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)",
  foreignId, foreignOwner, foreignCode, "Outra conta local", "", now, now);
try {
  const migrated = await Promise.all([success("/api/placas/codigos", "POST", {}), success("/api/placas/codigos", "POST", {})]);
  assert.ok(migrated.reduce((sum, data) => sum + data.migrated, 0) >= 1);
  const current = (await success(path)).loja;
  assert.match(current.code, /^[A-HJKMNP-Z][A-HJKMNP-Z2-9]{3}$/); assert.equal(current.legacyCode, numericCode);
  assert.equal(current.plateNumber, plate.plateNumber);
  assert.equal((await success("/api/placas/codigos", "POST", {})).migrated, 0);
  assert.equal((await success(path)).loja.code, current.code);
  assert.equal(fixture("SELECT code FROM lojas WHERE id = ?", foreignId)[0].code, foreignCode);
  for (const code of [numericCode, current.code]) {
    const head = await request(`/r/${code}`, "HEAD", undefined, false);
    assert.equal(head.status, 302); assert.equal(head.headers.get("location"), target);
    assert.match(head.headers.get("cache-control"), /no-store/);
  }
  assert.equal((await request(`/r/${numericCode}`, "GET", undefined, false)).status, 302);
  configured = (await success(path)).loja; assert.equal(configured.scans, 1);
  const list = (await success("/api/lojas")).lojas;
  assert.ok(!list.some(row => row.id === foreignId)); assert.ok(list.every(row => !("ownerId" in row)));
  for (const [suffix, method, body] of [["", "GET"], ["", "PATCH", { notes: "x" }], ["/historico", "GET"], ["/redefinir", "POST", { confirm: true }]]) {
    assert.equal((await request(`/api/lojas/${foreignId}${suffix}`, method, body)).status, 404);
  }
  assert.equal((await request(`${path}/redefinir`, "POST", { confirm: false })).status, 400);
  const reset = (await success(`${path}/redefinir`, "POST", { confirm: true })).loja;
  for (const key of ["id", "code", "legacyCode", "plateNumber", "createdAt"]) assert.equal(reset[key], current[key]);
  assert.equal(reset.name, `Placa ${String(plate.plateNumber).padStart(3, "0")}`);
  assert.equal(reset.targetUrl, ""); assert.equal(reset.active, false); assert.equal(reset.scans, 0);
  for (const key of ["lastAccess", "joinedAt", "initialReviews", "currentReviews", "reviewsUpdatedAt", "nextContactAt"]) assert.equal(reset[key], null);
  for (const key of ["ownerName", "ownerPhone", "address", "neighborhood", "notes"]) assert.equal(reset[key], "");
  const draft = await request(`/r/${numericCode}`, "GET", undefined, false);
  assert.equal(draft.status, 200); assert.match(await draft.text(), /ainda não foi ativada/);
  const history = (await success(`${path}/historico`)).historico;
  assert.equal(history.length, 1); assert.deepEqual(history[0].snapshot, configured);
  assert.equal((await request(`/api/lojas/${second.id}/restaurar`, "POST", { historyId: history[0].id })).status, 404);
  assert.equal((await request(`/api/lojas/${foreignId}/restaurar`, "POST", { historyId: history[0].id })).status, 404);
  const restored = (await success(`${path}/restaurar`, "POST", { historyId: history[0].id })).loja;
  for (const [key, value] of Object.entries(configured)) if (key !== "updatedAt") assert.deepEqual(restored[key], value, key);
  const after = (await success(`${path}/historico`)).historico;
  assert.equal(after.length, 2); assert.deepEqual(after.find(entry => entry.id !== history[0].id).snapshot, reset);
  for (const code of [numericCode, current.code]) assert.equal((await request(`/r/${code}`, "HEAD", undefined, false)).headers.get("location"), target);
  console.log(JSON.stringify({ passed: true, localPlateNumber: plate.plateNumber, checks: [
    "authentication and origin", "partial CRM without destination", "strict bounds and real dates",
    "manual review timestamps and zero baseline", "first association date in Sao Paulo",
    "concurrent idempotent numeric-code migration", "permanent numeric alias", "owner isolation",
    "atomic full reset and snapshot", "restoration archives current state", "identity preserved", "no CRM in public draft",
  ] }));
} finally {
  fixture("DELETE FROM lojas WHERE id = ? AND owner_id = ?", foreignId, foreignOwner);
  await request("/api/auth/logout", "POST");
}
