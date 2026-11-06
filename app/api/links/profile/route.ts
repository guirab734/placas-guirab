import { ApiError, apiError, jsonBody, requireApiUser } from "../../../lib/api";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    await requireApiUser(request, true);
    await jsonBody(request);
    throw new ApiError("As avaliações são preenchidas manualmente neste painel. Use o formulário do estabelecimento.", 409);
  } catch (error) { return apiError(error); }
}
