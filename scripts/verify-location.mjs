import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync(new URL('../app/lib/location.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { photonAddress, reverseLocation } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const feature = { features: [{ properties: { name: 'Nearby business — must not be imported', street: 'Rua de teste', housenumber: '10',
  district: 'Bairro de teste', city: 'Aracaju', state: 'Sergipe', postcode: '49000-000' }, geometry: { type: 'Point', coordinates: [-37, -10] } }] };
const address = photonAddress(feature, -10.974524, -37.073683);
assert.equal(address.latitude, -10.974524); assert.equal(address.longitude, -37.073683);
assert.equal(address.neighborhood, 'Bairro de teste'); assert.match(address.address, /Rua de teste, 10/);
assert.ok(!JSON.stringify(address).includes('Nearby business')); assert.ok(!('name' in address));
assert.equal(address.approximate, true); assert.equal(photonAddress({ features: [] }, 0, 0), null);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://photon.komoot.io');
    assert.equal(options.redirect, 'manual'); assert.ok(options.signal);
    return Response.json(feature);
  };
  assert.deepEqual(await reverseLocation(-10.974524, -37.073683), address);
  globalThis.fetch = async () => new Response('x'.repeat(65537));
  assert.equal(await reverseLocation(0, 0), null);
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal(await reverseLocation(0, 0), null);
} finally { globalThis.fetch = originalFetch; }
const origin = 'http://127.0.0.1:5173'; let cookie = '';
async function request(body, auth = true, sentOrigin = origin) {
  return fetch(`${origin}/api/location/reverse`, { method: 'POST', headers: { Origin: sentOrigin,
    'Content-Type': 'application/json', ...(auth && cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
}
assert.equal((await request({ latitude: 0, longitude: 0 })).status, 401);
const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
  'cf-connecting-ip': '198.51.100.93' }, body: JSON.stringify({ password: 'local-test-password' }) });
assert.equal(login.status, 200, await login.text()); cookie = login.headers.get('set-cookie').split(';', 1)[0];
assert.equal((await request({ latitude: 0, longitude: 0 }, true, 'https://other.example')).status, 403);
for (const body of [{ latitude: '0', longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, {}]) {
  assert.equal((await request(body)).status, 400);
}
if (process.argv.includes('--live')) {
  // Public business coordinates from the user's test link, never the device's location.
  const response = await request({ latitude: -10.974524, longitude: -37.073683 });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.source, 'OpenStreetMap'); assert.equal(result.latitude, -10.974524);
  assert.ok(result.address); assert.ok(!('name' in result));
  console.log(JSON.stringify({ live: true, provider: result.provider, addressResolved: true, approximate: result.approximate }));
}
console.log(JSON.stringify({ passed: true, checks: ['approximate GPS address only', 'never imports a neighboring store identity', 'preserves requested GPS position',
  'fixed provider and timeout', 'bounded response and graceful offline', 'admin authentication', 'origin and coordinate validation'] }));
