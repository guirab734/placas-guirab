import { adminUser, assertSameOrigin, AuthError } from "./admin-auth";
import { ReviewLinkError } from "./resolve-review";

export class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const noCache = { "Cache-Control": "no-store, max-age=0" };

export async function requireApiUser(request: Request, write = false) {
  const user = await adminUser(request);
  if (!user) throw new ApiError("Entre com a senha para administrar as lojas.", 401);
  if (write) {
    assertSameOrigin(request);
  }
  return user;
}

export async function jsonBody(request: Request, maxBytes = 8192): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("Preencha os dados da loja.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ApiError("Dados muito grandes.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(all)); }
  catch { throw new ApiError("Não foi possível ler os dados enviados."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("Dados inválidos.");
  return value as Record<string, unknown>;
}

export function apiError(error: unknown): Response {
  if (error instanceof ReviewLinkError) return Response.json({ error: error.message,
    ...("reason" in error && typeof error.reason === "string" ? { reason: error.reason } : {}) }, { status: 422, headers: noCache });
  if (error instanceof AuthError) return Response.json({ error: error.message }, {
    status: error.status, headers: { ...noCache, ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) },
  });
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status, headers: noCache });
  if (error instanceof Error && /Informe|Cole|Use um|nome da loja|status informado|alteração/.test(error.message)) {
    return Response.json({ error: error.message }, { status: 400, headers: noCache });
  }
  console.error(JSON.stringify({ event: "api_failed", message: error instanceof Error ? error.message : "Unknown error" }));
  return Response.json({ error: "Não foi possível salvar agora. Tente novamente." }, { status: 500, headers: noCache });
}
