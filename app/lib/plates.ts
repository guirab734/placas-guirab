import { getTableColumns } from "drizzle-orm";
import { lojas } from "../../db/schema";
import type { Loja } from "./types";
import { shortPlateCode } from "./plate-codes";
import { saoPauloDate } from "./calendar-date";

const { ownerId: _privateOwner, ...fields } = getTableColumns(lojas);
export const lojaFields = fields;

export function opaqueCode(): string {
  return shortPlateCode();
}

export function todayDate(): string {
  return saoPauloDate();
}

export type RawLoja = Omit<Loja, "active"> & { active: boolean | number };
export function lojaFromRaw(row: RawLoja): Loja {
  return { ...row, active: Boolean(row.active) };
}

// Only authenticated handlers use this projection. Public redirects select no CRM fields.
export const lojaSqlFields = `id, code, plate_number AS plateNumber, legacy_code AS legacyCode,
  name, target_url AS targetUrl, active, scans, last_access AS lastAccess,
  joined_at AS joinedAt, initial_reviews AS initialReviews, current_reviews AS currentReviews,
  reviews_updated_at AS reviewsUpdatedAt, owner_name AS ownerName, owner_phone AS ownerPhone,
  address, neighborhood, notes, next_contact_at AS nextContactAt,
  google_place_id AS googlePlaceId, google_profile_url AS googleProfileUrl, google_rating AS googleRating,
  latitude, longitude, google_synced_at AS googleSyncedAt, business_phone AS businessPhone, review_source AS reviewSource,
  created_at AS createdAt, updated_at AS updatedAt`;

// Evaluated inside the write transaction, so reset/restoration archive the actual current state.
export const snapshotSql = `json_object(
  'id', id, 'code', code, 'plateNumber', plate_number, 'legacyCode', legacy_code,
  'name', name, 'targetUrl', target_url, 'active', json(CASE WHEN active THEN 'true' ELSE 'false' END),
  'scans', scans, 'lastAccess', last_access, 'joinedAt', joined_at,
  'initialReviews', initial_reviews, 'currentReviews', current_reviews,
  'reviewsUpdatedAt', reviews_updated_at, 'ownerName', owner_name, 'ownerPhone', owner_phone,
  'address', address, 'neighborhood', neighborhood, 'notes', notes, 'nextContactAt', next_contact_at,
  'googlePlaceId', google_place_id, 'googleProfileUrl', google_profile_url, 'googleRating', google_rating,
  'latitude', latitude, 'longitude', longitude, 'googleSyncedAt', google_synced_at, 'businessPhone', business_phone, 'reviewSource', review_source,
  'createdAt', created_at, 'updatedAt', updated_at)`;

export function emptyPlateName(plateNumber: number | null, code: string): string {
  return plateNumber === null ? `Placa ${code.slice(0, 8).toUpperCase()}` : `Placa ${String(plateNumber).padStart(3, "0")}`;
}
