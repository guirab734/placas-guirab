import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "../../db";
import { adminSessions, loginAttempts } from "../../db/schema";

export const SESSION_SECONDS = 12 * 60 * 60;
const RATE_WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const unhex = (value: string) => Uint8Array.from(value.match(/.{2}/g) ?? [], byte => parseInt(byte, 16));

export class AuthError extends Error {
  constructor(message: string, public status: number, public retryAfter?: number) { super(message); }
}

async function digest(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function config() {
  const value = env.ADMIN_PASSWORD_HASH;
  if (!value || !env.ADMIN_RATE_KEY || !env.ADMIN_OWNER_ID) throw new AuthError("O login ainda não está configurado.", 503);
  const match = /^pbkdf2-sha256:100000:([a-f0-9]{64}):([a-f0-9]{64})$/.exec(value);
  if (!match) throw new AuthError("O login ainda não está configurado.", 503);
  return { salt: unhex(match[1]), expected: unhex(match[2]), encoded: value, ownerId: env.ADMIN_OWNER_ID };
}

export async function verifyPassword(password: string) {
  const { salt, expected } = config();
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, material, 256);
  return timingSafeEqual(new Uint8Array(derived), expected);
}

export function assertSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new AuthError("A solicitação precisa partir deste site.", 403);
  }
}

function devHost(host: string) {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

export function cookieName(request: Request) {
  const url = new URL(request.url);
  return url.protocol === "http:" && devHost(url.host) ? "placas_session_dev" : "__Host-placas_session";
}

export function sessionCookie(request: Request, token: string, clear = false) {
  const name = cookieName(request);
  return `${name}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${name.startsWith("__Host-") ? "; Secure" : ""}`;
}

function readToken(cookie: string, name: string) {
  const values = cookie.split(";").map(part => part.trim()).filter(part => part.startsWith(name + "="));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export async function adminUser(request?: Request) {
  const requestHeaders = request?.headers ?? await headers();
  const host = request ? new URL(request.url).host : requestHeaders.get("host") ?? "";
  const name = request ? cookieName(request) : devHost(host) ? "placas_session_dev" : "__Host-placas_session";
  const token = readToken(requestHeaders.get("cookie") ?? "", name);
  if (!token || !env.ADMIN_PASSWORD_HASH || !env.ADMIN_OWNER_ID) return null;
  const now = Math.floor(Date.now() / 1000);
  const [session] = await getDb().select().from(adminSessions).where(and(
    eq(adminSessions.tokenHash, await digest(token)), gt(adminSessions.expiresAt, now),
    eq(adminSessions.ownerId, env.ADMIN_OWNER_ID),
    eq(adminSessions.credentialVersion, await digest(env.ADMIN_PASSWORD_HASH)),
  )).limit(1);
  return session ? { userId: session.ownerId, displayName: "Administrador", email: "Acesso por senha" } : null;
}

export async function throttleLogin(request: Request) {
  config();
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / RATE_WINDOW_SECONDS);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const material = await crypto.subtle.importKey("raw", encoder.encode(env.ADMIN_RATE_KEY!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const key = hex(new Uint8Array(await crypto.subtle.sign("HMAC", material, encoder.encode(`${ip}:${bucket}`))));
  const expiry = (bucket + 1) * RATE_WINDOW_SECONDS;
  const db = getDb();
  await db.delete(loginAttempts).where(lt(loginAttempts.expiresAt, now));
  const [row] = await db.insert(loginAttempts).values({ key, attempts: 1, expiresAt: expiry })
    .onConflictDoUpdate({ target: loginAttempts.key, set: { attempts: sql`${loginAttempts.attempts} + 1` } })
    .returning({ attempts: loginAttempts.attempts });
  if (row.attempts > MAX_ATTEMPTS) throw new AuthError("Muitas tentativas. Aguarde alguns minutos e tente novamente.", 429, expiry - now);
}

export async function newSession(request: Request) {
  const cfg = config();
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
  await db.insert(adminSessions).values({ tokenHash: await digest(token), ownerId: cfg.ownerId,
    credentialVersion: await digest(cfg.encoded), expiresAt: now + SESSION_SECONDS });
  return sessionCookie(request, token);
}

export async function endSession(request: Request) {
  const token = readToken(request.headers.get("cookie") ?? "", cookieName(request));
  if (token) await getDb().delete(adminSessions).where(eq(adminSessions.tokenHash, await digest(token)));
  return sessionCookie(request, "", true);
}

export function redirectsArePublic() { return env.PUBLIC_REDIRECTS === "1"; }
