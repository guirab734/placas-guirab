import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { lojas, plateHistory } from "../../../../../db/schema";
import { apiError, ApiError, noCache, requireApiUser } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const db = getDb();
    const [plate] = await db.select({ id: lojas.id }).from(lojas)
      .where(and(eq(lojas.id, id), eq(lojas.ownerId, user.userId))).limit(1);
    if (!plate) throw new ApiError("Plaquinha não encontrada.", 404);
    const historico = await db.select({ id: plateHistory.id, createdAt: plateHistory.createdAt, snapshot: plateHistory.snapshot })
      .from(plateHistory).where(and(eq(plateHistory.plateId, id), eq(plateHistory.ownerId, user.userId)))
      .orderBy(desc(plateHistory.createdAt), desc(plateHistory.id));
    return Response.json({ historico }, { headers: noCache });
  } catch (error) { return apiError(error); }
}
