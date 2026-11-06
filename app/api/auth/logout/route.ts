import { apiError, noCache } from "../../../lib/api";
import { assertSameOrigin, endSession } from "../../../lib/admin-auth";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json({ ok: true }, { headers: { ...noCache, "Set-Cookie": await endSession(request) } });
  } catch (error) { return apiError(error); }
}
