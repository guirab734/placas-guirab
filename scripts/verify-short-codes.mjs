import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// This test has no host/credential options: fixture writes can only reach local Wrangler SQLite.
const origin = "http://127.0.0.1:5173";
assert.equal(new URL(origin).hostname, "127.0.0.1");
const repo = fileURLToPath(new URL("../", import.meta.url));
const stateRoot = realpathSync(resolve(repo, ".wrangler/state/v3/d1"));
function sqliteFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? sqliteFiles(join(directory, entry.name))
    : entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite" ? [join(directory, entry.name)] : []);
}
const files = sqliteFiles(stateRoot);
assert.equal(files.length, 1, "Expected exactly one local D1 SQLite file; never choose a remote database");
const fixturePath = realpathSync(files[0]);
const localRelative = relative(stateRoot, fixturePath);
assert.ok(localRelative && !localRelative.startsWith("..") && !isAbsolute(localRelative), "Fixture path must stay inside Wrangler local D1 state");
function database(callback) {
  const db = new DatabaseSync(fixturePath);
  try { db.exec("PRAGMA busy_timeout=5000"); return callback(db); }
  finally { db.close(); }
}

const shortCode = /^[A-HJKMNP-Z][A-HJKMNP-Z2-9]{3}$/;
const longDigits = () => `9${Array.from({ length: 15 }, () => randomInt(10)).join("")}`;
let cookie = "", ownerId = "", fixtures = [];
async function request(path, method = "GET", body, auth = true) {
  return fetch(origin + path, { method, redirect: "manual", headers: {
    Origin: origin, "Content-Type": "application/json", "cf-connecting-ip": "198.51.100.93",
    ...(auth && cookie ? { Cookie: cookie } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function success(path, method = "GET", body, expectedStatus = 200) {
  const response = await request(path, method, body);
  const result = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(result));
  assert.match(response.headers.get("cache-control"), /no-store/);
  return result;
}
async function publicRedirect(code, target) {
  const response = await request(`/r/${encodeURIComponent(code)}`, "HEAD", undefined, false);
  assert.equal(response.status, 302, `Public HEAD for ${code}`);
  assert.equal(response.headers.get("location"), target, `Destination for ${code}`);
  assert.match(response.headers.get("cache-control"), /no-store/);
}

assert.equal((await request("/api/placas/codigos", "POST", {}, false)).status, 401);
const login = await request("/api/auth/login", "POST", { password: "local-test-password" }, false);
assert.equal(login.status, 200, await login.text());
assert.ok(login.headers.get("set-cookie"));
cookie = login.headers.get("set-cookie").split(";", 1)[0];

try {
  fixtures = (await success("/api/placas/lote", "POST", { quantity: 5 }, 201)).lojas;
  assert.equal(fixtures.length, 5);
  for (const row of fixtures) {
    assert.match(row.code, shortCode);
    assert.match(row.code, /[2-9]/, "A handwritten code must contain a digit and avoid ambiguous all-letter words");
    assert.doesNotMatch(row.code, /[01ILO]/);
    assert.ok(row.plateNumber > 0);
  }
  assert.equal(new Set(fixtures.map((row) => row.code)).size, 5);
  ownerId = database((db) => db.prepare("SELECT owner_id FROM lojas WHERE id = ?").get(fixtures[0].id).owner_id);
  assert.ok(ownerId);
  const [hex, numeric, digitsWithNumber, digitsWithoutNumber, canonical] = fixtures;
  const cases = [
    { plate: hex, previousCode: `a${randomBytes(8).toString("hex").slice(0, 15)}`, storedNumber: hex.plateNumber, expectedNumber: hex.plateNumber },
    { plate: numeric, previousCode: String(numeric.plateNumber), storedNumber: null, expectedNumber: numeric.plateNumber },
    { plate: digitsWithNumber, previousCode: longDigits(), storedNumber: digitsWithNumber.plateNumber, expectedNumber: digitsWithNumber.plateNumber },
    { plate: digitsWithoutNumber, previousCode: longDigits(), storedNumber: null, expectedNumber: null },
    { plate: canonical, previousCode: canonical.code, storedNumber: canonical.plateNumber, expectedNumber: canonical.plateNumber },
  ].map((item, index) => ({ ...item, target: `https://g.page/r/short-code-${randomBytes(4).toString("hex")}-${index}/review` }));

  database((db) => {
    const update = db.prepare("UPDATE lojas SET code = ?, plate_number = ?, legacy_code = NULL, name = ?, target_url = ?, active = 1 WHERE id = ? AND owner_id = ?");
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of cases) assert.equal(update.run(item.previousCode, item.storedNumber, `Short-code fixture ${item.plate.id}`, item.target, item.plate.id, ownerId).changes, 1);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  });
  for (const item of cases) await publicRedirect(item.previousCode, item.target);

  const migrations = await Promise.all([
    success("/api/placas/codigos", "POST", {}),
    success("/api/placas/codigos", "POST", {}),
  ]);
  const migratingIds = new Set(cases.slice(0, 4).map((item) => item.plate.id));
  const migratedFixtures = migrations.flatMap((result) => {
    assert.equal(result.migrated, result.lojas.length);
    return result.lojas.filter((row) => migratingIds.has(row.id));
  });
  assert.equal(migratedFixtures.length, 4, "Each legacy fixture migrates exactly once across concurrent requests");
  assert.equal(new Set(migratedFixtures.map((row) => row.id)).size, 4);
  assert.ok(!migrations.some((result) => result.lojas.some((row) => row.id === canonical.id)), "Already canonical plate must remain unchanged");

  const rows = (await success("/api/lojas")).lojas;
  const currentFixtures = cases.map((item) => {
    const row = rows.find((candidate) => candidate.id === item.plate.id);
    assert.ok(row);
    assert.match(row.code, shortCode);
    assert.doesNotMatch(row.code, /[01ILO]/);
    assert.equal(row.plateNumber, item.expectedNumber, `Preserved plate number for ${item.previousCode}`);
    assert.equal(row.targetUrl, item.target);
    return { ...item, current: row };
  });
  assert.equal(new Set(rows.map((row) => row.code.toUpperCase())).size, rows.length);
  assert.equal(currentFixtures[4].current.code, canonical.code);
  assert.equal(currentFixtures[1].current.legacyCode, cases[1].previousCode);
  assert.equal(currentFixtures[2].current.plateNumber, digitsWithNumber.plateNumber, "Sixteen numeric characters must not replace an existing plate number");
  assert.equal(currentFixtures[3].current.plateNumber, null, "Sixteen numeric characters must not be inferred as a plate number");

  for (const item of currentFixtures) {
    await publicRedirect(item.previousCode, item.target);
    await publicRedirect(item.current.code, item.target);
    await publicRedirect(item.current.code.toLowerCase(), item.target);
    if (/[a-f]/.test(item.previousCode) && item.previousCode.length === 16) await publicRedirect(item.previousCode.toUpperCase(), item.target);
    if (item.previousCode !== item.current.code) {
      const alias = database((db) => db.prepare("SELECT plate_id, owner_id FROM plate_code_aliases WHERE code = ?").get(item.previousCode));
      assert.ok(alias); assert.equal(alias.plate_id, item.plate.id); assert.equal(alias.owner_id, ownerId);
    }
    const stored = database((db) => db.prepare("SELECT scans, last_access FROM lojas WHERE id = ?").get(item.plate.id));
    assert.equal(stored.scans, 0, "HEAD does not count a customer visit"); assert.equal(stored.last_access, null);
  }
  assert.equal((await success("/api/placas/codigos", "POST", {})).migrated, 0);
  for (const item of currentFixtures) assert.equal((await success(`/api/lojas/${item.plate.id}`)).loja.code, item.current.code);
  console.log(JSON.stringify({ passed: true, fixtures: cases.length, checks: [
    "local SQLite path guard", "admin-only migration", "new unique unambiguous four-character codes",
    "concurrent migration happens once", "canonical codes remain unchanged", "original plate numbers preserved",
    "16-digit strings never infer plate numbers", "numeric and hexadecimal aliases remain public",
    "lowercase short-code requests", "idempotent canonical codes", "HEAD preserves counters",
  ] }));
} finally {
  // Remove only the five records created by this test; leave shared local QA data and sequence intact.
  if (fixtures.length && ownerId) database((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of fixtures) {
        db.prepare("DELETE FROM plate_code_aliases WHERE plate_id = ? AND owner_id = ?").run(row.id, ownerId);
        db.prepare("DELETE FROM plate_history WHERE plate_id = ? AND owner_id = ?").run(row.id, ownerId);
        db.prepare("DELETE FROM lojas WHERE id = ? AND owner_id = ?").run(row.id, ownerId);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  });
  await request("/api/auth/logout", "POST");
}
