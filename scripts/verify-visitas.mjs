import assert from 'node:assert/strict';
const origin = 'http://127.0.0.1:5173';
let cookie = '';
async function request(path, method = 'GET', body, auth = true, originHeader = origin) {
  return fetch(origin + path, { method, redirect: 'manual', headers: {
    Origin: originHeader, 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.96',
    ...(auth && cookie ? { Cookie: cookie } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
assert.equal((await request('/api/visitas')).status, 401);
const login = await request('/api/auth/login', 'POST', { password: 'local-test-password' });
assert.equal(login.status, 200, await login.text());
cookie = login.headers.get('set-cookie').split(';', 1)[0];
const source = { title: 'Visita de teste local', geometry: { type: 'Point', coordinates: [-37.073683, -10.974524] },
  status: 'visited', visitedAt: '2026-10-14', notes: 'Retornar na próxima semana.', address: 'Somente teste local' };
assert.equal((await request('/api/visitas', 'POST', source, true, 'https://evil.test')).status, 403);
assert.equal((await request('/api/visitas', 'POST', source, false)).status, 401);
for (const bad of [
  { geometry: { type: 'Point', coordinates: [-37, 86] } },
  { geometry: { type: 'Point', coordinates: ['-37', -10] } },
  { geometry: { type: 'LineString', coordinates: [[-37, -10]] } },
  { geometry: { type: 'Polygon', coordinates: [[[-37, -10], [-37.1, -10.1], [-37.2, -10.2]]] } },
  { geometry: { type: 'Brush', strokes: [] } },
  { geometry: { type: 'Brush', strokes: [{ points: [[-37, -10]], radiusMeters: 10, mode: 'erase' }] } },
  { geometry: { type: 'Brush', strokes: [{ points: [[-37, -10]], radiusMeters: 0, mode: 'paint' }] } },
  { geometry: { type: 'Brush', strokes: [{ points: [[-37, -10]], radiusMeters: 501, mode: 'paint' }] } },
  { geometry: { type: 'Brush', strokes: [{ points: Array(3001).fill([-37, -10]), radiusMeters: 10, mode: 'paint' }] } },
  { geometry: { type: 'Brush', strokes: Array(81).fill({ points: [[-37, -10]], radiusMeters: 10, mode: 'paint' }) } },
  { geometry: { type: 'Streets', streets: [] } },
  { geometry: { type: 'Streets', streets: [{ id: 'way/1', name: 'Rua', coordinates: [[0, 0], [0, 0]] }] } },
  { geometry: { type: 'Streets', streets: [{ id: 'way/1', name: 'Rua', coordinates: [[0, 0], [0.00000001, 0]] }] } },
  { geometry: { type: 'Streets', streets: [{ id: 'way/1', name: 'Rua', coordinates: [[-37, -10]] }] } },
  { geometry: { type: 'Streets', streets: Array(2).fill({ id: 'way/1', name: 'Rua', coordinates: [[-37, -10], [-37.1, -10]] }) } },
  { visitedAt: '2026-02-30' }, { status: 'invalid' }, { title: '' }, { notes: 'x'.repeat(2001) },
]) assert.equal((await request('/api/visitas', 'POST', { ...source, ...bad })).status, 400, JSON.stringify(bad));
const created = [];
for (const geometry of [source.geometry,
  { type: 'LineString', coordinates: [[-37.07, -10.97], [-37.071, -10.971], [-37.072, -10.97]] },
  { type: 'Polygon', coordinates: [[[-37.07, -10.97], [-37.071, -10.971], [-37.072, -10.97], [-37.07, -10.97]]] },
  { type: 'Brush', strokes: [{ points: [[-37.07, -10.97], [-37.071, -10.971]], radiusMeters: 17.5, mode: 'paint' },
    { points: [[-37.0705, -10.9705]], radiusMeters: 9, mode: 'erase' }] },
  { type: 'Streets', streets: [{ id: 'way/123', name: 'Rua de teste', coordinates: [[-37.07, -10.97], [-37.071, -10.971]] }] },
]) {
  const response = await request('/api/visitas', 'POST', { ...source, geometry });
  const data = await response.json();
  assert.equal(response.status, 201, JSON.stringify(data));
  assert.deepEqual(data.visita.geometry, geometry);
  assert.equal(data.visita.archived, false);
  assert.equal('ownerId' in data.visita, false);
  created.push(data.visita);
}
const row = created[0];
const patched = await request(`/api/visitas/${row.id}`, 'PATCH', { status: 'return', notes: 'Próximo contato anotado.' });
assert.equal(patched.status, 200);
assert.equal((await patched.json()).visita.status, 'return');
assert.equal((await request(`/api/visitas/${row.id}`, 'PATCH', { archived: true }, false)).status, 401);
const archived = await request(`/api/visitas/${row.id}`, 'PATCH', { archived: true });
assert.equal(archived.status, 200);
assert.equal((await archived.json()).visita.archived, true);
const restored = await request(`/api/visitas/${row.id}`, 'PATCH', { archived: false });
assert.equal((await restored.json()).visita.archived, false);
assert.equal((await request('/api/visitas/missing', 'PATCH', { notes: 'Test' })).status, 404);
const list = await request('/api/visitas');
assert.match(list.headers.get('cache-control'), /no-store/);
const rows = (await list.json()).visitas;
assert.ok(created.every(value => rows.some(item => item.id === value.id)));
assert.ok(rows.every(item => !('ownerId' in item)));
await request('/api/auth/logout', 'POST');
console.log(JSON.stringify({ passed: true, local_visits: created.map(item => item.id), checks: [
  'private map API', 'same-origin writes', 'geometry/date/text validation', 'point/line/polygon/brush/streets persistence', 'brush and street size/mode limits',
  'partial status updates', 'recoverable archive and restore', 'no owner IDs in response', 'no-cache listing',
] }));
