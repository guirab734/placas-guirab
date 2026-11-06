import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { lojas } from "../../../../../db/schema";
import { apiError, ApiError, jsonBody, noCache, requireApiUser } from "../../../../lib/api";
import { emptyPlateName, lojaFromRaw, lojaSqlFields, snapshotSql, type RawLoja } from "../../../../lib/plates";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request, true);
    if ((await jsonBody(request)).confirm !== true) throw new ApiError("Confirme a redefinição desta placa.");
    const { id } = await context.params;
    const [plate] = await getDb().select({ plateNumber: lojas.plateNumber, code: lojas.code }).from(lojas)
      .where(and(eq(lojas.ownerId, user.userId), eq(lojas.id, id))).limit(1);
    if (!plate) throw new ApiError("Plaquinha não encontrada.", 404);
    const database = env.DB;
    if (!database) throw new Error("The database binding is unavailable.");
    const now = new Date().toISOString();
    const number = plate.plateNumber ?? (/^[1-9][0-9]{0,8}$/.test(plate.code) ? Number(plate.code) : null);
    const archive = database.prepare(`
      INSERT INTO plate_history (id, owner_id, plate_id, snapshot, created_at)
      SELECT ?1, owner_id, id, ${snapshotSql}, ?4 FROM lojas WHERE id = ?2 AND owner_id = ?3
    `).bind(crypto.randomUUID(), id, user.userId, now);
    const reset = database.prepare(`
      UPDATE lojas SET name = ?1, target_url = '', active = 0, scans = 0, last_access = NULL,
        joined_at = NULL, initial_reviews = NULL, current_reviews = NULL, reviews_updated_at = NULL,
        owner_name = '', owner_phone = '', address = '', neighborhood = '', notes = '', next_contact_at = NULL,
        google_place_id = NULL, google_profile_url = NULL, google_rating = NULL, latitude = NULL, longitude = NULL,
        google_synced_at = NULL, business_phone = '', review_source = 'manual',
        updated_at = ?4
      WHERE id = ?2 AND owner_id = ?3 RETURNING ${lojaSqlFields}
    `).bind(emptyPlateName(number, plate.code), id, user.userId, now);
    const results = await database.batch<RawLoja>([archive, reset]);
    const row = results[1].results[0];
    if (!row) throw new ApiError("Plaquinha não encontrada.", 404);
    return Response.json({ loja: lojaFromRaw(row) }, { headers: noCache });
  } catch (error) { return apiError(error); }
}
