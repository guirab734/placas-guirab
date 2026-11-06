import { ApiError } from "./api";
import { coordinateValue, googleReviewUrl, patchValues } from "./validation";
import type { Loja } from "./types";

export type RestorablePlate = Pick<Loja, "name" | "targetUrl" | "active" | "scans" | "lastAccess" |
  "joinedAt" | "initialReviews" | "currentReviews" | "reviewsUpdatedAt" | "ownerName" |
  "ownerPhone" | "address" | "neighborhood" | "notes" | "nextContactAt" | "googlePlaceId" |
  "googleProfileUrl" | "googleRating" | "latitude" | "longitude" | "googleSyncedAt" | "businessPhone" | "reviewSource">;

const keys = ["name", "targetUrl", "active", "scans", "lastAccess", "joinedAt", "initialReviews",
  "currentReviews", "reviewsUpdatedAt", "ownerName", "ownerPhone", "address", "neighborhood", "notes", "nextContactAt"] as const;

function timestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
}

export function restorablePlate(value: unknown): RestorablePlate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("Histórico inválido.", 409);
  const record = value as Record<string, unknown>;
  if (keys.some(key => !(key in record)) || typeof record.targetUrl !== "string" || typeof record.active !== "boolean" ||
    typeof record.scans !== "number" || !Number.isSafeInteger(record.scans) || record.scans < 0 ||
    !timestamp(record.lastAccess) || !timestamp(record.reviewsUpdatedAt)) throw new ApiError("Histórico inválido.", 409);
  const { targetUrl: _target, ...crm } = record;
  const patch = patchValues(crm);
  const googlePlaceId = record.googlePlaceId ?? null;
  if (googlePlaceId !== null && (typeof googlePlaceId !== "string" || !/^[A-Za-z0-9_-]{10,1024}$/.test(googlePlaceId) || /^\d+$/.test(googlePlaceId))) throw new ApiError("Histórico inválido.", 409);
  const googleProfileUrl = record.googleProfileUrl == null ? null : googleReviewUrl(record.googleProfileUrl);
  const googleRating = record.googleRating ?? null;
  if (googleRating !== null && (typeof googleRating !== "number" || !Number.isFinite(googleRating) || googleRating < 0 || googleRating > 5)) throw new ApiError("Histórico inválido.", 409);
  const googleSyncedAt = record.googleSyncedAt ?? null;
  if (!timestamp(googleSyncedAt) || (record.reviewSource !== undefined && record.reviewSource !== "manual" && record.reviewSource !== "google")) throw new ApiError("Histórico inválido.", 409);
  // Empty links represent stock; every saved destination remains constrained to Google HTTPS.
  const targetUrl = record.targetUrl === "" ? "" : googleReviewUrl(record.targetUrl);
  if (record.active && !targetUrl) throw new ApiError("O histórico não tem um destino válido para ativação.", 409);
  return {
    ...patch, name: patch.name!, targetUrl, active: record.active, scans: record.scans,
    lastAccess: record.lastAccess, joinedAt: patch.joinedAt!, initialReviews: patch.initialReviews!,
    currentReviews: patch.currentReviews!, reviewsUpdatedAt: record.reviewsUpdatedAt,
    ownerName: patch.ownerName!, ownerPhone: patch.ownerPhone!, address: patch.address!,
    neighborhood: patch.neighborhood!, notes: patch.notes!, nextContactAt: patch.nextContactAt!,
    googlePlaceId, googleProfileUrl, googleRating, googleSyncedAt,
    latitude: coordinateValue(record.latitude ?? null, "uma latitude", 90),
    longitude: coordinateValue(record.longitude ?? null, "uma longitude", 180),
    businessPhone: patch.businessPhone ?? "", reviewSource: record.reviewSource === "google" ? "google" : "manual",
  };
}

export function historyId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value)) throw new ApiError("Escolha um histórico válido.");
  return value;
}
