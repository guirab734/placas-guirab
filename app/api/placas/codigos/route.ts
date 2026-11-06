import { env } from "cloudflare:workers";
import { apiError, ApiError, jsonBody, noCache, requireApiUser } from "../../../lib/api";
import { lojaFromRaw, lojaSqlFields, type RawLoja } from "../../../lib/plates";
import { availablePlateCodes, codeCollision, SHORT_CODE } from "../../../lib/plate-codes";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request, true);
    await jsonBody(request);
    const database = env.DB;
    if (!database) throw new Error("The database binding is unavailable.");
    for (let attempt = 0; attempt < 8; attempt++) {
      const existing = await database.prepare("SELECT id, code FROM lojas WHERE owner_id = ?")
        .bind(user.userId).all<{ id: string; code: string }>();
      const pending = existing.results.filter(row => !SHORT_CODE.test(row.code));
      if (!pending.length) return Response.json({ migrated: 0, lojas: [] }, { headers: noCache });
      const codes = await availablePlateCodes(database, pending.length);
      const replacements = JSON.stringify(pending.map((row, i) => ({ id: row.id, previousCode: row.code, code: codes[i] })));
      const now = new Date().toISOString();
      // Save the old URL before updating its code, in the same transaction.
      // The previous-code guard makes concurrent migrations idempotent; aliases are never reassigned.
      const alias = database.prepare(`INSERT INTO plate_code_aliases (code, plate_id, owner_id, created_at)
        SELECT lojas.code, lojas.id, lojas.owner_id, ?3 FROM lojas JOIN json_each(?1) AS item
          ON json_extract(item.value, '$.id') = lojas.id AND json_extract(item.value, '$.previousCode') = lojas.code
        WHERE lojas.owner_id = ?2
        ON CONFLICT(code) DO NOTHING`).bind(replacements, user.userId, now);
      const migrate = database.prepare(`UPDATE lojas SET
          legacy_code = CASE WHEN legacy_code IS NULL AND length(code) BETWEEN 1 AND 9 AND substr(code,1,1) != '0' AND code NOT GLOB '*[^0-9]*' THEN code ELSE legacy_code END,
          plate_number = CASE WHEN plate_number IS NULL AND length(code) BETWEEN 1 AND 9 AND substr(code,1,1) != '0' AND code NOT GLOB '*[^0-9]*' THEN CAST(code AS INTEGER) ELSE plate_number END,
          code = (SELECT json_extract(item.value, '$.code') FROM json_each(?1) AS item
            WHERE json_extract(item.value, '$.id') = lojas.id AND json_extract(item.value, '$.previousCode') = lojas.code),
          updated_at = ?3
        WHERE owner_id = ?2 AND EXISTS (SELECT 1 FROM json_each(?1) AS item
          WHERE json_extract(item.value, '$.id') = lojas.id AND json_extract(item.value, '$.previousCode') = lojas.code)
        RETURNING ${lojaSqlFields}`).bind(replacements, user.userId, now);
      const syncSequence = database.prepare(`INSERT INTO plate_sequence (id, value)
        SELECT 1, COALESCE(MAX(plate_number), 0) FROM lojas WHERE 1
        ON CONFLICT(id) DO UPDATE SET value = MAX(value, excluded.value)`);
      try {
        const result = await database.batch<RawLoja>([alias, migrate, syncSequence]);
        const migrated = result[1].results.map(lojaFromRaw);
        return Response.json({ migrated: migrated.length, lojas: migrated }, { headers: noCache });
      } catch (error) { if (codeCollision(error) && attempt < 7) continue; throw error; }
    }
    throw new ApiError("Não foi possível reservar os códigos. Tente novamente.", 503);
  } catch (error) { return apiError(error); }
}
