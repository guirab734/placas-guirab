import { jsonBody, noCache, requireApiUser } from "../../../lib/api";
import { regionStreets } from "../../../lib/map-regions";
import { claimMapRequest, mapApiError, mapRateLimit } from "../../../lib/map-api";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    await requireApiUser(request, true);
    const { region } = await jsonBody(request, 524_288);
    if (!await claimMapRequest()) return mapRateLimit();
    return Response.json(await regionStreets(region), { headers: noCache });
  } catch (error) { return mapApiError(error); }
}
