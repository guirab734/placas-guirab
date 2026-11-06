import { apiError, jsonBody, noCache, requireApiUser } from "../../../lib/api";
import { resolvePlateDestination } from "../../../lib/resolve-review";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    await requireApiUser(request, true);
    const { url, targetMode } = await jsonBody(request);
    return Response.json(await resolvePlateDestination(url, targetMode), { headers: noCache });
  } catch (error) { return apiError(error); }
}
