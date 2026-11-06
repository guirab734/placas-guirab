import { and, eq, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { lojas } from "../../../db/schema";
import { googleReviewUrl } from "../../lib/validation";
import { adminUser, redirectsArePublic } from "../../lib/admin-auth";
import { normalizePlateCode } from "../../lib/plate-codes";

export const dynamic = "force-dynamic";

function unavailable(status: number) {
  const message = status === 200 ? "Esta plaquinha ainda não foi ativada." : status === 410 ? "Esta plaquinha está pausada." : "Não encontramos esta plaquinha.";
  const help = status === 200 ? "Em breve, este código abrirá a avaliação da loja. A ativação é feita pelo responsável no painel." : "Peça ajuda à equipe da loja para deixar sua avaliação.";
  return new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${status === 200 ? "Aguardando ativação" : "Plaquinha indisponível"}</title><style>body{font:16px system-ui;background:#f6f8fc;margin:0;display:grid;place-items:center;min-height:100vh}main{padding:36px;background:white;border-radius:20px;max-width:440px;margin:20px}h1{font-size:24px;color:#202124}p{line-height:1.6;color:#5f6368}</style><main><h1>${message}</h1><p>${help}</p></main></html>`, {
    status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

async function resolve(code: string, record: boolean) {
  const normalized = normalizePlateCode(code);
  if (!normalized) return unavailable(404);
  code = normalized;
  const db = getDb();
  const matches = await db.select({ id: lojas.id, targetUrl: lojas.targetUrl, active: lojas.active }).from(lojas)
    .where(or(eq(lojas.code, code), eq(lojas.legacyCode, code), sql`EXISTS (
      SELECT 1 FROM plate_code_aliases AS alias WHERE alias.plate_id = ${lojas.id} AND alias.code = ${code}
    )`)).limit(2);
  if (matches.length !== 1) return unavailable(404);
  const [loja] = matches;
  if (!loja.targetUrl) return unavailable(200);
  if (!loja.active) return unavailable(410);
  let target: string;
  try { target = googleReviewUrl(loja.targetUrl); } catch { return unavailable(410); }
  if (record) {
    try {
      await db.update(lojas).set({ scans: sql`${lojas.scans} + 1`, lastAccess: new Date().toISOString() })
        .where(and(eq(lojas.id, loja.id), eq(lojas.targetUrl, loja.targetUrl), eq(lojas.active, true)));
    } catch {
      // Counting must never prevent a customer from reaching the review form.
      console.error(JSON.stringify({ event: "redirect_counter_failed", code }));
    }
  }
  return new Response(null, { status: 302, headers: {
    Location: target, "Cache-Control": "no-store, max-age=0", Pragma: "no-cache",
    "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer",
  } });
}

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  if (!redirectsArePublic() && !await adminUser(request)) return new Response(null, { status: 302, headers: {
    Location: `/login?return_to=${encodeURIComponent(new URL(request.url).pathname)}`, "Cache-Control": "no-store",
  } });
  const { code } = await context.params;
  return resolve(code, true);
}
export async function HEAD(request: Request, context: { params: Promise<{ code: string }> }) {
  if (!redirectsArePublic() && !await adminUser(request)) return new Response(null, { status: 302, headers: {
    Location: `/login?return_to=${encodeURIComponent(new URL(request.url).pathname)}`, "Cache-Control": "no-store",
  } });
  const { code } = await context.params;
  return resolve(code, false);
}
