import assert from 'node:assert/strict';
const origin = 'http://127.0.0.1:5173';
let cookie = '';
const fixtures = [
  { name: 'Point do Pastel', fid: '0x71ab14c4efc0541:0x4612ccb73fc79226', id: 'ChIJQQX8TkyxGgcRJpLHP7fMEkY', short: 'https://maps.app.goo.gl/X5qE4duESJsgMB4g8' },
  { name: 'Renatao', fid: '0x71ab16934cc8219:0x750c7510e87c4446', id: 'ChIJGYLMNGmxGgcRRkR86BB1DHU', short: 'https://maps.app.goo.gl/U6nHDyUHdKBk2WCS6' },
  { name: 'Galdinos', fid: '0x71ab180ee22c6d9:0xf70716bc857243ee', id: 'ChIJ2cYi7oCxGgcR7kNyhbwWB_c', short: 'https://maps.app.goo.gl/cokR58fS4BDkcUkD6' },
];
async function request(path, method = 'GET', body, auth = true, sentOrigin = origin) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin, 'Fixture writes are local only');
  return fetch(url, { method, redirect: 'manual', headers: { Origin: sentOrigin, 'Content-Type': 'application/json',
    'cf-connecting-ip': '198.51.100.82', ...(auth && cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function success(path, method, body, status = 200) {
  const response = await request(path, method, body);
  const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data));
  assert.match(response.headers.get('cache-control'), /no-store/); return data;
}
assert.equal((await request('/api/links/resolve', 'POST', { url: fixtures[0].short })).status, 401);
const login = await request('/api/auth/login', 'POST', { password: 'local-test-password' });
assert.equal(login.status, 200, await login.text()); cookie = login.headers.get('set-cookie').split(';', 1)[0];
try {
  assert.equal((await request('/api/links/resolve', 'POST', { url: fixtures[0].short }, true, 'https://other.example')).status, 403);
  const plates = (await success('/api/placas/lote', 'POST', { quantity: fixtures.length }, 201)).lojas;
  for (const [index, fixture] of fixtures.entries()) {
    const full = `https://www.google.com/maps/place/${fixture.name.replaceAll(' ', '+')}/data=!4m2!3m1!1s${fixture.fid}`;
    const expected = `https://search.google.com/local/writereview?placeid=${fixture.id}`;
    const resolved = await success('/api/links/resolve', 'POST', { url: full });
    assert.equal(resolved.targetUrl, expected); assert.equal(resolved.destinationKind, 'review');
    assert.equal(resolved.converted, true); assert.equal(resolved.name, fixture.name);
    assert.equal(resolved.profileFallback, undefined);
    const path = `/api/lojas/${plates[index].id}`;
    const configured = (await success(path, 'PATCH', { name: fixture.name + ' — teste local', targetUrl: full,
      currentReviews: 12, joinedAt: '2026-10-16', latitude: -10.95, longitude: -37.07 })).loja;
    assert.equal(configured.targetUrl, expected); assert.equal(configured.initialReviews, 12);
    assert.equal(configured.joinedAt, '2026-10-16'); assert.equal(configured.latitude, -10.95);
    const publicLink = await request(`/r/${configured.code}`, 'HEAD', undefined, false);
    assert.equal(publicLink.status, 302); assert.equal(publicLink.headers.get('location'), expected);
    assert.match(publicLink.headers.get('cache-control'), /no-store/);
    const bad = await request(path, 'PATCH', { targetUrl: 'https://www.google.com/maps/search/pastelarias/', currentReviews: 99 });
    assert.equal(bad.status, 422); assert.equal((await bad.json()).profileFallback, undefined);
    const unchanged = (await success(path, 'GET')).loja;
    assert.equal(unchanged.targetUrl, expected); assert.equal(unchanged.currentReviews, 12);
    assert.equal((await request(path, 'PATCH', { targetUrl: full, targetMode: 'profile' })).status, 422);
    if (process.argv.includes('--live')) {
      const live = await success('/api/links/resolve', 'POST', { url: fixture.short });
      assert.equal(live.targetUrl, expected); assert.equal(live.destinationKind, 'review');
    }
  }
  const direct = await success('/api/links/resolve', 'POST', { url: 'https://g.page/r/test-direct/review' });
  assert.equal(direct.converted, false); assert.equal(direct.destinationKind, 'review');
  const posted = (await success('/api/lojas', 'POST', { name: 'Criação local — avaliação direta', targetUrl:
    `https://www.google.com/maps/place/Galdinos/data=!1s${fixtures[2].fid}`, currentReviews: 0 }, 201)).loja;
  assert.equal(posted.targetUrl, `https://search.google.com/local/writereview?placeid=${fixtures[2].id}`);
  assert.equal(posted.initialReviews, 0);
  console.log(JSON.stringify({ passed: true, liveShortLinks: process.argv.includes('--live'), checks: ['authentication and origin',
    'three businesses convert directly', 'PATCH and POST convert server-side', 'public QR redirects to review',
    'CRM baseline GPS date preserved', 'failed conversion preserves old destination', 'profile downgrade rejected', 'direct review links preserved'] }));
} finally { await request('/api/auth/logout', 'POST'); }
