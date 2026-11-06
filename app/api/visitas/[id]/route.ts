import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { visitas } from "../../../../db/schema";
import { apiError, ApiError, jsonBody, noCache, requireApiUser } from "../../../lib/api";
import { publicVisit, visitValues } from "../../../lib/visits";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request, true);
    const { id } = await context.params;
    const values = visitValues(await jsonBody(request, 262144));
    const patch = { ...values, updatedAt: new Date().toISOString() };
    const [row] = await getDb().update(visitas).set(patch)
      .where(and(eq(visitas.id, id), eq(visitas.ownerId, user.userId))).returning();
    if (!row) throw new ApiError("Visita não encontrada.", 404);
    return Response.json({ visita: publicVisit(row) }, { headers: noCache });
  } catch (error) { return apiError(error); }
}
