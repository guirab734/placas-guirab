import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { lojas } from "../../../../db/schema";
import { apiError, ApiError, jsonBody, noCache, requireApiUser } from "../../../lib/api";
import { patchValues } from "../../../lib/validation";
import { resolvePlateDestination, savedGoogleDestination, plateTargetMode } from "../../../lib/resolve-review";
import { initialManualReviews } from "../../../lib/manual-reviews";
import { lojaFields, todayDate } from "../../../lib/plates";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const [loja] = await getDb().select(lojaFields).from(lojas)
      .where(and(eq(lojas.id, id), eq(lojas.ownerId, user.userId))).limit(1);
    if (!loja) throw new ApiError("Plaquinha não encontrada.", 404);
    return Response.json({ loja }, { headers: noCache });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request, true);
    const { id } = await context.params;
    const body = await jsonBody(request);
    const patch = patchValues(body);
    const db = getDb();
    const [existing] = await db.select().from(lojas)
      .where(and(eq(lojas.id, id), eq(lojas.ownerId, user.userId))).limit(1);
    if (!existing) throw new ApiError("Plaquinha não encontrada.", 404);
    let changedDestination = false;
    if (patch.targetUrl) {
      plateTargetMode(body.targetMode);
      patch.targetUrl = patch.targetUrl === existing.targetUrl
        ? savedGoogleDestination(patch.targetUrl)
        : (await resolvePlateDestination(patch.targetUrl, body.targetMode)).targetUrl;
      changedDestination = patch.targetUrl !== existing.targetUrl;
    }
    if (patch.active && !(patch.targetUrl || existing.targetUrl)) {
      throw new ApiError("Configure o nome e o link da loja antes de ativar esta placa.", 409);
    }
    if (!existing.targetUrl && patch.targetUrl && patch.active === undefined) patch.active = true;
    if (!existing.targetUrl && patch.targetUrl) patch.joinedAt = patch.joinedAt ?? existing.joinedAt ?? todayDate();
    const now = new Date().toISOString();
    const values = { ...(changedDestination ? { googlePlaceId: null, googleProfileUrl: null, googleRating: null,
      googleSyncedAt: null } : {}), ...patch, initialReviews: initialManualReviews(existing, patch),
      ...('currentReviews' in body || changedDestination ? { reviewSource: "manual" as const } : {}) };
    const reviewsUpdatedAt = values.currentReviews === undefined ? {} : {
      reviewsUpdatedAt: values.currentReviews === null ? null : sql<string | null>`
        CASE WHEN ${lojas.currentReviews} IS NOT ${values.currentReviews} THEN ${now} ELSE ${lojas.reviewsUpdatedAt} END`,
    };
    const [row] = await db.update(lojas).set({ ...values, ...reviewsUpdatedAt, updatedAt: now })
      .where(and(eq(lojas.id, id), eq(lojas.ownerId, user.userId), eq(lojas.targetUrl, existing.targetUrl))).returning(lojaFields);
    if (!row) throw new ApiError("O destino desta placa mudou durante a consulta. Abra o cadastro novamente para revisar os dados.", 409);
    return Response.json({ loja: row }, { headers: noCache });
  } catch (error) { return apiError(error); }
}
