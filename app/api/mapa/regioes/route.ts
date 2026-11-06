import { jsonBody, noCache, requireApiUser } from "../../../lib/api";
import { localRegions, regionQuery, searchRegions } from "../../../lib/map-regions";
import { claimMapRequest, mapApiError, mapRateLimit } from "../../../lib/map-api";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    await requireApiUser(request, true);
    const query = regionQuery((await jsonBody(request)).query);
    const local = localRegions(query);
    if (local !== null) return Response.json({ regions: local }, { headers: noCache });
    if (!await claimMapRequest()) return mapRateLimit();
    return Response.json({ regions: await searchRegions(query) }, { headers: noCache });
  } catch (error) { return mapApiError(error); }
}
