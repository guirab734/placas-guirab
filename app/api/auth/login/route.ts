import { apiError, jsonBody, noCache } from "../../../lib/api";
import { assertSameOrigin, AuthError, newSession, throttleLogin, verifyPassword } from "../../../lib/admin-auth";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await jsonBody(request);
    if (typeof body.password !== "string" || body.password.length < 1 || body.password.length > 256) {
      throw new AuthError("Informe sua senha.", 400);
    }
    await throttleLogin(request);
    if (!await verifyPassword(body.password)) throw new AuthError("Senha incorreta.", 401);
    return Response.json({ ok: true }, { headers: { ...noCache, "Set-Cookie": await newSession(request) } });
  } catch (error) { return apiError(error); }
}
