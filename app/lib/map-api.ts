import { env } from "cloudflare:workers";
import { apiError, noCache } from "./api";
import { MapDataError } from "./map-regions";

export async function claimMapRequest() {
  if (!env.DB) throw new Error("Database binding unavailable");
  const now = Math.floor(Date.now() / 1000);
  const slot = await env.DB.prepare(`INSERT INTO login_attempts (key, attempts, expires_at) VALUES ('map_external_global', 1, ?1)
    ON CONFLICT(key) DO UPDATE SET expires_at = excluded.expires_at WHERE expires_at <= ?2 RETURNING key`)
    .bind(now + 2, now).first();
  return Boolean(slot);
}
export function mapApiError(error: unknown) {
  return error instanceof MapDataError ? Response.json({ error: error.message }, { status: error.status, headers: noCache }) : apiError(error);
}
export function mapRateLimit() {
  return Response.json({ error: "Aguarde dois segundos para consultar outros dados do mapa." }, { status: 429, headers: { ...noCache, "Retry-After": "2" } });
}
