import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { visitas } from "../../../db/schema";
import { apiError, ApiError, jsonBody, noCache, requireApiUser } from "../../lib/api";
import { publicVisit, visitValues } from "../../lib/visits";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser(request);
    const rows = await getDb().select().from(visitas).where(eq(visitas.ownerId, user.userId)).orderBy(desc(visitas.updatedAt)).limit(1000);
    return Response.json({ visitas: rows.map(publicVisit) }, { headers: noCache });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request, true);
    const value = visitValues(await jsonBody(request, 262144), true);
    if (!env.DB) throw new Error("Database binding unavailable");
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const result = await env.DB.prepare(`INSERT INTO visitas
      (id, owner_id, title, geometry, status, visited_at, notes, address, archived, created_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?9
      WHERE (SELECT COUNT(*) FROM visitas WHERE owner_id = ?2) < 1000 RETURNING id`)
      .bind(id, user.userId, value.title!, JSON.stringify(value.geometry), value.status!, value.visitedAt!, value.notes!, value.address!, now).first<{ id: string }>();
    if (!result) throw new ApiError("Seu mapa já tem 1.000 registros. Edite ou reutilize um registro existente.", 409);
    return Response.json({ visita: { id, ...value, archived: false, createdAt: now, updatedAt: now } }, { status: 201, headers: noCache });
  } catch (error) { return apiError(error); }
}
