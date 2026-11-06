import { env } from "cloudflare:workers";
import { desc, eq, getTableColumns } from "drizzle-orm";
import { getDb } from "../../../db";
import { lojas } from "../../../db/schema";
import { apiError, ApiError, jsonBody, noCache, requireApiUser } from "../../lib/api";
import { googleReviewUrl, storeName, patchValues } from "../../lib/validation";
import { resolvePlateDestination } from "../../lib/resolve-review";
import { initialManualReviews } from "../../lib/manual-reviews";
import { lojaFields, lojaFromRaw, lojaSqlFields, todayDate, type RawLoja } from "../../lib/plates";
import { availablePlateCodes, codeCollision } from "../../lib/plate-codes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser(request);
    const rows = await getDb().select(lojaFields).from(lojas).where(eq(lojas.ownerId, user.userId)).orderBy(desc(lojas.updatedAt)).limit(200);
    return Response.json({ lojas: rows }, { headers: noCache });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request, true);
    const body = await jsonBody(request);
    const name = storeName(body.name), resolved = await resolvePlateDestination(googleReviewUrl(body.targetUrl), body.targetMode);
    const targetUrl = resolved.targetUrl;
    const values = patchValues(body);
    const now = new Date().toISOString();
    const database = env.DB;
    if (!database) throw new Error("The database binding is unavailable.");
    for (let attempt = 0; attempt < 8; attempt++) {
      const [code] = await availablePlateCodes(database, 1);
      try {
        const insertValues: typeof lojas.$inferInsert = {
          ...values, id: crypto.randomUUID(), code,
          ownerId: user.userId, name, targetUrl, joinedAt: values.joinedAt ?? todayDate(),
          initialReviews: initialManualReviews({ targetUrl: "", initialReviews: null }, values) ?? null,
          reviewSource: "manual",
          reviewsUpdatedAt: values.currentReviews == null ? null : now,
          createdAt: now, updatedAt: now,
        };
        // Schema-owned column names and bound values; the count and insert are one SQLite write.
        const columns = getTableColumns(lojas);
        const entries = Object.entries(insertValues).filter(([, value]) => value !== undefined).map(([key, value]) => {
          const column = columns[key as keyof typeof columns];
          if (!column) throw new Error("Unknown plate column");
          return { name: column.name, value: typeof value === "boolean" ? Number(value) : value };
        });
        const row = await database.prepare(`INSERT INTO lojas (${entries.map(entry => `"${entry.name}"`).join(", ")})
          SELECT ${entries.map((_, index) => `?${index + 2}`).join(", ")}
          WHERE (SELECT COUNT(*) FROM lojas WHERE owner_id = ?1) < 200
          RETURNING ${lojaSqlFields}`)
          .bind(user.userId, ...entries.map(entry => entry.value)).first<RawLoja>();
        if (!row) throw new ApiError("O painel já tem 200 lojas cadastradas.", 409);
        return Response.json({ loja: lojaFromRaw(row) }, { status: 201, headers: noCache });
      } catch (error) { if (codeCollision(error) && attempt < 7) continue; throw error; }
    }
    throw new ApiError("Não foi possível reservar o código. Tente novamente.", 503);
  } catch (error) { return apiError(error); }
}
