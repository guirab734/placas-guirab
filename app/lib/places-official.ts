import { googleDiagnostic, resolveGoogleLinkIdentity, ReviewLinkError } from "./resolve-review";
import type { GooglePlaceProfile } from "./types";

export const PLACES_FIELD_MASK = "id,displayName,formattedAddress,addressComponents,location,rating,userRatingCount,nationalPhoneNumber,googleMapsUri";
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{10,1024}$/.test(value) && !/^\d+$/.test(value);
const clean = (value: unknown, max: number): string | undefined => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value) ? value.trim() : undefined;
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const unavailable = () => new ReviewLinkError("A integração oficial do Google não respondeu. Verifique a configuração ou preencha os dados manualmente.", "GooglePlacesUnavailable");

export function officialPlaceProfile(value: unknown, expectedId: string, fetchedAt = new Date().toISOString()): GooglePlaceProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const place = value as Record<string, any>, name = clean(place.displayName?.text, 100);
  if (!validId(place.id) || place.id !== expectedId || !name) throw new ReviewLinkError("O Google não confirmou o mesmo estabelecimento solicitado.", "GooglePlacesIdentityMismatch");
  const profile: GooglePlaceProfile = { placeId: place.id, name, fetchedAt,
    targetUrl: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(place.id)}`,
    googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.id)}` };
  if (typeof place.googleMapsUri === "string") {
    try {
      const url = new URL(place.googleMapsUri);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port && ["google.com", "www.google.com", "maps.google.com"].includes(url.hostname)) profile.googleMapsUrl = url.href;
    } catch { /* Keep the verified Place ID URL when an optional URI is absent or malformed. */ }
  }
  const address = clean(place.formattedAddress, 300), phone = clean(place.nationalPhoneNumber, 40);
  if (address) profile.address = address;
  if (phone && /^[+\d().\s-]+$/.test(phone) && phone.replace(/\D/g, "").length >= 8 && phone.replace(/\D/g, "").length <= 15) profile.businessPhone = phone;
  if (finite(place.location?.latitude, -90, 90) && finite(place.location?.longitude, -180, 180)) {
    profile.latitude = place.location.latitude; profile.longitude = place.location.longitude;
  }
  if (finite(place.rating, 0, 5)) profile.rating = place.rating;
  if (finite(place.userRatingCount, 0, 10_000_000) && Number.isInteger(place.userRatingCount)) profile.reviewCount = place.userRatingCount;
  if (Array.isArray(place.addressComponents)) for (const type of ["neighborhood", "sublocality_level_1", "sublocality"]) {
    const component = place.addressComponents.find((item: any) => Array.isArray(item?.types) && item.types.includes(type));
    const neighborhood = clean(component?.longText, 100);
    if (neighborhood) { profile.neighborhood = neighborhood; break; }
  }
  return profile;
}

export async function officialGooglePlaceProfile(value: unknown, apiKey: string, fetcher: typeof fetch = fetch): Promise<GooglePlaceProfile> {
  if (!apiKey || apiKey.length > 512 || /[\s\u0000-\u001f]/.test(apiKey)) throw unavailable();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  const bounded: typeof fetch = (input, init) => fetcher(input, { ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
  try {
    const identity = await resolveGoogleLinkIdentity(value, bounded);
    if (!identity.id) throw new ReviewLinkError("Este link de perfil não informa o Place ID. Cole o link oficial de avaliação do estabelecimento para importar com segurança.", "GooglePlaceIdRequired");
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(identity.id)}`);
    url.searchParams.set("languageCode", "pt-BR"); url.searchParams.set("regionCode", "BR");
    const response = await bounded(url.href, { redirect: "manual", headers: {
      Accept: "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": PLACES_FIELD_MASK,
    } });
    googleDiagnostic("official_response", { status: response.status });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw unavailable(); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read(); if (done) break;
        size += chunk.byteLength;
        if (size > 131_072) { await reader.cancel(); throw unavailable(); }
        chunks.push(chunk);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw unavailable(); }
    return officialPlaceProfile(payload, identity.id);
  } catch (error) {
    if (error instanceof ReviewLinkError) throw error;
    throw unavailable();
  } finally { clearTimeout(timer); }
}
