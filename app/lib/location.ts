export type LocationAddress = {
  address: string; neighborhood: string; latitude: number; longitude: number;
  displayName: string; source: "OpenStreetMap"; provider: "Photon"; approximate: true;
};

function clean(value: unknown, max = 160) { return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max) : ""; }

// GPS supplies an approximate address, never the identity, phone or reviews of a nearby business.
export function photonAddress(value: unknown, latitude: number, longitude: number): LocationAddress | null {
  if (!value || typeof value !== "object") return null;
  const features = (value as { features?: unknown }).features;
  if (!Array.isArray(features) || !features.length) return null;
  const feature = features[0];
  if (!feature || typeof feature !== "object" || !feature.properties) return null;
  const p = feature.properties as Record<string, unknown>;
  const street = [clean(p.street), clean(p.housenumber, 20)].filter(Boolean).join(", ");
  const neighborhood = clean(p.district) || clean(p.locality);
  const city = clean(p.city);
  const state = clean(p.state);
  const address = [street, neighborhood, [city, state].filter(Boolean).join(" / "), clean(p.postcode, 20)].filter(Boolean).join(" — ");
  if (!address) return null;
  return { address: address.slice(0, 300), neighborhood, latitude, longitude, displayName: address,
    source: "OpenStreetMap", provider: "Photon", approximate: true };
}

export async function reverseLocation(latitude: number, longitude: number): Promise<LocationAddress | null> {
  const url = new URL("https://photon.komoot.io/reverse");
  url.searchParams.set("lat", String(latitude)); url.searchParams.set("lon", String(longitude)); url.searchParams.set("limit", "1");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual", headers: {
      Accept: "application/json", "User-Agent": "GuirabPlaquinhas/1.0 (+https://placas.guirab.com.br)",
    } });
    if (!response.ok || !response.body) { await response.body?.cancel(); return null; }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 65536) { await reader.cancel(); return null; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return photonAddress(JSON.parse(new TextDecoder().decode(bytes)), latitude, longitude);
  } catch { return null; } finally { clearTimeout(timer); }
}
