import { env } from "cloudflare:workers";
import { apiError, ApiError, jsonBody, noCache, requireApiUser } from "../../../lib/api";
import { lojaFromRaw, lojaSqlFields, type RawLoja } from "../../../lib/plates";
import { availablePlateCodes, codeCollision } from "../../../lib/plate-codes";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request, true);
    const { quantity } = await jsonBody(request);
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      throw new ApiError("Escolha uma quantidade inteira de 1 a 50 placas.");
    }
    const now = new Date().toISOString();
    const database = env.DB;
    if (!database) throw new Error("The database binding is unavailable.");
    // Both statements run as one D1 transaction. Concurrent batches cannot reuse numbers.
    const reserve = database.prepare(`
      INSERT INTO plate_sequence (id, value)
      SELECT 1, ?1 WHERE (SELECT COUNT(*) FROM lojas WHERE owner_id = ?2) + ?1 <= 200
      ON CONFLICT(id) DO UPDATE SET value = value + excluded.value
    `).bind(quantity, user.userId);
    for (let attempt = 0; attempt < 8; attempt++) {
    const codes = await availablePlateCodes(database, quantity);
    const ids = codes.map(code => ({ id: crypto.randomUUID(), code }));
    const insert = database.prepare(`
      INSERT INTO lojas (id, owner_id, code, plate_number, name, target_url, active, scans, last_access, created_at, updated_at)
      SELECT json_extract(item.value, '$.id'), ?1,
        json_extract(item.value, '$.code'),
        sequence.value - CAST(?2 AS INTEGER) + CAST(item.key AS INTEGER) + 1,
        printf('Placa %03d', sequence.value - ?2 + CAST(item.key AS INTEGER) + 1),
        '', 0, 0, NULL, ?4, ?4
      FROM json_each(?3) AS item CROSS JOIN plate_sequence AS sequence
      WHERE sequence.id = 1 AND (SELECT COUNT(*) FROM lojas WHERE owner_id = ?1) + ?2 <= 200
      RETURNING ${lojaSqlFields}
    `).bind(user.userId, quantity, JSON.stringify(ids), now);
    let result;
    try { result = await database.batch<RawLoja>([reserve, insert]); }
    catch (error) { if (codeCollision(error) && attempt < 7) continue; throw error; }
    const rows = result[1].results;
    if (!rows.length) throw new ApiError("Este painel comporta até 200 placas. Reduza a quantidade do lote.", 409);
    const lojas = rows.map(lojaFromRaw);
    return Response.json({ lojas }, { status: 201, headers: noCache });
    }
    throw new ApiError("Não foi possível reservar os códigos. Tente novamente.", 503);
  } catch (error) { return apiError(error); }
}
