import type { Loja } from "./types";

type Coordinates = Pick<Loja, "latitude" | "longitude">;

export function hasPlateLocation<T extends Coordinates>(value: T): value is T & { latitude: number; longitude: number } {
  return typeof value.latitude === "number" && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 85
    && typeof value.longitude === "number" && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}

export function plateLocationLabel(value: Coordinates & Pick<Loja, "address" | "neighborhood">): string {
  const address = value.address.trim(), neighborhood = value.neighborhood.trim();
  const normalized = (text: string) => ` ${text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  if (address) return neighborhood && !normalized(address).includes(normalized(neighborhood)) ? `${address} · ${neighborhood}` : address;
  if (neighborhood) return neighborhood;
  return hasPlateLocation(value) ? `${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}` : "Sem localização cadastrada";
}
