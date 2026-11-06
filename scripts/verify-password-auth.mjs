import assert from "node:assert/strict";

const origin = "http://127.0.0.1:5173";
let cookie = "";
const ip = "198.51.100.17";
async function request(path, method = "GET", body, extra = {}) {
  return fetch(origin + path, { method, redirect: "manual", headers: {
    Origin: origin, "Content-Type": "application/json", "cf-connecting-ip": ip,
    ...(cookie ? { Cookie: cookie } : {}), ...extra,
  }, body: body ? JSON.stringify(body) : undefined });
}

const missing = await request("/api/lojas");
assert.equal(missing.status, 401);
const wrong = await request("/api/auth/login", "POST", { password: "wrong-local-password" });
assert.equal(wrong.status, 401);
const csrf = await request("/api/auth/login", "POST", { password: "local-test-password" }, { Origin: "https://evil.test" });
assert.equal(csrf.status, 403);
const login = await request("/api/auth/login", "POST", { password: "local-test-password" });
assert.equal(login.status, 200, await login.text());
const setCookie = login.headers.get("set-cookie");
assert.match(setCookie, /HttpOnly/);
assert.match(setCookie, /SameSite=Strict/);
assert.match(setCookie, /Max-Age=43200/);
cookie = setCookie.split(";", 1)[0];
assert.match(cookie, /^placas_session_dev=[a-f0-9]{64}$/);
assert.equal((await request("/api/lojas")).status, 200);

const made = await request("/api/lojas", "POST", { name: "Teste de login (somente local)", targetUrl: "https://g.page/r/teste-auth/review" });
assert.equal(made.status, 201);
const { loja } = await made.json();
const savedCookie = cookie;
cookie = "";
const anonymousQr = await request(`/r/${loja.code}`, "HEAD");
assert.equal(anonymousQr.status, 302);
assert.equal(anonymousQr.headers.get("location"), loja.targetUrl);
cookie = savedCookie;
const logout = await request("/api/auth/logout", "POST");
assert.equal(logout.status, 200);
assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
assert.equal((await request("/api/lojas")).status, 401, "A logged-out cookie must be revoked server-side");
cookie = "";
for (let i = 0; i < 5; i++) {
  const denied = await request("/api/auth/login", "POST", { password: "wrong-local-password" }, { "cf-connecting-ip": "198.51.100.19" });
  assert.equal(denied.status, 401);
}
const throttled = await request("/api/auth/login", "POST", { password: "wrong-local-password" }, { "cf-connecting-ip": "198.51.100.19" });
assert.equal(throttled.status, 429);
assert.ok(throttled.headers.get("retry-after"));
console.log(JSON.stringify({ passed: true, local_record_id: loja.id, checks: ["anonymous admin blocked", "wrong password", "CSRF blocked", "correct password", "cookie flags", "authenticated API", "public QR without cookie", "logout revokes session", "rate limit"] }));
