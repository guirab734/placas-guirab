import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { lojas } from "../../../../../db/schema";
import { apiError, ApiError, jsonBody, requireApiUser } from "../../../../lib/api";

export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request, true);
    await jsonBody(request);
    const { id } = await context.params;
    const db = getDb();
    const [existing] = await db.select().from(lojas).where(and(eq(lojas.id, id), eq(lojas.ownerId, user.userId))).limit(1);
    if (!existing) throw new ApiError("Plaquinha não encontrada.", 404);
    throw new ApiError("As avaliações são atualizadas manualmente. Edite a contagem no cadastro do estabelecimento.", 409);
  } catch (error) { return apiError(error); }
}
