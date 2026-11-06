import { fetchGooglePlaceMetadata, googleDiagnostic, resolveReviewLink, ReviewLinkError } from "./resolve-review";
import type { GooglePlaceProfile, Loja } from "./types";
import { officialGooglePlaceProfile } from "./places-official";

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !value.includes("\0") ? value.trim() : undefined;
}
function validPlaceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{10,1024}$/.test(value) && !/^\d+$/.test(value);
}
function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
const notIdentified = () => new ReviewLinkError("Não conseguimos confirmar os dados desse estabelecimento no Google. Preencha manualmente ou tente outro link do perfil.");

export function parseGooglePlaceProfile(raw: string, expected: { fid: string; expectedPlaceId?: string; diagnosticTrace?: string }, fetchedAt = new Date().toISOString()): GooglePlaceProfile {
  let payload: unknown;
  const json = raw.replace(/^\uFEFF/, "").trimStart();
  try { payload = JSON.parse(json.startsWith(")]}'") ? json.slice(4).trimStart() : json); }
  catch { googleDiagnostic("profile_json", { trace: expected.diagnosticTrace, valid: false }); throw notIdentified(); }
  const rows: unknown[][] = [];
  const pending: unknown[] = [payload];
  while (pending.length) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      // Observed public place row: FID [10], name [11], Place ID [78], identity tuple [227].
      // All optional facts come exclusively from this row, never from reviews or nearby-place rows.
      if (typeof node[10] === "string" && node[10].toLowerCase() === expected.fid && validPlaceId(node[78])) rows.push(node);
      for (const child of node) if (child && typeof child === "object") pending.push(child);
    } else if (node && typeof node === "object") {
      for (const child of Object.values(node)) if (child && typeof child === "object") pending.push(child);
    }
  }
  googleDiagnostic("profile_rows", { trace: expected.diagnosticTrace, rowCount: rows.length });
  if (rows.length !== 1) throw notIdentified();
  const row = rows[0], id = row[78] as string, name = text(row[11], 100);
  const tuples = Array.isArray(row[227]) ? row[227] : [];
  const identities = tuples.filter(tuple => Array.isArray(tuple) && typeof tuple[0] === "string" && tuple[0].toLowerCase() === expected.fid);
  if (!name || (expected.expectedPlaceId && id !== expected.expectedPlaceId) || identities.length !== 1 || identities[0][4] !== id || typeof identities[0][3] !== "string" ||
    !/^\/(?:g|m)\/[A-Za-z0-9_-]+$/.test(identities[0][3])) {
    googleDiagnostic("profile_identity", { trace: expected.diagnosticTrace, tupleCount: identities.length, valid: false }); throw notIdentified();
  }
  const profile: GooglePlaceProfile = {
    placeId: id, name, targetUrl: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}`,
    googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(id)}`, fetchedAt,
  };
  const address = text(row[39], 300), neighborhood = text(row[14], 100);
  if (address) profile.address = address;
  if (neighborhood) profile.neighborhood = neighborhood;
  const position = Array.isArray(row[9]) ? row[9] : [];
  if (finite(position[2], -90, 90) && finite(position[3], -180, 180)) {
    profile.latitude = position[2]; profile.longitude = position[3];
  }
  const summary = Array.isArray(row[4]) ? row[4] : [];
  if (finite(summary[7], 0, 5)) profile.rating = summary[7];
  if (finite(summary[8], 0, 10_000_000) && Number.isInteger(summary[8])) profile.reviewCount = summary[8];
  const phone = Array.isArray(row[178]) && Array.isArray(row[178][0]) ? text(row[178][0][0], 40) : undefined;
  if (phone && /^[+\d().\s-]+$/.test(phone) && phone.replace(/\D/g, "").length >= 8 && phone.replace(/\D/g, "").length <= 15) profile.businessPhone = phone;
  googleDiagnostic("profile_ready", { trace: expected.diagnosticTrace, hasAddress: profile.address !== undefined, hasCount: profile.reviewCount !== undefined,
    hasCoordinates: profile.latitude !== undefined, hasRating: profile.rating !== undefined, hasPhone: profile.businessPhone !== undefined });
  return profile;
}

export async function googlePlaceProfile(value: unknown, fetcher: typeof fetch = fetch, apiKey?: string): Promise<GooglePlaceProfile> {
  if (apiKey) return officialGooglePlaceProfile(value, apiKey, fetcher);
  const metadata = await fetchGooglePlaceMetadata(value, fetcher);
  return parseGooglePlaceProfile(metadata.text, metadata);
}

export type GoogleProfileValues = Partial<Pick<Loja, "googlePlaceId" | "googleProfileUrl" | "googleRating" |
  "latitude" | "longitude" | "googleSyncedAt" | "businessPhone" | "reviewSource" | "currentReviews" |
  "initialReviews" | "name" | "address" | "neighborhood">>;

export function profileValues(profile: GooglePlaceProfile, existing: Pick<Loja, "targetUrl" | "name" | "address" | "neighborhood" | "businessPhone" | "initialReviews">,
  explicit: Record<string, unknown>, sync = false): GoogleProfileValues {
  const values: GoogleProfileValues = {
    googlePlaceId: profile.placeId, googleProfileUrl: profile.googleMapsUrl, googleSyncedAt: profile.fetchedAt,
  };
  if (profile.rating !== undefined) values.googleRating = profile.rating;
  if (profile.latitude !== undefined && !('latitude' in explicit)) values.latitude = profile.latitude;
  if (profile.longitude !== undefined && !('longitude' in explicit)) values.longitude = profile.longitude;
  if (profile.businessPhone && !('businessPhone' in explicit) && (sync || !existing.businessPhone)) values.businessPhone = profile.businessPhone;
  if (!('name' in explicit) && !sync && (!existing.name || /^Placa [A-Z0-9]+$/i.test(existing.name))) values.name = profile.name;
  if (profile.address && !('address' in explicit) && (sync || !existing.address)) values.address = profile.address;
  if (profile.neighborhood && !('neighborhood' in explicit) && (sync || !existing.neighborhood)) values.neighborhood = profile.neighborhood;
  if (profile.reviewCount !== undefined) {
    if (!('currentReviews' in explicit)) { values.currentReviews = profile.reviewCount; values.reviewSource = "google"; }
    else values.reviewSource = explicit.currentReviews === profile.reviewCount ? "google" : "manual";
    if (!sync && !existing.targetUrl && existing.initialReviews === null && explicit.initialReviews == null) values.initialReviews = profile.reviewCount;
  }
  return values;
}

// A missing optional profile must not prevent saving a valid Google review link. Both attempts share one deadline.
export async function reviewLinkWithOptionalProfile(value: unknown, fetcher: typeof fetch = fetch, apiKey?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const bounded: typeof fetch = (input, init) => fetcher(input, {
    ...init, signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
  });
  try {
    try {
      const profile = await googlePlaceProfile(value, bounded, apiKey);
      return { targetUrl: profile.targetUrl, profile };
    } catch (profileError) {
      try {
        const resolved = await resolveReviewLink(value, bounded);
        return { targetUrl: resolved.targetUrl, profile: undefined };
      } catch (linkError) {
        if (profileError instanceof ReviewLinkError && profileError.reason === "GooglePlaceIdRequired") throw profileError;
        throw linkError;
      }
    }
  } finally { clearTimeout(timer); }
}
