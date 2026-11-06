export function googleReviewUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("Informe um link de avaliação válido do Google.");
  }
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error("Cole o endereço completo, começando com https://."); }
  const host = url.hostname.toLowerCase();
  const google = host === "google.com" || host.endsWith(".google.com") ||
    host === "google.com.br" || host.endsWith(".google.com.br");
  const short = host === "g.page" || host === "maps.app.goo.gl" || host === "share.google" ||
    (host === "goo.gl" && url.pathname.startsWith("/maps"));
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(google || short)) {
    throw new Error("Use um link HTTPS do Google Maps, g.page ou maps.app.goo.gl.");
  }
  return url.href;
}

export function storeName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > 100) {
    throw new Error("O nome da loja deve ter entre 2 e 100 caracteres.");
  }
  return value.trim();
}

export type LojaPatch = Partial<Pick<Loja, "name" | "targetUrl" | "active" | "joinedAt" |
  "initialReviews" | "currentReviews" | "ownerName" | "ownerPhone" | "address" |
  "neighborhood" | "notes" | "nextContactAt" | "businessPhone" | "latitude" | "longitude">>;

export function coordinateValue(value: unknown, label: string, limit: number): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) throw new ApiError(`Informe ${label} válida.`);
  return value;
}

export function calendarDate(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) {
    throw new ApiError(`Informe uma data válida para ${label}.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ApiError(`Informe uma data real para ${label}.`);
  }
  return value;
}

export function reviewCount(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10_000_000) {
    throw new ApiError(`Informe ${label} como um número inteiro de 0 a 10.000.000.`);
  }
  return value;
}

function textValue(value: unknown, limit: number, label: string): string {
  if (typeof value !== "string" || value.length > limit || /\u0000/.test(value)) {
    throw new ApiError(`Informe ${label} com até ${limit} caracteres.`);
  }
  return value.trim();
}

export function patchValues(body: Record<string, unknown>): LojaPatch {
  const patch: LojaPatch = {};
  if ("name" in body) patch.name = storeName(body.name);
  if ("targetUrl" in body) patch.targetUrl = googleReviewUrl(body.targetUrl);
  if ("active" in body) {
    if (typeof body.active !== "boolean") throw new Error("O status informado é inválido.");
    patch.active = body.active;
  }
  if ("joinedAt" in body) patch.joinedAt = calendarDate(body.joinedAt, "a entrada da loja");
  if ("nextContactAt" in body) patch.nextContactAt = calendarDate(body.nextContactAt, "o próximo contato");
  if ("initialReviews" in body) patch.initialReviews = reviewCount(body.initialReviews, "as avaliações iniciais");
  if ("currentReviews" in body) patch.currentReviews = reviewCount(body.currentReviews, "as avaliações atuais");
  if ("ownerName" in body) patch.ownerName = textValue(body.ownerName, 120, "o nome do responsável");
  for (const key of ["ownerPhone", "businessPhone"] as const) if (key in body) {
    const phone = textValue(body[key], 40, "o telefone");
    const digits = phone.replace(/\D/g, "");
    if (phone && (!/^[+\d().\s-]+$/.test(phone) || digits.length < 8 || digits.length > 15)) {
      throw new ApiError("Informe um telefone com 8 a 15 dígitos, incluindo o DDD.");
    }
    patch[key] = phone;
  }
  if ("address" in body) patch.address = textValue(body.address, 300, "o endereço");
  if ("neighborhood" in body) patch.neighborhood = textValue(body.neighborhood, 100, "o bairro");
  if ("notes" in body) patch.notes = textValue(body.notes, 2000, "as observações");
  if ("latitude" in body) patch.latitude = coordinateValue(body.latitude, "uma latitude", 90);
  if ("longitude" in body) patch.longitude = coordinateValue(body.longitude, "uma longitude", 180);
  if (!Object.keys(patch).length) throw new Error("Informe uma alteração para salvar.");
  return patch;
}
import { ApiError } from "./api";
import type { Loja } from "./types";

