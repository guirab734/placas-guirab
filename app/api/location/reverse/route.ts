import { env } from "cloudflare:workers";
import { apiError, ApiError, jsonBody, noCache, requireApiUser } from "../../../lib/api";
import { reverseLocation } from "../../../lib/location";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requireApiUser(request, true);
    const { latitude, longitude } = await jsonBody(request);
    if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 85 || Math.abs(longitude) > 180) throw new ApiError("Informe uma localização válida.");
    if (!env.DB) throw new Error("Database binding unavailable");
    const now = Math.floor(Date.now() / 1000);
    const slot = await env.DB.prepare(`INSERT INTO login_attempts (key, attempts, expires_at) VALUES ('reverse_location_global', 1, ?1)
      ON CONFLICT(key) DO UPDATE SET expires_at = excluded.expires_at WHERE expires_at <= ?2 RETURNING key`)
      .bind(now + 2, now).first();
    if (!slot) return Response.json({ error: "Aguarde dois segundos para consultar outro endereço." }, {
      status: 429, headers: { ...noCache, "Retry-After": "2" },
    });
    const address = await reverseLocation(latitude, longitude);
    if (!address) throw new ApiError("Não foi possível localizar o endereço agora. Você pode preenchê-lo manualmente.", 422);
    return Response.json(address, { headers: noCache });
  } catch (error) { return apiError(error); }
}
