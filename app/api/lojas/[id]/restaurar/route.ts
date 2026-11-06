import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { plateHistory } from "../../../../../db/schema";
import { apiError, ApiError, jsonBody, noCache, requireApiUser } from "../../../../lib/api";
import { historyId, restorablePlate } from "../../../../lib/plate-history";
import { lojaFromRaw, lojaSqlFields, snapshotSql, type RawLoja } from "../../../../lib/plates";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request, true);
    const { id } = await context.params;
    const selected = historyId((await jsonBody(request)).historyId);
    const [entry] = await getDb().select({ snapshot: plateHistory.snapshot }).from(plateHistory)
      .where(and(eq(plateHistory.id, selected), eq(plateHistory.plateId, id), eq(plateHistory.ownerId, user.userId))).limit(1);
    if (!entry) throw new ApiError("Histórico não encontrado para esta placa.", 404);
    const snapshot = restorablePlate(entry.snapshot);
    const database = env.DB;
    if (!database) throw new Error("The database binding is unavailable.");
    const now = new Date().toISOString();
    const archive = database.prepare(`
      INSERT INTO plate_history (id, owner_id, plate_id, snapshot, created_at)
      SELECT ?1, owner_id, id, ${snapshotSql}, ?4 FROM lojas WHERE id = ?2 AND owner_id = ?3
    `).bind(crypto.randomUUID(), id, user.userId, now);
    // Identity, permanent aliases, plate number and original creation date are never restored from a snapshot.
    const restore = database.prepare(`
      UPDATE lojas SET name = ?1, target_url = ?2, active = ?3, scans = ?4, last_access = ?5,
        joined_at = ?6, initial_reviews = ?7, current_reviews = ?8, reviews_updated_at = ?9,
        owner_name = ?10, owner_phone = ?11, address = ?12, neighborhood = ?13, notes = ?14,
        next_contact_at = ?15, updated_at = ?16,
        google_place_id = ?19, google_profile_url = ?20, google_rating = ?21, latitude = ?22, longitude = ?23,
        google_synced_at = ?24, business_phone = ?25, review_source = ?26
      WHERE id = ?17 AND owner_id = ?18
      RETURNING ${lojaSqlFields}
    `).bind(snapshot.name, snapshot.targetUrl, snapshot.active ? 1 : 0, snapshot.scans, snapshot.lastAccess,
      snapshot.joinedAt, snapshot.initialReviews, snapshot.currentReviews, snapshot.reviewsUpdatedAt,
      snapshot.ownerName, snapshot.ownerPhone, snapshot.address, snapshot.neighborhood, snapshot.notes,
      snapshot.nextContactAt, now, id, user.userId, snapshot.googlePlaceId, snapshot.googleProfileUrl, snapshot.googleRating,
      snapshot.latitude, snapshot.longitude, snapshot.googleSyncedAt, snapshot.businessPhone, snapshot.reviewSource);
    const results = await database.batch<RawLoja>([archive, restore]);
    const row = results[1].results[0];
    if (!row) throw new ApiError("Plaquinha não encontrada.", 404);
    return Response.json({ loja: lojaFromRaw(row) }, { headers: noCache });
  } catch (error) { return apiError(error); }
}
