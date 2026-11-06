import { jsonBody, noCache, requireApiUser } from "../../../lib/api";
import { regionBoundary } from "../../../lib/map-regions";
import { claimMapRequest, mapApiError, mapRateLimit } from "../../../lib/map-api";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    await requireApiUser(request, true);
    const { region } = await jsonBody(request, 524_288);
    if (!await claimMapRequest()) return mapRateLimit();
    return Response.json({ region: await regionBoundary(region) }, { headers: noCache });
  } catch (error) { return mapApiError(error); }
}
