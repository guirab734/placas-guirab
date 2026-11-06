import { requireApiUser, apiError, noCache } from "../../lib/api";
import { redirectsArePublic } from "../../lib/admin-auth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireApiUser(request);
    return Response.json({ domain: "placas.guirab.com.br", mode: redirectsArePublic() ? "public_redirects" : "private", domainStatus: "active",
      reviewMode: "manual", locationMode: "device" }, { headers: noCache });
  } catch (error) { return apiError(error); }
}
